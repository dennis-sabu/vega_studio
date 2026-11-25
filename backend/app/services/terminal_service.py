"""VEGA Studio Backend – Phase 11 Interactive PTY Terminal Service.

Cross-platform architecture:
- Linux / macOS: native POSIX PTY via standard library (`pty`, `termios`, `fcntl`, `subprocess`).
- Windows: native Windows ConPTY via `winpty.PTY` (`pywinpty`).
- Every session runs its own daemon reader thread pushing UTF-8 / raw ANSI chunks
  to a bounded ring buffer (256 KiB) and attached WebSocket subscriber queues.
- Raw ANSI escape sequences are NEVER stripped or rewritten in the backend.
- WebSocket disconnections leave running terminal sessions alive; only explicit
  DELETE close, natural shell exit, restart, or backend shutdown terminates PTYs.
"""
from __future__ import annotations

import asyncio
import codecs
from collections import deque
from dataclasses import dataclass, field
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import threading
import time
from typing import Any, Callable, Deque, Dict, List, Optional, Protocol, Set, Tuple
from urllib.parse import unquote
import uuid

from app.config import Settings, settings
from app.models.terminal import (
    TerminalCloseResponse,
    TerminalPtyBackend,
    TerminalResizeRequest,
    TerminalSessionCreateRequest,
    TerminalSessionListResponse,
    TerminalSessionStateResponse,
    TerminalSessionSummary,
    TerminalShellInfo,
    TerminalShellsResponse,
    TerminalStatus,
    validate_session_id,
)
from app.services.process_utils import utc_now_iso
from app.services.project_service import ProjectService
from app.services.sdk_service import (
    SdkService,
    _build_safe_subprocess_env,
    _host_os_name,
    _resolve_existing_path,
)

# ---------------------------------------------------------------------------
# Optional Windows ConPTY backend (`pywinpty`)
# ---------------------------------------------------------------------------

try:  # pragma: no cover - platform conditional import
    if _host_os_name() == "windows":
        import winpty  # type: ignore[import-not-found]
    else:
        winpty = None  # type: ignore[assignment]
except ImportError:  # pragma: no cover
    winpty = None  # type: ignore[assignment]

try:  # pragma: no cover - POSIX only
    import fcntl
    import pty as posix_pty
    import termios

    POSIX_PTY_AVAILABLE = True
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]
    posix_pty = None  # type: ignore[assignment]
    termios = None  # type: ignore[assignment]
    POSIX_PTY_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants & limits
# ---------------------------------------------------------------------------

MAX_TERMINAL_SESSIONS = 6
MAX_TERMINAL_BUFFER_CHARS = 262_144  # ~256 KiB bounded ANSI replay per session
MAX_WS_SUBSCRIBER_QUEUE = 2048
MAX_INPUT_CHARS = 65_536
_READ_CHUNK_BYTES = 4096

_OSC7_CWD_RE = re.compile(
    r"\x1b\]7;file://[^/\x07\x1b]*(/[^\x07\x1b]*)(?:\x07|\x1b\\)"
)
_OSC99_CWD_RE = re.compile(r"\x1b\]9;9;([^\x07\x1b]+)(?:\x07|\x1b\\)")

_POSIX_ALLOWED_SHELLS: Dict[str, str] = {
    "bash": "Bash",
    "zsh": "Zsh",
    "fish": "Fish",
    "sh": "POSIX sh",
    "dash": "Dash",
    "ksh": "Ksh",
}

_SubscriberEntry = Tuple["asyncio.Queue[Dict[str, Any]]", asyncio.AbstractEventLoop]


# ---------------------------------------------------------------------------
# Domain Error
# ---------------------------------------------------------------------------


class TerminalServiceError(Exception):
    """Domain error carrying an HTTP status code."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------------------
# PTY Backend Abstraction
# ---------------------------------------------------------------------------


class BasePtyHandle(Protocol):
    """Minimal cross-platform interface implemented by each PTY adapter."""

    @property
    def pid(self) -> Optional[int]: ...

    def read(self) -> Optional[str]: ...

    def write(self, data: str) -> None: ...

    def resize(self, cols: int, rows: int) -> None: ...

    def terminate(self) -> Optional[int]: ...

    def is_alive(self) -> bool: ...

    def poll_exit_code(self) -> Optional[int]: ...


PtyFactory = Callable[
    [str, List[str], str, Dict[str, str], int, int],
    BasePtyHandle,
]


def _kill_windows_pid_tree(pid: Optional[int]) -> None:
    if not pid or pid <= 0:
        return
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            shell=False,
            capture_output=True,
            timeout=3.0,
        )
    except (subprocess.TimeoutExpired, OSError):
        pass


class _WinPtyHandle:
    """Windows ConPTY terminal adapter backed by `winpty.PTY`."""

    def __init__(
        self,
        executable: str,
        args: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
    ) -> None:
        if winpty is None:
            raise TerminalServiceError(
                "Windows ConPTY support requires pywinpty, which is not installed.",
                status_code=503,
            )

        self._write_lock = threading.Lock()
        self._closed = False
        self._cached_exit: Optional[int] = None

        env_pairs = [
            f"{k}={v}"
            for k, v in env.items()
            if "\x00" not in k and "\x00" not in v
        ]
        env_block = "\x00".join(env_pairs) + "\x00"
        cmdline: Optional[str] = (
            " " + subprocess.list2cmdline(args) if args else None
        )

        try:
            self._pty = winpty.PTY(cols, rows)
            spawned = self._pty.spawn(
                executable,
                cmdline=cmdline,
                cwd=cwd,
                env=env_block,
            )
        except Exception as exc:
            raise TerminalServiceError(
                f"Failed to spawn Windows ConPTY shell '{executable}': {exc}",
                status_code=500,
            ) from exc
        if not spawned:
            raise TerminalServiceError(
                f"Failed to start shell process '{executable}' in Windows ConPTY.",
                status_code=500,
            )

    @property
    def pid(self) -> Optional[int]:
        try:
            raw = self._pty.pid
            return int(raw) if raw else None
        except Exception:
            return None

    def read(self) -> Optional[str]:
        while not self._closed:
            try:
                data = self._pty.read(blocking=True)
            except Exception:
                return None

            if data:
                return data

            try:
                if self._pty.iseof() or not self._pty.isalive():
                    return None
            except Exception:
                return None

            time.sleep(0.01)
        return None

    def write(self, data: str) -> None:
        if self._closed or not data:
            return
        with self._write_lock:
            self._pty.write(data)

    def resize(self, cols: int, rows: int) -> None:
        if self._closed:
            return
        self._pty.set_size(cols, rows)

    def is_alive(self) -> bool:
        if self._closed:
            return False
        try:
            return bool(self._pty.isalive())
        except Exception:
            return False

    def poll_exit_code(self) -> Optional[int]:
        if self._cached_exit is not None:
            return self._cached_exit
        try:
            code = self._pty.get_exitstatus()
            if code is not None:
                self._cached_exit = int(code)
            return self._cached_exit
        except Exception:
            return self._cached_exit

    def terminate(self) -> Optional[int]:
        self._closed = True
        pid = self.pid
        _kill_windows_pid_tree(pid)
        try:
            self._pty.cancel_io()
        except Exception:
            pass
        code = self.poll_exit_code()
        return code if code is not None else 0


class _PosixPtyHandle:
    """Linux / macOS POSIX PTY adapter using stdlib `pty`, `termios`, and `fcntl`."""

    def __init__(
        self,
        executable: str,
        args: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
    ) -> None:
        if not POSIX_PTY_AVAILABLE or posix_pty is None or fcntl is None or termios is None:
            raise TerminalServiceError(
                "POSIX PTY modules are unavailable on this platform.",
                status_code=503,
            )

        self._write_lock = threading.Lock()
        self._closed = False
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

        master_fd, slave_fd = posix_pty.openpty()
        self._master_fd: int = master_fd

        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

            def _configure_child_ctty() -> None:
                os.setsid()
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

            self._proc: subprocess.Popen[bytes] = subprocess.Popen(
                [executable, *args],
                cwd=cwd,
                env=env,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                preexec_fn=_configure_child_ctty,
                close_fds=True,
                shell=False,
            )
        except Exception as exc:
            try:
                os.close(slave_fd)
            except OSError:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass
            raise TerminalServiceError(
                f"Failed to launch POSIX shell '{executable}': {exc}",
                status_code=500,
            ) from exc

        try:
            os.close(slave_fd)
        except OSError:
            pass

    @property
    def pid(self) -> Optional[int]:
        return self._proc.pid

    def read(self) -> Optional[str]:
        while not self._closed:
            try:
                raw = os.read(self._master_fd, _READ_CHUNK_BYTES)
            except OSError:
                break

            if not raw:
                break

            text = self._decoder.decode(raw, final=False)
            if text:
                return text

        tail = self._decoder.decode(b"", final=True)
        return tail or None

    def write(self, data: str) -> None:
        if self._closed or not data:
            return
        payload = data.encode("utf-8", errors="replace")
        view = memoryview(payload)
        with self._write_lock:
            offset = 0
            while offset < len(payload):
                written = os.write(self._master_fd, view[offset:])
                if written <= 0:
                    break
                offset += written

    def resize(self, cols: int, rows: int) -> None:
        if self._closed or fcntl is None or termios is None:
            return
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        try:
            fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass
        if self._proc.poll() is None:
            try:
                os.killpg(os.getpgid(self._proc.pid), signal.SIGWINCH)
            except OSError:
                pass

    def is_alive(self) -> bool:
        return not self._closed and self._proc.poll() is None

    def poll_exit_code(self) -> Optional[int]:
        return self._proc.poll()

    def terminate(self) -> Optional[int]:
        self._closed = True
        if self._proc.poll() is None:
            try:
                pgid = os.getpgid(self._proc.pid)
                os.killpg(pgid, signal.SIGTERM)
                self._proc.wait(timeout=1.2)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    os.killpg(os.getpgid(self._proc.pid), signal.SIGKILL)
                except OSError:
                    try:
                        self._proc.kill()
                    except OSError:
                        pass
                try:
                    self._proc.wait(timeout=1.0)
                except (subprocess.TimeoutExpired, OSError):
                    pass

        try:
            os.close(self._master_fd)
        except OSError:
            pass

        return self._proc.poll()


# ---------------------------------------------------------------------------
# Internal session record
# ---------------------------------------------------------------------------


@dataclass
class TerminalSessionRecord:
    summary: TerminalSessionSummary
    executable: str
    default_args: List[str]
    pty_handle: Optional[BasePtyHandle] = None
    reader_thread: Optional[threading.Thread] = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    replay_chunks: Deque[str] = field(default_factory=deque)
    replay_chars: int = 0
    seq_counter: int = 0
    subscribers: Set[_SubscriberEntry] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock)
    intentional_stop: bool = False

    def append_replay(self, chunk: str) -> None:
        if not chunk:
            return
        if len(chunk) >= MAX_TERMINAL_BUFFER_CHARS:
            trimmed = chunk[-MAX_TERMINAL_BUFFER_CHARS:]
            self.replay_chunks.clear()
            self.replay_chunks.append(trimmed)
            self.replay_chars = len(trimmed)
            self.summary.buffer_truncated = True
            self.summary.buffer_bytes = len(trimmed.encode("utf-8", errors="replace"))
            return

        self.replay_chunks.append(chunk)
        self.replay_chars += len(chunk)
        while self.replay_chars > MAX_TERMINAL_BUFFER_CHARS and self.replay_chunks:
            oldest = self.replay_chunks.popleft()
            self.replay_chars -= len(oldest)
            self.summary.buffer_truncated = True

        self.summary.buffer_bytes = self.replay_chars

    def get_replay_text(self) -> str:
        return "".join(self.replay_chunks)

    def clear_replay(self) -> None:
        self.replay_chunks.clear()
        self.replay_chars = 0
        self.summary.buffer_bytes = 0
        self.summary.buffer_truncated = False


# ---------------------------------------------------------------------------
# Event queue helper (called on target event loop via call_soon_threadsafe)
# ---------------------------------------------------------------------------


def _deliver_queue_event(
    queue: "asyncio.Queue[Dict[str, Any]]",
    payload: Dict[str, Any],
) -> None:
    if queue.full():
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        queue.put_nowait(payload)
    except asyncio.QueueFull:
        pass


# ---------------------------------------------------------------------------
# Terminal Service
# ---------------------------------------------------------------------------


class TerminalService:
    """Manages interactive PTY terminal sessions, shell discovery, and lifecycles."""

    def __init__(
        self,
        app_settings: Optional[Settings] = None,
        *,
        max_sessions: int = MAX_TERMINAL_SESSIONS,
        pty_factory: Optional[PtyFactory] = None,
    ) -> None:
        self._settings = app_settings or settings
        self._sdk = SdkService(self._settings)
        self._projects = ProjectService(self._settings)
        self._max_sessions = max(1, int(max_sessions))
        self._pty_factory = pty_factory

        self._lock = threading.Lock()
        self._sessions: Dict[str, TerminalSessionRecord] = {}
        self._session_order: List[str] = []
        self._tab_counter = 0
        self._shutting_down = False

    # ------------------------------------------------------------------ #
    # PTY capability & shell discovery
    # ------------------------------------------------------------------ #

    def pty_capabilities(self) -> Tuple[TerminalPtyBackend, bool, Optional[str]]:
        if self._pty_factory is not None:
            host_os = _host_os_name()
            backend: TerminalPtyBackend = (
                "winpty_conpty" if host_os == "windows" else "posix_pty"
            )
            return backend, True, None

        host_os = _host_os_name()
        if host_os == "windows":
            if winpty is not None:
                return "winpty_conpty", True, None
            return (
                "unavailable",
                False,
                "Windows interactive PTY support requires pywinpty in backend/.venv.",
            )

        if POSIX_PTY_AVAILABLE:
            return "posix_pty", True, None
        return (
            "unavailable",
            False,
            "POSIX PTY modules (pty, termios, fcntl) are unavailable on this host.",
        )

    def discover_shells(self) -> TerminalShellsResponse:
        """Detect available supported shells safely without hardcoding blind paths."""
        host_os = _host_os_name()
        pty_backend, pty_supported, pty_message = self.pty_capabilities()
        shells: List[TerminalShellInfo] = []

        if host_os == "windows":
            pwsh = shutil.which("pwsh.exe") or shutil.which("pwsh")
            if pwsh and Path(pwsh).is_file():
                shells.append(
                    TerminalShellInfo(
                        id="pwsh",
                        label="PowerShell 7",
                        executable=str(Path(pwsh).resolve()),
                        default_args=["-NoLogo"],
                    )
                )

            ps = shutil.which("powershell.exe") or shutil.which("powershell")
            if ps and Path(ps).is_file():
                shells.append(
                    TerminalShellInfo(
                        id="powershell",
                        label="Windows PowerShell",
                        executable=str(Path(ps).resolve()),
                        default_args=["-NoLogo"],
                    )
                )

            comspec_raw = os.environ.get("COMSPEC")
            cmd_path = (
                comspec_raw
                if comspec_raw and Path(comspec_raw).is_file()
                else shutil.which("cmd.exe")
            )
            if cmd_path and Path(cmd_path).is_file():
                shells.append(
                    TerminalShellInfo(
                        id="cmd",
                        label="Command Prompt",
                        executable=str(Path(cmd_path).resolve()),
                        default_args=[],
                    )
                )

            default_id = shells[0].id if shells else None
        else:
            seen_ids: Set[str] = set()
            preferred_env_id: Optional[str] = None

            env_shell = os.environ.get("SHELL", "").strip()
            if env_shell:
                env_path = Path(env_shell)
                base_name = env_path.name.lower()
                if (
                    base_name in _POSIX_ALLOWED_SHELLS
                    and env_path.is_file()
                    and os.access(env_path, os.X_OK)
                ):
                    preferred_env_id = base_name
                    seen_ids.add(base_name)
                    shells.append(
                        TerminalShellInfo(
                            id=base_name,
                            label=_POSIX_ALLOWED_SHELLS[base_name],
                            executable=str(env_path),
                            default_args=[],
                        )
                    )

            for shell_id in ("bash", "zsh", "fish", "sh"):
                if shell_id in seen_ids:
                    continue
                found = shutil.which(shell_id)
                if not found:
                    for std_dir in ("/bin", "/usr/bin"):
                        cand = Path(std_dir) / shell_id
                        if cand.is_file() and os.access(cand, os.X_OK):
                            found = str(cand)
                            break
                if found and Path(found).is_file() and os.access(found, os.X_OK):
                    seen_ids.add(shell_id)
                    shells.append(
                        TerminalShellInfo(
                            id=shell_id,
                            label=_POSIX_ALLOWED_SHELLS[shell_id],
                            executable=found,
                            default_args=[],
                        )
                    )

            if preferred_env_id and any(s.id == preferred_env_id for s in shells):
                default_id = preferred_env_id
            elif any(s.id == "bash" for s in shells):
                default_id = "bash"
            elif any(s.id == "zsh" for s in shells):
                default_id = "zsh"
            else:
                default_id = shells[0].id if shells else None

        for item in shells:
            item.is_default = item.id == default_id

        if not shells:
            pty_supported = False
            pty_message = (
                pty_message
                or f"No supported interactive shells detected for host OS '{host_os}'."
            )

        return TerminalShellsResponse(
            platform_os=host_os,
            pty_backend=pty_backend,
            pty_supported=pty_supported,
            pty_message=pty_message,
            default_shell_id=default_id,
            shells=shells,
        )

    # ------------------------------------------------------------------ #
    # Directory validation & environment builder
    # ------------------------------------------------------------------ #

    def _validate_directory_readable(self, target: Path, label: str) -> str:
        if not target.exists():
            raise TerminalServiceError(
                f"{label} does not exist: '{target}'.", status_code=400
            )
        if not target.is_dir():
            raise TerminalServiceError(
                f"{label} is not a directory: '{target}'.", status_code=400
            )
        try:
            with os.scandir(target) as it:
                next(it, None)
        except OSError as exc:
            raise TerminalServiceError(
                f"{label} is not accessible: {exc}", status_code=400
            ) from exc
        return str(target)

    def resolve_working_directory(
        self,
        requested_cwd: Optional[str],
        project_dir: Optional[str],
    ) -> Tuple[str, Optional[str]]:
        """Validate requested working directory or select safe active-project/default cwd."""
        validated_project_dir: Optional[str] = None
        if project_dir:
            proj_path = Path(os.path.expanduser(project_dir)).resolve(strict=False)
            if proj_path.is_dir():
                validated_project_dir = self._validate_directory_readable(
                    proj_path, "Project directory"
                )
        else:
            try:
                active_dir = self._projects.persistence.get_active_project_dir()
                if active_dir:
                    cand = Path(active_dir).resolve(strict=False)
                    if cand.is_dir():
                        validated_project_dir = str(cand)
            except Exception:
                validated_project_dir = None

        if requested_cwd:
            expanded = os.path.expanduser(requested_cwd)
            raw_path = Path(expanded)
            if raw_path.is_absolute():
                resolved = raw_path.resolve(strict=False)
            elif validated_project_dir:
                resolved = (Path(validated_project_dir) / raw_path).resolve(
                    strict=False
                )
            else:
                raise TerminalServiceError(
                    "Relative working directory requires an open project directory.",
                    status_code=400,
                )
            cwd_str = self._validate_directory_readable(
                resolved, "Working directory"
            )
            return cwd_str, validated_project_dir

        if validated_project_dir:
            return validated_project_dir, validated_project_dir

        # Safe fallback without creating or modifying directories
        try:
            default_projects = self._settings.get_default_projects_dir()
            if default_projects.is_dir():
                return str(default_projects.resolve(strict=False)), None
        except OSError:
            pass

        home_dir = Path.home()
        if home_dir.is_dir():
            return str(home_dir.resolve(strict=False)), None
        return str(Path.cwd().resolve(strict=False)), None

    def _build_terminal_env(
        self,
        project_dir: Optional[str],
    ) -> Dict[str, str]:
        """Build safe child shell environment honoring host terminal vars & valid SDK paths."""
        try:
            sdk_cfg = self._sdk.get_config_state().config
            env = _build_safe_subprocess_env(sdk_cfg)
        except Exception:
            env = {}
            sdk_cfg = None

        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["LANG"] = os.environ.get("LANG") or "C.UTF-8"
        env.pop("LC_ALL", None)
        env["VEGA_STUDIO_TERMINAL"] = "1"

        passthrough_keys = (
            "HOME",
            "USER",
            "LOGNAME",
            "SHELL",
            "TMPDIR",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "SSH_AUTH_SOCK",
            "SYSTEMDRIVE",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "COMMONPROGRAMFILES",
            "APPDATA",
            "LOCALAPPDATA",
            "HOMEDRIVE",
            "HOMEPATH",
            "USERNAME",
            "PSMODULEPATH",
            "POWERSHELL_DISTRIBUTION_CHANNEL",
        )
        for key in passthrough_keys:
            val = os.environ.get(key)
            if val and key not in env:
                env[key] = val

        if sdk_cfg is not None:
            sdk_path = _resolve_existing_path(sdk_cfg.sdk_root)
            if sdk_path and sdk_path.is_dir():
                env["VEGA_SDK"] = str(sdk_path)
            tc_path = _resolve_existing_path(sdk_cfg.toolchain_root)
            if tc_path and tc_path.is_dir():
                env["VEGA_TOOLS"] = str(tc_path)

        if project_dir:
            env["VEGA_PROJECT_DIR"] = project_dir

        return env

    # ------------------------------------------------------------------ #
    # Pty creation & worker
    # ------------------------------------------------------------------ #

    def _spawn_pty_handle(
        self,
        executable: str,
        args: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
    ) -> BasePtyHandle:
        if self._pty_factory is not None:
            return self._pty_factory(executable, args, cwd, env, cols, rows)

        if _host_os_name() == "windows":
            return _WinPtyHandle(executable, args, cwd, env, cols, rows)
        return _PosixPtyHandle(executable, args, cwd, env, cols, rows)

    def _inspect_live_cwd(self, record: TerminalSessionRecord) -> None:
        """Best-effort read-only CWD sync on Linux via `/proc/<pid>/cwd`."""
        if _host_os_name() != "linux":
            return
        with record.lock:
            pid = record.summary.pid
            alive = record.summary.status == "running"
        if not alive or not pid or pid <= 0:
            return
        try:
            real_cwd = os.readlink(f"/proc/{pid}/cwd")
            if real_cwd and Path(real_cwd).is_dir():
                with record.lock:
                    record.summary.cwd = real_cwd
        except OSError:
            pass

    def _detect_osc_cwd(self, chunk: str) -> Optional[str]:
        """Extract directory path passively from OSC 7 or OSC 9;9 sequences without altering chunk."""
        candidate: Optional[str] = None
        for m in _OSC7_CWD_RE.finditer(chunk):
            raw_path = unquote(m.group(1))
            if _host_os_name() == "windows" and len(raw_path) >= 3 and raw_path[0] == "/" and raw_path[2] == ":":
                raw_path = raw_path[1:]
            candidate = raw_path
        for m in _OSC99_CWD_RE.finditer(chunk):
            candidate = m.group(1).strip()

        if candidate:
            try:
                p = Path(candidate)
                if p.is_dir():
                    return str(p)
            except OSError:
                pass
        return None

    def _broadcast_event(
        self,
        record: TerminalSessionRecord,
        payload: Dict[str, Any],
    ) -> None:
        with record.lock:
            subs = set(record.subscribers)
        dead: List[_SubscriberEntry] = []
        for entry in subs:
            queue, loop = entry
            try:
                loop.call_soon_threadsafe(_deliver_queue_event, queue, payload)
            except Exception:
                dead.append(entry)
        if dead:
            with record.lock:
                for d in dead:
                    record.subscribers.discard(d)

    def _start_reader_thread(self, record: TerminalSessionRecord) -> None:
        thread = threading.Thread(
            target=self._reader_worker,
            args=(record,),
            daemon=True,
            name=f"vega-pty-{record.summary.session_id[:8]}",
        )
        record.reader_thread = thread
        thread.start()

    def _reader_worker(self, record: TerminalSessionRecord) -> None:
        handle = record.pty_handle
        if handle is None:
            return

        while not record.stop_event.is_set():
            chunk = handle.read()
            if chunk is None:
                break

            detected_cwd = self._detect_osc_cwd(chunk)
            with record.lock:
                record.seq_counter += 1
                seq = record.seq_counter
                record.append_replay(chunk)
                record.summary.output_bytes += len(chunk.encode("utf-8", errors="replace"))
                record.summary.last_activity_at = utc_now_iso()
                if detected_cwd:
                    record.summary.cwd = detected_cwd
                cwd_snapshot = record.summary.cwd

            self._broadcast_event(
                record,
                {
                    "type": "output",
                    "seq": seq,
                    "data": chunk,
                    "cwd": cwd_snapshot,
                },
            )

        # Wait briefly for process exit code if process closed its stream just prior to exit
        exit_code = handle.poll_exit_code()
        if exit_code is None and not record.stop_event.is_set():
            for _ in range(10):
                exit_code = handle.poll_exit_code()
                if exit_code is not None or not handle.is_alive():
                    break
                time.sleep(0.03)

        with record.lock:
            if record.intentional_stop or record.summary.status == "closed":
                return
            record.summary.status = "exited"
            record.summary.exit_code = exit_code if exit_code is not None else 0
            record.summary.exited_at = utc_now_iso()
            record.summary.last_activity_at = record.summary.exited_at
            snap = record.summary.model_copy(deep=True)

        self._broadcast_event(
            record,
            {"type": "exited", "session": snap.model_dump()},
        )

    # ------------------------------------------------------------------ #
    # Session CRUD, Input, Resize, Restart & Lifecycle
    # ------------------------------------------------------------------ #

    def list_sessions(self) -> TerminalSessionListResponse:
        pty_backend, pty_supported, _ = self.pty_capabilities()
        with self._lock:
            records = [
                self._sessions[sid]
                for sid in self._session_order
                if sid in self._sessions
            ]

        summaries: List[TerminalSessionSummary] = []
        for rec in records:
            self._inspect_live_cwd(rec)
            with rec.lock:
                summaries.append(rec.summary.model_copy(deep=True))

        return TerminalSessionListResponse(
            max_sessions=self._max_sessions,
            pty_backend=pty_backend,
            pty_supported=pty_supported,
            sessions=summaries,
        )

    def create_session(
        self, req: TerminalSessionCreateRequest
    ) -> TerminalSessionStateResponse:
        if self._shutting_down:
            raise TerminalServiceError(
                "Backend is shutting down; cannot create new terminal sessions.",
                status_code=503,
            )

        shells_info = self.discover_shells()
        if not shells_info.pty_supported or not shells_info.shells:
            raise TerminalServiceError(
                shells_info.pty_message
                or "Interactive PTY terminal is unavailable on this host.",
                status_code=503,
            )

        selected_shell: Optional[TerminalShellInfo] = None
        if req.shell_id:
            for item in shells_info.shells:
                if item.id == req.shell_id:
                    selected_shell = item
                    break
            if selected_shell is None:
                available_ids = ", ".join(s.id for s in shells_info.shells)
                raise TerminalServiceError(
                    f"Unsupported or missing shell '{req.shell_id}'. Available shells: {available_ids}.",
                    status_code=400,
                )
        else:
            for item in shells_info.shells:
                if item.is_default:
                    selected_shell = item
                    break
            selected_shell = selected_shell or shells_info.shells[0]

        cwd_str, validated_project_dir = self.resolve_working_directory(
            req.cwd, req.project_dir
        )
        env = self._build_terminal_env(validated_project_dir)

        with self._lock:
            active_count = len(self._sessions)
            if active_count >= self._max_sessions:
                raise TerminalServiceError(
                    f"Maximum simultaneous terminal sessions ({self._max_sessions}) reached. "
                    "Close an existing terminal session before opening another.",
                    status_code=429,
                )
            self._tab_counter += 1
            tab_num = self._tab_counter

        session_id = uuid.uuid4().hex[:16]
        title = req.title or f"{selected_shell.label} #{tab_num}"
        now = utc_now_iso()

        handle = self._spawn_pty_handle(
            selected_shell.executable,
            list(selected_shell.default_args),
            cwd_str,
            env,
            req.cols,
            req.rows,
        )

        summary = TerminalSessionSummary(
            session_id=session_id,
            title=title,
            shell_id=selected_shell.id,
            shell_label=selected_shell.label,
            executable=selected_shell.executable,
            initial_cwd=cwd_str,
            cwd=cwd_str,
            project_dir=validated_project_dir,
            cols=req.cols,
            rows=req.rows,
            pid=handle.pid,
            status="running",
            created_at=now,
            last_activity_at=now,
        )
        record = TerminalSessionRecord(
            summary=summary,
            executable=selected_shell.executable,
            default_args=list(selected_shell.default_args),
            pty_handle=handle,
        )

        with self._lock:
            if len(self._sessions) >= self._max_sessions:
                try:
                    handle.terminate()
                except Exception:
                    pass
                raise TerminalServiceError(
                    f"Maximum simultaneous terminal sessions ({self._max_sessions}) reached.",
                    status_code=429,
                )
            self._sessions[session_id] = record
            self._session_order.append(session_id)

        self._start_reader_thread(record)
        return TerminalSessionStateResponse(
            session=summary.model_copy(deep=True),
            replay="",
        )

    def _get_record(self, raw_session_id: str) -> TerminalSessionRecord:
        try:
            sid = validate_session_id(raw_session_id)
        except ValueError as exc:
            raise TerminalServiceError(str(exc), status_code=400) from exc

        with self._lock:
            record = self._sessions.get(sid)
        if record is None:
            raise TerminalServiceError(
                f"Terminal session '{sid}' not found.", status_code=404
            )
        return record

    def get_session_record(self, raw_session_id: str) -> TerminalSessionRecord:
        return self._get_record(raw_session_id)

    def get_session_state(self, raw_session_id: str) -> TerminalSessionStateResponse:
        record = self._get_record(raw_session_id)
        self._inspect_live_cwd(record)
        with record.lock:
            return TerminalSessionStateResponse(
                session=record.summary.model_copy(deep=True),
                replay=record.get_replay_text(),
            )

    def send_input(self, raw_session_id: str, data: str) -> None:
        if not isinstance(data, str):
            raise TerminalServiceError("Terminal input must be text.", status_code=400)
        if len(data) > MAX_INPUT_CHARS:
            raise TerminalServiceError(
                f"Terminal input chunk exceeds {MAX_INPUT_CHARS} character limit.",
                status_code=400,
            )
        if not data:
            return

        record = self._get_record(raw_session_id)
        with record.lock:
            status = record.summary.status
            handle = record.pty_handle

        if status != "running" or handle is None:
            raise TerminalServiceError(
                "Terminal session is not running.", status_code=409
            )

        try:
            handle.write(data)
            with record.lock:
                record.summary.last_activity_at = utc_now_iso()
        except Exception as exc:
            raise TerminalServiceError(
                f"Failed to write input to PTY: {exc}", status_code=500
            ) from exc

    def resize_session(
        self, raw_session_id: str, req: TerminalResizeRequest
    ) -> TerminalSessionSummary:
        record = self._get_record(raw_session_id)
        with record.lock:
            handle = record.pty_handle
            record.summary.cols = req.cols
            record.summary.rows = req.rows
            status = record.summary.status
            snap = record.summary.model_copy(deep=True)

        if status == "running" and handle is not None:
            try:
                handle.resize(req.cols, req.rows)
            except Exception as exc:
                raise TerminalServiceError(
                    f"Failed to resize PTY: {exc}", status_code=500
                ) from exc

        return snap

    def clear_replay(self, raw_session_id: str) -> TerminalSessionSummary:
        record = self._get_record(raw_session_id)
        with record.lock:
            record.clear_replay()
            snap = record.summary.model_copy(deep=True)
        return snap

    def restart_session(
        self, raw_session_id: str
    ) -> TerminalSessionStateResponse:
        record = self._get_record(raw_session_id)

        with record.lock:
            old_handle = record.pty_handle
            old_thread = record.reader_thread
            record.intentional_stop = True
            record.stop_event.set()
            record.summary.status = "starting"

        if old_handle is not None:
            try:
                old_handle.terminate()
            except Exception:
                pass
        if old_thread is not None and old_thread.is_alive():
            old_thread.join(timeout=2.5)

        with record.lock:
            desired_cwd = record.summary.cwd or record.summary.initial_cwd
            fallback_cwd = record.summary.initial_cwd
            proj_dir = record.summary.project_dir
            cols = record.summary.cols
            rows = record.summary.rows
            exe = record.executable
            args = list(record.default_args)

        if not Path(desired_cwd).is_dir():
            desired_cwd = fallback_cwd
        cwd_str, validated_proj = self.resolve_working_directory(desired_cwd, proj_dir)
        env = self._build_terminal_env(validated_proj)

        new_handle = self._spawn_pty_handle(exe, args, cwd_str, env, cols, rows)
        now = utc_now_iso()

        with record.lock:
            record.stop_event.clear()
            record.intentional_stop = False
            record.pty_handle = new_handle
            record.clear_replay()
            record.seq_counter = 0
            record.summary.cwd = cwd_str
            record.summary.pid = new_handle.pid
            record.summary.status = "running"
            record.summary.exit_code = None
            record.summary.exited_at = None
            record.summary.error_message = None
            record.summary.output_bytes = 0
            record.summary.last_activity_at = now
            snap = record.summary.model_copy(deep=True)

        self._broadcast_event(
            record,
            {"type": "state", "session": snap.model_dump(), "reset": True},
        )
        self._start_reader_thread(record)
        return TerminalSessionStateResponse(session=snap, replay="")

    def close_session(self, raw_session_id: str) -> TerminalCloseResponse:
        try:
            sid = validate_session_id(raw_session_id)
        except ValueError as exc:
            raise TerminalServiceError(str(exc), status_code=400) from exc
        with self._lock:
            record = self._sessions.pop(sid, None)
            if sid in self._session_order:
                self._session_order.remove(sid)
        if record is None:
            raise TerminalServiceError(
                f"Terminal session '{sid}' not found.", status_code=404
            )

        self._terminate_record(record)
        return TerminalCloseResponse(closed=True, session_id=sid)

    def _terminate_record(self, record: TerminalSessionRecord) -> None:
        with record.lock:
            record.intentional_stop = True
            record.stop_event.set()
            record.summary.status = "closed"
            handle = record.pty_handle
            thread = record.reader_thread
            snap = record.summary.model_copy(deep=True)

        self._broadcast_event(
            record,
            {"type": "state", "session": snap.model_dump()},
        )

        if handle is not None:
            try:
                handle.terminate()
            except Exception:
                pass
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.5)

        with record.lock:
            record.pty_handle = None
            record.reader_thread = None

    def shutdown(self) -> None:
        """Terminate every active terminal PTY cleanly on application shutdown."""
        self._shutting_down = True
        with self._lock:
            records = list(self._sessions.values())
            self._sessions.clear()
            self._session_order.clear()

        for rec in records:
            try:
                self._terminate_record(rec)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_terminal_service_instance: Optional[TerminalService] = None
_terminal_service_lock = threading.Lock()


def get_terminal_service() -> TerminalService:
    global _terminal_service_instance
    if _terminal_service_instance is None:
        with _terminal_service_lock:
            if _terminal_service_instance is None:
                _terminal_service_instance = TerminalService()
    return _terminal_service_instance
