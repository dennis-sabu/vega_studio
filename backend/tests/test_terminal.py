"""Tests for Phase 11 Integrated Terminal (shells, PTY sessions, REST API, WebSocket, security)."""
from __future__ import annotations

import os
from pathlib import Path
import queue
import threading
import time
from typing import Dict, List, Optional
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.terminal import (
    TerminalResizeRequest,
    TerminalSessionCreateRequest,
)
from app.routers.terminal import get_terminal_service
from app.services.project_service import ProjectService
from app.services.sdk_service import _host_os_name
from app.services.terminal_service import (
    MAX_TERMINAL_BUFFER_CHARS,
    TerminalService,
    TerminalServiceError,
)


# ---------------------------------------------------------------------------
# Controlled Fake PTY for deterministic lifecycle, ANSI, resize & boundary tests
# ---------------------------------------------------------------------------


class FakePtyHandle:
    """In-memory thread-safe PTY handle simulating an interactive shell."""

    _next_pid = 9000

    def __init__(
        self,
        executable: str,
        args: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
    ) -> None:
        FakePtyHandle._next_pid += 1
        self._pid = FakePtyHandle._next_pid
        self.executable = executable
        self.args = list(args)
        self.cwd = cwd
        self.env = dict(env)
        self.cols = cols
        self.rows = rows

        self._out_q: queue.Queue[Optional[str]] = queue.Queue()
        self.written: List[str] = []
        self.resizes: List[tuple[int, int]] = []
        self.terminated = False
        self._alive = True
        self._exit_code: Optional[int] = None

        # Initial greeting with ANSI color preserved verbatim
        self._out_q.put("\x1b[32mVEGA-PTY\x1b[0m> ")

    @property
    def pid(self) -> Optional[int]:
        return self._pid

    def push_output(self, chunk: str) -> None:
        self._out_q.put(chunk)

    def trigger_exit(self, code: int = 0) -> None:
        self._exit_code = code
        self._alive = False
        self._out_q.put(None)

    def read(self) -> Optional[str]:
        item = self._out_q.get()
        return item

    def write(self, data: str) -> None:
        self.written.append(data)
        if data == "\x03":
            self._out_q.put("^C\r\n")
        elif "exit\r" in data or data == "\x04":
            self.trigger_exit(0)
        elif data.endswith("\r") or data.endswith("\n"):
            cmd = data.rstrip("\r\n")
            if cmd:
                self._out_q.put(f"\x1b[36m{cmd}\x1b[0m\r\n")

    def resize(self, cols: int, rows: int) -> None:
        self.cols = cols
        self.rows = rows
        self.resizes.append((cols, rows))

    def is_alive(self) -> bool:
        return self._alive

    def poll_exit_code(self) -> Optional[int]:
        return self._exit_code

    def terminate(self) -> Optional[int]:
        self.terminated = True
        if self._alive:
            self._exit_code = -15
            self._alive = False
            self._out_q.put(None)
        return self._exit_code


def make_fake_factory(created: Optional[List[FakePtyHandle]] = None):
    def _factory(
        executable: str,
        args: List[str],
        cwd: str,
        env: Dict[str, str],
        cols: int,
        rows: int,
    ) -> FakePtyHandle:
        h = FakePtyHandle(executable, args, cwd, env, cols, rows)
        if created is not None:
            created.append(h)
        return h

    return _factory


# ---------------------------------------------------------------------------
# 1. Shell Detection & Validation
# ---------------------------------------------------------------------------


class TestShellDiscovery:
    def test_discover_shells_finds_host_shells_safely(self, tmp_path: Path):
        cfg_settings = Settings(DATA_DIR=str(tmp_path / "data"))
        svc = TerminalService(cfg_settings)
        info = svc.discover_shells()

        assert info.platform_os in ("windows", "linux", "macos")
        assert len(info.shells) >= 1
        assert info.default_shell_id is not None
        assert any(s.id == info.default_shell_id and s.is_default for s in info.shells)
        for s in info.shells:
            assert Path(s.executable).is_file()

    def test_discover_shells_linux_respects_allowlist_and_preferred_shell(
        self, tmp_path: Path
    ):
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        bash_bin = bin_dir / "bash"
        zsh_bin = bin_dir / "zsh"
        bash_bin.write_text("#!/bin/sh\n", encoding="utf-8")
        zsh_bin.write_text("#!/bin/sh\n", encoding="utf-8")

        def fake_which(name: str) -> Optional[str]:
            mapping = {"bash": str(bash_bin), "zsh": str(zsh_bin)}
            return mapping.get(name)

        svc = TerminalService(Settings(DATA_DIR=str(tmp_path / "data")))
        with (
            patch("app.services.terminal_service._host_os_name", return_value="linux"),
            patch("app.services.terminal_service.POSIX_PTY_AVAILABLE", True),
            patch("app.services.terminal_service.shutil.which", side_effect=fake_which),
            patch("app.services.terminal_service.os.access", return_value=True),
            patch.dict(os.environ, {"SHELL": str(zsh_bin)}),
        ):
            info = svc.discover_shells()

        ids = [s.id for s in info.shells]
        assert "zsh" in ids
        assert "bash" in ids
        assert info.default_shell_id == "zsh"
        assert info.pty_backend == "posix_pty"
        assert info.pty_supported is True

    def test_rejects_raw_executable_paths_or_unknown_shell_ids(self, tmp_path: Path):
        with pytest.raises(ValueError):
            TerminalSessionCreateRequest(shell_id="/bin/bash")
        with pytest.raises(ValueError):
            TerminalSessionCreateRequest(shell_id="../evil")

        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(),
        )
        with pytest.raises(TerminalServiceError) as exc:
            svc.create_session(
                TerminalSessionCreateRequest(shell_id="no_such_shell", cwd=str(tmp_path))
            )
        assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# 2. Working Directory Validation & Project Integration
# ---------------------------------------------------------------------------


class TestWorkingDirectory:
    def test_defaults_to_active_project_root_and_supports_relative_cwd(
        self, tmp_path: Path
    ):
        data_dir = tmp_path / "data"
        proj_parent = tmp_path / "projects"
        app_settings = Settings(DATA_DIR=str(data_dir))
        proj_svc = ProjectService(app_settings)
        summary = proj_svc.create_project(
            type(
                "Req",
                (),
                {
                    "name": "aries_term_proj",
                    "parent_dir": str(proj_parent),
                    "description": "Terminal cwd test",
                    "template": "minimal",
                },
            )()
        )
        project_root = Path(summary.project_dir)
        sub_dir = project_root / "src"
        assert sub_dir.is_dir()

        created: List[FakePtyHandle] = []
        svc = TerminalService(app_settings, pty_factory=make_fake_factory(created))

        # No cwd specified -> defaults to active project root
        res1 = svc.create_session(TerminalSessionCreateRequest())
        assert Path(res1.session.cwd).resolve() == project_root.resolve()
        assert Path(created[0].cwd).resolve() == project_root.resolve()

        # Relative cwd -> resolves against active project
        res2 = svc.create_session(TerminalSessionCreateRequest(cwd="src"))
        assert Path(res2.session.cwd).resolve() == sub_dir.resolve()

        svc.shutdown()

    def test_rejects_nonexistent_file_or_inaccessible_directory(self, tmp_path: Path):
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(),
        )
        # Missing dir
        with pytest.raises(TerminalServiceError) as exc1:
            svc.create_session(
                TerminalSessionCreateRequest(cwd=str(tmp_path / "missing_folder"))
            )
        assert exc1.value.status_code == 400

        # File path instead of dir
        file_path = tmp_path / "plain.txt"
        file_path.write_text("hi", encoding="utf-8")
        with pytest.raises(TerminalServiceError) as exc2:
            svc.create_session(TerminalSessionCreateRequest(cwd=str(file_path)))
        assert exc2.value.status_code == 400

        # Inaccessible directory
        locked_dir = tmp_path / "locked"
        locked_dir.mkdir()
        with patch(
            "app.services.terminal_service.os.scandir",
            side_effect=PermissionError("Access is denied"),
        ):
            with pytest.raises(TerminalServiceError) as exc3:
                svc.create_session(TerminalSessionCreateRequest(cwd=str(locked_dir)))
        assert exc3.value.status_code == 400

    def test_tracks_cwd_changes_via_osc_sequences_without_stripping_ansi(
        self, tmp_path: Path
    ):
        work_sub = tmp_path / "nested dir"
        work_sub.mkdir()
        created: List[FakePtyHandle] = []
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(created),
        )
        res = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        sid = res.session.session_id
        handle = created[0]

        osc_uri_path = work_sub.as_posix()
        if not osc_uri_path.startswith("/"):
            osc_uri_path = "/" + osc_uri_path
        osc_chunk = f"\x1b]7;file://localhost{osc_uri_path.replace(' ', '%20')}\x07\x1b[33mprompt>\x1b[0m"
        handle.push_output(osc_chunk)

        deadline = time.time() + 2.0
        while time.time() < deadline:
            state = svc.get_session_state(sid)
            if Path(state.session.cwd).resolve() == work_sub.resolve():
                break
            time.sleep(0.02)

        final_state = svc.get_session_state(sid)
        assert Path(final_state.session.cwd).resolve() == work_sub.resolve()
        # ANSI sequences MUST NOT be stripped in backend replay
        assert "\x1b[33mprompt>\x1b[0m" in final_state.replay
        svc.shutdown()


# ---------------------------------------------------------------------------
# 3. Session Limits, Multi-session, Input, Resize, Bounded Buffer & Shutdown
# ---------------------------------------------------------------------------


class TestTerminalSessionLifecycle:
    def test_session_limits_and_multiple_isolated_sessions(self, tmp_path: Path):
        created: List[FakePtyHandle] = []
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            max_sessions=2,
            pty_factory=make_fake_factory(created),
        )
        s1 = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        s2 = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        assert s1.session.session_id != s2.session.session_id

        with pytest.raises(TerminalServiceError) as exc:
            svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        assert exc.value.status_code == 429

        # Closing one frees a slot cleanly
        svc.close_session(s1.session.session_id)
        assert created[0].terminated is True
        assert created[1].terminated is False

        s3 = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        assert s3.session.status == "running"
        svc.shutdown()
        assert created[1].terminated is True
        assert created[2].terminated is True

    def test_input_forwarding_resize_and_natural_exit(self, tmp_path: Path):
        created: List[FakePtyHandle] = []
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(created),
        )
        res = svc.create_session(
            TerminalSessionCreateRequest(cwd=str(tmp_path), cols=90, rows=24)
        )
        sid = res.session.session_id
        handle = created[0]

        # Ctrl+C and command forwarding
        svc.send_input(sid, "\x03")
        svc.send_input(sid, "make all\r")
        resized = svc.resize_session(sid, TerminalResizeRequest(cols=140, rows=42))
        assert resized.cols == 140
        assert resized.rows == 42
        assert (140, 42) in handle.resizes
        assert "\x03" in handle.written
        assert "make all\r" in handle.written

        # Natural exit via Ctrl+D / exit updates status & exit code
        handle.trigger_exit(7)
        deadline = time.time() + 2.0
        while time.time() < deadline:
            st = svc.get_session_state(sid)
            if st.session.status == "exited":
                break
            time.sleep(0.02)

        exited_state = svc.get_session_state(sid)
        assert exited_state.session.status == "exited"
        assert exited_state.session.exit_code == 7

        # Input to exited session fails 409 cleanly
        with pytest.raises(TerminalServiceError) as exc:
            svc.send_input(sid, "ls\r")
        assert exc.value.status_code == 409
        svc.shutdown()

    def test_bounded_output_buffer_caps_large_volume(self, tmp_path: Path):
        created: List[FakePtyHandle] = []
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(created),
        )
        res = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        sid = res.session.session_id
        handle = created[0]

        # Exceed MAX_TERMINAL_BUFFER_CHARS significantly
        chunk = "A" * 32768
        for _ in range(12):
            handle.push_output(chunk)

        expected_total = 12 * 32768
        deadline = time.time() + 3.0
        while time.time() < deadline:
            st = svc.get_session_state(sid)
            if st.session.output_bytes >= expected_total:
                break
            time.sleep(0.02)

        final_state = svc.get_session_state(sid)
        assert final_state.session.output_bytes >= expected_total
        assert len(final_state.replay) <= MAX_TERMINAL_BUFFER_CHARS
        assert final_state.session.buffer_truncated is True
        svc.shutdown()

    def test_restart_preserves_cwd_and_terminates_previous_pty(self, tmp_path: Path):
        created: List[FakePtyHandle] = []
        sub_dir = tmp_path / "workdir"
        sub_dir.mkdir()
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            pty_factory=make_fake_factory(created),
        )
        res = svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        sid = res.session.session_id

        # Simulate cwd tracked to sub_dir before restart
        rec = svc.get_session_record(sid)
        with rec.lock:
            rec.summary.cwd = str(sub_dir)

        restarted = svc.restart_session(sid)
        assert created[0].terminated is True
        assert len(created) == 2
        assert Path(created[1].cwd).resolve() == sub_dir.resolve()
        assert restarted.session.status == "running"
        assert restarted.replay == ""
        svc.shutdown()


# ---------------------------------------------------------------------------
# 4. REST API + Bidirectional WebSocket Reconnect & Validation Tests
# ---------------------------------------------------------------------------


class TestTerminalAPIAndWebSocket:
    @pytest.fixture
    def isolated_api(self, tmp_path: Path):
        created: List[FakePtyHandle] = []
        svc = TerminalService(
            Settings(DATA_DIR=str(tmp_path / "data")),
            max_sessions=3,
            pty_factory=make_fake_factory(created),
        )
        app.dependency_overrides[get_terminal_service] = lambda: svc
        yield svc, created, tmp_path
        app.dependency_overrides.clear()
        svc.shutdown()

    def test_rest_crud_validation_and_restart_endpoints(self, isolated_api):
        svc, created, tmp_path = isolated_api
        client = TestClient(app)

        shells_res = client.get("/api/terminal/shells")
        assert shells_res.status_code == 200
        assert len(shells_res.json()["shells"]) >= 1

        # Create session
        create_res = client.post(
            "/api/terminal/sessions",
            json={"cwd": str(tmp_path), "cols": 100, "rows": 30},
        )
        assert create_res.status_code == 201
        sid = create_res.json()["session"]["session_id"]

        # List sessions
        list_res = client.get("/api/terminal/sessions")
        assert list_res.status_code == 200
        assert len(list_res.json()["sessions"]) == 1

        # Invalid session id / unknown id
        assert client.get("/api/terminal/sessions/bad!id").status_code == 400
        assert client.get("/api/terminal/sessions/0123456789abcdef").status_code == 404

        # Invalid resize dimensions
        assert (
            client.post(
                f"/api/terminal/sessions/{sid}/resize",
                json={"cols": 5, "rows": 2},
            ).status_code
            == 422
        )

        # Valid resize + clear + restart + delete
        r_res = client.post(
            f"/api/terminal/sessions/{sid}/resize",
            json={"cols": 120, "rows": 35},
        )
        assert r_res.status_code == 200
        assert r_res.json()["cols"] == 120

        clr_res = client.post(f"/api/terminal/sessions/{sid}/clear")
        assert clr_res.status_code == 200
        assert clr_res.json()["buffer_bytes"] == 0

        rst_res = client.post(f"/api/terminal/sessions/{sid}/restart")
        assert rst_res.status_code == 200
        assert created[0].terminated is True

        del_res = client.delete(f"/api/terminal/sessions/{sid}")
        assert del_res.status_code == 200
        assert del_res.json()["closed"] is True
        assert client.get(f"/api/terminal/sessions/{sid}").status_code == 404

    def test_websocket_io_resize_disconnect_resilience_and_reconnect(self, isolated_api):
        svc, created, tmp_path = isolated_api
        client = TestClient(app)

        create_res = client.post(
            "/api/terminal/sessions",
            json={"cwd": str(tmp_path), "cols": 80, "rows": 24},
        )
        sid = create_res.json()["session"]["session_id"]
        handle = created[0]

        # Unknown session rejected cleanly
        with pytest.raises(Exception):
            with client.websocket_connect("/api/terminal/ws/0123456789abcdef") as ws:
                ws.receive_json()

        # First WebSocket connection: snapshot -> input -> resize -> live output -> ping
        with client.websocket_connect(f"/api/terminal/ws/{sid}") as ws1:
            snap = ws1.receive_json()
            assert snap["type"] == "snapshot"
            assert snap["session"]["session_id"] == sid

            ws1.send_json({"type": "resize", "cols": 132, "rows": 40})
            ws1.send_json({"type": "input", "data": "echo vega_term\r"})

            # Receive output events containing command echo
            collected = snap["replay"]
            for _ in range(5):
                ev = ws1.receive_json()
                if ev["type"] == "output":
                    collected += ev["data"]
                if "echo vega_term" in collected:
                    break
            assert "\x1b[36mecho vega_term\x1b[0m" in collected
            assert (132, 40) in handle.resizes

            # Malformed event returns error without breaking session
            ws1.send_text("not-json")
            err_ev = ws1.receive_json()
            assert err_ev["type"] == "error"

            ws1.send_json({"type": "ping"})
            pong_ev = ws1.receive_json()
            assert pong_ev["type"] == "pong"

        # Disconnecting ws1 MUST NOT kill running shell
        assert svc.get_session_state(sid).session.status == "running"
        assert handle.terminated is False

        # Reconnect second WebSocket -> receives buffered ANSI replay intact + exit event
        with client.websocket_connect(f"/api/terminal/ws/{sid}") as ws2:
            snap2 = ws2.receive_json()
            assert snap2["type"] == "snapshot"
            assert "echo vega_term" in snap2["replay"]

            ws2.send_json({"type": "input", "data": "exit\r"})
            saw_exit = False
            for _ in range(6):
                ev = ws2.receive_json()
                if ev["type"] == "exited":
                    assert ev["session"]["status"] == "exited"
                    assert ev["session"]["exit_code"] == 0
                    saw_exit = True
                    break
            assert saw_exit


# ---------------------------------------------------------------------------
# 5. Live Real OS PTY Integration Test (Windows ConPTY / Linux POSIX PTY)
# ---------------------------------------------------------------------------


def test_real_host_pty_shell_command_resize_and_termination(tmp_path: Path):
    """Exercise the real host OS PTY backend end-to-end with a clean shell session."""
    svc = TerminalService(Settings(DATA_DIR=str(tmp_path / "data")))
    shells = svc.discover_shells()
    if not shells.pty_supported or not shells.shells:
        pytest.skip("Host PTY backend unavailable in current test environment")

    preferred = "cmd" if _host_os_name() == "windows" else "bash"
    chosen = (
        preferred
        if any(s.id == preferred for s in shells.shells)
        else shells.default_shell_id
    )
    assert chosen is not None

    res = svc.create_session(
        TerminalSessionCreateRequest(
            shell_id=chosen,
            cwd=str(tmp_path),
            cols=80,
            rows=24,
        )
    )
    sid = res.session.session_id
    assert res.session.status == "running"
    assert res.session.pid is not None

    try:
        # Resize live OS PTY
        resized = svc.resize_session(sid, TerminalResizeRequest(cols=110, rows=32))
        assert resized.cols == 110

        time.sleep(0.3)
        svc.send_input(sid, "echo VEGA_REAL_PTY_CHECK\r")

        deadline = time.time() + 5.0
        saw_output = False
        while time.time() < deadline:
            state = svc.get_session_state(sid)
            if "VEGA_REAL_PTY_CHECK" in state.replay:
                saw_output = True
                break
            time.sleep(0.05)

        assert saw_output, f"Expected real PTY echo output, got: {svc.get_session_state(sid).replay!r}"
    finally:
        svc.shutdown()

    assert svc.list_sessions().sessions == []


def test_terminal_environment_sdk_vars_and_unavailable_pty_503(tmp_path: Path):
    """Terminal includes safe TERM/SDK env without mutating disk files and fails 503 if PTY absent."""
    from app.models.sdk import SdkConfig

    data_dir = tmp_path / "data"
    sdk_dir = tmp_path / "vega-sdk"
    tc_dir = tmp_path / "vega-tools"
    proj_dir = tmp_path / "proj"
    sdk_dir.mkdir()
    (tc_dir / "bin").mkdir(parents=True)
    proj_dir.mkdir()

    app_settings = Settings(DATA_DIR=str(data_dir))
    created: List[FakePtyHandle] = []
    svc = TerminalService(app_settings, pty_factory=make_fake_factory(created))
    svc._sdk.update_config(
        SdkConfig(sdk_root=str(sdk_dir), toolchain_root=str(tc_dir))
    )

    res = svc.create_session(
        TerminalSessionCreateRequest(project_dir=str(proj_dir))
    )
    env = created[0].env
    assert env["TERM"] == "xterm-256color"
    assert env["VEGA_STUDIO_TERMINAL"] == "1"
    assert Path(env["VEGA_SDK"]).resolve() == sdk_dir.resolve()
    assert Path(env["VEGA_TOOLS"]).resolve() == tc_dir.resolve()
    assert Path(env["VEGA_PROJECT_DIR"]).resolve() == proj_dir.resolve()
    svc.shutdown()

    # Simulate missing PTY backend on Windows -> clean 503
    no_pty_svc = TerminalService(app_settings)
    with (
        patch("app.services.terminal_service._host_os_name", return_value="windows"),
        patch("app.services.terminal_service.winpty", None),
    ):
        shells = no_pty_svc.discover_shells()
        assert shells.pty_supported is False
        assert shells.pty_backend == "unavailable"
        with pytest.raises(TerminalServiceError) as exc:
            no_pty_svc.create_session(TerminalSessionCreateRequest(cwd=str(tmp_path)))
        assert exc.value.status_code == 503


def test_subscriber_queue_backpressure_drops_oldest_and_keeps_exited():
    """Verify slow subscriber queues do not overflow or drop terminal exit events."""
    import asyncio
    from app.services.terminal_service import _deliver_queue_event

    async def _run() -> None:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=2)
        _deliver_queue_event(q, {"type": "output", "seq": 1, "data": "a"})
        _deliver_queue_event(q, {"type": "output", "seq": 2, "data": "b"})
        _deliver_queue_event(q, {"type": "exited", "session": {"status": "exited"}})
        items = [q.get_nowait(), q.get_nowait()]
        assert items[0]["seq"] == 2
        assert items[1]["type"] == "exited"

    asyncio.run(_run())

