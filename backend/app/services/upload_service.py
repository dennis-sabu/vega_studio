"""VEGA Studio Backend – Phase 9 Firmware Upload Orchestration Service."""
from __future__ import annotations

import ast
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Sequence, Set, Tuple

from app.config import Settings, is_frozen_backend, settings
from app.models.board import BoardProfile
from app.models.sdk import SdkConfig
from app.models.upload import (
    DeviceListResponse,
    FirmwareArtifactInfo,
    SerialDeviceInfo,
    UploadCheckStatus,
    UploadHistoryResponse,
    UploadInvocationMode,
    UploadLogLine,
    UploadPreflightCheck,
    UploadPreflightRequest,
    UploadPreflightResponse,
    UploadRequest,
    UploadStateResponse,
    UploadStatus,
    UploadStream,
    UploadSummary,
    validate_upload_id,
)
from app.services.board_service import BoardService
from app.services.explorer_service import ExplorerService, ExplorerServiceError
from app.services.process_utils import terminate_process_tree, utc_now_iso
from app.services.project_service import ProjectService, ProjectServiceError
from app.services.sdk_service import (
    SdkService,
    _build_safe_subprocess_env,
    _host_os_name,
    _resolve_existing_path,
)

MAX_UPLOAD_LOG_LINES = 5000
MAX_UPLOAD_HISTORY = 25
MAX_SCAN_ENTRIES = 1500
MAX_SCAN_DEPTH = 4
_MAX_UPLOADER_AST_BYTES = 1024 * 1024

_IGNORED_SCAN_DIRS = frozenset(
    {
        ".git",
        ".vega-studio",
        ".vscode",
        ".idea",
        "node_modules",
        "__pycache__",
        ".venv",
    }
)
_PREFERRED_ARTIFACT_DIRS = ("build", "out", "bin", "debug", "release")

# Parse explicit percentage progress ONLY when output clearly reflects transfer progress.
_EXPLICIT_PROGRESS_RE = re.compile(
    r"(?:upload|send|flash|transfer|xmodem|progress|block|packet|write|verify|bytes)[^\r\n]{0,80}?\b(100|[1-9]?\d(?:\.\d+)?)%",
    re.IGNORECASE,
)
_EXPLICIT_PERCENT_FRACTION_RE = re.compile(
    r"(?:^|\s)(100|[1-9]?\d)%\s*(?:\(|$|\s+done|\s+complete|\s+sent)",
    re.IGNORECASE,
)


class UploadServiceError(Exception):
    """Domain error with HTTP status code for firmware upload operations."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def parse_explicit_upload_progress(line_text: str) -> Optional[float]:
    """Extract progress percentage strictly when explicitly reported by uploader output."""
    text = line_text.strip()
    if not text or "%" not in text:
        return None
    for pattern in (_EXPLICIT_PROGRESS_RE, _EXPLICIT_PERCENT_FRACTION_RE):
        m = pattern.search(text)
        if m:
            try:
                pct = float(m.group(1))
                if 0.0 <= pct <= 100.0:
                    return round(pct, 1)
            except ValueError:
                return None
    return None


@dataclass
class UploaderContractInfo:
    """Result of safe static inspection of configured uploader script/executable."""

    is_python: bool
    syntax_ok: bool
    syntax_error: Optional[str] = None
    dependencies_ok: bool = True
    missing_dependencies: List[str] = field(default_factory=list)
    port_flag: Optional[str] = None
    file_flag: Optional[str] = None
    convention_verified: bool = False
    contract_source: str = "provisional_adapter"
    notes: List[str] = field(default_factory=list)


def _inspect_argparse_option_names(tree: ast.AST) -> Tuple[Optional[str], Optional[str], bool]:
    """Detect argparse option flags (e.g. --port / --file) or sys.argv usage via read-only AST."""
    port_flag: Optional[str] = None
    file_flag: Optional[str] = None
    uses_sys_argv = False

    port_candidates = ("--port", "-p", "--device", "-d", "--tty")
    file_candidates = ("--file", "-f", "--firmware", "--bin", "--binary", "-i")

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "argv"
            and isinstance(node.value, ast.Name)
            and node.value.id == "sys"
        ):
            uses_sys_argv = True

        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "add_argument":
                str_args = [
                    arg.value
                    for arg in node.args
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                ]
                for cand in port_candidates:
                    if cand in str_args and port_flag is None:
                        port_flag = cand
                        break
                for cand in file_candidates:
                    if cand in str_args and file_flag is None:
                        file_flag = cand
                        break

    return port_flag, file_flag, uses_sys_argv


@dataclass
class UploadRunRecord:
    """Runtime tracking record for an active or completed firmware upload."""

    summary: UploadSummary
    logs: Deque[UploadLogLine] = field(
        default_factory=lambda: deque(maxlen=MAX_UPLOAD_LOG_LINES)
    )
    subscribers: Set[Tuple[asyncio.Queue[Dict[str, Any]], asyncio.AbstractEventLoop]] = field(
        default_factory=set
    )
    cancel_event: threading.Event = field(default_factory=threading.Event)
    active_proc: Optional[subprocess.Popen[str]] = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    seq_counter: int = 0
    worker_thread: Optional[threading.Thread] = None

    def snapshot(self) -> Tuple[UploadSummary, List[UploadLogLine]]:
        with self.lock:
            return self.summary.model_copy(deep=True), list(self.logs)


class UploadService:
    """Orchestrates preflight validation, device discovery, and safe firmware uploads."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._explorer = ExplorerService(self._settings)
        self._projects = ProjectService(self._settings)
        self._sdk = SdkService(self._settings)
        self._boards = BoardService(self._settings)

        self._state_lock = threading.Lock()
        self._active_upload_id: Optional[str] = None
        self._latest_upload_id: Optional[str] = None
        self._runs: Dict[str, UploadRunRecord] = {}
        self._history: Deque[str] = deque(maxlen=MAX_UPLOAD_HISTORY)

    # ------------------------------------------------------------------ #
    # Serial device discovery (no hardcoded ports)
    # ------------------------------------------------------------------ #

    def _probe_pyserial_ports(
        self, eff: SdkConfig
    ) -> Tuple[Optional[List[SerialDeviceInfo]], Optional[str]]:
        """Query pyserial.tools.list_ports safely if available in configured/backend Python."""
        py_exe = _resolve_existing_path(eff.python_path)
        env = _build_safe_subprocess_env(eff)
        probe_script = (
            "import json, serial.tools.list_ports as lp\n"
            "out = []\n"
            "for p in lp.comports():\n"
            "    out.append({\n"
            "        'port': getattr(p, 'device', '') or '',\n"
            "        'description': getattr(p, 'description', '') or '',\n"
            "        'hardware_id': getattr(p, 'hwid', None),\n"
            "        'manufacturer': getattr(p, 'manufacturer', None),\n"
            "        'serial_number': getattr(p, 'serial_number', None),\n"
            "        'vid': f'{p.vid:04X}' if getattr(p, 'vid', None) is not None else None,\n"
            "        'pid': f'{p.pid:04X}' if getattr(p, 'pid', None) is not None else None,\n"
            "    })\n"
            "print(json.dumps(out))\n"
        )

        # Prefer running probe under configured Python when pyserial exists there,
        # otherwise fall back to bundled/in-process pyserial when available.
        raw_list: Optional[List[Any]] = None
        target_py: Optional[Path] = py_exe if (py_exe and py_exe.is_file()) else None
        if target_py is None and not is_frozen_backend() and importlib.util.find_spec("serial") is not None:
            target_py = Path(sys.executable)

        if target_py is not None:
            try:
                proc = subprocess.run(
                    [str(target_py), "-c", probe_script],
                    shell=False,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=3.5,
                    encoding="utf-8",
                    errors="replace",
                )
                if proc.returncode == 0:
                    parsed = json.loads(proc.stdout.strip() or "[]")
                    if not isinstance(parsed, list):
                        return None, "Unexpected pyserial port enumeration format."
                    raw_list = parsed
            except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError):
                raw_list = None

        if raw_list is None:
            if importlib.util.find_spec("serial") is None:
                return None, None
            try:
                import serial.tools.list_ports as lp  # type: ignore[import-untyped]

                raw_list = []
                for p in lp.comports():
                    vid_val = getattr(p, "vid", None)
                    pid_val = getattr(p, "pid", None)
                    raw_list.append(
                        {
                            "port": getattr(p, "device", "") or "",
                            "description": getattr(p, "description", "") or "",
                            "hardware_id": getattr(p, "hwid", None),
                            "manufacturer": getattr(p, "manufacturer", None),
                            "serial_number": getattr(p, "serial_number", None),
                            "vid": f"{vid_val:04X}" if vid_val is not None else None,
                            "pid": f"{pid_val:04X}" if pid_val is not None else None,
                        }
                    )
            except Exception:
                return None, None

        devices: List[SerialDeviceInfo] = []
        for entry in raw_list:
            if not isinstance(entry, dict):
                continue
            dev_path = str(entry.get("port") or "").strip()
            if not dev_path:
                continue
            desc = str(entry.get("description") or "").strip()
            mfg = entry.get("manufacturer")
            label = f"{dev_path} — {desc}" if desc and desc.lower() != "n/a" else dev_path
            accessible: Optional[bool] = None
            if _host_os_name() != "windows" and dev_path.startswith("/dev/"):
                accessible = os.access(dev_path, os.R_OK | os.W_OK)
            devices.append(
                SerialDeviceInfo(
                    port=dev_path,
                    display_name=label,
                    description=desc,
                    hardware_id=entry.get("hardware_id"),
                    manufacturer=str(mfg) if mfg else None,
                    serial_number=(
                        str(entry.get("serial_number"))
                        if entry.get("serial_number")
                        else None
                    ),
                    vendor_id=entry.get("vid"),
                    product_id=entry.get("pid"),
                    transport="usb-uart",
                    accessible=accessible,
                )
            )
        return devices, None

    @staticmethod
    def _discover_linux_devfs_ports() -> Tuple[List[SerialDeviceInfo], List[str]]:
        """Enumerate Linux /dev/serial/by-id, /dev/ttyUSB*, and /dev/ttyACM* without pyserial."""
        devices: List[SerialDeviceInfo] = []
        warnings: List[str] = []
        covered_realpaths: Set[str] = set()

        by_id_dir = Path("/dev/serial/by-id")
        if by_id_dir.is_dir():
            try:
                for entry in sorted(by_id_dir.iterdir(), key=lambda p: p.name):
                    try:
                        resolved = entry.resolve(strict=True)
                    except OSError:
                        continue
                    if not resolved.as_posix().startswith("/dev/"):
                        continue
                    covered_realpaths.add(str(resolved))
                    accessible = os.access(resolved, os.R_OK | os.W_OK)
                    if not accessible:
                        warnings.append(
                            f"Permission denied for {resolved.name} ({entry.name}). Add user to dialout/uucp group."
                        )
                    devices.append(
                        SerialDeviceInfo(
                            port=str(entry),
                            display_name=f"{entry.name} -> {resolved.name}",
                            description=f"Stable serial link to {resolved}",
                            stable_path=str(entry),
                            transport="usb-uart",
                            accessible=accessible,
                        )
                    )
            except OSError:
                pass

        dev_root = Path("/dev")
        for pattern in ("ttyUSB*", "ttyACM*"):
            try:
                for entry in sorted(dev_root.glob(pattern), key=lambda p: p.name):
                    try:
                        resolved = str(entry.resolve(strict=True))
                    except OSError:
                        continue
                    if resolved in covered_realpaths:
                        continue
                    covered_realpaths.add(resolved)
                    accessible = os.access(entry, os.R_OK | os.W_OK)
                    if not accessible:
                        warnings.append(
                            f"Permission denied for {entry}. Add user to dialout/uucp group before uploading."
                        )
                    devices.append(
                        SerialDeviceInfo(
                            port=str(entry),
                            display_name=str(entry),
                            description="Linux USB/ACM serial device",
                            transport="usb-uart",
                            accessible=accessible,
                        )
                    )
            except OSError:
                continue

        return devices, warnings

    def _discover_windows_registry_ports(self) -> List[SerialDeviceInfo]:
        """Enumerate Windows COM ports safely via HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM."""
        try:
            import winreg  # type: ignore[import-not-found]
        except ImportError:
            return []

        devices: List[SerialDeviceInfo] = []
        try:
            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM"
            ) as key:
                idx = 0
                while True:
                    try:
                        name, value, _ = winreg.EnumValue(key, idx)
                        idx += 1
                    except OSError:
                        break
                    com_port = str(value or "").strip()
                    if not com_port:
                        continue
                    devices.append(
                        SerialDeviceInfo(
                            port=com_port,
                            display_name=f"{com_port} ({name.split('\\')[-1]})",
                            description=str(name),
                            transport="serial",
                        )
                    )
        except OSError:
            return []

        devices.sort(key=lambda d: d.port)
        return devices

    def discover_devices(self) -> DeviceListResponse:
        """Discover serial/USB-UART devices cleanly using platform-compatible fallbacks."""
        base_cfg = self._sdk.get_config_state().config
        eff = self._sdk.discover_environment(
            config_hint=base_cfg, apply_to_config=False
        ).suggested_config
        host_os = _host_os_name()
        warnings: List[str] = []
        notes: List[str] = []

        pyserial_devices, probe_err = self._probe_pyserial_ports(eff)
        if probe_err:
            warnings.append(probe_err)

        if pyserial_devices is not None:
            # On Linux enrich/prefer stable /dev/serial/by-id aliases alongside pyserial results
            if host_os != "windows":
                devfs_devices, dev_warnings = self._discover_linux_devfs_ports()
                warnings.extend(dev_warnings)
                by_real: Dict[str, SerialDeviceInfo] = {}
                for d in devfs_devices:
                    if d.stable_path:
                        try:
                            by_real[str(Path(d.stable_path).resolve())] = d
                        except OSError:
                            pass
                merged: List[SerialDeviceInfo] = []
                seen_ports: Set[str] = set()
                for d in pyserial_devices:
                    stable = by_real.get(d.port)
                    if stable and stable.stable_path:
                        merged.append(
                            d.model_copy(
                                update={
                                    "port": stable.stable_path,
                                    "stable_path": stable.stable_path,
                                    "display_name": f"{d.display_name} ({Path(stable.stable_path).name})",
                                }
                            )
                        )
                        seen_ports.add(stable.stable_path)
                    else:
                        merged.append(d)
                        seen_ports.add(d.port)
                for d in devfs_devices:
                    if d.port not in seen_ports:
                        merged.append(d)
                pyserial_devices = merged

            if not pyserial_devices:
                notes.append(
                    "No serial/USB-UART devices currently connected."
                )
            return DeviceListResponse(
                platform_os=host_os,
                discovery_method="pyserial",
                discovery_supported=True,
                devices=pyserial_devices,
                warnings=warnings,
                notes=notes,
            )

        if host_os == "windows":
            win_devices = self._discover_windows_registry_ports()
            notes.append(
                "PySerial is not installed in the active Python environment; queried Windows SERIALCOMM registry."
            )
            if not win_devices:
                notes.append(
                    "No active Windows COM ports detected. Actual VEGA ARIES V3 hardware validation targets Ubuntu Linux; you can also specify a test port for mock workflows."
                )
            return DeviceListResponse(
                platform_os=host_os,
                discovery_method="windows_registry",
                discovery_supported=True,
                devices=win_devices,
                warnings=warnings,
                notes=notes,
            )

        linux_devices, linux_warnings = self._discover_linux_devfs_ports()
        warnings.extend(linux_warnings)
        notes.append(
            "PySerial is not installed; scanned /dev/serial/by-id, /dev/ttyUSB*, and /dev/ttyACM*."
        )
        if not linux_devices:
            notes.append("No serial USB-UART devices currently connected under /dev.")
        return DeviceListResponse(
            platform_os=host_os,
            discovery_method="linux_devfs",
            discovery_supported=True,
            devices=linux_devices,
            warnings=warnings,
            notes=notes,
        )

    # ------------------------------------------------------------------ #
    # Firmware artifact discovery & staleness checks
    # ------------------------------------------------------------------ #

    def _latest_source_mtime(self, project_root: Path, meta: Any) -> float:
        """Return newest mtime among project source, include, and Makefile files."""
        latest = 0.0
        candidates: List[Path] = []
        if meta is not None:
            for rel in (
                meta.build.makefile,
                meta.build.sourceDir,
                meta.build.includeDir,
            ):
                p = (project_root / rel).resolve(strict=False)
                if p.is_relative_to(project_root):
                    candidates.append(p)
        else:
            candidates.append(project_root)

        source_exts = frozenset({".c", ".h", ".cpp", ".hpp", ".cc", ".s", ".asm", ".mk", ""})
        seen_count = 0

        def _walk(target: Path, depth: int) -> None:
            nonlocal latest, seen_count
            if seen_count >= MAX_SCAN_ENTRIES or depth > MAX_SCAN_DEPTH:
                return
            try:
                if target.is_symlink() and not target.resolve(strict=True).is_relative_to(project_root):
                    return
                if target.is_file():
                    seen_count += 1
                    if target.suffix.lower() in source_exts or target.name.lower() == "makefile":
                        latest = max(latest, target.stat().st_mtime)
                elif target.is_dir() and target.name not in _IGNORED_SCAN_DIRS:
                    for child in target.iterdir():
                        _walk(child, depth + 1)
            except OSError:
                return

        for cand in candidates:
            if cand.exists():
                _walk(cand, 0)
        return latest

    def _discover_artifacts(
        self,
        project_root: Path,
        meta: Any,
        allowed_extensions: Sequence[str],
    ) -> Tuple[List[FirmwareArtifactInfo], List[str]]:
        """Locate valid compiled firmware artifacts confined cleanly to project_root."""
        ext_set = frozenset(e.lower() for e in allowed_extensions)
        ext_rank = {e.lower(): idx for idx, e in enumerate(allowed_extensions)}
        latest_src_mtime = self._latest_source_mtime(project_root, meta)

        found: List[Tuple[int, int, float, FirmwareArtifactInfo]] = []
        zero_byte_warnings: List[str] = []
        scanned = 0

        def _scan(directory: Path, depth: int) -> None:
            nonlocal scanned
            if depth > MAX_SCAN_DEPTH or scanned >= MAX_SCAN_ENTRIES:
                return
            try:
                entries = list(directory.iterdir())
            except OSError:
                return

            for entry in entries:
                if scanned >= MAX_SCAN_ENTRIES:
                    return
                scanned += 1
                try:
                    if entry.is_symlink():
                        resolved = entry.resolve(strict=True)
                        if not resolved.is_relative_to(project_root):
                            continue
                    if entry.is_dir():
                        if entry.name not in _IGNORED_SCAN_DIRS:
                            _scan(entry, depth + 1)
                        continue
                    if not entry.is_file():
                        continue
                    suffix = entry.suffix.lower()
                    if suffix not in ext_set:
                        continue
                    rel = entry.relative_to(project_root).as_posix()
                    st = entry.stat()
                    if st.st_size <= 0:
                        zero_byte_warnings.append(
                            f"Ignored empty 0-byte artifact '{rel}'. Rebuild project to generate valid firmware."
                        )
                        continue
                    stale = latest_src_mtime > 0.0 and (st.st_mtime + 0.01) < latest_src_mtime
                    stale_reason = (
                        "Project source files or Makefile are newer than this firmware artifact. Run Build to refresh."
                        if stale
                        else None
                    )
                    top_dir = rel.split("/", 1)[0].lower() if "/" in rel else ""
                    dir_rank = 0 if top_dir in _PREFERRED_ARTIFACT_DIRS else 1
                    e_rank = ext_rank.get(suffix, 99)
                    info = FirmwareArtifactInfo(
                        relative_path=rel,
                        name=entry.name,
                        extension=suffix,
                        size_bytes=st.st_size,
                        modified_at=datetime.fromtimestamp(
                            st.st_mtime, tz=timezone.utc
                        ).isoformat(),
                        stale=stale,
                        stale_reason=stale_reason,
                    )
                    found.append((dir_rank, e_rank, -st.st_mtime, info))
                except OSError:
                    continue

        _scan(project_root, 0)
        found.sort(key=lambda item: (item[0], item[1], item[2], item[3].relative_path))
        return [item[3] for item in found], zero_byte_warnings

    # ------------------------------------------------------------------ #
    # Uploader script inspection & adaptable argument mapping
    # ------------------------------------------------------------------ #

    def _inspect_uploader_contract(
        self,
        uploader_path: Path,
        eff: SdkConfig,
    ) -> UploaderContractInfo:
        """Inspect configured uploader safely without running arbitrary untrusted code."""
        if uploader_path.suffix.lower() != ".py":
            return UploaderContractInfo(
                is_python=False,
                syntax_ok=True,
                dependencies_ok=True,
                convention_verified=False,
                contract_source="provisional_adapter",
                notes=[
                    f"Configured uploader '{uploader_path.name}' is a non-Python executable; running via adaptable positional arguments [<port>, <firmware>]."
                ],
            )

        try:
            if uploader_path.stat().st_size > _MAX_UPLOADER_AST_BYTES:
                return UploaderContractInfo(
                    is_python=True,
                    syntax_ok=False,
                    syntax_error="Uploader Python script exceeds 1 MiB safety limit.",
                    dependencies_ok=False,
                )
            source = uploader_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(uploader_path))
        except SyntaxError as exc:
            return UploaderContractInfo(
                is_python=True,
                syntax_ok=False,
                syntax_error=f"Python syntax error in '{uploader_path.name}' (line {exc.lineno}): {exc.msg}",
                dependencies_ok=False,
            )
        except (OSError, UnicodeDecodeError) as exc:
            return UploaderContractInfo(
                is_python=True,
                syntax_ok=False,
                syntax_error=f"Unable to read uploader script '{uploader_path.name}': {exc}",
                dependencies_ok=False,
            )

        port_flag, file_flag, uses_sys_argv = _inspect_argparse_option_names(tree)
        _, deps_check = self._sdk._inspect_uploader_script(
            uploader_path,
            _resolve_existing_path(eff.python_path),
            _build_safe_subprocess_env(eff),
        )
        missing_deps: List[str] = []
        deps_ok = True
        if deps_check.status in ("warning", "fail"):
            if "not_checked" != deps_check.status and "missing python modules" in deps_check.summary.lower():
                deps_ok = False
                missing_part = deps_check.summary.split(":", 1)[-1].rstrip(".")
                missing_deps = [m.strip() for m in missing_part.split(",") if m.strip()]

        notes: List[str] = []
        if port_flag or file_flag:
            return UploaderContractInfo(
                is_python=True,
                syntax_ok=True,
                dependencies_ok=deps_ok,
                missing_dependencies=missing_deps,
                port_flag=port_flag,
                file_flag=file_flag,
                convention_verified=True,
                contract_source="script_ast",
                notes=[
                    f"Detected CLI flags from {uploader_path.name} AST ({port_flag or 'positional port'}, {file_flag or 'positional firmware'})."
                ],
            )

        if uses_sys_argv:
            notes.append(
                f"{uploader_path.name} reads positional arguments via sys.argv; using adaptable [<port>, <firmware>] convention unless overridden."
            )
        else:
            notes.append(
                f"External VEGA uploader flags could not be determined from {uploader_path.name}; using adaptable [<port>, <firmware>] invocation."
            )

        return UploaderContractInfo(
            is_python=True,
            syntax_ok=True,
            dependencies_ok=deps_ok,
            missing_dependencies=missing_deps,
            convention_verified=False,
            contract_source="provisional_adapter",
            notes=notes,
        )

    def _build_uploader_command(
        self,
        uploader_path: Path,
        python_exe: Optional[Path],
        contract: UploaderContractInfo,
        invocation_mode: UploadInvocationMode,
        port: Optional[str],
        artifact_abs: Optional[Path],
    ) -> Tuple[List[str], str, bool]:
        """Construct safe subprocess argument array without shell interpolation."""
        port_token = port or "<serial-port>"
        fw_token = str(artifact_abs) if artifact_abs else "<firmware-artifact>"

        resolved_mode = invocation_mode
        verified = False

        if invocation_mode == "auto":
            if contract.port_flag and contract.file_flag:
                args = [contract.port_flag, port_token, contract.file_flag, fw_token]
                resolved_mode = "flagged_port_file"
                verified = True
            elif contract.port_flag:
                args = [contract.port_flag, port_token, fw_token]
                resolved_mode = "flagged_port_file"
                verified = True
            elif contract.file_flag:
                args = [port_token, contract.file_flag, fw_token]
                resolved_mode = "flagged_port_file"
                verified = True
            else:
                args = [port_token, fw_token]
                resolved_mode = "positional_port_file"
                verified = False
        elif invocation_mode == "flagged_port_file":
            args = [
                contract.port_flag or "--port",
                port_token,
                contract.file_flag or "--file",
                fw_token,
            ]
            verified = contract.convention_verified
        elif invocation_mode == "positional_file_port":
            args = [fw_token, port_token]
        else:
            args = [port_token, fw_token]

        if contract.is_python:
            py_cmd = str(python_exe) if python_exe else "python3"
            return [py_cmd, str(uploader_path), *args], resolved_mode, verified
        return [str(uploader_path), *args], resolved_mode, verified

    # ------------------------------------------------------------------ #
    # Preflight & execution preparation
    # ------------------------------------------------------------------ #

    def _prepare_preflight_and_context(
        self,
        raw_project_dir: str,
        raw_port: Optional[str],
        raw_artifact_path: Optional[str],
        invocation_mode: UploadInvocationMode,
    ) -> Tuple[
        UploadPreflightResponse,
        Optional[Path],
        Optional[BoardProfile],
        Optional[SdkConfig],
        Optional[Path],
        Optional[Path],
        Optional[FirmwareArtifactInfo],
        List[str],
    ]:
        """Validate workspace, board, SDK, uploader, artifacts, and serial device cleanly."""
        try:
            project_root = self._explorer._resolve_project_root(raw_project_dir)
            meta, _, _, _ = self._projects._inspect_project_directory(project_root)
        except ExplorerServiceError as exc:
            raise UploadServiceError(exc.message, exc.status_code) from exc
        except ProjectServiceError as exc:
            raise UploadServiceError(exc.message, exc.status_code) from exc

        project_name = meta.name if meta else project_root.name
        checks: List[UploadPreflightCheck] = [
            UploadPreflightCheck(
                id="project",
                label="Active VEGA Project",
                status="pass",
                detail=f"Validated workspace '{project_name}'.",
            )
        ]
        warnings: List[str] = []
        blocking: List[str] = []
        needs_build = False
        needs_sdk_doctor = False
        needs_board_manager = False

        # 1. Board validation
        selected_board_id = (meta.target.board if meta and meta.target else None) or None
        board: Optional[BoardProfile] = (
            self._boards.find_board(selected_board_id) if selected_board_id else None
        )
        board_supported = board is not None
        if not selected_board_id:
            msg = "No hardware board is selected in vega-project.json."
            blocking.append(msg)
            needs_board_manager = True
            checks.append(
                UploadPreflightCheck(
                    id="board",
                    label="Target Hardware Board",
                    status="fail",
                    detail=msg,
                    remediation="Open Board Manager to select VEGA ARIES V3.",
                )
            )
        elif board is None:
            msg = f"Unsupported target board '{selected_board_id}' in vega-project.json."
            blocking.append(msg)
            needs_board_manager = True
            checks.append(
                UploadPreflightCheck(
                    id="board",
                    label="Target Hardware Board",
                    status="fail",
                    detail=msg,
                    remediation="Open Board Manager to assign a supported target board.",
                )
            )
        else:
            checks.append(
                UploadPreflightCheck(
                    id="board",
                    label="Target Hardware Board",
                    status="pass",
                    detail=f"Target: {board.name} ({board.machine} / {board.isa}).",
                )
            )

        # 2. SDK configuration & board compatibility
        base_config = self._sdk.get_config_state().config
        discovery = self._sdk.discover_environment(
            config_hint=base_config, apply_to_config=False
        )
        eff = discovery.suggested_config

        if board is not None:
            compat = self._boards.validate_compatibility(board, eff)
            if compat.issues:
                needs_sdk_doctor = True
                blocking.extend(compat.issues)
                checks.append(
                    UploadPreflightCheck(
                        id="sdk_board_compat",
                        label="SDK & Board Compatibility",
                        status="fail",
                        detail="; ".join(compat.issues),
                        remediation="Open SDK Doctor to verify VEGA SDK paths and target architecture.",
                    )
                )
            elif compat.warnings:
                warnings.extend(compat.warnings)
                checks.append(
                    UploadPreflightCheck(
                        id="sdk_board_compat",
                        label="SDK & Board Compatibility",
                        status="warning",
                        detail="; ".join(compat.warnings),
                    )
                )
            else:
                checks.append(
                    UploadPreflightCheck(
                        id="sdk_board_compat",
                        label="SDK & Board Compatibility",
                        status="pass",
                        detail="Configured SDK matches board target profile.",
                    )
                )

        # 3. Uploader executable/script & Python runtime + dependencies
        uploader_path = _resolve_existing_path(eff.uploader_script)
        py_exe = _resolve_existing_path(eff.python_path)
        contract: Optional[UploaderContractInfo] = None

        if uploader_path is None or not uploader_path.is_file():
            needs_sdk_doctor = True
            msg = "VEGA XMODEM uploader script (vega_xmodem.py) is missing or unconfigured."
            blocking.append(msg)
            checks.append(
                UploadPreflightCheck(
                    id="uploader_script",
                    label="VEGA Uploader Utility",
                    status="fail",
                    detail=msg,
                    remediation="Open SDK Doctor and set the Uploader Script path.",
                )
            )
        else:
            contract = self._inspect_uploader_contract(uploader_path, eff)
            if not contract.syntax_ok:
                needs_sdk_doctor = True
                msg = contract.syntax_error or "Configured uploader script is invalid."
                blocking.append(msg)
                checks.append(
                    UploadPreflightCheck(
                        id="uploader_script",
                        label="VEGA Uploader Utility",
                        status="fail",
                        detail=msg,
                        remediation="Inspect or replace vega_xmodem.py in SDK Doctor.",
                    )
                )
            elif contract.is_python and (py_exe is None or not py_exe.is_file()):
                needs_sdk_doctor = True
                msg = "Python 3 executable is missing or unconfigured for running the Python uploader."
                blocking.append(msg)
                checks.append(
                    UploadPreflightCheck(
                        id="uploader_script",
                        label="VEGA Uploader Utility",
                        status="fail",
                        detail=msg,
                        remediation="Configure Python 3 executable in SDK Doctor.",
                    )
                )
            elif not contract.dependencies_ok:
                needs_sdk_doctor = True
                msg = (
                    f"Missing Python dependencies required by '{uploader_path.name}': "
                    f"{', '.join(contract.missing_dependencies)}."
                )
                blocking.append(msg)
                checks.append(
                    UploadPreflightCheck(
                        id="uploader_script",
                        label="VEGA Uploader Utility",
                        status="fail",
                        detail=msg,
                        remediation="Install required upload packages (e.g. pyserial / xmodem) in configured Python.",
                    )
                )
            else:
                warnings.extend(
                    note for note in contract.notes if not contract.convention_verified
                )
                checks.append(
                    UploadPreflightCheck(
                        id="uploader_script",
                        label="VEGA Uploader Utility",
                        status="pass" if contract.convention_verified else "warning",
                        detail=(
                            f"Uploader ready: {uploader_path.name}"
                            + (
                                ""
                                if contract.convention_verified
                                else " (provisional CLI adapter — inspect command preview)"
                            )
                        ),
                    )
                )

        # 4. Firmware artifacts inside project_root
        allowed_exts = (
            board.upload.artifact_extensions
            if board and board.upload
            else [".bin", ".elf", ".hex"]
        )
        artifacts, zero_warnings = self._discover_artifacts(
            project_root, meta, allowed_exts
        )
        warnings.extend(zero_warnings)

        selected_artifact: Optional[FirmwareArtifactInfo] = None
        artifact_ambiguous = False
        artifact_abs: Optional[Path] = None

        if raw_artifact_path:
            try:
                norm_rel, resolved_art = self._explorer._resolve_inside_root(
                    project_root, raw_artifact_path, must_exist=True
                )
            except ExplorerServiceError as exc:
                raise UploadServiceError(exc.message, exc.status_code) from exc

            if not resolved_art.is_file():
                raise UploadServiceError(
                    f"Selected firmware artifact '{norm_rel}' is not a regular file.",
                    400,
                )
            if resolved_art.suffix.lower() not in {e.lower() for e in allowed_exts}:
                raise UploadServiceError(
                    f"Unsupported firmware artifact type '{resolved_art.suffix}' for board upload. Expected {', '.join(allowed_exts)}.",
                    400,
                )
            st = resolved_art.stat()
            if st.st_size <= 0:
                raise UploadServiceError(
                    f"Selected firmware artifact '{norm_rel}' is empty (0 bytes). Rebuild firmware before uploading.",
                    400,
                )

            selected_artifact = next(
                (a for a in artifacts if a.relative_path == norm_rel), None
            )
            if selected_artifact is None:
                selected_artifact = FirmwareArtifactInfo(
                    relative_path=norm_rel,
                    name=resolved_art.name,
                    extension=resolved_art.suffix.lower(),
                    size_bytes=st.st_size,
                    modified_at=datetime.fromtimestamp(
                        st.st_mtime, tz=timezone.utc
                    ).isoformat(),
                    stale=False,
                )
            artifact_abs = resolved_art
        elif len(artifacts) == 1:
            selected_artifact = artifacts[0]
            artifact_abs = (project_root / selected_artifact.relative_path).resolve()
        elif len(artifacts) > 1:
            artifact_ambiguous = True

        if not artifacts and selected_artifact is None:
            needs_build = True
            msg = "No compiled firmware artifact (.bin / .elf / .hex) found in project. Build firmware first."
            blocking.append(msg)
            checks.append(
                UploadPreflightCheck(
                    id="firmware_artifact",
                    label="Firmware Artifact",
                    status="fail",
                    detail=msg,
                    remediation="Click Build to compile project firmware.",
                )
            )
        elif artifact_ambiguous and selected_artifact is None:
            msg = (
                f"Multiple firmware artifacts detected ({len(artifacts)} files). "
                "Select the specific artifact to upload."
            )
            blocking.append(msg)
            checks.append(
                UploadPreflightCheck(
                    id="firmware_artifact",
                    label="Firmware Artifact",
                    status="fail",
                    detail=msg,
                    remediation="Choose the target firmware binary in the Artifact selector.",
                )
            )
        elif selected_artifact is not None:
            if selected_artifact.stale and selected_artifact.stale_reason:
                warnings.append(selected_artifact.stale_reason)
            checks.append(
                UploadPreflightCheck(
                    id="firmware_artifact",
                    label="Firmware Artifact",
                    status="warning" if selected_artifact.stale else "pass",
                    detail=(
                        f"Selected {selected_artifact.relative_path} "
                        f"({selected_artifact.size_bytes} bytes)"
                        + (" — may be stale vs edited source files." if selected_artifact.stale else "")
                    ),
                    remediation="Consider rebuilding before uploading." if selected_artifact.stale else None,
                )
            )

        # 5. Serial device / port check
        device_res = self.discover_devices()
        warnings.extend(device_res.warnings)
        chosen_port = raw_port
        if not chosen_port and len(device_res.devices) == 1:
            chosen_port = device_res.devices[0].port

        matched_device = next(
            (
                d
                for d in device_res.devices
                if d.port == chosen_port or d.stable_path == chosen_port
            ),
            None,
        )
        port_connected = matched_device is not None
        requires_port = board.upload.requires_port if board and board.upload else True

        if requires_port and not chosen_port:
            msg = "No serial device or port selected."
            blocking.append(msg)
            checks.append(
                UploadPreflightCheck(
                    id="serial_port",
                    label="Serial Device / Port",
                    status="fail",
                    detail=msg,
                    remediation="Connect VEGA ARIES V3 via USB-UART and select or enter a port (e.g. /dev/ttyUSB0 or COM3).",
                )
            )
        elif matched_device is not None:
            if matched_device.accessible is False:
                msg = f"Serial device '{matched_device.port}' exists but lacks read/write permissions."
                blocking.append(msg)
                checks.append(
                    UploadPreflightCheck(
                        id="serial_port",
                        label="Serial Device / Port",
                        status="fail",
                        detail=msg,
                        remediation="Grant serial permissions (Linux: sudo usermod -aG dialout $USER) and replug device.",
                    )
                )
            else:
                checks.append(
                    UploadPreflightCheck(
                        id="serial_port",
                        label="Serial Device / Port",
                        status="pass",
                        detail=f"Detected serial port: {matched_device.display_name}",
                    )
                )
        elif chosen_port:
            warn_msg = (
                f"Port '{chosen_port}' is not currently reported by host serial discovery; "
                "ensure device is connected or using a controlled mock setup."
            )
            warnings.append(warn_msg)
            checks.append(
                UploadPreflightCheck(
                    id="serial_port",
                    label="Serial Device / Port",
                    status="warning",
                    detail=warn_msg,
                )
            )

        command_preview: List[str] = []
        resolved_mode: str = invocation_mode
        convention_verified = False
        contract_source = contract.contract_source if contract else "provisional_adapter"

        if uploader_path and contract:
            command_preview, resolved_mode, convention_verified = self._build_uploader_command(
                uploader_path,
                py_exe,
                contract,
                invocation_mode,
                chosen_port,
                artifact_abs,
            )

        resp = UploadPreflightResponse(
            ready=len(blocking) == 0,
            project_dir=str(project_root),
            project_name=project_name,
            board_id=selected_board_id,
            board_name=board.name if board else None,
            board_supported=board_supported,
            uploader_path=str(uploader_path) if uploader_path else None,
            python_path=str(py_exe) if py_exe else None,
            command_convention_verified=convention_verified,
            contract_source=contract_source,
            resolved_invocation_mode=resolved_mode,
            command_preview=command_preview,
            artifacts=artifacts,
            selected_artifact=selected_artifact,
            artifact_ambiguous=artifact_ambiguous,
            devices=device_res.devices,
            selected_port=chosen_port,
            port_verified_connected=port_connected,
            checks=checks,
            warnings=list(dict.fromkeys(warnings)),
            blocking_issues=list(dict.fromkeys(blocking)),
            needs_build=needs_build,
            needs_sdk_doctor=needs_sdk_doctor,
            needs_board_manager=needs_board_manager,
        )

        return (
            resp,
            project_root,
            board,
            eff,
            uploader_path,
            py_exe,
            selected_artifact,
            command_preview,
        )

    def preflight(self, req: UploadPreflightRequest) -> UploadPreflightResponse:
        """Execute non-destructive upload validation for the active project and target."""
        report, *_ = self._prepare_preflight_and_context(
            req.project_dir, req.port, req.artifact_path, req.invocation_mode
        )
        return report

    # ------------------------------------------------------------------ #
    # Streaming & subprocess execution worker
    # ------------------------------------------------------------------ #

    def _emit_event(self, record: UploadRunRecord, payload: Dict[str, Any]) -> None:
        with record.lock:
            subs = list(record.subscribers)
        is_critical = payload.get("type") in ("completed", "cleared", "snapshot", "progress")

        def _deliver(q: "asyncio.Queue[Dict[str, Any]]") -> None:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                if is_critical:
                    try:
                        q.get_nowait()
                        q.put_nowait(payload)
                    except (asyncio.QueueEmpty, asyncio.QueueFull):
                        pass

        for queue, loop in subs:
            if loop.is_closed():
                continue
            try:
                loop.call_soon_threadsafe(_deliver, queue)
            except RuntimeError:
                pass

    def _append_log(
        self,
        record: UploadRunRecord,
        stream: UploadStream,
        text: str,
    ) -> None:
        clean = text.rstrip("\r\n")
        if not clean:
            return
        parsed_pct = parse_explicit_upload_progress(clean)
        prog_update: Optional[UploadSummary] = None
        with record.lock:
            if (
                record.summary.log_line_count >= MAX_UPLOAD_LOG_LINES
                and not record.summary.truncated_logs
            ):
                record.summary.truncated_logs = True
            record.seq_counter += 1
            line = UploadLogLine(
                seq=record.seq_counter,
                timestamp=utc_now_iso(),
                stream=stream,
                text=clean,
            )
            record.logs.append(line)
            record.summary.log_line_count = len(record.logs)
            if parsed_pct is not None:
                record.summary.progress_percent = parsed_pct
                record.summary.progress_indeterminate = False
                prog_update = record.summary.model_copy(deep=True)

        self._emit_event(record, {"type": "log", "line": line.model_dump()})
        if prog_update is not None:
            self._emit_event(
                record, {"type": "progress", "upload": prog_update.model_dump()}
            )

    def _read_pipe(
        self,
        pipe: Any,
        record: UploadRunRecord,
        stream: UploadStream,
    ) -> None:
        try:
            for raw_line in iter(pipe.readline, ""):
                if raw_line:
                    self._append_log(record, stream, raw_line)
        except (OSError, ValueError):
            pass
        finally:
            try:
                pipe.close()
            except OSError:
                pass

    def _execute_upload_worker(
        self,
        record: UploadRunRecord,
        project_root: Path,
        command: List[str],
        env: Dict[str, str],
        timeout_seconds: int,
    ) -> None:
        start_monotonic = time.monotonic()
        final_status: UploadStatus = "succeeded"
        final_exit: Optional[int] = None
        final_error: Optional[str] = None

        self._append_log(
            record,
            "system",
            f"Executing uploader ({record.summary.board_name} via {record.summary.port}): {' '.join(command)}",
        )

        try:
            popen_kwargs: Dict[str, Any] = {
                "cwd": str(project_root),
                "env": env,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
                "bufsize": 1,
                "shell": False,
            }
            if _host_os_name() == "windows":
                popen_kwargs["creationflags"] = getattr(
                    subprocess, "CREATE_NEW_PROCESS_GROUP", 0
                )
            else:
                popen_kwargs["start_new_session"] = True

            try:
                proc = subprocess.Popen(command, **popen_kwargs)
            except OSError as exc:
                final_status = "failed"
                final_exit = -1
                final_error = f"Failed to launch uploader process: {exc}"
                self._append_log(record, "stderr", final_error)
                return

            with record.lock:
                record.active_proc = proc

            t_out = threading.Thread(
                target=self._read_pipe,
                args=(proc.stdout, record, "stdout"),
                daemon=True,
            )
            t_err = threading.Thread(
                target=self._read_pipe,
                args=(proc.stderr, record, "stderr"),
                daemon=True,
            )
            t_out.start()
            t_err.start()

            while proc.poll() is None:
                if record.cancel_event.is_set():
                    final_status = "cancelled"
                    final_error = "Upload cancelled by user."
                    terminate_process_tree(proc)
                    break
                if (time.monotonic() - start_monotonic) >= timeout_seconds:
                    final_status = "timed_out"
                    final_error = f"Upload exceeded timeout of {timeout_seconds}s."
                    with record.lock:
                        record.summary.timed_out = True
                    terminate_process_tree(proc)
                    break
                time.sleep(0.05)

            t_out.join(timeout=2.0)
            t_err.join(timeout=2.0)
            with record.lock:
                record.active_proc = None

            rc = proc.returncode
            final_exit = rc
            # If the process was killed externally (by cancel_upload) before the loop
            # saw cancel_event, reconcile status so it is never wrongly reported as "failed".
            if final_status not in ("cancelled", "timed_out") and record.cancel_event.is_set():
                final_status = "cancelled"
                final_error = "Upload cancelled by user."
            if final_status == "timed_out":
                self._append_log(record, "system", f"[TIMEOUT] {final_error}")
            elif final_status == "cancelled":
                self._append_log(
                    record, "system", "[CANCELLED] Firmware upload process terminated."
                )
            elif rc != 0:
                final_status = "failed"
                final_error = f"Uploader exited with code {rc}."
            else:
                with record.lock:
                    if not record.summary.progress_indeterminate:
                        record.summary.progress_percent = 100.0
        except Exception as exc:  # pragma: no cover - defensive fallback
            final_status = "failed"
            final_exit = -1
            final_error = f"Unexpected upload runner error: {exc}"
            self._append_log(record, "stderr", final_error)
        finally:
            duration_ms = int((time.monotonic() - start_monotonic) * 1000)
            with record.lock:
                record.summary.status = final_status
                record.summary.finished_at = utc_now_iso()
                record.summary.duration_ms = duration_ms
                record.summary.exit_code = final_exit
                record.summary.cancelled = final_status == "cancelled"
                record.summary.timed_out = final_status == "timed_out"
                record.summary.error_message = final_error
                snap = record.summary.model_copy(deep=True)

            self._append_log(
                record,
                "system",
                f"[{final_status.upper()}] Exit {final_exit if final_exit is not None else '—'} in {(duration_ms / 1000):.2f}s",
            )

            with self._state_lock:
                if self._active_upload_id == snap.upload_id:
                    self._active_upload_id = None

            self._emit_event(
                record,
                {"type": "completed", "upload": snap.model_dump()},
            )

    # ------------------------------------------------------------------ #
    # Public operations
    # ------------------------------------------------------------------ #

    def start_upload(self, req: UploadRequest) -> UploadSummary:
        """Validate preflight, acquire upload lock, and launch controlled uploader subprocess."""
        with self._state_lock:
            if self._active_upload_id is not None:
                active = self._runs.get(self._active_upload_id)
                if active and active.summary.status == "running":
                    raise UploadServiceError(
                        f"A firmware upload ({active.summary.project_name} -> {active.summary.port}) is already running. Cancel or wait for it to finish.",
                        409,
                    )

        (
            report,
            project_root,
            board,
            eff,
            uploader_path,
            _py_exe,
            selected_artifact,
            command,
        ) = self._prepare_preflight_and_context(
            req.project_dir, req.port, req.artifact_path, req.invocation_mode
        )

        if not report.ready or board is None or eff is None or uploader_path is None or selected_artifact is None or project_root is None:
            raise UploadServiceError(
                report.blocking_issues[0]
                if report.blocking_issues
                else "Upload prerequisites are incomplete.",
                400,
            )

        if selected_artifact.stale and not req.allow_stale_artifact:
            raise UploadServiceError(
                selected_artifact.stale_reason
                or "Selected firmware artifact is older than modified source files. Rebuild before uploading.",
                400,
            )

        if req.strict_port_check and not report.port_verified_connected:
            raise UploadServiceError(
                f"Selected serial port '{report.selected_port}' is disconnected or not reported by host discovery. Refresh devices before uploading.",
                400,
            )

        assert report.selected_port is not None

        # Coordinate port ownership with live Serial Monitor session
        try:
            from app.services.serial_service import get_serial_service

            serial_state = get_serial_service().get_state(include_logs=False)
            if serial_state.status in ("connected", "connecting") and serial_state.port:
                sel_norm = report.selected_port.strip().lower()
                ser_norm = serial_state.port.strip().lower()
                if sel_norm == ser_norm:
                    raise UploadServiceError(
                        f"Serial Monitor is currently connected to '{serial_state.port}'. Disconnect Serial Monitor before flashing firmware.",
                        409,
                    )
        except UploadServiceError:
            raise
        except Exception:
            pass

        # Minimal restricted environment (no host secret leakage)
        env = _build_safe_subprocess_env(eff)
        env["PYTHONUNBUFFERED"] = "1"
        env["VEGA_BOARD"] = board.id
        env["VEGA_MACHINE"] = board.machine
        env["RISCV_ARCH"] = board.isa
        env["VEGA_UPLOAD_PORT"] = report.selected_port
        try:
            env["VEGA_FIRMWARE"] = str(
                (project_root / selected_artifact.relative_path).resolve()
            )
        except OSError as exc:
            raise UploadServiceError(
                f"Unable to resolve firmware artifact path: {exc}", 400
            ) from exc
        sdk_root = _resolve_existing_path(eff.sdk_root)
        if sdk_root and sdk_root.is_dir():
            env["VEGA_SDK"] = str(sdk_root)
            env["VEGA_SDK_HOME"] = str(sdk_root)

        upload_id = uuid.uuid4().hex[:16]
        summary = UploadSummary(
            upload_id=upload_id,
            project_dir=str(project_root),
            project_name=report.project_name,
            board_id=board.id,
            board_name=board.name,
            artifact_path=selected_artifact.relative_path,
            artifact_size_bytes=selected_artifact.size_bytes,
            port=report.selected_port,
            invocation_mode=report.resolved_invocation_mode,
            command_preview=command,
            command_convention_verified=report.command_convention_verified,
            status="running",
            started_at=utc_now_iso(),
            progress_indeterminate=True,
        )
        record = UploadRunRecord(summary=summary)

        with self._state_lock:
            if self._active_upload_id is not None:
                active = self._runs.get(self._active_upload_id)
                if active and active.summary.status == "running":
                    raise UploadServiceError(
                        f"A firmware upload ({active.summary.project_name} -> {active.summary.port}) is already running. Cancel or wait for it to finish.",
                        409,
                    )
            if len(self._history) == self._history.maxlen:
                oldest = self._history.pop()
                if oldest != self._active_upload_id:
                    self._runs.pop(oldest, None)
            self._runs[upload_id] = record
            self._history.appendleft(upload_id)
            self._active_upload_id = upload_id
            self._latest_upload_id = upload_id

        worker = threading.Thread(
            target=self._execute_upload_worker,
            args=(record, project_root, command, env, req.timeout_seconds),
            daemon=True,
            name=f"vega-upload-{upload_id[:8]}",
        )
        record.worker_thread = worker
        worker.start()

        return summary.model_copy(deep=True)

    def _validated_id(self, upload_id: str) -> str:
        try:
            return validate_upload_id(upload_id)
        except ValueError as exc:
            raise UploadServiceError(str(exc), 400) from exc

    def cancel_upload(self, upload_id: Optional[str] = None) -> UploadSummary:
        """Signal an active firmware upload to terminate cleanly."""
        with self._state_lock:
            target_id = (
                self._validated_id(upload_id) if upload_id else self._active_upload_id
            )
            record = self._runs.get(target_id) if target_id else None

        if record is None:
            raise UploadServiceError("No matching active upload found to cancel.", 404)

        with record.lock:
            if record.summary.status != "running":
                return record.summary.model_copy(deep=True)
            record.cancel_event.set()
            proc = record.active_proc

        if proc is not None:
            terminate_process_tree(proc)

        worker = record.worker_thread
        if worker and worker.is_alive():
            worker.join(timeout=2.0)

        return record.snapshot()[0]

    def get_upload_state(self, upload_id: Optional[str] = None) -> UploadStateResponse:
        """Return active upload and latest/requested upload summary + buffered logs."""
        with self._state_lock:
            active_rec = (
                self._runs.get(self._active_upload_id)
                if self._active_upload_id
                else None
            )
            target_id = (
                self._validated_id(upload_id) if upload_id else self._latest_upload_id
            )
            if upload_id and target_id not in self._runs:
                raise UploadServiceError(f"Upload '{target_id}' was not found.", 404)
            target_rec = self._runs.get(target_id) if target_id else None

        active_sum = active_rec.snapshot()[0] if active_rec else None
        if target_rec is None:
            return UploadStateResponse(active_upload=active_sum)

        latest_sum, logs = target_rec.snapshot()
        return UploadStateResponse(
            active_upload=active_sum,
            latest_upload=latest_sum,
            logs=logs,
        )

    def get_upload_record(self, upload_id: str) -> UploadRunRecord:
        clean_id = self._validated_id(upload_id)
        with self._state_lock:
            record = self._runs.get(clean_id)
        if record is None:
            raise UploadServiceError(f"Upload '{clean_id}' was not found.", 404)
        return record

    def clear_output(self) -> UploadStateResponse:
        """Clear logs of the latest completed upload."""
        with self._state_lock:
            target_id = self._latest_upload_id
            record = self._runs.get(target_id) if target_id else None
        if record is not None:
            with record.lock:
                if record.summary.status == "running":
                    raise UploadServiceError(
                        "Cannot clear upload output while a firmware upload is running.",
                        409,
                    )
                record.logs.clear()
                record.seq_counter = 0
                record.summary.log_line_count = 0
                record.summary.truncated_logs = False
            self._emit_event(record, {"type": "cleared", "upload_id": record.summary.upload_id})
        return self.get_upload_state()

    def list_history(self) -> UploadHistoryResponse:
        """Return bounded session upload history newest-first."""
        with self._state_lock:
            records = [self._runs[uid] for uid in self._history if uid in self._runs]
        return UploadHistoryResponse(history=[rec.snapshot()[0] for rec in records])

    def clear_history(self) -> UploadHistoryResponse:
        """Clear completed session upload entries while keeping any active upload."""
        with self._state_lock:
            active_id = self._active_upload_id
            if active_id and active_id in self._runs:
                self._history.clear()
                self._history.appendleft(active_id)
                for uid in list(self._runs.keys()):
                    if uid != active_id:
                        del self._runs[uid]
                self._latest_upload_id = active_id
            else:
                self._history.clear()
                self._runs.clear()
                self._latest_upload_id = None
        return self.list_history()

    def shutdown(self) -> None:
        """Terminate any active upload cleanly when FastAPI shuts down."""
        with self._state_lock:
            active_rec = (
                self._runs.get(self._active_upload_id)
                if self._active_upload_id
                else None
            )
        if active_rec:
            with active_rec.lock:
                active_rec.cancel_event.set()
                proc = active_rec.active_proc
                worker = active_rec.worker_thread
            if proc:
                terminate_process_tree(proc)
            if worker and worker.is_alive():
                worker.join(timeout=1.5)


_upload_service_singleton = UploadService(settings)


def get_upload_service() -> UploadService:
    """FastAPI dependency returning the shared process-level UploadService."""
    return _upload_service_singleton
