"""VEGA Studio Backend – Phase 7 Make-based Firmware Build orchestration service."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Sequence, Set, Tuple

from app.config import Settings, settings
from app.models.build import (
    BuildDiagnostic,
    BuildDiagnosticSeverity,
    BuildHistoryResponse,
    BuildLogLine,
    BuildRequest,
    BuildStateResponse,
    BuildStatus,
    BuildStream,
    BuildSummary,
    validate_build_id,
)
from app.services.board_service import BoardService
from app.services.explorer_service import ExplorerService, ExplorerServiceError
from app.services.process_utils import terminate_process_tree, utc_now_iso as _utc_now
from app.services.project_service import ProjectService, ProjectServiceError
from app.services.sdk_service import (
    SdkService,
    _build_safe_subprocess_env,
    _host_os_name,
    _resolve_existing_path,
)

MAX_LOG_LINES = 5000
MAX_DIAGNOSTICS = 250
MAX_BUILD_HISTORY = 25

# Common GCC / Clang diagnostic format: path:line(:col)?: (fatal error|error|warning): msg
_GCC_DIAG_RE = re.compile(
    r"^(?P<file>(?:[A-Za-z]:)?[^:\r\n]+?):(?P<line>\d+)(?::(?P<col>\d+))?:\s*(?P<sev>fatal error|error|warning):\s*(?P<msg>.+)$"
)
_GENERIC_ERROR_PREFIX_RE = re.compile(
    r"^(?:(?P<tool>make(?:\[\d+\])?|ld|collect2|arm-.*|riscv32-.*):\s*)?\*\*\*\s+(?P<msg>.+)$"
)
_FALLBACK_SEVERITY_RE = re.compile(
    r"^(?:fatal error|error|warning):\s+(?P<msg>.+)$", re.IGNORECASE
)


class BuildServiceError(Exception):
    """Domain error with HTTP status code for firmware build operations."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _resolve_diagnostic_rel_path(project_root: Path, raw_file: str) -> Optional[str]:
    """Resolve raw compiler file token cleanly if it sits inside the active project root."""
    cleaned = raw_file.strip().strip('"').strip("'")
    if not cleaned or "\x00" in cleaned:
        return None
    try:
        candidate = Path(cleaned)
        if not candidate.is_absolute():
            candidate = project_root / candidate
        resolved = candidate.resolve(strict=False)
        if resolved.is_relative_to(project_root):
            rel = resolved.relative_to(project_root).as_posix()
            if rel and rel != "." and ".vega-studio" not in rel.split("/"):
                return rel
    except OSError:
        return None
    return None


def parse_build_diagnostic(
    line_text: str, project_root: Path, diag_index: int
) -> Optional[BuildDiagnostic]:
    """Identify compiler or Make diagnostics without guessing unverified details."""
    stripped = line_text.strip()
    if not stripped:
        return None

    m = _GCC_DIAG_RE.match(stripped)
    if m:
        sev_raw = m.group("sev").lower()
        severity: BuildDiagnosticSeverity = "warning" if sev_raw == "warning" else "error"
        raw_file = m.group("file").strip()
        line_num = int(m.group("line"))
        col_num = int(m.group("col")) if m.group("col") else None
        msg = m.group("msg").strip()
        return BuildDiagnostic(
            id=f"diag-{diag_index}",
            severity=severity,
            message=msg,
            file_path=raw_file,
            relative_path=_resolve_diagnostic_rel_path(project_root, raw_file),
            line=line_num,
            column=col_num,
            raw_line=stripped,
        )

    m_make = _GENERIC_ERROR_PREFIX_RE.match(stripped)
    if m_make:
        return BuildDiagnostic(
            id=f"diag-{diag_index}",
            severity="error",
            message=m_make.group("msg").strip(),
            raw_line=stripped,
        )

    m_fb = _FALLBACK_SEVERITY_RE.match(stripped)
    if m_fb:
        sev: BuildDiagnosticSeverity = (
            "warning" if stripped.lower().startswith("warning:") else "error"
        )
        return BuildDiagnostic(
            id=f"diag-{diag_index}",
            severity=sev,
            message=m_fb.group("msg").strip(),
            raw_line=stripped,
        )

    return None


@dataclass
class BuildRunRecord:
    """Runtime tracking record for an active or completed build."""

    summary: BuildSummary
    logs: Deque[BuildLogLine] = field(
        default_factory=lambda: deque(maxlen=MAX_LOG_LINES)
    )
    diagnostics: List[BuildDiagnostic] = field(default_factory=list)
    subscribers: Set[Tuple[asyncio.Queue[Dict[str, Any]], asyncio.AbstractEventLoop]] = field(
        default_factory=set
    )
    cancel_event: threading.Event = field(default_factory=threading.Event)
    active_proc: Optional[subprocess.Popen[str]] = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    seq_counter: int = 0
    diag_counter: int = 0
    worker_thread: Optional[threading.Thread] = None

    def snapshot(self) -> Tuple[BuildSummary, List[BuildLogLine], List[BuildDiagnostic]]:
        with self.lock:
            return (
                self.summary.model_copy(deep=True),
                list(self.logs),
                list(self.diagnostics),
            )


class BuildService:
    """Coordinates Make-based firmware builds using Phase 6 SDK config & active project."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._explorer = ExplorerService(self._settings)
        self._projects = ProjectService(self._settings)
        self._sdk = SdkService(self._settings)
        self._boards = BoardService(self._settings)

        self._state_lock = threading.Lock()
        self._active_build_id: Optional[str] = None
        self._latest_build_id: Optional[str] = None
        self._runs: Dict[str, BuildRunRecord] = {}
        self._history: Deque[str] = deque(maxlen=MAX_BUILD_HISTORY)

    # ------------------------------------------------------------------ #
    # Pre-flight validation & environment construction
    # ------------------------------------------------------------------ #

    def _prepare_build_context(
        self, req: BuildRequest
    ) -> Tuple[Path, str, Path, List[List[str]], List[str], Dict[str, str], str]:
        """Validate workspace, Makefile, SDK prerequisites, command array, and build env."""
        try:
            project_root = self._explorer._resolve_project_root(req.project_dir)
            meta, _, _, _ = self._projects._inspect_project_directory(project_root)
        except ExplorerServiceError as exc:
            raise BuildServiceError(exc.message, exc.status_code) from exc
        except ProjectServiceError as exc:
            raise BuildServiceError(exc.message, exc.status_code) from exc

        selected_board_id = (meta.target.board if meta and meta.target else None) or ""
        if not selected_board_id.strip():
            raise BuildServiceError(
                "No hardware board is selected for this project. Open Board Manager to select a target board before running builds.",
                400,
            )
        board = self._boards.find_board(selected_board_id)
        if board is None:
            raise BuildServiceError(
                f"Unsupported or unrecognized target board '{selected_board_id}' in vega-project.json. Open Board Manager to select a supported board.",
                400,
            )

        rel_makefile = (meta.build.makefile if meta else "Makefile") or "Makefile"
        try:
            norm_makefile, makefile_path = self._explorer._resolve_inside_root(
                project_root, rel_makefile, must_exist=True
            )
        except ExplorerServiceError as exc:
            if exc.status_code == 404:
                raise BuildServiceError(
                    f"Missing project Makefile at '{rel_makefile}'. Create or restore the project Makefile before running {req.operation}.",
                    404,
                ) from exc
            raise BuildServiceError(exc.message, exc.status_code) from exc

        if not makefile_path.is_file():
            raise BuildServiceError(
                f"Configured Makefile '{norm_makefile}' is not a regular file.",
                400,
            )

        base_config = self._sdk.get_config_state().config
        discovery = self._sdk.discover_environment(
            config_hint=base_config, apply_to_config=False
        )
        eff = discovery.suggested_config

        make_exe = _resolve_existing_path(eff.make_path)
        if not make_exe or not make_exe.is_file():
            raise BuildServiceError(
                "Make executable not found. Configure Make or run SDK Doctor before building.",
                400,
            )

        sdk_root = _resolve_existing_path(eff.sdk_root)
        compiler_exe = _resolve_existing_path(eff.compiler_path)
        if req.operation in ("build", "rebuild"):
            if not sdk_root or not sdk_root.is_dir():
                raise BuildServiceError(
                    "VEGA SDK directory is missing or unconfigured. Open SDK Doctor to configure VEGA SDK paths before building firmware.",
                    400,
                )
            if not compiler_exe or not compiler_exe.is_file():
                prefix = board.build.cross_compile_prefix or eff.cross_compile_prefix or "riscv32-vega-elf"
                raise BuildServiceError(
                    f"Cross-compiler '{prefix}-gcc' could not be located. Open SDK Doctor to inspect toolchain setup before building.",
                    400,
                )
            compat = self._boards.validate_compatibility(board, eff)
            if compat.issues:
                raise BuildServiceError(
                    f"Board compatibility check failed for {board.name}: {'; '.join(compat.issues)}",
                    400,
                )

        # Build explicit argument arrays (zero shell string concatenation)
        commands: List[List[str]] = []
        if req.operation in ("clean", "rebuild"):
            commands.append([str(make_exe), "-f", norm_makefile, req.clean_target])
        if req.operation in ("build", "rebuild"):
            build_cmd = [str(make_exe), "-f", norm_makefile]
            if req.target:
                build_cmd.append(req.target)
            commands.append(build_cmd)

        preview = (
            [" ".join(c) for c in commands]
            if len(commands) > 1
            else list(commands[0])
        )

        # Controlled build environment derived from verified board profile & SDK config
        env = _build_safe_subprocess_env(eff)
        prefix = board.build.cross_compile_prefix or eff.cross_compile_prefix or "riscv32-vega-elf"
        env["CROSS_COMPILE"] = prefix if prefix.endswith("-") else f"{prefix}-"
        env["VEGA_PREFIX"] = prefix
        env["RISCV_ARCH"] = board.isa
        env["VEGA_MACHINE"] = board.machine
        env["VEGA_BOARD"] = board.id
        if sdk_root and sdk_root.is_dir():
            env["VEGA_SDK"] = str(sdk_root)
            env["VEGA_SDK_HOME"] = str(sdk_root)
        tc_root = _resolve_existing_path(eff.toolchain_root)
        if tc_root and tc_root.is_dir():
            env["VEGA_TOOLS"] = str(tc_root)
        py_exe = _resolve_existing_path(eff.python_path)
        if py_exe and py_exe.is_file():
            env["PYTHON"] = str(py_exe)
        if req.mode != "default":
            env["BUILD_MODE"] = req.mode
        for k, v in req.env_overrides.items():
            env[k] = v

        project_name = meta.name if meta else project_root.name
        return (
            project_root,
            norm_makefile,
            make_exe,
            commands,
            preview,
            env,
            project_name,
        )

    # ------------------------------------------------------------------ #
    # Streaming & execution loop
    # ------------------------------------------------------------------ #

    def _emit_event(self, record: BuildRunRecord, payload: Dict[str, Any]) -> None:
        with record.lock:
            subs = list(record.subscribers)
        is_critical = payload.get("type") in ("completed", "cleared", "snapshot")

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
        record: BuildRunRecord,
        project_root: Path,
        stream: BuildStream,
        raw_text: str,
    ) -> None:
        text = raw_text.rstrip("\r\n")
        created_diag: Optional[BuildDiagnostic] = None

        with record.lock:
            record.seq_counter += 1
            was_full = len(record.logs) >= MAX_LOG_LINES
            line = BuildLogLine(
                seq=record.seq_counter,
                timestamp=_utc_now(),
                stream=stream,
                text=text,
            )
            record.logs.append(line)
            record.summary.log_line_count = record.seq_counter
            if was_full:
                record.summary.truncated_logs = True

            if stream != "system":
                parsed = parse_build_diagnostic(
                    text, project_root, record.diag_counter + 1
                )
                if parsed:
                    if parsed.severity == "error":
                        record.summary.error_count += 1
                    else:
                        record.summary.warning_count += 1
                    if len(record.diagnostics) < MAX_DIAGNOSTICS:
                        record.diag_counter += 1
                        parsed.id = f"diag-{record.diag_counter}"
                        record.diagnostics.append(parsed)
                        created_diag = parsed

        self._emit_event(record, {"type": "log", "line": line.model_dump()})
        if created_diag is not None:
            self._emit_event(
                record,
                {"type": "diagnostic", "diagnostic": created_diag.model_dump()},
            )

    def _execute_build_worker(
        self,
        record: BuildRunRecord,
        project_root: Path,
        commands: List[List[str]],
        env: Dict[str, str],
        timeout_seconds: int,
    ) -> None:
        start_monotonic = time.monotonic()
        final_status: BuildStatus = "succeeded"
        final_exit: Optional[int] = 0
        final_error: Optional[str] = None

        try:
            self._append_log(
                record,
                project_root,
                "system",
                f"[{record.summary.operation.upper()}] Working directory: {project_root}",
            )

            for step_idx, cmd in enumerate(commands):
                if record.cancel_event.is_set():
                    final_status = "cancelled"
                    final_exit = None
                    final_error = "Build cancelled before step started."
                    break

                self._append_log(
                    record,
                    project_root,
                    "system",
                    f"$ {' '.join(cmd)}",
                )

                popen_kwargs: Dict[str, Any] = {}
                if _host_os_name() == "windows":
                    popen_kwargs["creationflags"] = getattr(
                        subprocess, "CREATE_NEW_PROCESS_GROUP", 0
                    )
                else:
                    popen_kwargs["start_new_session"] = True

                try:
                    proc = subprocess.Popen(
                        cmd,
                        shell=False,
                        cwd=str(project_root),
                        env=env,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        bufsize=1,
                        **popen_kwargs,
                    )
                except OSError as exc:
                    final_status = "failed"
                    final_exit = 1
                    final_error = f"Failed to start Make process: {exc}"
                    self._append_log(record, project_root, "stderr", final_error)
                    break

                with record.lock:
                    record.active_proc = proc

                def _pump_pipe(pipe: Any, stream_name: BuildStream) -> None:
                    if pipe is None:
                        return
                    try:
                        for line in iter(pipe.readline, ""):
                            self._append_log(record, project_root, stream_name, line)
                    except (OSError, ValueError):
                        pass
                    finally:
                        try:
                            pipe.close()
                        except OSError:
                            pass

                t_out = threading.Thread(
                    target=_pump_pipe, args=(proc.stdout, "stdout"), daemon=True
                )
                t_err = threading.Thread(
                    target=_pump_pipe, args=(proc.stderr, "stderr"), daemon=True
                )
                t_out.start()
                t_err.start()

                while proc.poll() is None:
                    if record.cancel_event.is_set():
                        final_status = "cancelled"
                        final_error = "Cancelled by user."
                        terminate_process_tree(proc)
                        break
                    elapsed = time.monotonic() - start_monotonic
                    if elapsed >= timeout_seconds:
                        final_status = "timed_out"
                        final_error = f"Build exceeded timeout of {timeout_seconds}s."
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
                if final_status in ("cancelled", "timed_out"):
                    final_exit = rc
                    if final_status == "timed_out":
                        self._append_log(
                            record,
                            project_root,
                            "system",
                            f"[TIMEOUT] {final_error}",
                        )
                    else:
                        self._append_log(
                            record,
                            project_root,
                            "system",
                            "[CANCELLED] Build process terminated.",
                        )
                    break

                final_exit = rc
                if rc != 0:
                    final_status = "failed"
                    final_error = f"Step exited with code {rc}."
                    if len(commands) > 1 and step_idx == 0:
                        self._append_log(
                            record,
                            project_root,
                            "system",
                            f"[CLEAN FAILED] Rebuild halted after clean exited with code {rc}.",
                        )
                    break
        except Exception as exc:  # pragma: no cover - defensive fallback
            final_status = "failed"
            final_exit = -1
            final_error = f"Unexpected build runner error: {exc}"
            self._append_log(record, project_root, "stderr", final_error)
        finally:
            duration_ms = int((time.monotonic() - start_monotonic) * 1000)
            finished_at = _utc_now()
            with record.lock:
                record.summary.status = final_status
                record.summary.finished_at = finished_at
                record.summary.duration_ms = duration_ms
                record.summary.exit_code = final_exit
                record.summary.cancelled = final_status == "cancelled"
                record.summary.timed_out = final_status == "timed_out"
                record.summary.error_message = final_error
                snap_summary = record.summary.model_copy(deep=True)

            self._append_log(
                record,
                project_root,
                "system",
                f"[{final_status.upper()}] Exit {final_exit if final_exit is not None else '—'} in {(duration_ms / 1000):.2f}s ({snap_summary.error_count} error(s), {snap_summary.warning_count} warning(s))",
            )

            with self._state_lock:
                if self._active_build_id == snap_summary.build_id:
                    self._active_build_id = None

            self._emit_event(
                record,
                {"type": "completed", "build": snap_summary.model_dump()},
            )

    # ------------------------------------------------------------------ #
    # Public operations
    # ------------------------------------------------------------------ #

    def start_build(self, req: BuildRequest) -> BuildSummary:
        """Validate workspace + SDK, reserve active build slot, and start Make asynchronously."""
        with self._state_lock:
            if self._active_build_id is not None:
                active = self._runs.get(self._active_build_id)
                if active and active.summary.status == "running":
                    raise BuildServiceError(
                        f"A build ({active.summary.operation} for '{active.summary.project_name}') is already running. Cancel or wait for it to finish first.",
                        409,
                    )

        (
            project_root,
            norm_makefile,
            _make_exe,
            commands,
            preview,
            env,
            project_name,
        ) = self._prepare_build_context(req)

        build_id = uuid.uuid4().hex[:16]
        summary = BuildSummary(
            build_id=build_id,
            project_dir=str(project_root),
            project_name=project_name,
            operation=req.operation,
            target=req.target if req.operation != "clean" else req.clean_target,
            mode=req.mode,
            makefile_path=norm_makefile,
            command_preview=preview,
            status="running",
            started_at=_utc_now(),
        )
        record = BuildRunRecord(summary=summary)

        with self._state_lock:
            if self._active_build_id is not None:
                active = self._runs.get(self._active_build_id)
                if active and active.summary.status == "running":
                    raise BuildServiceError(
                        "Another build was started concurrently.", 409
                    )
            self._runs[build_id] = record
            self._active_build_id = build_id
            self._latest_build_id = build_id
            self._history.appendleft(build_id)
            # Prune old run objects not in history nor active
            keep_ids = set(self._history)
            keep_ids.add(build_id)
            for stale_id in list(self._runs.keys()):
                if stale_id not in keep_ids:
                    del self._runs[stale_id]

            worker = threading.Thread(
                target=self._execute_build_worker,
                args=(record, project_root, commands, env, req.timeout_seconds),
                daemon=True,
                name=f"vega-build-{build_id}",
            )
            record.worker_thread = worker
            worker.start()

        return summary.model_copy(deep=True)

    def _validated_id(self, raw_id: str) -> str:
        try:
            return validate_build_id(raw_id)
        except ValueError as exc:
            raise BuildServiceError(str(exc), 400) from exc

    def cancel_build(self, build_id: Optional[str] = None) -> BuildSummary:
        """Cancel the specified or currently running build cleanly."""
        with self._state_lock:
            target_id = (
                self._validated_id(build_id)
                if build_id
                else self._active_build_id
            )
            if not target_id or target_id not in self._runs:
                raise BuildServiceError("No active build to cancel.", 404)
            record = self._runs[target_id]

        with record.lock:
            if record.summary.status != "running":
                return record.summary.model_copy(deep=True)
            record.cancel_event.set()
            proc = record.active_proc

        if proc is not None:
            terminate_process_tree(proc)

        return record.snapshot()[0]

    def get_build_state(self, build_id: Optional[str] = None) -> BuildStateResponse:
        """Retrieve current active/latest build state, logs, and diagnostics."""
        with self._state_lock:
            active_rec = (
                self._runs.get(self._active_build_id)
                if self._active_build_id
                else None
            )
            target_id = (
                self._validated_id(build_id)
                if build_id
                else self._latest_build_id
            )
            if build_id and target_id not in self._runs:
                raise BuildServiceError(f"Build '{target_id}' was not found.", 404)
            target_rec = self._runs.get(target_id) if target_id else None

        active_sum = active_rec.snapshot()[0] if active_rec else None
        if target_rec is None:
            return BuildStateResponse(active_build=active_sum)

        latest_sum, logs, diagnostics = target_rec.snapshot()
        return BuildStateResponse(
            active_build=active_sum,
            latest_build=latest_sum,
            logs=logs,
            diagnostics=diagnostics,
        )

    def get_build_record(self, build_id: str) -> BuildRunRecord:
        clean_id = self._validated_id(build_id)
        with self._state_lock:
            record = self._runs.get(clean_id)
        if record is None:
            raise BuildServiceError(f"Build '{clean_id}' was not found.", 404)
        return record

    def clear_output(self) -> BuildStateResponse:
        """Clear logs and parsed diagnostics of the latest completed build."""
        with self._state_lock:
            target_id = self._latest_build_id
            record = self._runs.get(target_id) if target_id else None
        if record is not None:
            with record.lock:
                if record.summary.status == "running":
                    raise BuildServiceError(
                        "Cannot clear build output while a build is still running.",
                        409,
                    )
                record.logs.clear()
                record.diagnostics.clear()
                record.seq_counter = 0
                record.diag_counter = 0
                record.summary.error_count = 0
                record.summary.warning_count = 0
                record.summary.log_line_count = 0
                record.summary.truncated_logs = False
            self._emit_event(record, {"type": "cleared", "build_id": record.summary.build_id})
        return self.get_build_state()

    def list_history(self) -> BuildHistoryResponse:
        """Return bounded session build history newest-first."""
        with self._state_lock:
            records = [self._runs[bid] for bid in self._history if bid in self._runs]
        summaries = [rec.snapshot()[0] for rec in records]
        return BuildHistoryResponse(history=summaries)

    def clear_history(self) -> BuildHistoryResponse:
        """Clear completed session build entries while preserving any active running build."""
        with self._state_lock:
            active_id = self._active_build_id
            if active_id and active_id in self._runs:
                self._history.clear()
                self._history.appendleft(active_id)
                for bid in list(self._runs.keys()):
                    if bid != active_id:
                        del self._runs[bid]
                self._latest_build_id = active_id
            else:
                self._history.clear()
                self._runs.clear()
                self._latest_build_id = None
        return self.list_history()

    def shutdown(self) -> None:
        """Terminate any active build cleanly when backend shuts down."""
        with self._state_lock:
            active_rec = (
                self._runs.get(self._active_build_id)
                if self._active_build_id
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


_build_service_singleton = BuildService(settings)


def get_build_service() -> BuildService:
    """FastAPI dependency returning the shared process-level BuildService."""
    return _build_service_singleton
