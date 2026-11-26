"""Phase 17 stabilization regression tests across security, persistence, lifecycle, and diagnostics."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.config import Settings, is_allowed_ws_origin
from app.main import create_app, lifespan
from app.models.ai import AIConfig, AIConnectionTestRequest, validate_ai_base_url
from app.models.build import BuildRequest
from app.models.upload import UploadRequest
from app.services.ai_context import is_sensitive_relative_path, resolve_workspace_file
from app.services.ai_credentials import (
    AICredentialManager,
    CredentialStorageUnavailableError,
    KeyringLibraryBackend,
    OSCredentialBackend,
)
from app.services.ai_providers import OpenAIProviderAdapter
from app.services.diagnostics_service import (
    configure_backend_logging,
)
from app.services.github_service import GitHubService, GitHubServiceError
from app.services.persistence import AppPersistence
from app.services.process_utils import terminate_process_tree
from app.services.project_service import ProjectService
from app.services.sdk_service import SdkService
from app.services.upload_service import UploadService, UploadServiceError


def test_settings_restricts_host_to_loopback_and_ws_origin():
    assert Settings(HOST="::1").HOST == "::1"
    for bad_host in ("0.0.0.0", "192.168.1.5", "::"):
        with pytest.raises(ValidationError):
            Settings(HOST=bad_host)

    assert is_allowed_ws_origin(None) is True
    assert is_allowed_ws_origin("http://localhost:3000") is True
    assert is_allowed_ws_origin("http://127.0.0.1:8765") is True
    assert is_allowed_ws_origin("null") is False
    assert is_allowed_ws_origin("https://evil.example") is False

    app = create_app()
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(
            "/api/serial/ws",
            headers={"Origin": "https://evil.example"},
        ):
            pass
    assert exc_info.value.code == 1008


def test_persistence_closes_connections_cleanly(tmp_path: Path):
    db_path = tmp_path / "state" / "vega_studio.db"
    store = AppPersistence(db_path=db_path)
    store.set_state_json("phase17_check", {"ok": True})
    assert store.get_state_json("phase17_check")[0]["ok"] is True

    conn = sqlite3.connect(db_path)
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert str(mode).lower() in ("wal", "delete", "memory")
    finally:
        conn.close()

    # Verify DB & WAL files are not held open after AppPersistence operations finish
    for leftover in db_path.parent.glob("vega_studio.db*"):
        leftover.unlink()
    assert not db_path.exists()


def test_terminate_process_tree_reaps_posix_child_after_sigkill(monkeypatch):
    proc = MagicMock()
    proc.pid = 4242
    proc.poll.return_value = None
    proc.wait.return_value = -9

    monkeypatch.setattr("app.services.process_utils._host_os_name", lambda: "linux")
    monkeypatch.setattr("app.services.process_utils.os.getpgid", lambda pid: pid, raising=False)
    kill_calls = []
    monkeypatch.setattr(
        "app.services.process_utils.os.killpg",
        lambda pgid, sig: kill_calls.append((pgid, sig)),
        raising=False,
    )

    terminate_process_tree(proc)

    assert len(kill_calls) >= 1
    assert proc.wait.call_count >= 1


def test_project_service_load_project_is_readonly(tmp_path: Path):
    cfg = Settings(DATA_DIR=str(tmp_path / "app_data"))
    svc = ProjectService(cfg)
    created = svc.create_project(
        type(
            "Req",
            (),
            {
                "name": "readonly_check",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Verify read-only project loading",
                "template": "minimal",
            },
        )()
    )
    svc.close_workspace()
    assert svc.get_workspace_state().active_project is None

    loaded = svc.load_project(created.project_dir)
    assert loaded.project.name == "readonly_check"
    # load_project must not mutate persisted active_project_dir
    assert svc.get_workspace_state().active_project is None


def test_ai_context_blocks_case_insensitive_sensitive_paths_and_symlinks(tmp_path: Path):
    assert is_sensitive_relative_path(".Git/config") is not None
    assert is_sensitive_relative_path("sub/.GIT/HEAD") is not None
    assert is_sensitive_relative_path(".ENV.local") is not None

    proj_dir = tmp_path / "fw"
    proj_dir.mkdir()
    secret_env = proj_dir / ".env"
    secret_env.write_text("API_KEY=sk-topsecret123456\n", encoding="utf-8")
    alias = proj_dir / "harmless.txt"
    try:
        os.symlink(secret_env, alias)
    except OSError:
        pytest.skip("Symlink creation requires elevated/Developer privileges on this host")

    with pytest.raises(ValueError):
        resolve_workspace_file(proj_dir, "harmless.txt")


def test_keyring_error_maps_to_unavailable_503():
    class BrokenKeyring:
        @staticmethod
        def set_password(*_a, **_kw):
            raise RuntimeError("D-Bus keyring locked")

        @staticmethod
        def get_password(*_a, **_kw):
            raise RuntimeError("D-Bus keyring locked")

    backend = KeyringLibraryBackend()
    backend._keyring = BrokenKeyring()
    backend._kr_backend_name = "mock"
    with pytest.raises(CredentialStorageUnavailableError) as exc_info:
        backend.set_secret("openai", "sk-dummykey123456789")
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_ai_validation_and_invalid_url_handled_gracefully():
    with pytest.raises(ValueError):
        validate_ai_base_url("http://127.0.0.1:notaport/v1")
    with pytest.raises(ValueError):
        validate_ai_base_url("https://api.openai.com/v1 bad")
    with pytest.raises(ValidationError):
        AIConnectionTestRequest(
            provider_id="openai",
            api_key_override="sk-bad\nheader-injection",
        )

    adapter = OpenAIProviderAdapter()

    class BrokenAsyncClient:
        async def get(self, *_args, **_kwargs):
            raise httpx.InvalidURL("Invalid URL encoding")

    resp = await adapter.test_connection(
        BrokenAsyncClient(),  # type: ignore[arg-type]
        model="gpt-4o-mini",
        base_url=None,
        api_key="sk-test-valid-key-1234",
        timeout_seconds=5.0,
    )
    assert resp.ok is False
    assert resp.error_code == "invalid_request"


def test_build_and_upload_validation_and_serial_port_conflict(tmp_path: Path):
    for bad_env in ("GNUMAKEFLAGS", "BASH_ENV", "VEGA_SDK_HOME", "CROSS_COMPILE", "PYTHONSTARTUP"):
        with pytest.raises(ValidationError):
            BuildRequest(project_dir=str(tmp_path), env_overrides={bad_env: "1"})

    with pytest.raises(ValidationError):
        UploadRequest(project_dir=str(tmp_path), port="--bad-flag")
    ok_req = UploadRequest(
        project_dir=str(tmp_path),
        port="/dev/serial/by-id/usb-FTDI+UART-if00",
    )
    assert ok_req.port == "/dev/serial/by-id/usb-FTDI+UART-if00"

    app_settings = Settings(DATA_DIR=str(tmp_path / "data"))
    proj_svc = ProjectService(app_settings)
    summary = proj_svc.create_project(
        type(
            "Req",
            (),
            {
                "name": "conflict_test",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Conflict guard test",
                "template": "minimal",
            },
        )()
    )
    proj_dir = Path(summary.project_dir)
    (proj_dir / "build").mkdir(exist_ok=True)
    (proj_dir / "build" / "firmware.bin").write_bytes(b"\x01\x02\x03\x04")

    sdk_root = tmp_path / "vega-sdk"
    sdk_root.mkdir(parents=True)
    tc_root = tmp_path / "vega-tools"
    tc_root.mkdir(parents=True)
    uploader = tmp_path / "vega_xmodem.py"
    uploader.write_text("print('stub')\n", encoding="utf-8")
    SdkService(app_settings).update_config(
        SdkService(app_settings).get_config_state().config.model_copy(
            update={
                "sdk_root": str(sdk_root),
                "toolchain_root": str(tc_root),
                "uploader_script": str(uploader),
            }
        )
    )

    upload_svc = UploadService(app_settings)

    import app.services.serial_service as serial_mod

    fake_serial_svc = MagicMock()
    fake_serial_svc.get_state.return_value = type(
        "SState", (), {"status": "connected", "port": "COM9"}
    )()
    orig_getter = serial_mod.get_serial_service
    serial_mod.get_serial_service = lambda: fake_serial_svc  # type: ignore[assignment]
    try:
        with pytest.raises(UploadServiceError) as exc_info:
            upload_svc.start_upload(
                UploadRequest(
                    project_dir=str(proj_dir),
                    port="COM9",
                    artifact_path="build/firmware.bin",
                    strict_port_check=False,
                )
            )
        assert exc_info.value.status_code == 409
    finally:
        serial_mod.get_serial_service = orig_getter  # type: ignore[assignment]


def test_github_cli_hardening_and_posix_session(monkeypatch, tmp_path: Path):
    svc = GitHubService()
    with pytest.raises(GitHubServiceError) as rm_exc:
        from app.models.github import validate_remote_name

        try:
            validate_remote_name("-evil")
        except ValueError as err:
            raise GitHubServiceError(str(err), status_code=400) from err
    assert rm_exc.value.status_code == 400

    with monkeypatch.context() as mp:
        mp.setattr("app.services.github_service.os.name", "posix")
        assert svc._popen_kwargs().get("start_new_session") is True

    proj_svc = ProjectService(Settings(DATA_DIR=str(tmp_path / "data")))
    created = proj_svc.create_project(
        type(
            "Req",
            (),
            {
                "name": "gh_flag_test",
                "parent_dir": str(tmp_path / "projects"),
                "description": "",
                "template": "minimal",
            },
        )()
    )
    svc._git_service = MagicMock()
    svc._git_service._require_git_and_repo.return_value = ("git", Path(created.project_dir))
    svc._git_service.get_status.return_value = type(
        "St", (), {"current_branch": "main", "upstream": "origin/main", "ahead": 0, "behind": 0}
    )()
    svc._git_service._run_git_text.return_value = (0, "deadbeef\trefs/heads/main\n", "")
    monkeypatch.setattr(
        svc,
        "_parse_remotes",
        lambda _g, _r: [
            type(
                "Rem",
                (),
                {
                    "name": "origin",
                    "fetch_url": "https://github.com/owner/repo.git",
                    "is_github": True,
                    "github_owner_repo": "owner/repo",
                },
            )()
        ],
    )
    monkeypatch.setattr(svc, "detect_gh", lambda: (True, "gh", "2.60.0", None))

    captured_cmds = []

    def fake_run(cmd, **_kwargs):
        captured_cmds.append(cmd)
        return type(
            "Proc",
            (),
            {
                "returncode": 0,
                "stdout": json.dumps(
                    {
                        "nameWithOwner": "owner/repo",
                        "url": "https://github.com/owner/repo",
                        "isPrivate": False,
                        "visibility": "PUBLIC",
                    }
                ),
                "stderr": "",
            },
        )()

    monkeypatch.setattr("app.services.github_service.subprocess.run", fake_run)
    detail = svc.get_remote_repo_info(created.project_dir, "origin")
    assert detail.owner_repo == "owner/repo"
    assert "--" in captured_cmds[0]
    assert captured_cmds[0].index("--") < captured_cmds[0].index("owner/repo")


@pytest.mark.asyncio
async def test_lifespan_isolates_shutdown_exceptions(monkeypatch):
    import app.main as main_mod

    called = []

    class BoomSvc:
        def shutdown(self):
            called.append("boom")
            raise RuntimeError("boom during shutdown")

    class OkSvc:
        def __init__(self, label):
            self.label = label

        def shutdown(self):
            called.append(self.label)

    monkeypatch.setattr(main_mod, "get_build_service", lambda: BoomSvc())
    monkeypatch.setattr(main_mod, "get_upload_service", lambda: OkSvc("upload"))
    monkeypatch.setattr(main_mod, "get_serial_service", lambda: OkSvc("serial"))
    monkeypatch.setattr(main_mod, "get_terminal_service", lambda: OkSvc("terminal"))
    monkeypatch.setattr(main_mod, "get_github_service", lambda: OkSvc("github"))
    monkeypatch.setattr(main_mod, "get_ai_service", lambda: OkSvc("ai"))

    async with lifespan(main_mod.create_app()):
        pass

    assert called == ["boom", "upload", "serial", "terminal", "github", "ai"]


def test_redacted_logging_and_diagnostics_export(tmp_path: Path, monkeypatch):
    app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
    log_path = configure_backend_logging(app_settings)
    assert log_path is not None

    secret_api_key = "sk-vegaPhase17SecretKey9876543210"
    secret_bearer = "superSecretBearerToken123456"

    class _NoOsStore(OSCredentialBackend):
        @property
        def backend_name(self) -> str:
            return "none"

        def is_available(self):
            return (False, "Unavailable in test")

        def get_secret(self, provider_id):
            return None

        def set_secret(self, provider_id, secret):
            raise CredentialStorageUnavailableError("Unavailable")

        def delete_secret(self, provider_id):
            return None

    creds = AICredentialManager(backend=_NoOsStore())
    creds.set_secret("openai", secret_api_key, session_only=True)

    from app.services.ai_service import get_ai_service

    ai_svc = get_ai_service()
    orig_creds = ai_svc._credentials
    ai_svc._credentials = creds
    try:
        test_logger = logging.getLogger("vega_studio.test_redaction")
        test_logger.warning(
            "Testing secret scrubbing: %s Authorization: Bearer %s token=abc1234567",
            secret_api_key,
            secret_bearer,
        )
        for h in logging.getLogger().handlers:
            h.flush()

        log_contents = log_path.read_text(encoding="utf-8")
        assert secret_api_key not in log_contents
        assert secret_bearer not in log_contents
        assert "abc1234567" not in log_contents
        assert "[REDACTED" in log_contents

        monkeypatch.setattr("app.services.diagnostics_service.settings", app_settings)
        monkeypatch.setattr("app.routers.health.settings", app_settings)
        client = TestClient(create_app())
        resp = client.get("/api/diagnostics/export")
        assert resp.status_code == 200
        payload_text = resp.text
        assert secret_api_key not in payload_text
        assert secret_bearer not in payload_text
        assert "abc1234567" not in payload_text

        bundle = resp.json()
        assert bundle["redaction_applied"] is True
        assert len(bundle["excluded_items"]) >= 3
        assert "backend" in bundle and "platform" in bundle and "ai" in bundle
        assert any(
            "Testing secret scrubbing" in line
            for line in bundle["recent_backend_logs"]
        )
    finally:
        ai_svc._credentials = orig_creds
