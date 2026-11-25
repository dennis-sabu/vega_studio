"""Tests for Phase 14 Native OpenCode CLI Integration.

Runs entirely inside isolated `tmp_path` environments with a controlled mock
`opencode` CLI + HTTP/SSE v2 server wrapper — requiring zero live LLM keys or
network access while verifying real process control, SSE/WS streaming,
permissions, workspace isolation, bounds, and FastAPI endpoints.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Optional
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.config import Settings
from app.main import app
from app.models.opencode import (
    OpenCodeConfigUpdateRequest,
    OpenCodeContextAttachment,
    OpenCodePermissionReplyRequest,
    OpenCodeSessionCreateRequest,
    OpenCodeSessionPromptRequest,
    validate_opencode_executable_path,
    validate_opencode_session_id,
)
from app.routers.opencode import get_opencode_service
from app.services.opencode_service import (
    MAX_ACTIVE_OPENCODE_SESSIONS,
    MAX_MESSAGE_TEXT_CHARS,
    MAX_WS_SUBSCRIBER_QUEUE,
    OpenCodeService,
    OpenCodeServiceError,
    scrub_opencode_secrets,
)
from app.services.project_service import ProjectService


_MOCK_OPENCODE_PY = r'''
import base64, json, os, queue, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

args = sys.argv[1:]
if "--version" in args or "-v" in args:
    print("opencode v2.0.32")
    sys.exit(0)

if not args or args[0] != "serve":
    sys.exit(1)

host = "127.0.0.1"
port = 14096
for i, a in enumerate(args):
    if a == "--hostname" and i + 1 < len(args):
        host = args[i + 1]
    elif a == "--port" and i + 1 < len(args):
        port = int(args[i + 1])

password = os.environ.get("OPENCODE_SERVER_PASSWORD", "")
expected_auth = (
    "Basic " + base64.b64encode(f"opencode:{password}".encode("utf-8")).decode("ascii")
    if password else None
)
state_file = os.environ.get("MOCK_OPENCODE_STATE_FILE")
crash_startup = os.environ.get("MOCK_OPENCODE_CRASH") == "1"
hang_startup = os.environ.get("MOCK_OPENCODE_HANG") == "1"
if crash_startup:
    print("fatal startup simulated", file=sys.stderr)
    sys.exit(2)
if hang_startup:
    time.sleep(30)
    sys.exit(0)

lock = threading.RLock()
sessions = {}
sse_clients = []

def _load_state():
    if state_file and os.path.isfile(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                sessions.update(data)
        except Exception:
            pass

def _save_state():
    if state_file:
        with lock:
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump(sessions, f)

_load_state()

def emit_sse(evt_type, session_id, data_obj):
    payload = json.dumps({
        "id": f"evt_{int(time.time()*1000)}",
        "type": evt_type,
        "data": {"sessionID": session_id, **data_obj},
    })
    with lock:
        for q in list(sse_clients):
            q.put(payload)

def _run_prompt(sid, text):
    now = int(time.time() * 1000)
    with lock:
        s = sessions.get(sid)
        if not s:
            return
        s["interrupted"] = False
        s["messages"].append({"id": f"u_{now}", "type": "user", "time": {"created": now}, "text": text})
        _save_state()

    if "[TRIGGER_ERROR]" in text:
        emit_sse("session.idle", sid, {"outcome": "failed", "error": {"type": "ModelError", "message": "Simulated API failure sk-secret1234567890"}})
        return

    if "[NEED_PERMISSION]" in text:
        req_id = f"perm_{int(time.time()*1000)}"
        perm_obj = {
            "id": req_id,
            "sessionID": sid,
            "action": "bash",
            "resources": ["make clean && make", "/etc/passwd"],
            "message": "Run build clean command",
            "metadata": {"cwd": s["location"]["directory"]},
        }
        with lock:
            s["permissions"][req_id] = perm_obj
            ev = threading.Event()
            s.setdefault("_perm_waiters", {})[req_id] = ev
        emit_sse("permission.asked", sid, perm_obj)
        ev.wait(timeout=15)
        with lock:
            decision = s.get("_perm_decisions", {}).get(req_id, "reject")
            s["permissions"].pop(req_id, None)
        if decision == "reject":
            with lock:
                s["messages"].append({
                    "id": f"a_{int(time.time()*1000)}",
                    "type": "assistant",
                    "time": {"created": now, "completed": int(time.time() * 1000)},
                    "content": [{"type": "text", "text": "Command skipped because permission was rejected."}],
                })
                _save_state()
            emit_sse("session.idle", sid, {"outcome": "succeeded"})
            return

    if "[SLOW_STREAM]" in text:
        for step in range(40):
            with lock:
                if sessions.get(sid, {}).get("interrupted"):
                    emit_sse("session.idle", sid, {"outcome": "interrupted"})
                    return
            time.sleep(0.1)

    now2 = int(time.time() * 1000)
    reply_text = (
        "X" * (MAX_OUT := 70000)
        if "[OVERSIZE]" in text
        else f"Analyzed firmware project in {s['location']['directory']}."
    )
    with lock:
        s["messages"].append({
            "id": f"a_{now2}",
            "type": "assistant",
            "time": {"created": now, "completed": now2},
            "content": [
                {"type": "reasoning", "text": "Inspecting workspace configuration cleanly."},
                {
                    "type": "tool",
                    "id": f"tool_{now2}",
                    "name": "read",
                    "state": {
                        "status": "completed",
                        "input": {"path": "src/main.c"},
                        "content": [{"text": "int main(void) { return 0; }"}],
                    },
                    "time": {"created": now, "completed": now2},
                },
                {"type": "text", "text": reply_text},
            ],
        })
        _save_state()
    emit_sse("message.updated", sid, {"id": f"a_{now2}"})
    emit_sse("session.idle", sid, {"outcome": "succeeded"})

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        return

    def _check_auth(self):
        if expected_auth and self.headers.get("Authorization") != expected_auth:
            self._send_json(401, {"_tag": "UnauthorizedError", "message": "Authentication required"})
            return False
        return True

    def _send_json(self, code, obj):
        raw = json.dumps(obj).encode("utf-8") if obj is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        p = parsed.path

        if p == "/api/info":
            self._send_json(200, {"version": "2.0.32", "pid": os.getpid(), "urls": [f"http://{host}:{port}"], "paths": {"tmp": "."}})
            return
        if p == "/api/model":
            self._send_json(200, {"data": [{"id": "claude-sonnet", "modelID": "claude-sonnet", "providerID": "anthropic", "name": "Claude Sonnet"}]})
            return
        if p == "/api/event":
            q = queue.Queue()
            with lock:
                sse_clients.append(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(b'data: {"id":"evt0","type":"server.connected","data":{}}\n\n')
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=5.0)
                        self.wfile.write(f"data: {msg}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
            except Exception:
                pass
            finally:
                with lock:
                    if q in sse_clients:
                        sse_clients.remove(q)
            return
        if p.startswith("/api/session/"):
            parts = [x for x in p.split("/") if x]
            # api, session, sid, [message|permission]
            sid = parts[2]
            with lock:
                s = sessions.get(sid)
            if not s:
                self._send_json(404, {"_tag": "SessionNotFoundError", "message": "Session not found"})
                return
            if len(parts) == 3:
                clean = {k: v for k, v in s.items() if k not in ("messages", "permissions", "_perm_waiters", "_perm_decisions", "interrupted")}
                self._send_json(200, {"data": clean})
                return
            if len(parts) == 4 and parts[3] == "message":
                with lock:
                    msgs = list(s["messages"])
                self._send_json(200, {"data": msgs, "cursor": {"previous": None, "next": None}})
                return
            if len(parts) == 4 and parts[3] == "permission":
                with lock:
                    perms = list(s["permissions"].values())
                self._send_json(200, {"data": perms})
                return
        self._send_json(404, {"message": "Not found"})

    def do_POST(self):
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        p = parsed.path
        body = self._read_json()

        if p == "/api/session":
            sid = f"ses_{int(time.time()*1000)}_{len(sessions)+1}"
            now = int(time.time() * 1000)
            rec = {
                "id": sid,
                "projectID": "mock_proj",
                "cost": 0,
                "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}},
                "time": {"created": now, "updated": now},
                "title": body.get("title") or "Session",
                "permissions": body.get("permissions") or [],
                "location": body.get("location") or {"directory": os.getcwd()},
                "messages": [],
                "permissions": {},
            }
            with lock:
                sessions[sid] = rec
            _save_state()
            emit_sse("session.created", sid, {"title": rec["title"]})
            clean = {k: v for k, v in rec.items() if k not in ("messages", "permissions")}
            self._send_json(200, {"data": clean})
            return

        if p.startswith("/api/session/"):
            parts = [x for x in p.split("/") if x]
            sid = parts[2]
            with lock:
                s = sessions.get(sid)
            if not s:
                self._send_json(404, {"_tag": "SessionNotFoundError", "message": "Session not found"})
                return
            if len(parts) == 4 and parts[3] == "prompt":
                text = body.get("text", "")
                threading.Thread(target=_run_prompt, args=(sid, text), daemon=True).start()
                self._send_json(200, {"data": {"id": f"in_{int(time.time()*1000)}"}})
                return
            if len(parts) == 4 and parts[3] == "model":
                self._send_json(200, {"data": {"ok": True}})
                return
            if len(parts) == 4 and parts[3] == "interrupt":
                with lock:
                    s["interrupted"] = True
                emit_sse("session.idle", sid, {"outcome": "interrupted"})
                self._send_json(200, {"data": {"interrupted": True}})
                return
            if len(parts) == 6 and parts[3] == "permission" and parts[5] == "reply":
                req_id = parts[4]
                decision = body.get("decision", "reject")
                with lock:
                    s.setdefault("_perm_decisions", {})[req_id] = decision
                    ev = s.get("_perm_waiters", {}).get(req_id)
                if ev:
                    ev.set()
                emit_sse("permission.replied", sid, {"requestID": req_id, "decision": decision})
                self.send_response(204)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self._send_json(404, {"message": "Not found"})

    def do_DELETE(self):
        if not self._check_auth():
            return
        parts = [x for x in urlparse(self.path).path.split("/") if x]
        if len(parts) == 3 and parts[1] == "session":
            sid = parts[2]
            with lock:
                sessions.pop(sid, None)
            _save_state()
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self._send_json(404, {"message": "Not found"})

srv = ThreadingHTTPServer((host, port), Handler)
print(f"server listening on http://{host}:{port}", flush=True)
srv.serve_forever()
'''


def _write_mock_opencode(bin_dir: Path) -> Path:
    bin_dir.mkdir(parents=True, exist_ok=True)
    py_file = bin_dir / "mock_opencode.py"
    py_file.write_text(_MOCK_OPENCODE_PY, encoding="utf-8")
    if os.name == "nt":
        wrapper = bin_dir / "opencode.cmd"
        wrapper.write_text(f'@echo off\r\n"{sys.executable}" "{py_file}" %*\r\n', encoding="utf-8")
        return wrapper
    wrapper = bin_dir / "opencode"
    wrapper.write_text(f'#!/usr/bin/env sh\nexec "{sys.executable}" "{py_file}" "$@"\n', encoding="utf-8")
    wrapper.chmod(0o755)
    return wrapper


def _create_isolated_project(tmp_path: Path, name: str = "aries_opencode_proj") -> tuple[Settings, Path]:
    app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
    proj_svc = ProjectService(app_settings)
    summary = proj_svc.create_project(
        type(
            "Req",
            (),
            {
                "name": name,
                "parent_dir": str(tmp_path / "projects"),
                "description": "Phase 14 OpenCode test project",
                "template": "minimal",
            },
        )()
    )
    return app_settings, Path(summary.project_dir)


def _wait_session_status(
    svc: OpenCodeService,
    session_id: str,
    wanted: tuple[str, ...],
    timeout: float = 10.0,
):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        detail = svc.get_session_detail(session_id, sync_from_server=True)
        if detail.session.status in wanted:
            return detail
        time.sleep(0.08)
    pytest.fail(f"Timed out waiting for session {session_id} -> {wanted}")


# ---------------------------------------------------------------------------
# 1. CLI Detection, Validation, Security & Host Compatibility
# ---------------------------------------------------------------------------


class TestDetectionAndConfig:
    def test_missing_opencode_cli_is_non_fatal_and_blocks_session_with_503(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        svc = OpenCodeService(app_settings)
        try:
            with (
                patch("app.services.opencode_service.shutil.which", return_value=None),
                patch.object(svc, "_candidate_executables", return_value=[]),
            ):
                info = svc.get_info()
                assert info.available is False
                assert info.executable_source == "missing"
                assert info.install_guide_url == "https://opencode.ai/docs"
                assert info.unavailable_reason is not None

                with pytest.raises(OpenCodeServiceError) as exc:
                    svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir)))
                assert exc.value.status_code == 503
        finally:
            svc.shutdown()

    def test_rejects_arbitrary_executables_and_invalid_ids(self, tmp_path: Path):
        app_settings, _ = _create_isolated_project(tmp_path)
        svc = OpenCodeService(app_settings)
        try:
            for bad_exec in ("C:\\Windows\\System32\\cmd.exe", "/bin/bash", "powershell.exe", "-version"):
                with pytest.raises(ValueError):
                    validate_opencode_executable_path(bad_exec)

            with pytest.raises(ValueError):
                validate_opencode_session_id("../escape")

            missing_exe = tmp_path / "opencode.cmd"
            with pytest.raises(OpenCodeServiceError) as exc:
                svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(missing_exe)))
            assert exc.value.status_code == 400
        finally:
            svc.shutdown()

    def test_validates_mock_cli_version_and_linux_executable_mode(self, tmp_path: Path):
        app_settings, _ = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        try:
            state = svc.update_config(
                OpenCodeConfigUpdateRequest(
                    executable_path=str(mock_exe),
                    default_permission_mode="workspace_assisted",
                    default_model="anthropic/claude-sonnet",
                    startup_timeout_seconds=12.0,
                )
            )
            assert state.info.available is True
            assert state.info.version == "2.0.32"
            assert state.info.executable_source == "configured"
            assert state.config.default_permission_mode == "workspace_assisted"

            # Verify Linux executable bit check cleanly
            with (
                patch("app.services.opencode_service._host_os_name", return_value="linux"),
                patch("app.services.opencode_service.os.access", return_value=False),
            ):
                ok, _, err = svc._verify_executable_version(str(mock_exe))
                assert ok is False
                assert err and "executable" in err.lower()

            reset_state = svc.reset_config()
            assert reset_state.config.executable_path is None
            assert reset_state.config.default_permission_mode == "ask_all"
        finally:
            svc.shutdown()

    def test_host_installed_opencode_version_sanity_if_present(self, tmp_path: Path):
        host_bin = shutil.which("opencode")
        if not host_bin:
            pytest.skip("OpenCode CLI not installed on test runner host")
        svc = OpenCodeService(Settings(DATA_DIR=str(tmp_path / "host_check")))
        try:
            info = svc.get_info()
            assert info.available is True
            assert info.version is not None
        finally:
            svc.shutdown()


# ---------------------------------------------------------------------------
# 2. Session Lifecycle, Permissions, Workspace Isolation, Recovery & Bounds
# ---------------------------------------------------------------------------


class TestSessionOrchestrationAndSecurity:
    def test_session_create_prompt_tool_events_and_output_bounds(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        try:
            svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
            detail = svc.create_session(
                OpenCodeSessionCreateRequest(project_dir=str(proj_dir), title="Explain Firmware")
            )
            sid = detail.session.session_id
            assert detail.session.project_dir == str(proj_dir.resolve(strict=False))
            assert detail.session.status == "idle"

            info = svc.get_info(query_models=True)
            assert info.server_running is True
            assert any(m.id == "anthropic/claude-sonnet" for m in info.available_models)

            # Prompt with explicit context attachment preserves clean prompt + chips
            svc.send_prompt(
                sid,
                OpenCodeSessionPromptRequest(
                    project_dir=str(proj_dir),
                    prompt="Explain this main function",
                    contexts=[
                        OpenCodeContextAttachment(
                            kind="selection",
                            title="src/main.c:L1-L3",
                            relative_path="src/main.c",
                            start_line=1,
                            end_line=3,
                            language="c",
                            snippet="int main(void) { return 0; }",
                        )
                    ],
                ),
            )
            done = _wait_session_status(svc, sid, ("completed",))
            assistant_msgs = [m for m in done.messages if m.role == "assistant"]
            assert len(assistant_msgs) == 1
            assert "Analyzed firmware project" in assistant_msgs[0].text
            assert assistant_msgs[0].reasoning is not None
            assert len(assistant_msgs[0].tools) == 1
            assert assistant_msgs[0].tools[0].name == "read"
            user_msgs = [m for m in done.messages if m.role == "user"]
            assert user_msgs[0].text == "Explain this main function"
            assert len(user_msgs[0].contexts) == 1

            # Oversized assistant response is bounded safely
            svc.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_dir), prompt="[OVERSIZE]"))
            done_large = _wait_session_status(svc, sid, ("completed",))
            last_assistant = [m for m in done_large.messages if m.role == "assistant"][-1]
            assert len(last_assistant.text) <= MAX_MESSAGE_TEXT_CHARS + 128
            assert "truncated by VEGA Studio" in last_assistant.text
        finally:
            svc.shutdown()

    def test_permission_workflow_classifies_sensitivity_and_blocks_until_replied(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        try:
            svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
            created = svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir)))
            sid = created.session.session_id

            svc.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_dir), prompt="[NEED_PERMISSION] run clean"))
            waiting = _wait_session_status(svc, sid, ("waiting_permission",))
            assert len(waiting.pending_permissions) == 1
            perm = waiting.pending_permissions[0]
            assert perm.action == "bash"
            assert perm.is_sensitive is True
            assert any("shell" in r.lower() or "outside" in r.lower() for r in perm.sensitivity_reasons)

            # User rejects -> agent gracefully reports skipped command without crash
            svc.reply_permission(
                sid,
                perm.request_id,
                OpenCodePermissionReplyRequest(project_dir=str(proj_dir), decision="reject", message="No shell"),
            )
            finished = _wait_session_status(svc, sid, ("completed",))
            assert "rejected" in finished.messages[-1].text.lower()
        finally:
            svc.shutdown()

    def test_workspace_isolation_path_traversal_and_cross_project_blocking(self, tmp_path: Path):
        app_settings, proj_a = _create_isolated_project(tmp_path, "proj_a")
        _, proj_b = _create_isolated_project(tmp_path, "proj_b")
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        try:
            svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
            created = svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_a)))
            sid = created.session.session_id

            # Cross-project prompt must raise 409 Conflict
            with pytest.raises(OpenCodeServiceError) as cross_exc:
                svc.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_b), prompt="touch proj_b"))
            assert cross_exc.value.status_code == 409

            # Traversal path in context attachment must be rejected
            with pytest.raises(OpenCodeServiceError) as trav_exc:
                svc.send_prompt(
                    sid,
                    OpenCodeSessionPromptRequest(
                        project_dir=str(proj_a),
                        prompt="inspect",
                        contexts=[
                            OpenCodeContextAttachment(
                                kind="file",
                                title="escape",
                                relative_path="../../secrets.txt",
                            )
                        ],
                    ),
                )
            assert trav_exc.value.status_code == 400
        finally:
            svc.shutdown()

    def test_interrupt_concurrency_session_limit_and_shutdown_cleanup(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        try:
            svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
            created = svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir)))
            sid = created.session.session_id

            svc.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_dir), prompt="[SLOW_STREAM]"))
            # Concurrent prompt blocked with 409
            with pytest.raises(OpenCodeServiceError) as busy_exc:
                svc.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_dir), prompt="second"))
            assert busy_exc.value.status_code == 409

            interrupted = svc.interrupt_session(sid, project_dir=str(proj_dir))
            assert interrupted.status == "interrupted"

            # Enforce MAX_ACTIVE_OPENCODE_SESSIONS bound
            for idx in range(MAX_ACTIVE_OPENCODE_SESSIONS - 1):
                svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir), title=f"Extra {idx}"))
            with pytest.raises(OpenCodeServiceError) as limit_exc:
                svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir), title="Overflow"))
            assert limit_exc.value.status_code == 409

            proc = svc._server_proc
            assert proc is not None and proc.poll() is None
        finally:
            svc.shutdown()

        # Verify loopback process was terminated cleanly
        assert proc.poll() is not None

    def test_persisted_session_recovery_and_unavailable_state(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        state_file = tmp_path / "mock_oc_state.json"

        with patch.dict(os.environ, {"MOCK_OPENCODE_STATE_FILE": str(state_file)}):
            svc1 = OpenCodeService(app_settings)
            try:
                svc1.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
                created = svc1.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir), title="Persistent"))
                sid = created.session.session_id
                svc1.send_prompt(sid, OpenCodeSessionPromptRequest(project_dir=str(proj_dir), prompt="remember me"))
                _wait_session_status(svc1, sid, ("completed",))
            finally:
                svc1.shutdown()

            # New service instance simulating backend restart recovers messages cleanly
            svc2 = OpenCodeService(app_settings)
            try:
                listed = svc2.list_sessions(str(proj_dir))
                assert len(listed.sessions) == 1
                recovered = svc2.get_session_detail(sid, sync_from_server=True)
                assert any("remember me" in m.text for m in recovered.messages)
            finally:
                svc2.shutdown()

            # Simulate lost OpenCode server session -> transitions cleanly to unavailable
            state_file.write_text("{}", encoding="utf-8")
            svc3 = OpenCodeService(app_settings)
            try:
                lost = svc3.get_session_detail(sid, sync_from_server=True)
                assert lost.session.status == "unavailable"
                assert lost.session.recoverable is False
            finally:
                svc3.shutdown()

    def test_startup_crash_secret_scrubbing_and_critical_ws_backpressure(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")

        # Secret scrubber checks
        scrubbed = scrub_opencode_secrets("OPENCODE_SERVER_PASSWORD=topsecret Bearer sk-abc123456789012")
        assert "topsecret" not in scrubbed
        assert "sk-abc123456789012" not in scrubbed

        # Startup crash returns 503 safely
        svc = OpenCodeService(app_settings)
        try:
            svc.update_config(OpenCodeConfigUpdateRequest(executable_path=str(mock_exe)))
            with patch.dict(os.environ, {"MOCK_OPENCODE_CRASH": "1"}):
                with pytest.raises(OpenCodeServiceError) as crash_exc:
                    svc.create_session(OpenCodeSessionCreateRequest(project_dir=str(proj_dir)))
                assert crash_exc.value.status_code == 503
        finally:
            svc.shutdown()

        # Verify critical WS event is preserved even when subscriber queue is saturated
        q: asyncio.Queue = asyncio.Queue(maxsize=MAX_WS_SUBSCRIBER_QUEUE)
        for i in range(MAX_WS_SUBSCRIBER_QUEUE):
            q.put_nowait({"type": "delta", "seq": i, "_critical": False})
        assert q.full()
        OpenCodeService._enqueue_subscriber(
            q, {"type": "permission_requested", "request_id": "p1", "_critical": True}, True
        )
        drained = []
        while not q.empty():
            drained.append(q.get_nowait())
        assert any(item.get("type") == "permission_requested" for item in drained)

    def test_error_redaction_fastapi_routes_and_websocket_reconnect(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        mock_exe = _write_mock_opencode(tmp_path / "mock_bin")
        svc = OpenCodeService(app_settings)
        app.dependency_overrides[get_opencode_service] = lambda: svc
        try:
            client = TestClient(app)
            cfg_res = client.put(
                "/api/opencode/config",
                json={"executable_path": str(mock_exe), "default_permission_mode": "ask_all"},
            )
            assert cfg_res.status_code == 200
            assert cfg_res.json()["info"]["version"] == "2.0.32"

            create_res = client.post(
                "/api/opencode/sessions",
                json={"project_dir": str(proj_dir), "title": "API + WS Test"},
            )
            assert create_res.status_code == 201
            sid = create_res.json()["session"]["session_id"]

            # WebSocket connect receives snapshot & disconnects without closing session
            with client.websocket_connect(f"/api/opencode/ws/{sid}") as ws:
                snap = ws.receive_json()
                assert snap["type"] == "snapshot"
                assert snap["session_id"] == sid
                ws.send_json({"type": "ping"})
                pong = ws.receive_json()
                assert pong["type"] == "pong"

            # Trigger model error & verify token is scrubbed cleanly
            prompt_res = client.post(
                f"/api/opencode/sessions/{sid}/prompt",
                json={"project_dir": str(proj_dir), "prompt": "[TRIGGER_ERROR]"},
            )
            assert prompt_res.status_code == 200
            err_detail = _wait_session_status(svc, sid, ("error",))
            assert "sk-secret" not in (err_detail.session.last_error or "")

            del_res = client.delete(f"/api/opencode/sessions/{sid}")
            assert del_res.status_code == 200
            assert del_res.json()["status"] == "closed"
        finally:
            app.dependency_overrides.clear()
            svc.shutdown()
