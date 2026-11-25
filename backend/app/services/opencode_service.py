"""VEGA Studio Backend – Phase 14 Native OpenCode CLI Service.

Orchestrates the installed `opencode` CLI using its structured loopback HTTP/SSE
v2 API (`opencode serve --hostname 127.0.0.1 --port <port>`), enforcing:
- Loopback-only binding with ephemeral per-process HTTP Basic auth password kept in memory.
- Controlled executable discovery and strict binary-name allowlist validation.
- Explicit per-session project binding (immutable `project_dir`, cross-project rejection).
- Native OpenCode permission rulesets and interactive permission request approval/rejection.
- Bounded per-session message/tool buffers, bounded session limits, and lossless WS critical events.
"""
from __future__ import annotations

import asyncio
import base64
from collections import deque
from dataclasses import dataclass, field
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from typing import Any, Deque, Dict, List, Optional, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid

from app.config import Settings, settings
from app.models.opencode import (
    OpenCodeConfig,
    OpenCodeConfigStateResponse,
    OpenCodeConfigUpdateRequest,
    OpenCodeContextAttachment,
    OpenCodeInfoResponse,
    OpenCodeMessageItem,
    OpenCodeModelOption,
    OpenCodePermissionMode,
    OpenCodePermissionReplyRequest,
    OpenCodePermissionRequestInfo,
    OpenCodeSessionCreateRequest,
    OpenCodeSessionDetailResponse,
    OpenCodeSessionListResponse,
    OpenCodeSessionPromptRequest,
    OpenCodeSessionStatus,
    OpenCodeSessionSummary,
    OpenCodeToolEvent,
    validate_opencode_executable_path,
    validate_opencode_session_id,
)
from app.services.persistence import AppPersistence
from app.services.process_utils import terminate_process_tree, utc_now_iso
from app.services.project_service import ProjectService, ProjectServiceError, validate_directory_input
from app.services.sdk_service import _host_os_name

_OPENCODE_CONFIG_KEY = "opencode_config"
_OPENCODE_SESSIONS_KEY = "opencode_sessions"

MAX_ACTIVE_OPENCODE_SESSIONS = 6
MAX_PERSISTED_OPENCODE_SESSIONS = 40
MAX_MESSAGES_PER_SESSION = 300
MAX_MESSAGE_TEXT_CHARS = 65_536
MAX_TOOL_PREVIEW_CHARS = 4_000
MAX_WS_SUBSCRIBER_QUEUE = 1024

_ALLOWED_EXEC_NAMES = frozenset({"opencode", "opencode.exe", "opencode.cmd", "opencode.bat"})
_VERSION_RE = re.compile(r"(?:opencode\s+)?v?([0-9]+\.[0-9]+\.[0-9]+[^\s]*)", re.IGNORECASE)
_SECRET_SCRUB_PATTERNS = (
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    re.compile(r"\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{16,})\b"),
    re.compile(r"(OPENCODE_SERVER_PASSWORD=)[^\s]+"),
    re.compile(r"(server password\s+)[^\s]+", re.IGNORECASE),
)

_SENSITIVE_ACTION_KEYWORDS = (
    "bash",
    "shell",
    "terminal",
    "exec",
    "command",
    "run",
)
_WRITE_ACTION_KEYWORDS = (
    "edit",
    "write",
    "patch",
    "delete",
    "remove",
    "rm",
    "unlink",
    "chmod",
    "rename",
)
_NETWORK_ACTION_KEYWORDS = ("web", "fetch", "http", "curl", "mcp", "search")
_SENSITIVE_PATH_FRAGMENTS = (".env", "id_rsa", "id_ed25519", ".ssh", ".git/", "credentials", "secrets")


def scrub_opencode_secrets(text: str) -> str:
    if not text:
        return ""
    cleaned = text
    cleaned = _SECRET_SCRUB_PATTERNS[0].sub(r"\1[REDACTED]", cleaned)
    cleaned = _SECRET_SCRUB_PATTERNS[1].sub("[REDACTED_SECRET]", cleaned)
    cleaned = _SECRET_SCRUB_PATTERNS[2].sub(r"\1[REDACTED]", cleaned)
    cleaned = _SECRET_SCRUB_PATTERNS[3].sub(r"\1[REDACTED]", cleaned)
    return cleaned


class OpenCodeServiceError(Exception):
    """Domain error carrying an HTTP status code."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        cleaned = scrub_opencode_secrets(message)
        super().__init__(cleaned)
        self.message = cleaned
        self.status_code = status_code


@dataclass
class _SessionRecord:
    session_id: str
    opencode_session_id: Optional[str]
    title: str
    project_dir: str
    project_name: str
    status: OpenCodeSessionStatus
    permission_mode: OpenCodePermissionMode
    model: Optional[str]
    created_at: str
    updated_at: str
    last_error: Optional[str] = None
    recoverable: bool = True
    messages: Deque[OpenCodeMessageItem] = field(
        default_factory=lambda: deque(maxlen=MAX_MESSAGES_PER_SESSION)
    )
    truncated_messages: bool = False
    pending_permissions: Dict[str, OpenCodePermissionRequestInfo] = field(default_factory=dict)
    prompt_display_map: Dict[str, Tuple[str, List[OpenCodeContextAttachment]]] = field(default_factory=dict)
    prompt_in_flight: bool = False

    def to_summary(self) -> OpenCodeSessionSummary:
        return OpenCodeSessionSummary(
            session_id=self.session_id,
            opencode_session_id=self.opencode_session_id,
            title=self.title,
            project_dir=self.project_dir,
            project_name=self.project_name,
            status=self.status,
            permission_mode=self.permission_mode,
            model=self.model,
            created_at=self.created_at,
            updated_at=self.updated_at,
            last_error=self.last_error,
            pending_permissions_count=sum(
                1 for p in self.pending_permissions.values() if p.status == "pending"
            ),
            message_count=len(self.messages),
            recoverable=self.recoverable,
        )

    def to_persisted_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "opencode_session_id": self.opencode_session_id,
            "title": self.title,
            "project_dir": self.project_dir,
            "project_name": self.project_name,
            "status": self.status if self.status not in ("running", "creating") else "idle",
            "permission_mode": self.permission_mode,
            "model": self.model,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_error": self.last_error,
            "recoverable": self.recoverable,
        }


_Subscriber = Tuple[asyncio.Queue[Dict[str, Any]], asyncio.AbstractEventLoop]


class OpenCodeService:
    """Thread-safe controller for OpenCode CLI discovery, serve process lifecycle, sessions, and WS streaming."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._projects = ProjectService(self._settings)
        self._persistence = self._projects.persistence

        self._lock = threading.RLock()
        self._server_proc: Optional[subprocess.Popen[str]] = None
        self._server_port: Optional[int] = None
        self._server_password: Optional[str] = None
        self._server_exec: Optional[str] = None
        self._sse_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        self._sessions: Dict[str, _SessionRecord] = {}
        self._oc_to_local: Dict[str, str] = {}
        self._subscribers: Dict[str, Set[_Subscriber]] = {}

        self._load_persisted_sessions()

    # ── Persistence Helpers ──────────────────────────────────────────────────────

    def _load_persisted_sessions(self) -> None:
        raw = self._persistence.get_state_json(_OPENCODE_SESSIONS_KEY)
        if not raw:
            return
        payload, _ = raw
        if not isinstance(payload, list):
            return
        with self._lock:
            for item in payload[:MAX_PERSISTED_OPENCODE_SESSIONS]:
                if not isinstance(item, dict):
                    continue
                sid = str(item.get("session_id") or "").strip()
                proj = str(item.get("project_dir") or "").strip()
                if not sid or not proj:
                    continue
                oc_id = item.get("opencode_session_id")
                raw_status = str(item.get("status") or "idle")
                if raw_status in ("running", "creating", "waiting_permission"):
                    raw_status = "interrupted"
                perm_mode = str(item.get("permission_mode") or "ask_all")
                if perm_mode not in ("ask_all", "workspace_assisted", "read_only"):
                    perm_mode = "ask_all"
                rec = _SessionRecord(
                    session_id=sid,
                    opencode_session_id=str(oc_id) if oc_id else None,
                    title=str(item.get("title") or "OpenCode Session")[:120],
                    project_dir=proj,
                    project_name=str(item.get("project_name") or Path(proj).name),
                    status=raw_status,  # type: ignore[arg-type]
                    permission_mode=perm_mode,  # type: ignore[arg-type]
                    model=str(item["model"]) if item.get("model") else None,
                    created_at=str(item.get("created_at") or utc_now_iso()),
                    updated_at=str(item.get("updated_at") or utc_now_iso()),
                    last_error=str(item["last_error"]) if item.get("last_error") else None,
                    recoverable=bool(item.get("recoverable", bool(oc_id))),
                )
                self._sessions[sid] = rec
                if rec.opencode_session_id:
                    self._oc_to_local[rec.opencode_session_id] = sid

    def _persist_sessions(self) -> None:
        with self._lock:
            ordered = sorted(
                self._sessions.values(),
                key=lambda r: r.updated_at,
                reverse=True,
            )[:MAX_PERSISTED_OPENCODE_SESSIONS]
            serialized = [r.to_persisted_dict() for r in ordered]
        self._persistence.set_state_json(_OPENCODE_SESSIONS_KEY, serialized)

    def _load_config(self) -> Tuple[OpenCodeConfig, Optional[str]]:
        stored = self._persistence.get_state_json(_OPENCODE_CONFIG_KEY)
        if not stored:
            return OpenCodeConfig(), None
        data, updated_at = stored
        try:
            return OpenCodeConfig.model_validate(data), updated_at
        except Exception:
            return OpenCodeConfig(), updated_at

    # ── Lifecycle & Safe Subprocess Helpers ──────────────────────────────────────

    @staticmethod
    def _creation_flags() -> int:
        if _host_os_name() == "windows":
            return getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return 0

    def _safe_env(self, *, server_password: Optional[str] = None) -> Dict[str, str]:
        env = os.environ.copy()
        env["NO_COLOR"] = "1"
        env["CLICOLOR"] = "0"
        if server_password is not None:
            env["OPENCODE_SERVER_PASSWORD"] = server_password
        return env

    def shutdown(self) -> None:
        self._stop_server()

    def _stop_server(self) -> None:
        with self._lock:
            self._stop_event.set()
            proc = self._server_proc
            self._server_proc = None
            self._server_port = None
            self._server_password = None
            self._server_exec = None
        if proc is not None and proc.poll() is None:
            terminate_process_tree(proc)

    # ── Executable Discovery & Configuration ─────────────────────────────────────

    def _candidate_executables(self) -> List[str]:
        candidates: List[str] = []
        which_path = shutil.which("opencode")
        if which_path:
            candidates.append(which_path)

        home = Path.home()
        if _host_os_name() == "windows":
            appdata = Path(os.environ.get("APPDATA", ""))
            localappdata = Path(os.environ.get("LOCALAPPDATA", ""))
            raw_candidates = [
                appdata / "npm" / "opencode.cmd",
                appdata / "npm" / "opencode.exe",
                home / ".opencode" / "bin" / "opencode.exe",
                home / ".opencode" / "bin" / "opencode.cmd",
                localappdata / "Programs" / "opencode" / "opencode.exe",
                home / "scoop" / "shims" / "opencode.exe",
            ]
        else:
            raw_candidates = [
                home / ".opencode" / "bin" / "opencode",
                home / ".local" / "bin" / "opencode",
                home / ".npm-global" / "bin" / "opencode",
                Path("/usr/local/bin/opencode"),
                Path("/usr/bin/opencode"),
                Path("/opt/homebrew/bin/opencode"),
            ]

        for p in raw_candidates:
            try:
                if p.is_file():
                    s = str(p)
                    if s not in candidates:
                        candidates.append(s)
            except OSError:
                continue
        return candidates

    def _verify_executable_version(self, exe_path: str) -> Tuple[bool, Optional[str], Optional[str]]:
        p = Path(exe_path)
        if not p.exists() or not p.is_file():
            return False, None, f"Configured OpenCode CLI file does not exist: '{exe_path}'."
        if p.name.lower() not in _ALLOWED_EXEC_NAMES:
            return False, None, "Executable filename must be an OpenCode CLI binary (opencode)."
        if _host_os_name() != "windows" and not os.access(p, os.X_OK):
            return False, None, f"OpenCode CLI binary is not executable: '{exe_path}'."

        try:
            proc = subprocess.run(
                [str(p), "--version"],
                shell=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=6.0,
                stdin=subprocess.DEVNULL,
                env=self._safe_env(),
                creationflags=self._creation_flags(),
            )
        except subprocess.TimeoutExpired:
            return False, None, "Timed out waiting for OpenCode CLI `--version`."
        except OSError as exc:
            return False, None, scrub_opencode_secrets(f"Failed to execute OpenCode CLI: {exc}")

        if proc.returncode != 0:
            err = scrub_opencode_secrets((proc.stderr or proc.stdout or "").strip())
            return False, None, err or f"OpenCode CLI `--version` exited with code {proc.returncode}."

        raw_out = scrub_opencode_secrets((proc.stdout or proc.stderr or "").strip())
        match = _VERSION_RE.search(raw_out)
        version = match.group(1) if match else (raw_out.splitlines()[0] if raw_out else "unknown")
        return True, version, None

    def get_info(self, *, query_models: bool = False) -> OpenCodeInfoResponse:
        config, _ = self._load_config()
        exe_path: Optional[str] = None
        source: str = "missing"
        version: Optional[str] = None
        reason: Optional[str] = None

        if config.executable_path:
            ok, ver, err = self._verify_executable_version(config.executable_path)
            if ok:
                exe_path = str(Path(config.executable_path).resolve(strict=False))
                source = "configured"
                version = ver
            else:
                reason = err
        else:
            candidates = self._candidate_executables()
            if not candidates:
                reason = (
                    "OpenCode CLI was not found on PATH. Install OpenCode or configure its executable path in Settings -> OpenCode Agent."
                )
            else:
                for cand in candidates:
                    ok, ver, err = self._verify_executable_version(cand)
                    if ok:
                        exe_path = str(Path(cand).resolve(strict=False))
                        source = "discovered"
                        version = ver
                        break
                    reason = err

        with self._lock:
            server_alive = self._server_proc is not None and self._server_proc.poll() is None
            server_url = f"http://127.0.0.1:{self._server_port}" if server_alive and self._server_port else None
            server_pid = self._server_proc.pid if server_alive and self._server_proc else None
            active_count = self._count_active_sessions_locked()

        models: List[OpenCodeModelOption] = []
        if query_models and server_alive and exe_path:
            models = self._fetch_server_models()

        return OpenCodeInfoResponse(
            available=exe_path is not None and version is not None,
            version=version,
            executable_path=exe_path,
            configured_executable_path=config.executable_path,
            executable_source=source,  # type: ignore[arg-type]
            unavailable_reason=None if exe_path else reason,
            server_running=server_alive,
            server_url=server_url,
            server_pid=server_pid,
            active_sessions_count=active_count,
            max_active_sessions=MAX_ACTIVE_OPENCODE_SESSIONS,
            available_models=models,
        )

    def get_config_state(self) -> OpenCodeConfigStateResponse:
        config, updated_at = self._load_config()
        return OpenCodeConfigStateResponse(
            config=config,
            info=self.get_info(query_models=False),
            updated_at=updated_at,
        )

    def update_config(self, req: OpenCodeConfigUpdateRequest) -> OpenCodeConfigStateResponse:
        validated_exec: Optional[str] = None
        if req.executable_path:
            cleaned = validate_opencode_executable_path(req.executable_path)
            if cleaned:
                ok, _, err = self._verify_executable_version(cleaned)
                if not ok:
                    raise OpenCodeServiceError(err or "Invalid OpenCode executable path.", status_code=400)
                validated_exec = str(Path(cleaned).resolve(strict=False))

        new_cfg = OpenCodeConfig(
            executable_path=validated_exec,
            default_permission_mode=req.default_permission_mode,
            default_model=req.default_model,
            startup_timeout_seconds=req.startup_timeout_seconds,
        )
        prev_cfg, _ = self._load_config()
        updated_at = self._persistence.set_state_json(_OPENCODE_CONFIG_KEY, new_cfg.model_dump())

        # Restart managed server if configured binary path changed
        if prev_cfg.executable_path != new_cfg.executable_path:
            self._stop_server()

        return OpenCodeConfigStateResponse(
            config=new_cfg,
            info=self.get_info(query_models=False),
            updated_at=updated_at,
        )

    def reset_config(self) -> OpenCodeConfigStateResponse:
        default_cfg = OpenCodeConfig()
        updated_at = self._persistence.set_state_json(_OPENCODE_CONFIG_KEY, default_cfg.model_dump())
        self._stop_server()
        return OpenCodeConfigStateResponse(
            config=default_cfg,
            info=self.get_info(query_models=False),
            updated_at=updated_at,
        )

    # ── Loopback OpenCode v2 HTTP Server Management ──────────────────────────────

    @staticmethod
    def _allocate_loopback_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])

    def _auth_header(self) -> Dict[str, str]:
        with self._lock:
            pw = self._server_password
        if not pw:
            return {}
        token = base64.b64encode(f"opencode:{pw}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {token}"}

    def _http_json(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Dict[str, Any]] = None,
        timeout: float = 10.0,
    ) -> Tuple[int, Any]:
        with self._lock:
            port = self._server_port
            proc = self._server_proc
        if not port or proc is None or proc.poll() is not None:
            raise OpenCodeServiceError("OpenCode runtime server is not running.", status_code=503)

        url = f"http://127.0.0.1:{port}{path}"
        headers = {
            **self._auth_header(),
            "Accept": "application/json",
        }
        raw_bytes: Optional[bytes] = None
        if body is not None:
            raw_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = Request(url, data=raw_bytes, method=method, headers=headers)
        try:
            with urlopen(req, timeout=timeout) as resp:
                raw_resp = resp.read().decode("utf-8", errors="replace").strip()
                parsed = json.loads(raw_resp) if raw_resp else None
                return int(resp.status), parsed
        except HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            msg = scrub_opencode_secrets(err_body or f"OpenCode API HTTP {exc.code}")
            try:
                err_json = json.loads(err_body)
                if isinstance(err_json, dict) and err_json.get("message"):
                    msg = scrub_opencode_secrets(str(err_json["message"]))
            except Exception:
                pass
            raise OpenCodeServiceError(msg, status_code=int(exc.code)) from exc
        except URLError as exc:
            raise OpenCodeServiceError(
                scrub_opencode_secrets(f"Failed to communicate with local OpenCode server: {exc.reason}"),
                status_code=503,
            ) from exc

    def _ensure_server_running(self) -> int:
        info = self.get_info(query_models=False)
        if not info.available or not info.executable_path:
            raise OpenCodeServiceError(
                info.unavailable_reason
                or "OpenCode CLI is not installed. Configure OpenCode in Settings or install from https://opencode.ai/docs.",
                status_code=503,
            )

        with self._lock:
            if (
                self._server_proc is not None
                and self._server_proc.poll() is None
                and self._server_port is not None
                and self._server_exec == info.executable_path
            ):
                return self._server_port

            # Stop stale process if any
            if self._server_proc is not None:
                terminate_process_tree(self._server_proc)
                self._server_proc = None
                self._server_port = None
                self._server_password = None

            cfg, _ = self._load_config()
            port = self._allocate_loopback_port()
            password = secrets.token_urlsafe(24)
            exe = info.executable_path

            self._stop_event.clear()
            try:
                kwargs: Dict[str, Any] = {
                    "shell": False,
                    "stdin": subprocess.DEVNULL,
                    "stdout": subprocess.PIPE,
                    "stderr": subprocess.STDOUT,
                    "text": True,
                    "encoding": "utf-8",
                    "errors": "replace",
                    "env": self._safe_env(server_password=password),
                    "creationflags": self._creation_flags(),
                }
                if _host_os_name() != "windows":
                    kwargs["start_new_session"] = True
                proc = subprocess.Popen(
                    [exe, "serve", "--hostname", "127.0.0.1", "--port", str(port)],
                    **kwargs,
                )
            except OSError as exc:
                raise OpenCodeServiceError(
                    scrub_opencode_secrets(f"Failed to start OpenCode runtime: {exc}"),
                    status_code=500,
                ) from exc

            self._server_proc = proc
            self._server_port = port
            self._server_password = password
            self._server_exec = exe

            # Drain stdout asynchronously so pipe never blocks
            threading.Thread(target=self._drain_server_logs, args=(proc,), daemon=True).start()

        deadline = time.monotonic() + float(cfg.startup_timeout_seconds)
        last_err: str = "Server did not respond."
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                rc = proc.returncode
                self._stop_server()
                raise OpenCodeServiceError(
                    f"OpenCode server exited unexpectedly during startup (code {rc}).",
                    status_code=503,
                )
            try:
                status_code, _ = self._http_json("GET", "/api/info", timeout=1.5)
                if 200 <= status_code < 300:
                    self._start_sse_listener_if_needed()
                    return port
            except OpenCodeServiceError as exc:
                last_err = exc.message
            time.sleep(0.15)

        self._stop_server()
        raise OpenCodeServiceError(
            f"Timed out waiting {cfg.startup_timeout_seconds:.0f}s for OpenCode server startup ({last_err}).",
            status_code=504,
        )

    def _drain_server_logs(self, proc: subprocess.Popen[str]) -> None:
        if proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                _ = scrub_opencode_secrets(line)
        except Exception:
            pass

    def _fetch_server_models(self) -> List[OpenCodeModelOption]:
        try:
            _, payload = self._http_json("GET", "/api/model", timeout=3.0)
        except OpenCodeServiceError:
            return []
        data = payload.get("data", []) if isinstance(payload, dict) else (payload if isinstance(payload, list) else [])
        models: List[OpenCodeModelOption] = []
        seen: Set[str] = set()
        for item in data[:80]:
            if not isinstance(item, dict):
                continue
            mid = str(item.get("modelID") or item.get("id") or "").strip()
            pid = str(item.get("providerID") or "").strip() or None
            full_id = f"{pid}/{mid}" if (pid and mid and "/" not in mid) else mid
            if not full_id or full_id in seen:
                continue
            seen.add(full_id)
            models.append(
                OpenCodeModelOption(
                    id=full_id,
                    name=str(item.get("name") or full_id),
                    provider_id=pid,
                )
            )
        return models

    # ── SSE Event Listener & Sync ────────────────────────────────────────────────

    def _start_sse_listener_if_needed(self) -> None:
        with self._lock:
            if self._sse_thread is not None and self._sse_thread.is_alive():
                return
            t = threading.Thread(target=self._sse_loop, daemon=True)
            self._sse_thread = t
            t.start()

    def _sse_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._lock:
                port = self._server_port
                proc = self._server_proc
            if not port or proc is None or proc.poll() is not None:
                return

            url = f"http://127.0.0.1:{port}/api/event"
            headers = {
                **self._auth_header(),
                "Accept": "text/event-stream",
                "Cache-Control": "no-cache",
            }
            try:
                req = Request(url, headers=headers, method="GET")
                with urlopen(req, timeout=30.0) as resp:
                    data_buf: List[str] = []
                    for raw_line in resp:
                        if self._stop_event.is_set():
                            return
                        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                        if not line:
                            if data_buf:
                                self._handle_raw_sse_payload("\n".join(data_buf))
                                data_buf.clear()
                            continue
                        if line.startswith(":"):
                            continue
                        if line.startswith("data:"):
                            data_buf.append(line[5:].lstrip())
            except Exception:
                if self._stop_event.is_set():
                    return
                time.sleep(0.5)

    def _handle_raw_sse_payload(self, raw_json: str) -> None:
        try:
            evt = json.loads(raw_json)
        except json.JSONDecodeError:
            return
        if not isinstance(evt, dict):
            return

        evt_type = str(evt.get("type") or "")
        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
        oc_sid = str(
            data.get("sessionID")
            or data.get("sessionId")
            or evt.get("sessionID")
            or ""
        ).strip()
        if not oc_sid:
            return

        with self._lock:
            local_sid = self._oc_to_local.get(oc_sid)
        if not local_sid:
            return

        if evt_type.startswith("permission."):
            if "replied" in evt_type or "resolved" in evt_type:
                req_id = str(data.get("requestID") or data.get("id") or "")
                decision = str(data.get("decision") or "reject")
                self._mark_permission_resolved(local_sid, req_id, decision)
            else:
                self._ingest_permission_object(local_sid, oc_sid, data)
            return

        if evt_type == "session.idle":
            outcome = str(data.get("outcome") or "succeeded")
            self._refresh_session_messages_from_server(local_sid)
            with self._lock:
                rec = self._sessions.get(local_sid)
                if rec:
                    rec.prompt_in_flight = False
                    if outcome == "interrupted":
                        rec.status = "interrupted"
                    elif outcome == "failed":
                        rec.status = "error"
                        err_obj = data.get("error")
                        if isinstance(err_obj, dict) and err_obj.get("message"):
                            rec.last_error = scrub_opencode_secrets(str(err_obj["message"]))
                    else:
                        rec.status = "completed"
                    rec.updated_at = utc_now_iso()
            self._persist_sessions()
            self._broadcast_session_state(local_sid, critical=True)
            return

        if evt_type.startswith("session.error") or evt_type == "error":
            err_msg = scrub_opencode_secrets(
                str(data.get("message") or data.get("error") or "OpenCode runtime error")
            )
            with self._lock:
                rec = self._sessions.get(local_sid)
                if rec:
                    rec.prompt_in_flight = False
                    rec.status = "error"
                    rec.last_error = err_msg
                    rec.updated_at = utc_now_iso()
            self._persist_sessions()
            self._broadcast(local_sid, {"type": "error", "session_id": local_sid, "message": err_msg}, critical=True)
            self._broadcast_session_state(local_sid, critical=True)
            return

        if evt_type.startswith("message.") or evt_type.startswith("part."):
            self._refresh_session_messages_from_server(local_sid)

    # ── Permissions & Security Boundaries ────────────────────────────────────────

    @staticmethod
    def _build_permissions_ruleset(
        mode: OpenCodePermissionMode, project_dir: str
    ) -> List[Dict[str, str]]:
        # OpenCode v2 `Permission.Ruleset` evaluates rules cleanly (`allow`, `ask`, `deny`).
        # Never set `"allow"` for wildcard `"*"` or `"bash"` / `"shell"`.
        workspace_posix = project_dir.replace("\\", "/").rstrip("/")
        workspace_glob = f"{workspace_posix}/**"
        if mode == "read_only":
            return [
                {"action": "*", "resource": "*", "effect": "deny"},
                {"action": "read", "resource": workspace_glob, "effect": "allow"},
                {"action": "glob", "resource": workspace_glob, "effect": "allow"},
                {"action": "grep", "resource": workspace_glob, "effect": "allow"},
            ]
        if mode == "workspace_assisted":
            return [
                {"action": "*", "resource": "*", "effect": "ask"},
                {"action": "read", "resource": workspace_glob, "effect": "allow"},
                {"action": "glob", "resource": workspace_glob, "effect": "allow"},
                {"action": "grep", "resource": workspace_glob, "effect": "allow"},
                {"action": "bash", "resource": "*", "effect": "ask"},
                {"action": "edit", "resource": "*", "effect": "ask"},
                {"action": "write", "resource": "*", "effect": "ask"},
            ]
        # Default "ask_all": prompt user before tools, edits, shell, or network calls.
        return [
            {"action": "*", "resource": "*", "effect": "ask"},
        ]

    @staticmethod
    def classify_permission_sensitivity(
        project_dir: str, action: str, resources: List[str]
    ) -> Tuple[bool, List[str]]:
        reasons: List[str] = []
        act = action.lower()
        root_resolved = Path(project_dir).resolve(strict=False)

        if any(k in act for k in _SENSITIVE_ACTION_KEYWORDS):
            reasons.append("Executes terminal/shell command on host")
        if any(k in act for k in _WRITE_ACTION_KEYWORDS):
            reasons.append("Modifies or deletes project files")
        if any(k in act for k in _NETWORK_ACTION_KEYWORDS):
            reasons.append("Performs external network or MCP access")

        for res in resources:
            low = res.lower().replace("\\", "/")
            if any(frag in low for frag in _SENSITIVE_PATH_FRAGMENTS):
                reasons.append(f"Touches potentially sensitive path: {res}")
                continue
            # Detect paths that look filesystem-rooted outside workspace
            if res.startswith("/") or (len(res) >= 3 and res[1] == ":"):
                try:
                    target = Path(res).resolve(strict=False)
                    if not target.is_relative_to(root_resolved):
                        reasons.append(f"Targets path outside active project workspace: {res}")
                except OSError:
                    reasons.append(f"Unverified path target: {res}")

        deduped = list(dict.fromkeys(reasons))
        return len(deduped) > 0, deduped

    def _ingest_permission_object(
        self, local_sid: str, oc_sid: str, item: Dict[str, Any]
    ) -> Optional[OpenCodePermissionRequestInfo]:
        req_id = str(item.get("id") or item.get("requestID") or "").strip()
        if not req_id:
            return None
        action = str(item.get("action") or "tool")
        raw_res = item.get("resources")
        resources = [scrub_opencode_secrets(str(r)) for r in raw_res] if isinstance(raw_res, list) else []
        msg = scrub_opencode_secrets(str(item["message"])) if item.get("message") else None
        meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}

        with self._lock:
            rec = self._sessions.get(local_sid)
            if not rec:
                return None
            existing = rec.pending_permissions.get(req_id)
            if existing is not None:
                return existing
            sensitive, reasons = self.classify_permission_sensitivity(
                rec.project_dir, action, resources
            )
            perm = OpenCodePermissionRequestInfo(
                request_id=req_id,
                session_id=local_sid,
                opencode_session_id=oc_sid,
                action=action,
                resources=resources,
                message=msg,
                metadata=meta,
                is_sensitive=sensitive,
                sensitivity_reasons=reasons,
                created_at=utc_now_iso(),
                status="pending",
            )
            rec.pending_permissions[req_id] = perm
            rec.status = "waiting_permission"
            rec.updated_at = utc_now_iso()

        self._broadcast(
            local_sid,
            {
                "type": "permission_requested",
                "session_id": local_sid,
                "permission": perm.model_dump(),
            },
            critical=True,
        )
        self._broadcast_session_state(local_sid, critical=True)
        return perm

    def _mark_permission_resolved(self, local_sid: str, req_id: str, decision: str) -> None:
        mapped_status = (
            "approved_once"
            if decision == "once"
            else ("approved_always" if decision == "always" else "rejected")
        )
        resolved_obj: Optional[Dict[str, Any]] = None
        with self._lock:
            rec = self._sessions.get(local_sid)
            if not rec:
                return
            perm = rec.pending_permissions.get(req_id)
            if perm:
                perm.status = mapped_status  # type: ignore[assignment]
                resolved_obj = perm.model_dump()
            if all(p.status != "pending" for p in rec.pending_permissions.values()):
                if rec.prompt_in_flight:
                    rec.status = "running"
            rec.updated_at = utc_now_iso()
        if resolved_obj:
            self._broadcast(
                local_sid,
                {
                    "type": "permission_resolved",
                    "session_id": local_sid,
                    "permission": resolved_obj,
                },
                critical=True,
            )
            self._broadcast_session_state(local_sid, critical=True)

    # ── Session Validation & Project Confinement ─────────────────────────────────

    def _resolve_session_project_dir(self, raw_project_dir: Optional[str]) -> Path:
        candidate = raw_project_dir.strip() if raw_project_dir else None
        if not candidate:
            candidate = self._projects.persistence.get_active_project_dir()
        if not candidate:
            raise OpenCodeServiceError(
                "No active project directory is open. Open or create a VEGA project first.",
                status_code=400,
            )
        try:
            resolved = validate_directory_input(candidate, label="Project directory")
        except ProjectServiceError as exc:
            raise OpenCodeServiceError(exc.message, status_code=exc.status_code) from exc

        if not resolved.exists() or not resolved.is_dir():
            raise OpenCodeServiceError(
                f"Project directory does not exist: '{resolved}'.",
                status_code=404,
            )
        return resolved

    def _get_session_locked(
        self, session_id: str, expected_project_dir: Optional[str] = None
    ) -> _SessionRecord:
        try:
            cleaned_id = validate_opencode_session_id(session_id)
        except ValueError as exc:
            raise OpenCodeServiceError(str(exc), status_code=400) from exc

        rec = self._sessions.get(cleaned_id)
        if rec is None:
            raise OpenCodeServiceError(
                f"OpenCode session '{cleaned_id}' was not found.", status_code=404
            )

        if expected_project_dir and expected_project_dir.strip():
            expected_path = str(
                validate_directory_input(expected_project_dir, label="Project directory").resolve(
                    strict=False
                )
            )
            actual_path = str(Path(rec.project_dir).resolve(strict=False))
            if expected_path.lower() != actual_path.lower():
                raise OpenCodeServiceError(
                    f"Session '{cleaned_id}' is bound to '{rec.project_name}' and cannot execute against a different workspace.",
                    status_code=409,
                )
        return rec

    def _count_active_sessions_locked(self) -> int:
        return sum(
            1
            for r in self._sessions.values()
            if r.status not in ("closed", "unavailable")
        )

    # ── Message Synchronization ──────────────────────────────────────────────────

    @staticmethod
    def _truncate_text(text: str, limit: int = MAX_MESSAGE_TEXT_CHARS) -> str:
        scrubbed = scrub_opencode_secrets(text)
        if len(scrubbed) <= limit:
            return scrubbed
        return scrubbed[:limit] + "\n\n[Output truncated by VEGA Studio due to buffer limits]"

    def _parse_server_messages(self, raw_items: Any) -> List[OpenCodeMessageItem]:
        if not isinstance(raw_items, list):
            return []
        parsed: List[OpenCodeMessageItem] = []
        for idx, item in enumerate(raw_items[-MAX_MESSAGES_PER_SESSION:]):
            if not isinstance(item, dict):
                continue
            msg_type = str(item.get("type") or "")
            msg_id = str(item.get("id") or f"ocmsg-{idx}")
            time_obj = item.get("time") if isinstance(item.get("time"), dict) else {}
            created_ms = time_obj.get("created")
            created_iso = (
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(created_ms) / 1000.0))
                if isinstance(created_ms, (int, float))
                else utc_now_iso()
            )
            completed_ms = time_obj.get("completed")
            completed_iso = (
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(completed_ms) / 1000.0))
                if isinstance(completed_ms, (int, float))
                else None
            )

            if msg_type == "user":
                parsed.append(
                    OpenCodeMessageItem(
                        id=msg_id,
                        role="user",
                        text=self._truncate_text(str(item.get("text") or "")),
                        created_at=created_iso,
                        completed_at=completed_iso or created_iso,
                    )
                )
            elif msg_type == "assistant":
                content = item.get("content") if isinstance(item.get("content"), list) else []
                text_parts: List[str] = []
                reasoning_parts: List[str] = []
                tools: List[OpenCodeToolEvent] = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    ptype = str(part.get("type") or "")
                    if ptype == "text":
                        text_parts.append(str(part.get("text") or ""))
                    elif ptype == "reasoning":
                        reasoning_parts.append(str(part.get("text") or ""))
                    elif ptype == "tool":
                        state = part.get("state") if isinstance(part.get("state"), dict) else {}
                        tstatus = str(state.get("status") or "running")
                        if tstatus not in ("streaming", "running", "completed", "error"):
                            tstatus = "running"
                        raw_inp = state.get("input")
                        inp_preview = (
                            json.dumps(raw_inp, indent=2)
                            if isinstance(raw_inp, (dict, list))
                            else str(raw_inp or "")
                        )
                        out_preview = None
                        if isinstance(state.get("content"), list):
                            chunks = []
                            for c in state["content"]:
                                if isinstance(c, dict) and c.get("text"):
                                    chunks.append(str(c["text"]))
                                else:
                                    chunks.append(str(c))
                            out_preview = "\n".join(chunks)
                        err_msg = None
                        if isinstance(state.get("error"), dict):
                            err_msg = str(state["error"].get("message") or "")
                        elif state.get("error"):
                            err_msg = str(state["error"])
                        tools.append(
                            OpenCodeToolEvent(
                                tool_id=str(part.get("id") or f"tool-{len(tools)}"),
                                name=str(part.get("name") or "tool"),
                                status=tstatus,  # type: ignore[arg-type]
                                input_preview=self._truncate_text(inp_preview, MAX_TOOL_PREVIEW_CHARS) if inp_preview else None,
                                output_preview=self._truncate_text(out_preview, MAX_TOOL_PREVIEW_CHARS) if out_preview else None,
                                error_message=scrub_opencode_secrets(err_msg) if err_msg else None,
                                created_at=created_iso,
                                completed_at=completed_iso,
                            )
                        )
                parsed.append(
                    OpenCodeMessageItem(
                        id=msg_id,
                        role="assistant",
                        text=self._truncate_text("\n".join(text_parts)),
                        reasoning=self._truncate_text("\n".join(reasoning_parts), 16_384)
                        if reasoning_parts
                        else None,
                        tools=tools,
                        created_at=created_iso,
                        completed_at=completed_iso,
                        is_streaming=completed_iso is None,
                    )
                )
            elif msg_type == "system":
                parsed.append(
                    OpenCodeMessageItem(
                        id=msg_id,
                        role="system",
                        text=self._truncate_text(str(item.get("text") or "")),
                        created_at=created_iso,
                    )
                )
            elif msg_type == "idle" and str(item.get("outcome") or "") == "failed":
                err_obj = item.get("error") if isinstance(item.get("error"), dict) else {}
                err_txt = str(err_obj.get("message") or "Execution failed.")
                parsed.append(
                    OpenCodeMessageItem(
                        id=msg_id,
                        role="error",
                        text=scrub_opencode_secrets(err_txt),
                        created_at=created_iso,
                    )
                )
        return parsed

    def _refresh_session_messages_from_server(self, local_sid: str) -> None:
        with self._lock:
            rec = self._sessions.get(local_sid)
            oc_sid = rec.opencode_session_id if rec else None
        if not rec or not oc_sid:
            return
        try:
            _, payload = self._http_json(
                "GET",
                f"/api/session/{quote(oc_sid, safe='')}/message?limit=100&order=asc",
                timeout=4.0,
            )
            _, perm_payload = self._http_json(
                "GET",
                f"/api/session/{quote(oc_sid, safe='')}/permission",
                timeout=4.0,
            )
        except OpenCodeServiceError:
            return

        data = payload.get("data") if isinstance(payload, dict) else (payload if isinstance(payload, list) else [])
        parsed_msgs = self._parse_server_messages(data)

        # Preserve attached IDE context badges & clean prompt text on matching user turns
        with self._lock:
            existing_ctx_by_text: Dict[str, Tuple[str, List[OpenCodeContextAttachment]]] = dict(
                rec.prompt_display_map
            )
            for old in rec.messages:
                if old.role == "user" and old.contexts and old.text not in existing_ctx_by_text:
                    existing_ctx_by_text[old.text] = (old.text, old.contexts)
            rec.messages.clear()
            for msg in parsed_msgs:
                if msg.role == "user" and msg.text in existing_ctx_by_text:
                    display_text, ctxs = existing_ctx_by_text[msg.text]
                    msg.text = display_text
                    msg.contexts = ctxs
                rec.messages.append(msg)
            if isinstance(data, list) and len(data) > MAX_MESSAGES_PER_SESSION:
                rec.truncated_messages = True

        perm_list = (
            perm_payload.get("data")
            if isinstance(perm_payload, dict)
            else (perm_payload if isinstance(perm_payload, list) else [])
        )
        if isinstance(perm_list, list):
            for pitem in perm_list:
                if isinstance(pitem, dict):
                    self._ingest_permission_object(local_sid, oc_sid, pitem)

        self._broadcast(
            local_sid,
            {
                "type": "messages_synced",
                "session_id": local_sid,
                "messages": [m.model_dump() for m in parsed_msgs],
            },
            critical=False,
        )

    # ── Session Lifecycle Operations ─────────────────────────────────────────────

    def list_sessions(
        self, project_dir: Optional[str] = None
    ) -> OpenCodeSessionListResponse:
        with self._lock:
            items = list(self._sessions.values())
            if project_dir and project_dir.strip():
                resolved = str(Path(project_dir.strip()).resolve(strict=False)).lower()
                items = [
                    r for r in items if str(Path(r.project_dir).resolve(strict=False)).lower() == resolved
                ]
            items.sort(key=lambda r: r.updated_at, reverse=True)
            return OpenCodeSessionListResponse(
                sessions=[r.to_summary() for r in items],
                active_count=self._count_active_sessions_locked(),
                max_active_sessions=MAX_ACTIVE_OPENCODE_SESSIONS,
            )

    def create_session(self, req: OpenCodeSessionCreateRequest) -> OpenCodeSessionDetailResponse:
        project_path = self._resolve_session_project_dir(req.project_dir)
        cfg, _ = self._load_config()
        perm_mode = req.permission_mode or cfg.default_permission_mode
        model = req.model or cfg.default_model

        with self._lock:
            if self._count_active_sessions_locked() >= MAX_ACTIVE_OPENCODE_SESSIONS:
                raise OpenCodeServiceError(
                    f"Maximum active OpenCode sessions ({MAX_ACTIVE_OPENCODE_SESSIONS}) reached. Close or terminate an old session first.",
                    status_code=409,
                )

        self._ensure_server_running()

        now = utc_now_iso()
        local_sid = f"oc-{uuid.uuid4().hex[:10]}"
        title = req.title or f"{project_path.name} Session"
        oc_body: Dict[str, Any] = {
            "title": title,
            "location": {"directory": str(project_path)},
            "permissions": self._build_permissions_ruleset(perm_mode, str(project_path)),
        }
        if model:
            oc_body["model"] = model

        _, created = self._http_json("POST", "/api/session", body=oc_body, timeout=10.0)
        data = created.get("data") if isinstance(created, dict) and isinstance(created.get("data"), dict) else created
        if not isinstance(data, dict) or not data.get("id"):
            raise OpenCodeServiceError(
                "OpenCode runtime returned an invalid session payload.",
                status_code=502,
            )

        oc_sid = str(data["id"])
        rec = _SessionRecord(
            session_id=local_sid,
            opencode_session_id=oc_sid,
            title=str(data.get("title") or title),
            project_dir=str(project_path),
            project_name=project_path.name,
            status="idle",
            permission_mode=perm_mode,
            model=model,
            created_at=now,
            updated_at=now,
            recoverable=True,
        )

        with self._lock:
            self._sessions[local_sid] = rec
            self._oc_to_local[oc_sid] = local_sid
        self._persist_sessions()

        return OpenCodeSessionDetailResponse(
            session=rec.to_summary(),
            messages=[],
            pending_permissions=[],
        )

    def get_session_detail(
        self,
        session_id: str,
        *,
        expected_project_dir: Optional[str] = None,
        sync_from_server: bool = True,
    ) -> OpenCodeSessionDetailResponse:
        with self._lock:
            rec = self._get_session_locked(session_id, expected_project_dir)
            oc_sid = rec.opencode_session_id
            should_sync = (
                sync_from_server
                and oc_sid is not None
                and rec.status not in ("closed", "unavailable")
            )

        if should_sync and oc_sid:
            info = self.get_info(query_models=False)
            if not info.available:
                with self._lock:
                    rec.status = "unavailable"
                    rec.recoverable = False
                    rec.last_error = info.unavailable_reason or "OpenCode CLI is not installed."
                    rec.updated_at = utc_now_iso()
                self._persist_sessions()
            else:
                try:
                    if not info.server_running:
                        self._ensure_server_running()
                    self._http_json("GET", f"/api/session/{quote(oc_sid, safe='')}", timeout=4.0)
                    self._refresh_session_messages_from_server(rec.session_id)
                except OpenCodeServiceError as exc:
                    if exc.status_code == 404:
                        with self._lock:
                            rec.status = "unavailable"
                            rec.recoverable = False
                            rec.last_error = "OpenCode runtime no longer holds this session state."
                            rec.updated_at = utc_now_iso()
                        self._persist_sessions()
                    else:
                        with self._lock:
                            rec.last_error = exc.message
                            rec.updated_at = utc_now_iso()

        with self._lock:
            rec = self._get_session_locked(session_id)
            return OpenCodeSessionDetailResponse(
                session=rec.to_summary(),
                messages=list(rec.messages),
                pending_permissions=list(rec.pending_permissions.values()),
                truncated_messages=rec.truncated_messages,
            )

    @staticmethod
    def _format_prompt_with_contexts(
        prompt: str, contexts: List[OpenCodeContextAttachment]
    ) -> str:
        if not contexts:
            return prompt
        blocks: List[str] = []
        for ctx in contexts:
            loc = ""
            if ctx.relative_path:
                # Never allow path traversal metadata in context header
                safe_rel = ctx.relative_path.replace("\\", "/").lstrip("/")
                if ".." in PurePosixPath(safe_rel).parts:
                    raise OpenCodeServiceError(
                        "Invalid relative path in attached IDE context.",
                        status_code=400,
                    )
                loc = f" ({safe_rel}"
                if ctx.start_line:
                    loc += f":L{ctx.start_line}"
                    if ctx.end_line and ctx.end_line >= ctx.start_line:
                        loc += f"-L{ctx.end_line}"
                loc += ")"
            header = f"[IDE Context · {ctx.kind}: {ctx.title}{loc}]"
            if ctx.snippet:
                lang = ctx.language or ""
                blocks.append(f"{header}\n```{lang}\n{ctx.snippet}\n```")
            else:
                blocks.append(header)
        return "\n\n".join(blocks) + "\n\n" + prompt

    def send_prompt(
        self, session_id: str, req: OpenCodeSessionPromptRequest
    ) -> OpenCodeSessionDetailResponse:
        with self._lock:
            rec = self._get_session_locked(session_id, req.project_dir)
            if rec.status in ("closed", "unavailable"):
                raise OpenCodeServiceError(
                    f"Session '{session_id}' is {rec.status} and cannot accept prompts.",
                    status_code=409,
                )
            if rec.prompt_in_flight:
                raise OpenCodeServiceError(
                    "Session already has an active agent response in progress. Wait or interrupt it first.",
                    status_code=409,
                )
            oc_sid = rec.opencode_session_id
            if not oc_sid:
                raise OpenCodeServiceError("Session has no OpenCode runtime binding.", status_code=409)

        composed_text = self._format_prompt_with_contexts(req.prompt, req.contexts)
        self._ensure_server_running()

        # Optimistically append user message immediately for crisp UI responsiveness
        now = utc_now_iso()
        local_user_msg = OpenCodeMessageItem(
            id=f"local-user-{uuid.uuid4().hex[:8]}",
            role="user",
            text=req.prompt,
            contexts=req.contexts,
            created_at=now,
            completed_at=now,
        )
        with self._lock:
            if len(rec.prompt_display_map) >= 120:
                oldest_key = next(iter(rec.prompt_display_map))
                rec.prompt_display_map.pop(oldest_key, None)
            rec.prompt_display_map[composed_text] = (req.prompt, req.contexts)
            rec.messages.append(local_user_msg)
            rec.prompt_in_flight = True
            rec.status = "running"
            rec.last_error = None
            rec.updated_at = now
            if req.model:
                rec.model = req.model

        self._persist_sessions()
        self._broadcast(
            session_id,
            {"type": "user_message", "session_id": session_id, "message": local_user_msg.model_dump()},
            critical=False,
        )
        self._broadcast_session_state(session_id, critical=True)

        # Execute prompt dispatch on background thread so fast POST returns cleanly & SSE streams progress
        threading.Thread(
            target=self._dispatch_prompt_worker,
            args=(session_id, oc_sid, composed_text, req.model),
            daemon=True,
        ).start()

        return self.get_session_detail(session_id, sync_from_server=False)

    def _dispatch_prompt_worker(
        self,
        local_sid: str,
        oc_sid: str,
        composed_text: str,
        model: Optional[str],
    ) -> None:
        if model:
            try:
                self._http_json(
                    "POST",
                    f"/api/session/{quote(oc_sid, safe='')}/model",
                    body={"model": model},
                    timeout=5.0,
                )
            except OpenCodeServiceError:
                pass

        try:
            self._http_json(
                "POST",
                f"/api/session/{quote(oc_sid, safe='')}/prompt",
                body={"text": composed_text},
                timeout=30.0,
            )
            # Poll until idle or interrupted / stopped cleanly while SSE also delivers live deltas
            poll_deadline = time.monotonic() + 180.0
            while not self._stop_event.is_set() and time.monotonic() < poll_deadline:
                with self._lock:
                    rec = self._sessions.get(local_sid)
                    if not rec or not rec.prompt_in_flight or rec.status in ("closed", "interrupted", "completed", "error"):
                        break
                self._refresh_session_messages_from_server(local_sid)
                with self._lock:
                    rec = self._sessions.get(local_sid)
                    if not rec or not rec.prompt_in_flight:
                        break
                    # Check if last assistant message completed when SSE idle wasn't fired explicitly
                    if rec.messages and rec.messages[-1].role == "assistant" and rec.messages[-1].completed_at is not None and all(
                        p.status != "pending" for p in rec.pending_permissions.values()
                    ):
                        rec.prompt_in_flight = False
                        rec.status = "completed"
                        rec.updated_at = utc_now_iso()
                        self._broadcast_session_state(local_sid, critical=True)
                        break
                time.sleep(0.35)
        except OpenCodeServiceError as exc:
            with self._lock:
                rec = self._sessions.get(local_sid)
                if rec:
                    rec.prompt_in_flight = False
                    if rec.status != "interrupted":
                        rec.status = "error"
                        rec.last_error = exc.message
                    rec.updated_at = utc_now_iso()
            self._persist_sessions()
            self._broadcast(
                local_sid,
                {"type": "error", "session_id": local_sid, "message": exc.message},
                critical=True,
            )
            self._broadcast_session_state(local_sid, critical=True)

    def interrupt_session(
        self, session_id: str, *, project_dir: Optional[str] = None
    ) -> OpenCodeSessionSummary:
        with self._lock:
            rec = self._get_session_locked(session_id, project_dir)
            oc_sid = rec.opencode_session_id
            rec.prompt_in_flight = False
            rec.status = "interrupted"
            rec.updated_at = utc_now_iso()

        if oc_sid:
            try:
                self._http_json(
                    "POST",
                    f"/api/session/{quote(oc_sid, safe='')}/interrupt",
                    body={},
                    timeout=5.0,
                )
            except OpenCodeServiceError:
                pass

        self._persist_sessions()
        self._broadcast_session_state(session_id, critical=True)
        return rec.to_summary()

    def reply_permission(
        self,
        session_id: str,
        request_id: str,
        req: OpenCodePermissionReplyRequest,
    ) -> OpenCodeSessionDetailResponse:
        with self._lock:
            rec = self._get_session_locked(session_id, req.project_dir)
            oc_sid = rec.opencode_session_id
            perm = rec.pending_permissions.get(request_id)
            if perm is None:
                raise OpenCodeServiceError(
                    f"Permission request '{request_id}' not found in session '{session_id}'.",
                    status_code=404,
                )
            if perm.status != "pending":
                raise OpenCodeServiceError(
                    f"Permission request '{request_id}' has already been resolved ({perm.status}).",
                    status_code=409,
                )

        if oc_sid:
            self._http_json(
                "POST",
                f"/api/session/{quote(oc_sid, safe='')}/permission/{quote(request_id, safe='')}/reply",
                body={"decision": req.decision, "message": req.message},
                timeout=8.0,
            )

        self._mark_permission_resolved(session_id, request_id, req.decision)
        return self.get_session_detail(session_id, sync_from_server=False)

    def terminate_session(
        self, session_id: str, *, project_dir: Optional[str] = None
    ) -> OpenCodeSessionSummary:
        with self._lock:
            rec = self._get_session_locked(session_id, project_dir)
            oc_sid = rec.opencode_session_id
            rec.prompt_in_flight = False
            rec.status = "closed"
            rec.updated_at = utc_now_iso()

        if oc_sid:
            with self._lock:
                server_alive = self._server_proc is not None and self._server_proc.poll() is None
            if server_alive:
                try:
                    self._http_json("DELETE", f"/api/session/{quote(oc_sid, safe='')}", timeout=5.0)
                except OpenCodeServiceError:
                    pass

        self._persist_sessions()
        self._broadcast(
            session_id,
            {"type": "session_closed", "session_id": session_id, "session": rec.to_summary().model_dump()},
            critical=True,
        )
        return rec.to_summary()

    # ── WebSocket Subscriber Registry ────────────────────────────────────────────

    def register_ws_subscriber(
        self, session_id: str, loop: asyncio.AbstractEventLoop
    ) -> Tuple[asyncio.Queue[Dict[str, Any]], Dict[str, Any]]:
        detail = self.get_session_detail(session_id, sync_from_server=False)
        q: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=MAX_WS_SUBSCRIBER_QUEUE)
        with self._lock:
            subs = self._subscribers.setdefault(session_id, set())
            subs.add((q, loop))
        snapshot = {
            "type": "snapshot",
            "session_id": session_id,
            "session": detail.session.model_dump(),
            "messages": [m.model_dump() for m in detail.messages],
            "pending_permissions": [p.model_dump() for p in detail.pending_permissions],
            "truncated_messages": detail.truncated_messages,
        }
        return q, snapshot

    def unregister_ws_subscriber(
        self, session_id: str, sub: _Subscriber
    ) -> None:
        with self._lock:
            subs = self._subscribers.get(session_id)
            if subs:
                subs.discard(sub)
                if not subs:
                    self._subscribers.pop(session_id, None)

    def _broadcast_session_state(self, session_id: str, *, critical: bool) -> None:
        with self._lock:
            rec = self._sessions.get(session_id)
            if not rec:
                return
            summary = rec.to_summary().model_dump()
        self._broadcast(
            session_id,
            {"type": "session_status", "session_id": session_id, "session": summary},
            critical=critical,
        )

    def _broadcast(
        self, session_id: str, payload: Dict[str, Any], *, critical: bool
    ) -> None:
        with self._lock:
            subs = list(self._subscribers.get(session_id, ()))
        if not subs:
            return
        tagged = {**payload, "_critical": critical}
        for q, loop in subs:
            try:
                loop.call_soon_threadsafe(self._enqueue_subscriber, q, tagged, critical)
            except RuntimeError:
                pass

    @staticmethod
    def _enqueue_subscriber(
        q: asyncio.Queue[Dict[str, Any]], payload: Dict[str, Any], critical: bool
    ) -> None:
        if not q.full():
            q.put_nowait(payload)
            return
        if not critical:
            return
        # Critical event (permission / status / error / close): evict one non-critical item if possible
        kept: List[Dict[str, Any]] = []
        dropped_one = False
        while not q.empty():
            item = q.get_nowait()
            if not dropped_one and not item.get("_critical"):
                dropped_one = True
                continue
            kept.append(item)
        if not dropped_one and kept:
            # If all queued are critical, drop oldest to avoid blocking
            kept.pop(0)
        for item in kept:
            if not q.full():
                q.put_nowait(item)
        if not q.full():
            q.put_nowait(payload)


_opencode_service_singleton: Optional[OpenCodeService] = None


def get_opencode_service() -> OpenCodeService:
    global _opencode_service_singleton
    if _opencode_service_singleton is None:
        _opencode_service_singleton = OpenCodeService(settings)
    return _opencode_service_singleton
