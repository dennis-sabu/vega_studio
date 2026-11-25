"""VEGA Studio Backend – Phase 6 VEGA SDK discovery, configuration, and SDK Doctor service."""
from __future__ import annotations

import ast
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional, Sequence, Tuple

from app.config import Settings, settings
from app.models.sdk import (
    DEFAULT_CROSS_COMPILE_PREFIX,
    DEFAULT_TARGET_ARCH,
    DEFAULT_TARGET_MACHINE,
    DiagnosticCheckResult,
    DiagnosticStatus,
    DiagnosticSummaryCounts,
    DiscoveredTool,
    SdkConfig,
    SdkConfigStateResponse,
    SdkDiscoveryResult,
    SdkDoctorReport,
)
from app.services.persistence import AppPersistence

_SDK_CONFIG_STATE_KEY = "sdk_config"
_SDK_REPORT_STATE_KEY = "sdk_last_report"

_COMMAND_TIMEOUT_SECONDS = 5.0
_MAX_CAPTURE_CHARS = 3000
_MAX_UPLOADER_READ_BYTES = 1024 * 1024  # 1 MiB safety limit for AST inspection

_SAFE_PY_MOD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_COMPANION_TOOL_SUFFIXES = (
    "g++",
    "objcopy",
    "objdump",
    "size",
    "gdb",
    "ar",
    "ld",
    "as",
    "nm",
)
_STD_ENV_VARS = (
    "VEGA_SDK",
    "VEGA_SDK_HOME",
    "VEGA_TOOLS",
    "RISCV_TOOLS",
    "VEGA_XMODEM",
)


class SdkServiceError(Exception):
    """Domain error with an HTTP status code for SDK operations."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _host_os_name() -> str:
    sys_name = platform.system().lower()
    if sys_name.startswith("win"):
        return "windows"
    if sys_name == "linux":
        return "linux"
    if sys_name == "darwin":
        return "macos"
    return sys_name or os.name


def _is_posix_style_path(raw: str) -> bool:
    return raw.startswith("/") and not raw.startswith("//")


def _expand_user_path(raw: str) -> str:
    """Expand leading ~ cleanly without failing on non-existent targets."""
    if raw == "~" or raw.startswith("~/") or raw.startswith("~\\"):
        return os.path.expanduser(raw)
    return raw


def _validate_configured_path(raw: Optional[str], label: str) -> Optional[str]:
    """Validate an optional user-configured path without requiring it to exist yet."""
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    if "\x00" in cleaned:
        raise SdkServiceError(f"{label} contains an invalid null byte.", 400)
    parts = cleaned.replace("\\", "/").split("/")
    if ".." in parts:
        raise SdkServiceError(
            f"{label} cannot contain '..' traversal segments.", 400
        )

    expanded = _expand_user_path(cleaned)
    host_os = _host_os_name()

    # Allow POSIX-style target paths (/home/..., /opt/...) to be stored on Windows
    # so developers can configure or stage Linux toolchain paths ahead of time.
    if host_os == "windows" and _is_posix_style_path(expanded):
        if PurePosixPath(expanded).is_absolute():
            return expanded

    candidate = Path(expanded)
    if not candidate.is_absolute():
        raise SdkServiceError(
            f"{label} must be an absolute path (or start with '~/').", 400
        )
    try:
        return str(candidate.resolve(strict=False))
    except OSError as exc:
        raise SdkServiceError(f"Invalid {label.lower()}: {exc}", 400) from exc


def _resolve_existing_path(raw: Optional[str]) -> Optional[Path]:
    """Convert a configured path to a Path for local filesystem inspection."""
    if not raw:
        return None
    expanded = _expand_user_path(raw.strip())
    if _host_os_name() == "windows" and _is_posix_style_path(expanded):
        # On Windows, POSIX /opt/... does not map to a local drive path.
        p = Path(expanded)
        return p if p.exists() else None
    try:
        return Path(expanded).resolve(strict=False)
    except OSError:
        return None


def _truncate_output(text: str, limit: int = _MAX_CAPTURE_CHARS) -> str:
    cleaned = (text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[:limit].rstrip()}\n... [output truncated]"


def _first_non_empty_line(text: str) -> Optional[str]:
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _summarize_counts(checks: Sequence[DiagnosticCheckResult]) -> DiagnosticSummaryCounts:
    passed = sum(1 for c in checks if c.status == "pass")
    warning = sum(1 for c in checks if c.status == "warning")
    failed = sum(1 for c in checks if c.status == "fail")
    not_checked = sum(1 for c in checks if c.status == "not_checked")
    return DiagnosticSummaryCounts(
        passed=passed,
        warning=warning,
        failed=failed,
        not_checked=not_checked,
        total=len(checks),
    )


def _overall_from_counts(summary: DiagnosticSummaryCounts) -> DiagnosticStatus:
    if summary.total > 0 and summary.not_checked == summary.total:
        return "not_checked"
    if summary.failed > 0:
        return "fail"
    if summary.warning > 0:
        return "warning"
    if summary.passed > 0:
        return "pass"
    return "not_checked"


def _build_safe_subprocess_env(config: SdkConfig) -> Dict[str, str]:
    """Construct a minimal, restricted environment without mutating global os.environ."""
    env: Dict[str, str] = {
        "LANG": "C.UTF-8",
        "LC_ALL": "C",
    }

    if _host_os_name() == "windows":
        for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "TEMP", "TMP"):
            val = os.environ.get(key)
            if val:
                env[key] = val
    else:
        for key in ("HOME", "USER", "TMPDIR"):
            val = os.environ.get(key)
            if val:
                env[key] = val

    path_parts: List[str] = []
    seen = set()

    def _add_path_dir(raw_dir: Optional[str]) -> None:
        if not raw_dir:
            return
        p = _resolve_existing_path(raw_dir)
        if p and p.is_dir():
            s = str(p)
            if s not in seen:
                seen.add(s)
                path_parts.append(s)

    for extra in config.extra_path_entries:
        _add_path_dir(extra)

    if config.toolchain_root:
        tc_path = _resolve_existing_path(config.toolchain_root)
        if tc_path:
            _add_path_dir(str(tc_path / "bin"))
            _add_path_dir(str(tc_path))

    system_path = os.environ.get("PATH", "")
    if system_path:
        for segment in system_path.split(os.pathsep):
            if segment and segment not in seen:
                seen.add(segment)
                path_parts.append(segment)

    env["PATH"] = os.pathsep.join(path_parts)
    return env


class SdkService:
    """Service providing bounded VEGA SDK discovery, config persistence, and diagnostics."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        db_path = self._settings.get_data_dir() / "vega_studio.db"
        self.persistence = AppPersistence(db_path)

    # ------------------------------------------------------------------ #
    # Configuration persistence & validation
    # ------------------------------------------------------------------ #

    def _config_warnings(self, config: SdkConfig) -> List[str]:
        warnings: List[str] = []
        host_os = _host_os_name()
        for label, value in (
            ("SDK root", config.sdk_root),
            ("Toolchain root", config.toolchain_root),
            ("Compiler path", config.compiler_path),
            ("Make path", config.make_path),
            ("Python path", config.python_path),
            ("XMODEM uploader script", config.uploader_script),
        ):
            if not value:
                continue
            if host_os == "windows" and _is_posix_style_path(_expand_user_path(value)):
                warnings.append(
                    f"{label} uses a Linux/POSIX path ('{value}') which cannot be verified natively on Windows."
                )
            else:
                p = _resolve_existing_path(value)
                if p is None or not p.exists():
                    warnings.append(f"{label} does not exist at '{value}'.")
        return warnings

    def get_config_state(self) -> SdkConfigStateResponse:
        """Retrieve persisted SDK configuration, or defaults if not customized yet."""
        saved = self.persistence.get_state_json(_SDK_CONFIG_STATE_KEY)
        if not saved:
            cfg = SdkConfig()
            return SdkConfigStateResponse(
                config=cfg,
                is_customized=False,
                updated_at=None,
                validation_warnings=[],
            )

        raw_dict, updated_at = saved
        try:
            cfg = SdkConfig.model_validate(raw_dict)
        except Exception:
            cfg = SdkConfig()
        return SdkConfigStateResponse(
            config=cfg,
            is_customized=True,
            updated_at=updated_at,
            validation_warnings=self._config_warnings(cfg),
        )

    def update_config(self, incoming: SdkConfig) -> SdkConfigStateResponse:
        """Validate, normalize, and store SDK configuration in local application data."""
        normalized = SdkConfig(
            sdk_root=_validate_configured_path(incoming.sdk_root, "SDK root directory"),
            toolchain_root=_validate_configured_path(
                incoming.toolchain_root, "Toolchain root directory"
            ),
            compiler_path=_validate_configured_path(
                incoming.compiler_path, "Compiler executable"
            ),
            cross_compile_prefix=incoming.cross_compile_prefix,
            make_path=_validate_configured_path(incoming.make_path, "Make executable"),
            python_path=_validate_configured_path(
                incoming.python_path, "Python executable"
            ),
            uploader_script=_validate_configured_path(
                incoming.uploader_script, "VEGA XMODEM uploader script"
            ),
            target_arch=incoming.target_arch,
            target_machine=incoming.target_machine,
            extra_path_entries=[
                cleaned
                for cleaned in (
                    _validate_configured_path(entry, "Additional toolchain PATH")
                    for entry in incoming.extra_path_entries
                )
                if cleaned
            ],
        )

        updated_at = self.persistence.set_state_json(
            _SDK_CONFIG_STATE_KEY, normalized.model_dump()
        )
        # Clear cached diagnostic report because settings changed
        self.persistence.delete_state(_SDK_REPORT_STATE_KEY)
        return SdkConfigStateResponse(
            config=normalized,
            is_customized=True,
            updated_at=updated_at,
            validation_warnings=self._config_warnings(normalized),
        )

    def reset_config(self) -> SdkConfigStateResponse:
        """Reset SDK configuration to discovered defaults and remove custom overrides."""
        discovery = self.discover_environment(apply_to_config=False)
        self.persistence.delete_state(_SDK_CONFIG_STATE_KEY)
        self.persistence.delete_state(_SDK_REPORT_STATE_KEY)
        return SdkConfigStateResponse(
            config=discovery.suggested_config,
            is_customized=False,
            updated_at=None,
            validation_warnings=self._config_warnings(discovery.suggested_config),
        )

    # ------------------------------------------------------------------ #
    # Bounded SDK discovery
    # ------------------------------------------------------------------ #

    def _find_exe_in_dir(self, directory: Path, base_names: Sequence[str]) -> Optional[Path]:
        if not directory.is_dir():
            return None
        exts = (".exe", ".cmd", ".bat", "") if _host_os_name() == "windows" else ("",)
        for base in base_names:
            for ext in exts:
                candidate = directory / f"{base}{ext}"
                if candidate.is_file():
                    return candidate
        return None

    def _discover_companion_tools(
        self, compiler_path: Optional[Path], prefix: str
    ) -> List[DiscoveredTool]:
        if compiler_path is None or not compiler_path.parent.is_dir():
            return []
        bin_dir = compiler_path.parent
        found: List[DiscoveredTool] = []
        for suffix in _COMPANION_TOOL_SUFFIXES:
            exe = self._find_exe_in_dir(bin_dir, (f"{prefix}-{suffix}",))
            if exe:
                found.append(
                    DiscoveredTool(
                        name=f"{prefix}-{suffix}",
                        path=str(exe),
                        source="toolchain_bin",
                    )
                )
        return found

    def discover_environment(
        self,
        *,
        config_hint: Optional[SdkConfig] = None,
        apply_to_config: bool = False,
    ) -> SdkDiscoveryResult:
        """Discover VEGA SDK, toolchain, compiler, Make, Python, and XMODEM uploader safely."""
        current = config_hint or self.get_config_state().config
        host_os = _host_os_name()
        searched: List[str] = []
        notes: List[str] = []

        def _note_searched(path_str: str) -> None:
            if path_str not in searched:
                searched.append(path_str)

        # 1. SDK root candidates (strictly bounded)
        sdk_candidates: List[Tuple[str, str]] = []
        if current.sdk_root:
            sdk_candidates.append((current.sdk_root, "configured"))
        for env_key in ("VEGA_SDK", "VEGA_SDK_HOME"):
            env_val = os.environ.get(env_key)
            if env_val:
                sdk_candidates.append((env_val, f"env:{env_key}"))
        sdk_candidates.extend(
            [
                ("~/vega/vega-sdk", "standard_home"),
                ("~/vega-sdk", "standard_home"),
            ]
        )
        if host_os != "windows":
            sdk_candidates.extend(
                [
                    ("/opt/vega/vega-sdk", "system_opt"),
                    ("/usr/local/vega-sdk", "system_local"),
                ]
            )

        detected_sdk: Optional[Path] = None
        for raw, source in sdk_candidates:
            expanded = _expand_user_path(raw)
            _note_searched(expanded)
            p = _resolve_existing_path(expanded)
            if p and p.is_dir():
                detected_sdk = p
                if source != "configured":
                    notes.append(f"Discovered VEGA SDK via {source}: {p}")
                break

        # 2. Toolchain root candidates
        tc_candidates: List[Tuple[str, str]] = []
        if current.toolchain_root:
            tc_candidates.append((current.toolchain_root, "configured"))
        for env_key in ("VEGA_TOOLS", "RISCV_TOOLS"):
            env_val = os.environ.get(env_key)
            if env_val:
                tc_candidates.append((env_val, f"env:{env_key}"))
        tc_candidates.extend(
            [
                ("~/vega/vega-tools-rv32", "standard_home"),
                ("~/vega-tools-rv32", "standard_home"),
            ]
        )
        if host_os != "windows":
            tc_candidates.extend(
                [
                    ("/opt/vega/vega-tools-rv32", "system_opt"),
                    ("/opt/riscv32-vega-elf", "system_opt"),
                ]
            )

        detected_tc: Optional[Path] = None
        for raw, source in tc_candidates:
            expanded = _expand_user_path(raw)
            _note_searched(expanded)
            p = _resolve_existing_path(expanded)
            if p and p.is_dir():
                detected_tc = p
                if source != "configured":
                    notes.append(f"Discovered VEGA toolchain via {source}: {p}")
                break

        # 3. Cross-compiler discovery
        prefix = current.cross_compile_prefix or DEFAULT_CROSS_COMPILE_PREFIX
        gcc_name = f"{prefix}-gcc"
        detected_compiler: Optional[Path] = None

        if current.compiler_path:
            _note_searched(current.compiler_path)
            cand = _resolve_existing_path(current.compiler_path)
            if cand and cand.is_file():
                detected_compiler = cand

        if detected_compiler is None and detected_tc is not None:
            for sub in (detected_tc / "bin", detected_tc):
                _note_searched(str(sub))
                cand = self._find_exe_in_dir(sub, (gcc_name,))
                if cand:
                    detected_compiler = cand
                    break

        if detected_compiler is None:
            search_path = _build_safe_subprocess_env(current).get("PATH", "")
            which_gcc = shutil.which(gcc_name, path=search_path)
            if which_gcc:
                detected_compiler = Path(which_gcc).resolve(strict=False)
                if detected_tc is None:
                    detected_tc = (
                        detected_compiler.parent.parent
                        if detected_compiler.parent.name.lower() == "bin"
                        else detected_compiler.parent
                    )

        companion_tools = self._discover_companion_tools(detected_compiler, prefix)

        # 4. Make discovery
        detected_make: Optional[Path] = None
        if current.make_path:
            _note_searched(current.make_path)
            cand = _resolve_existing_path(current.make_path)
            if cand and cand.is_file():
                detected_make = cand

        if detected_make is None:
            search_path = _build_safe_subprocess_env(current).get("PATH", "")
            make_names = (
                ("make", "gmake", "mingw32-make")
                if host_os == "windows"
                else ("make", "gmake")
            )
            for name in make_names:
                found = shutil.which(name, path=search_path)
                if found:
                    detected_make = Path(found).resolve(strict=False)
                    break

        # 5. Python discovery
        detected_python: Optional[Path] = None
        if current.python_path:
            _note_searched(current.python_path)
            cand = _resolve_existing_path(current.python_path)
            if cand and cand.is_file():
                detected_python = cand

        if detected_python is None:
            search_path = _build_safe_subprocess_env(current).get("PATH", "")
            for name in ("python3", "python"):
                found = shutil.which(name, path=search_path)
                if found:
                    detected_python = Path(found).resolve(strict=False)
                    break
            if detected_python is None and sys.executable:
                detected_python = Path(sys.executable).resolve(strict=False)

        # 6. VEGA XMODEM uploader script discovery
        uploader_candidates: List[str] = []
        if current.uploader_script:
            uploader_candidates.append(current.uploader_script)
        env_xmodem = os.environ.get("VEGA_XMODEM")
        if env_xmodem:
            uploader_candidates.append(env_xmodem)
        uploader_candidates.extend(["~/vega/tools/vega_xmodem.py", "~/vega/vega_xmodem.py"])
        if detected_sdk:
            uploader_candidates.extend(
                [
                    str(detected_sdk / "tools" / "vega_xmodem.py"),
                    str(detected_sdk / "scripts" / "vega_xmodem.py"),
                    str(detected_sdk.parent / "tools" / "vega_xmodem.py"),
                ]
            )
        if host_os != "windows":
            uploader_candidates.append("/opt/vega/tools/vega_xmodem.py")

        detected_uploader: Optional[Path] = None
        for raw in uploader_candidates:
            expanded = _expand_user_path(raw)
            _note_searched(expanded)
            p = _resolve_existing_path(expanded)
            if p and p.is_file():
                detected_uploader = p
                break

        if host_os == "windows" and detected_compiler is None:
            notes.append(
                "Running on Windows: Linux VEGA RISC-V toolchain (~/vega/vega-tools-rv32) is optional here unless configured locally; target production environment is Ubuntu/Linux."
            )

        suggested = SdkConfig(
            sdk_root=str(detected_sdk) if detected_sdk else current.sdk_root,
            toolchain_root=(
                str(detected_tc) if detected_tc else current.toolchain_root
            ),
            compiler_path=(
                str(detected_compiler) if detected_compiler else current.compiler_path
            ),
            cross_compile_prefix=prefix,
            make_path=str(detected_make) if detected_make else current.make_path,
            python_path=str(detected_python) if detected_python else current.python_path,
            uploader_script=(
                str(detected_uploader) if detected_uploader else current.uploader_script
            ),
            target_arch=current.target_arch or DEFAULT_TARGET_ARCH,
            target_machine=current.target_machine or DEFAULT_TARGET_MACHINE,
            extra_path_entries=list(current.extra_path_entries),
        )

        result = SdkDiscoveryResult(
            platform_os=host_os,
            searched_locations=searched,
            sdk_root=str(detected_sdk) if detected_sdk else None,
            toolchain_root=str(detected_tc) if detected_tc else None,
            compiler_path=str(detected_compiler) if detected_compiler else None,
            compiler_tools=companion_tools,
            make_path=str(detected_make) if detected_make else None,
            python_path=str(detected_python) if detected_python else None,
            uploader_script=str(detected_uploader) if detected_uploader else None,
            suggested_config=suggested,
            notes=notes,
        )

        if apply_to_config:
            self.update_config(suggested)

        return result

    # ------------------------------------------------------------------ #
    # Safe subprocess execution helper
    # ------------------------------------------------------------------ #

    def _run_safe_command(
        self,
        argv: Sequence[str],
        *,
        env: Dict[str, str],
        cwd: Path,
        timeout: float = _COMMAND_TIMEOUT_SECONDS,
    ) -> Tuple[Optional[int], str, str, Optional[str]]:
        """Execute a predefined diagnostic command safely with no shell invocation."""
        safe_cwd = cwd if cwd.is_dir() else Path.home()
        try:
            proc = subprocess.run(
                list(argv),
                shell=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                cwd=str(safe_cwd),
                env=env,
            )
            return (
                proc.returncode,
                _truncate_output(proc.stdout),
                _truncate_output(proc.stderr),
                None,
            )
        except subprocess.TimeoutExpired:
            return (
                None,
                "",
                "",
                f"Diagnostic command timed out after {timeout:.1f}s.",
            )
        except OSError as exc:
            return None, "", "", f"OS execution error: {exc}"

    # ------------------------------------------------------------------ #
    # Diagnostic checks (SDK Doctor)
    # ------------------------------------------------------------------ #

    def _build_baseline_report(self, config: SdkConfig) -> SdkDoctorReport:
        """Return an unexecuted baseline report showing 'not_checked' states cleanly."""
        specs = [
            ("sdk_root_configured", "sdk", "SDK Root Configured"),
            ("sdk_dir_exists", "sdk", "SDK Directory Exists"),
            ("sdk_contents_valid", "sdk", "VEGA SDK Contents"),
            ("toolchain_dir_exists", "toolchain", "Toolchain Directory Exists"),
            ("compiler_exists", "toolchain", "Cross-Compiler Present"),
            ("compiler_executable", "toolchain", "Cross-Compiler Runnable"),
            ("compiler_invocation", "toolchain", "Compiler Version Check"),
            ("compiler_target", "toolchain", "Compiler Target Verification"),
            ("make_detected", "build_prerequisites", "Make Executable Detected"),
            ("make_version", "build_prerequisites", "Make Version Check"),
            ("python_detected", "build_prerequisites", "Python 3 Detected"),
            ("python_version", "build_prerequisites", "Python Version Check"),
            ("vega_target_arch", "vega_config", "Target Architecture (rv32i_zicsr)"),
            ("vega_target_machine", "vega_config", "Target Machine (THEJAS32)"),
            ("vega_cross_prefix", "vega_config", "Cross-Compile Prefix"),
            ("vega_env_alignment", "vega_config", "VEGA ARIES V3 Readiness"),
            ("uploader_exists", "upload_prerequisites", "VEGA XMODEM Uploader Script"),
            ("uploader_inspection", "upload_prerequisites", "Uploader Python Compatibility"),
            ("uploader_dependencies", "upload_prerequisites", "Upload Python Dependencies"),
        ]
        checks = [
            DiagnosticCheckResult(
                id=check_id,
                category=category,  # type: ignore[arg-type]
                title=title,
                status="not_checked",
                summary="Not yet verified. Run SDK Doctor diagnostics to inspect.",
            )
            for check_id, category, title in specs
        ]
        summary = _summarize_counts(checks)
        return SdkDoctorReport(
            overall_status="not_checked",
            checked_at=None,
            platform_os=_host_os_name(),
            platform_compatible=_host_os_name() == "linux",
            summary=summary,
            config_used=config,
            checks=checks,
            companion_tools=[],
        )

    def get_diagnostics_state(self) -> SdkDoctorReport:
        """Return cached diagnostic results if present, else baseline 'not_checked' checklist."""
        cfg = self.get_config_state().config
        saved = self.persistence.get_state_json(_SDK_REPORT_STATE_KEY)
        if saved:
            raw_report, _ = saved
            try:
                return SdkDoctorReport.model_validate(raw_report)
            except Exception:
                pass
        return self._build_baseline_report(cfg)

    def _inspect_uploader_script(
        self,
        uploader_path: Path,
        python_path: Optional[Path],
        env: Dict[str, str],
    ) -> Tuple[DiagnosticCheckResult, DiagnosticCheckResult]:
        """Inspect uploader Python syntax via AST + module dependencies safely without running it."""
        if uploader_path.suffix.lower() != ".py":
            return (
                DiagnosticCheckResult(
                    id="uploader_inspection",
                    category="upload_prerequisites",
                    title="Uploader Python Compatibility",
                    status="warning",
                    summary=f"Configured uploader '{uploader_path.name}' is not a .py script.",
                    detected_path=str(uploader_path),
                ),
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="not_checked",
                    summary="Dependency inspection skipped for non-Python uploader file.",
                ),
            )

        try:
            if uploader_path.stat().st_size > _MAX_UPLOADER_READ_BYTES:
                return (
                    DiagnosticCheckResult(
                        id="uploader_inspection",
                        category="upload_prerequisites",
                        title="Uploader Python Compatibility",
                        status="warning",
                        summary="Uploader script exceeds 1 MiB inspection limit.",
                        detected_path=str(uploader_path),
                    ),
                    DiagnosticCheckResult(
                        id="uploader_dependencies",
                        category="upload_prerequisites",
                        title="Upload Python Dependencies",
                        status="not_checked",
                        summary="Skipped because uploader inspection did not complete.",
                    ),
                )
            source = uploader_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(uploader_path))
        except SyntaxError as exc:
            return (
                DiagnosticCheckResult(
                    id="uploader_inspection",
                    category="upload_prerequisites",
                    title="Uploader Python Compatibility",
                    status="fail",
                    summary=f"Python syntax error in uploader script (line {exc.lineno}).",
                    detail=str(exc),
                    detected_path=str(uploader_path),
                ),
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="not_checked",
                    summary="Skipped because uploader script has a syntax error.",
                ),
            )
        except (OSError, UnicodeDecodeError) as exc:
            return (
                DiagnosticCheckResult(
                    id="uploader_inspection",
                    category="upload_prerequisites",
                    title="Uploader Python Compatibility",
                    status="fail",
                    summary="Unable to read VEGA XMODEM uploader script.",
                    detail=str(exc),
                    detected_path=str(uploader_path),
                ),
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="not_checked",
                    summary="Skipped because uploader script could not be read.",
                ),
            )

        imported: List[str] = []
        seen = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top = alias.name.split(".", 1)[0]
                    if _SAFE_PY_MOD_RE.match(top) and top not in seen:
                        seen.add(top)
                        imported.append(top)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                top = node.module.split(".", 1)[0]
                if _SAFE_PY_MOD_RE.match(top) and top not in seen:
                    seen.add(top)
                    imported.append(top)

        inspect_check = DiagnosticCheckResult(
            id="uploader_inspection",
            category="upload_prerequisites",
            title="Uploader Python Compatibility",
            status="pass",
            summary="Uploader script parsed cleanly without executing external code.",
            detail=(
                f"Static AST inspection found imports: {', '.join(imported)}."
                if imported
                else "Static AST inspection verified valid Python syntax (no external imports detected)."
            ),
            detected_path=str(uploader_path),
        )

        # Check runtime module availability using configured Python cleanly via find_spec
        relevant_mods = imported[:20]
        if not relevant_mods:
            return (
                inspect_check,
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="pass",
                    summary="No additional Python dependencies detected in uploader script.",
                ),
            )

        if python_path is None or not python_path.is_file():
            return (
                inspect_check,
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="not_checked",
                    summary="Cannot verify uploader dependencies until Python 3 executable is available.",
                    detail=f"Detected imports: {', '.join(relevant_mods)}.",
                ),
            )

        probe_code = (
            "import importlib.util, json, sys; "
            "print(json.dumps({m: bool(importlib.util.find_spec(m)) for m in sys.argv[1:]}))"
        )
        cmd = [str(python_path), "-c", probe_code, *relevant_mods]
        rc, out, err, run_err = self._run_safe_command(
            cmd, env=env, cwd=uploader_path.parent
        )
        if run_err or rc != 0:
            return (
                inspect_check,
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="warning",
                    summary="Unable to verify uploader module imports with configured Python.",
                    detail=run_err or err or out,
                    detected_path=str(python_path),
                    command=f"{python_path.name} -c <importlib.util.find_spec probe>",
                ),
            )

        try:
            avail = json.loads(out.strip())
        except json.JSONDecodeError:
            avail = {}

        missing = [m for m in relevant_mods if not avail.get(m, False)]
        if missing:
            return (
                inspect_check,
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="warning",
                    summary=f"Missing Python modules required by uploader: {', '.join(missing)}.",
                    detail=(
                        "Checked via importlib.util.find_spec on the configured Python interpreter. "
                        "Install missing upload packages (e.g. pyserial / xmodem) before flashing hardware."
                    ),
                    detected_path=str(python_path),
                    output=out,
                    remediation=f"Verify packages in {python_path} before Phase 8 hardware upload.",
                ),
            )

        return (
            inspect_check,
            DiagnosticCheckResult(
                id="uploader_dependencies",
                category="upload_prerequisites",
                title="Upload Python Dependencies",
                status="pass",
                summary=f"All {len(relevant_mods)} imported module(s) are available in configured Python.",
                detail=f"Verified modules: {', '.join(relevant_mods)}.",
                detected_path=str(python_path),
                output=out,
            ),
        )

    def run_diagnostics(
        self, config_override: Optional[SdkConfig] = None
    ) -> SdkDoctorReport:
        """Execute bounded, safe diagnostics for VEGA SDK, Toolchain, Build & Upload prerequisites."""
        base_config = config_override or self.get_config_state().config
        discovery = self.discover_environment(config_hint=base_config, apply_to_config=False)
        eff = discovery.suggested_config
        host_os = _host_os_name()
        env = _build_safe_subprocess_env(eff)
        checks: List[DiagnosticCheckResult] = []

        # -------------------- 1. SDK Checks -------------------- #
        configured_sdk_raw = base_config.sdk_root
        resolved_sdk = _resolve_existing_path(eff.sdk_root)

        if configured_sdk_raw:
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_root_configured",
                    category="sdk",
                    title="SDK Root Configured",
                    status="pass",
                    summary="VEGA SDK root is configured.",
                    detected_path=configured_sdk_raw,
                )
            )
        elif resolved_sdk and resolved_sdk.is_dir():
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_root_configured",
                    category="sdk",
                    title="SDK Root Configured",
                    status="warning",
                    summary="Auto-detected VEGA SDK directory (save settings to lock it in).",
                    detected_path=str(resolved_sdk),
                    remediation="Review and click Save Configuration or Auto-Detect & Apply.",
                )
            )
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_root_configured",
                    category="sdk",
                    title="SDK Root Configured",
                    status="fail",
                    summary="VEGA SDK root is not configured and was not found at ~/vega/vega-sdk.",
                    remediation="Install VEGA SDK or set SDK Root to your local vega-sdk folder.",
                )
            )

        if resolved_sdk and resolved_sdk.is_dir():
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_dir_exists",
                    category="sdk",
                    title="SDK Directory Exists",
                    status="pass",
                    summary="VEGA SDK directory exists on disk.",
                    detected_path=str(resolved_sdk),
                )
            )
            marker_candidates = ("examples", "bsp", "libs", "drivers", "Makefile", "src", "include")
            try:
                child_names = {entry.name for entry in resolved_sdk.iterdir()}
                found_markers = [m for m in marker_candidates if m in child_names]
                if found_markers:
                    checks.append(
                        DiagnosticCheckResult(
                            id="sdk_contents_valid",
                            category="sdk",
                            title="VEGA SDK Contents",
                            status="pass",
                            summary=f"Detected SDK structure ({', '.join(found_markers)}).",
                            detected_path=str(resolved_sdk),
                        )
                    )
                else:
                    checks.append(
                        DiagnosticCheckResult(
                            id="sdk_contents_valid",
                            category="sdk",
                            title="VEGA SDK Contents",
                            status="warning",
                            summary="SDK directory exists, but standard folders (examples/bsp/libs) were not found.",
                            detected_path=str(resolved_sdk),
                            remediation="Confirm this path points to the root of your VEGA SDK tree.",
                        )
                    )
            except OSError as exc:
                checks.append(
                    DiagnosticCheckResult(
                        id="sdk_contents_valid",
                        category="sdk",
                        title="VEGA SDK Contents",
                        status="warning",
                        summary="Could not inspect SDK directory contents.",
                        detail=str(exc),
                        detected_path=str(resolved_sdk),
                    )
                )
        else:
            bad_path = configured_sdk_raw or "~/vega/vega-sdk"
            is_posix_on_win = host_os == "windows" and _is_posix_style_path(_expand_user_path(bad_path))
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_dir_exists",
                    category="sdk",
                    title="SDK Directory Exists",
                    status="warning" if is_posix_on_win else "fail",
                    summary=(
                        f"Linux/POSIX path '{bad_path}' staged (cannot verify locally on Windows)."
                        if is_posix_on_win
                        else f"VEGA SDK directory not found at '{bad_path}'."
                    ),
                    detected_path=bad_path,
                    remediation="Point SDK Root to an existing VEGA SDK installation.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="sdk_contents_valid",
                    category="sdk",
                    title="VEGA SDK Contents",
                    status="not_checked",
                    summary="Skipped because SDK directory does not exist on this host.",
                )
            )

        # -------------------- 2. Toolchain Checks -------------------- #
        resolved_tc = _resolve_existing_path(eff.toolchain_root)
        resolved_compiler = _resolve_existing_path(eff.compiler_path)
        prefix = eff.cross_compile_prefix or DEFAULT_CROSS_COMPILE_PREFIX

        if resolved_tc and resolved_tc.is_dir():
            has_bin = (resolved_tc / "bin").is_dir()
            checks.append(
                DiagnosticCheckResult(
                    id="toolchain_dir_exists",
                    category="toolchain",
                    title="Toolchain Directory Exists",
                    status="pass" if has_bin else "warning",
                    summary=(
                        "Toolchain directory and bin/ folder exist."
                        if has_bin
                        else "Toolchain directory exists, but bin/ subfolder was not found."
                    ),
                    detected_path=str(resolved_tc),
                )
            )
        else:
            tc_disp = eff.toolchain_root or "~/vega/vega-tools-rv32"
            checks.append(
                DiagnosticCheckResult(
                    id="toolchain_dir_exists",
                    category="toolchain",
                    title="Toolchain Directory Exists",
                    status="warning" if resolved_compiler and resolved_compiler.is_file() else "fail",
                    summary=(
                        f"Toolchain directory not found at '{tc_disp}'."
                    ),
                    detected_path=tc_disp,
                    remediation="Install vega-tools-rv32 toolchain or set Toolchain Root.",
                )
            )

        compiler_runnable = False
        if resolved_compiler and resolved_compiler.is_file():
            checks.append(
                DiagnosticCheckResult(
                    id="compiler_exists",
                    category="toolchain",
                    title="Cross-Compiler Present",
                    status="pass",
                    summary=f"Found compiler '{resolved_compiler.name}'.",
                    detected_path=str(resolved_compiler),
                )
            )
            is_exec = os.access(resolved_compiler, os.X_OK)
            if host_os != "windows" and not is_exec:
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_executable",
                        category="toolchain",
                        title="Cross-Compiler Runnable",
                        status="fail",
                        summary="Compiler file exists but lacks executable permission (+x).",
                        detected_path=str(resolved_compiler),
                        remediation=f"Run chmod +x '{resolved_compiler}'.",
                    )
                )
            else:
                compiler_runnable = True
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_executable",
                        category="toolchain",
                        title="Cross-Compiler Runnable",
                        status="pass",
                        summary="Compiler file is accessible on this host.",
                        detected_path=str(resolved_compiler),
                    )
                )
        else:
            expected_gcc = f"{prefix}-gcc"
            checks.append(
                DiagnosticCheckResult(
                    id="compiler_exists",
                    category="toolchain",
                    title="Cross-Compiler Present",
                    status="warning" if host_os == "windows" else "fail",
                    summary=(
                        f"{expected_gcc} was not detected (expected on Linux target host)."
                        if host_os == "windows"
                        else f"Cross-compiler '{expected_gcc}' could not be located."
                    ),
                    detected_path=eff.compiler_path,
                    remediation=f"Install {expected_gcc} in your VEGA toolchain or select Compiler Path manually.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="compiler_executable",
                    category="toolchain",
                    title="Cross-Compiler Runnable",
                    status="not_checked",
                    summary="Skipped because cross-compiler executable was not found.",
                )
            )

        if compiler_runnable and resolved_compiler is not None:
            cmd_ver = [str(resolved_compiler), "--version"]
            rc, out, err, run_err = self._run_safe_command(
                cmd_ver, env=env, cwd=resolved_compiler.parent
            )
            if run_err:
                is_win_elf_issue = host_os == "windows"
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_invocation",
                        category="toolchain",
                        title="Compiler Version Check",
                        status="warning" if is_win_elf_issue else "fail",
                        summary=(
                            "Configured compiler could not execute on Windows host."
                            if is_win_elf_issue
                            else "Failed to execute compiler version check."
                        ),
                        detail=run_err,
                        detected_path=str(resolved_compiler),
                        command=f"{resolved_compiler.name} --version",
                    )
                )
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_target",
                        category="toolchain",
                        title="Compiler Target Verification",
                        status="not_checked",
                        summary="Skipped because compiler invocation failed.",
                    )
                )
            elif rc == 0:
                ver_line = _first_non_empty_line(out or err) or "Compiler responded with exit 0"
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_invocation",
                        category="toolchain",
                        title="Compiler Version Check",
                        status="pass",
                        summary=f"Compiler executed cleanly: {ver_line}",
                        detected_path=str(resolved_compiler),
                        detected_version=ver_line,
                        command=f"{resolved_compiler.name} --version",
                        output=out or err,
                    )
                )
                # Verify compiler target machine
                rc_t, out_t, err_t, run_err_t = self._run_safe_command(
                    [str(resolved_compiler), "-dumpmachine"],
                    env=env,
                    cwd=resolved_compiler.parent,
                )
                triple = _first_non_empty_line(out_t or err_t)
                if run_err_t or rc_t != 0 or not triple:
                    checks.append(
                        DiagnosticCheckResult(
                            id="compiler_target",
                            category="toolchain",
                            title="Compiler Target Verification",
                            status="warning",
                            summary="Could not confirm compiler target triple via -dumpmachine.",
                            detail=run_err_t or err_t or out_t,
                            detected_path=str(resolved_compiler),
                            command=f"{resolved_compiler.name} -dumpmachine",
                        )
                    )
                elif prefix in triple or "riscv32" in triple.lower():
                    checks.append(
                        DiagnosticCheckResult(
                            id="compiler_target",
                            category="toolchain",
                            title="Compiler Target Verification",
                            status="pass",
                            summary=f"Compiler target triple '{triple}' is compatible with RISC-V 32-bit VEGA.",
                            detected_path=str(resolved_compiler),
                            detected_version=triple,
                            command=f"{resolved_compiler.name} -dumpmachine",
                            output=triple,
                        )
                    )
                else:
                    checks.append(
                        DiagnosticCheckResult(
                            id="compiler_target",
                            category="toolchain",
                            title="Compiler Target Verification",
                            status="warning",
                            summary=f"Compiler triple '{triple}' does not match expected prefix '{prefix}' / riscv32.",
                            detected_path=str(resolved_compiler),
                            detected_version=triple,
                            command=f"{resolved_compiler.name} -dumpmachine",
                            output=triple,
                            remediation=f"Verify {prefix}-gcc is selected rather than host gcc.",
                        )
                    )
            else:
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_invocation",
                        category="toolchain",
                        title="Compiler Version Check",
                        status="fail",
                        summary=f"Compiler returned non-zero exit code {rc}.",
                        detail=err or out,
                        detected_path=str(resolved_compiler),
                        command=f"{resolved_compiler.name} --version",
                        output=err or out,
                    )
                )
                checks.append(
                    DiagnosticCheckResult(
                        id="compiler_target",
                        category="toolchain",
                        title="Compiler Target Verification",
                        status="not_checked",
                        summary="Skipped because compiler version command failed.",
                    )
                )
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="compiler_invocation",
                    category="toolchain",
                    title="Compiler Version Check",
                    status="not_checked",
                    summary="Skipped because cross-compiler executable is unavailable.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="compiler_target",
                    category="toolchain",
                    title="Compiler Target Verification",
                    status="not_checked",
                    summary="Skipped because cross-compiler executable is unavailable.",
                )
            )

        # -------------------- 3. Build Prerequisites -------------------- #
        resolved_make = _resolve_existing_path(eff.make_path)
        if resolved_make and resolved_make.is_file():
            checks.append(
                DiagnosticCheckResult(
                    id="make_detected",
                    category="build_prerequisites",
                    title="Make Executable Detected",
                    status="pass",
                    summary=f"Detected Make at '{resolved_make.name}'.",
                    detected_path=str(resolved_make),
                )
            )
            rc_m, out_m, err_m, run_err_m = self._run_safe_command(
                [str(resolved_make), "--version"],
                env=env,
                cwd=resolved_make.parent,
            )
            if run_err_m or rc_m != 0:
                checks.append(
                    DiagnosticCheckResult(
                        id="make_version",
                        category="build_prerequisites",
                        title="Make Version Check",
                        status="fail",
                        summary="Failed to retrieve Make version.",
                        detail=run_err_m or err_m or out_m,
                        detected_path=str(resolved_make),
                        command=f"{resolved_make.name} --version",
                    )
                )
            else:
                ver_m = _first_non_empty_line(out_m or err_m) or "Make available"
                checks.append(
                    DiagnosticCheckResult(
                        id="make_version",
                        category="build_prerequisites",
                        title="Make Version Check",
                        status="pass",
                        summary=ver_m,
                        detected_path=str(resolved_make),
                        detected_version=ver_m,
                        command=f"{resolved_make.name} --version",
                        output=out_m or err_m,
                    )
                )
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="make_detected",
                    category="build_prerequisites",
                    title="Make Executable Detected",
                    status="fail",
                    summary="Make executable was not detected.",
                    remediation=(
                        "Install GNU Make (e.g. build-essential on Ubuntu) or configure Make Path."
                    ),
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="make_version",
                    category="build_prerequisites",
                    title="Make Version Check",
                    status="not_checked",
                    summary="Skipped because Make executable was not detected.",
                )
            )

        resolved_py = _resolve_existing_path(eff.python_path)
        if resolved_py and resolved_py.is_file():
            checks.append(
                DiagnosticCheckResult(
                    id="python_detected",
                    category="build_prerequisites",
                    title="Python 3 Detected",
                    status="pass",
                    summary=f"Detected Python interpreter '{resolved_py.name}'.",
                    detected_path=str(resolved_py),
                )
            )
            rc_p, out_p, err_p, run_err_p = self._run_safe_command(
                [str(resolved_py), "--version"],
                env=env,
                cwd=resolved_py.parent,
            )
            ver_p = _first_non_empty_line(out_p or err_p)
            if run_err_p or rc_p != 0 or not ver_p:
                checks.append(
                    DiagnosticCheckResult(
                        id="python_version",
                        category="build_prerequisites",
                        title="Python Version Check",
                        status="fail",
                        summary="Failed to execute Python version check.",
                        detail=run_err_p or err_p or out_p,
                        detected_path=str(resolved_py),
                        command=f"{resolved_py.name} --version",
                    )
                )
            elif "python 3." in ver_p.lower():
                checks.append(
                    DiagnosticCheckResult(
                        id="python_version",
                        category="build_prerequisites",
                        title="Python Version Check",
                        status="pass",
                        summary=ver_p,
                        detected_path=str(resolved_py),
                        detected_version=ver_p,
                        command=f"{resolved_py.name} --version",
                        output=out_p or err_p,
                    )
                )
            else:
                checks.append(
                    DiagnosticCheckResult(
                        id="python_version",
                        category="build_prerequisites",
                        title="Python Version Check",
                        status="warning",
                        summary=f"Expected Python 3.x, detected '{ver_p}'.",
                        detected_path=str(resolved_py),
                        detected_version=ver_p,
                        command=f"{resolved_py.name} --version",
                        output=out_p or err_p,
                    )
                )
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="python_detected",
                    category="build_prerequisites",
                    title="Python 3 Detected",
                    status="fail",
                    summary="Python 3 executable was not detected.",
                    remediation="Install Python 3 or specify Python executable path.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="python_version",
                    category="build_prerequisites",
                    title="Python Version Check",
                    status="not_checked",
                    summary="Skipped because Python executable was not detected.",
                )
            )

        # -------------------- 4. VEGA Configuration Checks -------------------- #
        checks.append(
            DiagnosticCheckResult(
                id="vega_target_arch",
                category="vega_config",
                title="Target Architecture (rv32i_zicsr)",
                status="pass" if eff.target_arch == DEFAULT_TARGET_ARCH else "warning",
                summary=(
                    f"Target architecture matches VEGA ARIES V3 ({eff.target_arch})."
                    if eff.target_arch == DEFAULT_TARGET_ARCH
                    else f"Custom architecture '{eff.target_arch}' configured (reference: {DEFAULT_TARGET_ARCH})."
                ),
                detected_version=eff.target_arch,
            )
        )
        checks.append(
            DiagnosticCheckResult(
                id="vega_target_machine",
                category="vega_config",
                title="Target Machine (THEJAS32)",
                status="pass" if eff.target_machine == DEFAULT_TARGET_MACHINE else "warning",
                summary=(
                    f"Target machine matches VEGA ARIES V3 ({eff.target_machine})."
                    if eff.target_machine == DEFAULT_TARGET_MACHINE
                    else f"Custom machine '{eff.target_machine}' configured (reference: {DEFAULT_TARGET_MACHINE})."
                ),
                detected_version=eff.target_machine,
            )
        )
        checks.append(
            DiagnosticCheckResult(
                id="vega_cross_prefix",
                category="vega_config",
                title="Cross-Compile Prefix",
                status="pass" if prefix == DEFAULT_CROSS_COMPILE_PREFIX else "warning",
                summary=(
                    f"Cross-compile prefix matches VEGA reference ({prefix})."
                    if prefix == DEFAULT_CROSS_COMPILE_PREFIX
                    else f"Custom cross-compile prefix '{prefix}' (reference: {DEFAULT_CROSS_COMPILE_PREFIX})."
                ),
                detected_version=prefix,
            )
        )

        # Environment alignment summary check
        sdk_ok = resolved_sdk is not None and resolved_sdk.is_dir()
        compiler_check_ok = any(
            c.id == "compiler_invocation" and c.status == "pass" for c in checks
        )
        make_ok = any(c.id == "make_version" and c.status == "pass" for c in checks)
        if host_os != "linux":
            checks.append(
                DiagnosticCheckResult(
                    id="vega_env_alignment",
                    category="vega_config",
                    title="VEGA ARIES V3 Readiness",
                    status="warning",
                    summary=f"Running on {host_os.title()} host; primary VEGA toolchain target is Ubuntu/Linux.",
                    detail=(
                        "Windows development and UI testing are supported, while Linux VEGA SDK/toolchain checks only pass when native Linux binaries are available. "
                        "Serial port and USB hardware probes are deferred to Board/Upload phases."
                    ),
                )
            )
        elif sdk_ok and compiler_check_ok and make_ok:
            checks.append(
                DiagnosticCheckResult(
                    id="vega_env_alignment",
                    category="vega_config",
                    title="VEGA ARIES V3 Readiness",
                    status="pass",
                    summary="VEGA SDK, RISC-V cross-compiler, and Make prerequisites are ready.",
                    detail="USB/serial board detection is intentionally excluded until Phase 8.",
                )
            )
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="vega_env_alignment",
                    category="vega_config",
                    title="VEGA ARIES V3 Readiness",
                    status="warning" if (sdk_ok or compiler_check_ok or make_ok) else "fail",
                    summary="VEGA ARIES V3 development environment is incomplete.",
                    detail="Resolve missing SDK, toolchain, or Make prerequisites listed above.",
                )
            )

        # -------------------- 5. Upload Prerequisites -------------------- #
        resolved_uploader = _resolve_existing_path(eff.uploader_script)
        explicit_uploader = base_config.uploader_script

        if resolved_uploader and resolved_uploader.is_file():
            checks.append(
                DiagnosticCheckResult(
                    id="uploader_exists",
                    category="upload_prerequisites",
                    title="VEGA XMODEM Uploader Script",
                    status="pass",
                    summary=f"Located uploader script '{resolved_uploader.name}'.",
                    detected_path=str(resolved_uploader),
                )
            )
            inspect_check, deps_check = self._inspect_uploader_script(
                resolved_uploader, resolved_py, env
            )
            checks.extend([inspect_check, deps_check])
        else:
            checks.append(
                DiagnosticCheckResult(
                    id="uploader_exists",
                    category="upload_prerequisites",
                    title="VEGA XMODEM Uploader Script",
                    status="fail" if explicit_uploader else "warning",
                    summary=(
                        f"Configured XMODEM uploader not found at '{explicit_uploader}'."
                        if explicit_uploader
                        else "VEGA XMODEM uploader (~/vega/tools/vega_xmodem.py) was not detected."
                    ),
                    detected_path=explicit_uploader,
                    remediation="Configure Uploader Script path before flashing firmware via XMODEM.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="uploader_inspection",
                    category="upload_prerequisites",
                    title="Uploader Python Compatibility",
                    status="not_checked",
                    summary="Skipped because uploader script was not found.",
                )
            )
            checks.append(
                DiagnosticCheckResult(
                    id="uploader_dependencies",
                    category="upload_prerequisites",
                    title="Upload Python Dependencies",
                    status="not_checked",
                    summary="Skipped because uploader script was not found.",
                )
            )

        summary = _summarize_counts(checks)
        overall = _overall_from_counts(summary)
        report = SdkDoctorReport(
            overall_status=overall,
            checked_at=_utc_now(),
            platform_os=host_os,
            platform_compatible=host_os == "linux",
            summary=summary,
            config_used=eff,
            checks=checks,
            companion_tools=discovery.compiler_tools,
        )

        self.persistence.set_state_json(_SDK_REPORT_STATE_KEY, report.model_dump())
        return report


def get_sdk_service() -> SdkService:
    """FastAPI dependency returning a configured SdkService."""
    return SdkService(settings)
