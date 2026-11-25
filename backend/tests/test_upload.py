"""Tests for Phase 9 Firmware Upload System (preflight, artifacts, devices, streaming, process safety)."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.sdk import SdkConfig
from app.models.upload import (
    DeviceListResponse,
    SerialDeviceInfo,
    UploadPreflightRequest,
    UploadRequest,
)
from app.routers.projects import get_project_service
from app.routers.upload import get_upload_service
from app.services.project_service import ProjectService
from app.services.upload_service import UploadService, parse_explicit_upload_progress


@pytest.fixture
def isolated_upload_env(tmp_path: Path):
    """Create isolated project, SDK/uploader stubs, ProjectService, Build artifact, and UploadService."""
    data_dir = tmp_path / "app_data"
    app_settings = Settings(DATA_DIR=str(data_dir))
    proj_service = ProjectService(app_settings)
    upload_service = UploadService(app_settings)

    summary = proj_service.create_project(
        type(
            "Req",
            (),
            {
                "name": "aries_uart_flash",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Phase 9 upload test firmware",
                "template": "minimal",
            },
        )()
    )
    project_dir = Path(summary.project_dir)

    sdk_root = tmp_path / "vega-sdk"
    (sdk_root / "examples").mkdir(parents=True)
    tools_dir = sdk_root / "tools"
    tools_dir.mkdir(parents=True)
    tc_root = tmp_path / "vega-tools-rv32"
    (tc_root / "bin").mkdir(parents=True)

    uploader_py = tools_dir / "vega_xmodem.py"
    uploader_py.write_text(
        "import argparse, os, sys\n"
        "p = argparse.ArgumentParser()\n"
        "p.add_argument('--port', required=True)\n"
        "p.add_argument('--file', required=True)\n"
        "args = p.parse_args()\n"
        "print('PORT=' + args.port, flush=True)\n"
        "print('FILE=' + os.path.basename(args.file), flush=True)\n"
        "print('VEGA_BOARD=' + os.environ.get('VEGA_BOARD', ''), flush=True)\n"
        "print('Uploading firmware 50%', flush=True)\n"
        "print('Upload progress 100%', flush=True)\n",
        encoding="utf-8",
    )

    build_dir = project_dir / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    fw_bin = build_dir / "aries_uart_flash.bin"
    fw_bin.write_bytes(b"\x13\x00\x00\x00" * 64)

    upload_service._sdk.update_config(
        SdkConfig(
            sdk_root=str(sdk_root),
            toolchain_root=str(tc_root),
            python_path=sys.executable,
            uploader_script=str(uploader_py),
            target_arch="rv32i_zicsr",
            target_machine="THEJAS32",
            cross_compile_prefix="riscv32-vega-elf",
        )
    )

    app.dependency_overrides[get_project_service] = lambda: proj_service
    app.dependency_overrides[get_upload_service] = lambda: upload_service

    yield {
        "upload_service": upload_service,
        "project_service": proj_service,
        "project_dir": project_dir,
        "sdk_root": sdk_root,
        "tc_root": tc_root,
        "uploader_py": uploader_py,
        "fw_bin": fw_bin,
        "tmp_path": tmp_path,
    }

    upload_service.shutdown()
    app.dependency_overrides.clear()


def _wait_upload_finished(svc: UploadService, upload_id: str, timeout: float = 8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = svc.get_upload_state(upload_id)
        if st.latest_upload and st.latest_upload.status != "running":
            return st
        time.sleep(0.05)
    raise AssertionError(f"Upload {upload_id} did not finish within {timeout}s")


def test_explicit_progress_parser_never_fabricates():
    assert parse_explicit_upload_progress("Uploading XMODEM packet 45%") == 45.0
    assert parse_explicit_upload_progress("Flash complete 100% done") == 100.0
    assert parse_explicit_upload_progress("Initializing serial link...") is None
    assert parse_explicit_upload_progress("Baud rate check OK") is None


def test_upload_preflight_sdk_board_uploader_and_artifacts(
    isolated_upload_env, monkeypatch
):
    ctx = isolated_upload_env
    svc: UploadService = ctx["upload_service"]
    project_dir: Path = ctx["project_dir"]
    fw_bin: Path = ctx["fw_bin"]
    uploader_py: Path = ctx["uploader_py"]
    meta_path = project_dir / "vega-project.json"

    # Mock deterministic device discovery cleanly
    monkeypatch.setattr(
        svc,
        "discover_devices",
        lambda: DeviceListResponse(
            platform_os="linux",
            discovery_method="linux_devfs",
            discovery_supported=True,
            devices=[
                SerialDeviceInfo(
                    port="/dev/serial/by-id/usb-CP2102-port0",
                    display_name="CP2102 USB-UART -> ttyUSB0",
                    stable_path="/dev/serial/by-id/usb-CP2102-port0",
                    accessible=True,
                )
            ],
        ),
    )

    # 1. Clean preflight (single artifact + auto-selected single device + AST verified --port / --file)
    ok_rep = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert ok_rep.ready is True
    assert ok_rep.board_id == "VEGA_ARIES_V3"
    assert ok_rep.command_convention_verified is True
    assert ok_rep.contract_source == "script_ast"
    assert "--port" in ok_rep.command_preview and "--file" in ok_rep.command_preview
    assert ok_rep.selected_artifact is not None
    assert ok_rep.selected_artifact.relative_path == "build/aries_uart_flash.bin"
    assert ok_rep.port_verified_connected is True

    # 2. Ambiguous artifacts require explicit user selection
    fw_elf = fw_bin.with_suffix(".elf")
    fw_elf.write_bytes(b"\x7fELF" + b"\x00" * 60)
    amb_rep = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert amb_rep.ready is False
    assert amb_rep.artifact_ambiguous is True
    assert len(amb_rep.artifacts) == 2

    picked_rep = svc.preflight(
        UploadPreflightRequest(
            project_dir=str(project_dir),
            artifact_path="build/aries_uart_flash.bin",
        )
    )
    assert picked_rep.ready is True
    fw_elf.unlink()

    # 3. Missing artifact sets needs_build and blocks start cleanly
    fw_bin.unlink()
    no_art = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert no_art.ready is False
    assert no_art.needs_build is True
    with pytest.raises(Exception) as no_art_exc:
        svc.start_upload(UploadRequest(project_dir=str(project_dir)))
    assert "artifact" in str(no_art_exc.value).lower()

    # 4. Zero-byte artifact ignored cleanly and invalid explicit selection fails
    fw_bin.write_bytes(b"")
    with pytest.raises(Exception) as empty_exc:
        svc.start_upload(
            UploadRequest(
                project_dir=str(project_dir),
                artifact_path="build/aries_uart_flash.bin",
            )
        )
    assert "empty" in str(empty_exc.value).lower()
    fw_bin.write_bytes(b"\x13\x00\x00\x00" * 64)

    # 5. Stale artifact detection when source is newer
    main_c = project_dir / "src" / "main.c"
    now = time.time()
    os.utime(fw_bin, (now - 120, now - 120))
    os.utime(main_c, (now + 5, now + 5))
    stale_rep = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert stale_rep.selected_artifact is not None
    assert stale_rep.selected_artifact.stale is True
    with pytest.raises(Exception) as stale_exc:
        svc.start_upload(
            UploadRequest(
                project_dir=str(project_dir),
                allow_stale_artifact=False,
            )
        )
    assert "newer" in str(stale_exc.value).lower() or "rebuild" in str(stale_exc.value).lower()

    # 6. Path confinement & traversal checks + symlink outside root blocked
    with pytest.raises(ValueError):
        UploadRequest(project_dir=str(project_dir), artifact_path="../escape.bin")
    with pytest.raises(ValueError):
        UploadRequest(project_dir=str(project_dir), port="COM3;whoami")

    outside_bin = ctx["tmp_path"] / "outside.bin"
    outside_bin.write_bytes(b"BAD" * 10)
    sym_bin = project_dir / "build" / "sym.bin"
    try:
        sym_bin.symlink_to(outside_bin)
        sym_ok = True
    except OSError:
        sym_ok = False
    if sym_ok:
        with pytest.raises(Exception):
            svc.start_upload(
                UploadRequest(
                    project_dir=str(project_dir),
                    artifact_path="build/sym.bin",
                )
            )
        sym_bin.unlink()

    # 7. Missing board or unsupported board flags needs_board_manager
    orig_meta = meta_path.read_text(encoding="utf-8")
    raw = json.loads(orig_meta)
    raw["target"] = {"board": "BAD_BOARD", "arch": "rv32i", "machine": "X"}
    meta_path.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
    bad_board = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert bad_board.ready is False
    assert bad_board.needs_board_manager is True
    meta_path.write_text(orig_meta, encoding="utf-8")

    # 8. Missing uploader dependency & bad Python syntax detected via AST/SDK inspect
    uploader_backup = uploader_py.read_text(encoding="utf-8")
    uploader_py.write_text("import missing_nonexistent_pkg_xyz\n", encoding="utf-8")
    dep_rep = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert dep_rep.ready is False
    assert dep_rep.needs_sdk_doctor is True

    uploader_py.write_text("def broken(:\n", encoding="utf-8")
    syn_rep = svc.preflight(UploadPreflightRequest(project_dir=str(project_dir)))
    assert syn_rep.ready is False
    assert syn_rep.needs_sdk_doctor is True
    uploader_py.write_text(uploader_backup, encoding="utf-8")

    # 9. Disconnected port enforcement when strict_port_check=True
    with pytest.raises(Exception) as disc_exc:
        svc.start_upload(
            UploadRequest(
                project_dir=str(project_dir),
                port="/dev/ttyUSB9",
                strict_port_check=True,
            )
        )
    assert "disconnected" in str(disc_exc.value).lower()


def test_device_discovery_fallback_behavior(isolated_upload_env):
    svc: UploadService = isolated_upload_env["upload_service"]
    res = svc.discover_devices()
    assert res.discovery_supported is True
    assert res.platform_os in ("windows", "linux", "darwin")


def test_mock_upload_execution_progress_failure_and_concurrency(isolated_upload_env):
    ctx = isolated_upload_env
    svc: UploadService = ctx["upload_service"]
    project_dir: Path = ctx["project_dir"]
    uploader_py: Path = ctx["uploader_py"]

    # 1. Successful upload with AST-detected flags + explicit progress
    started = svc.start_upload(
        UploadRequest(project_dir=str(project_dir), port="COM99")
    )
    assert started.status == "running"
    state = _wait_upload_finished(svc, started.build_id if hasattr(started, "build_id") else started.upload_id)
    assert state.latest_upload is not None
    assert state.latest_upload.status == "succeeded"
    assert state.latest_upload.exit_code == 0
    assert state.latest_upload.progress_indeterminate is False
    assert state.latest_upload.progress_percent == 100.0
    joined = "\n".join(l.text for l in state.logs)
    assert "PORT=COM99" in joined
    assert "FILE=aries_uart_flash.bin" in joined
    assert "VEGA_BOARD=VEGA_ARIES_V3" in joined

    # 2. Indeterminate progress when script does NOT emit percentage
    uploader_py.write_text(
        "import sys\n"
        "print('Uploading without percent token:', sys.argv[1:], flush=True)\n",
        encoding="utf-8",
    )
    indet = svc.start_upload(
        UploadRequest(
            project_dir=str(project_dir),
            port="COM99",
            invocation_mode="positional_port_file",
        )
    )
    indet_state = _wait_upload_finished(svc, indet.upload_id)
    assert indet_state.latest_upload.status == "succeeded"
    assert indet_state.latest_upload.progress_indeterminate is True
    assert indet_state.latest_upload.progress_percent is None

    # 3. Failed upload propagates exit code & stderr
    uploader_py.write_text(
        "import sys\n"
        "print('sync failed on serial port', file=sys.stderr, flush=True)\n"
        "sys.exit(3)\n",
        encoding="utf-8",
    )
    failed = svc.start_upload(
        UploadRequest(project_dir=str(project_dir), port="COM99")
    )
    fail_state = _wait_upload_finished(svc, failed.upload_id)
    assert fail_state.latest_upload.status == "failed"
    assert fail_state.latest_upload.exit_code == 3
    assert any(l.stream == "stderr" and "sync failed" in l.text for l in fail_state.logs)


def test_upload_cancellation_concurrency_timeout_and_shutdown(isolated_upload_env):
    ctx = isolated_upload_env
    svc: UploadService = ctx["upload_service"]
    project_dir: Path = ctx["project_dir"]
    uploader_py: Path = ctx["uploader_py"]

    # Script spawns a child Python process too so we exercise process-tree termination
    uploader_py.write_text(
        "import subprocess, sys, time\n"
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
        "print('uploading long stream...', flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )

    u1 = svc.start_upload(UploadRequest(project_dir=str(project_dir), port="COM99"))
    time.sleep(0.25)

    # Concurrent upload rejected cleanly with 409
    with pytest.raises(Exception) as conflict_exc:
        svc.start_upload(UploadRequest(project_dir=str(project_dir), port="COM99"))
    assert getattr(conflict_exc.value, "status_code", None) == 409

    # Cancel active upload -> terminated cleanly
    cancelled = svc.cancel_upload(u1.upload_id)
    assert cancelled.status == "cancelled"
    assert cancelled.cancelled is True

    # Timeout test
    uploader_py.write_text(
        "import time\nprint('waiting for bootloader...', flush=True)\ntime.sleep(30)\n",
        encoding="utf-8",
    )
    u2 = svc.start_upload(
        UploadRequest(
            project_dir=str(project_dir),
            port="COM99",
            timeout_seconds=5,
        )
    )
    timeout_state = _wait_upload_finished(svc, u2.upload_id, timeout=8.5)
    assert timeout_state.latest_upload.status == "timed_out"
    assert timeout_state.latest_upload.timed_out is True

    # Shutdown terminates running upload cleanly
    u3 = svc.start_upload(UploadRequest(project_dir=str(project_dir), port="COM99"))
    time.sleep(0.2)
    svc.shutdown()
    shut_state = _wait_upload_finished(svc, u3.upload_id, timeout=5.0)
    assert shut_state.latest_upload.status in ("cancelled", "failed")


def test_upload_api_routes_websocket_and_disconnect_resilience(isolated_upload_env):
    ctx = isolated_upload_env
    svc: UploadService = ctx["upload_service"]
    project_dir: Path = ctx["project_dir"]
    uploader_py: Path = ctx["uploader_py"]

    uploader_py.write_text(
        "import sys, time\n"
        "print('Uploading block 1: 30%', flush=True)\n"
        "time.sleep(0.1)\n"
        "print('Uploading block 2: 100%', flush=True)\n",
        encoding="utf-8",
    )

    with TestClient(app) as client:
        assert client.get("/api/upload/devices").status_code == 200

        pre = client.post(
            "/api/upload/preflight",
            json={"project_dir": str(project_dir), "port": "COM99"},
        )
        assert pre.status_code == 200
        assert pre.json()["ready"] is True

        res_start = client.post(
            "/api/upload/start",
            json={"project_dir": str(project_dir), "port": "COM99"},
        )
        assert res_start.status_code == 202
        upload_id = res_start.json()["upload_id"]

        events = []
        with client.websocket_connect(f"/api/upload/ws/{upload_id}") as ws:
            while True:
                msg = ws.receive_json()
                events.append(msg)
                if msg["type"] == "completed":
                    break

        assert events[0]["type"] == "snapshot"
        assert any(
            e["type"] == "completed" and e["upload"]["status"] == "succeeded"
            for e in events
        )

        # Disconnect mid-upload does NOT cancel the running process
        uploader_py.write_text(
            "import time\n"
            "print('continuing upload after socket close', flush=True)\n"
            "time.sleep(0.35)\n"
            "print('upload finished 100%', flush=True)\n",
            encoding="utf-8",
        )
        res_second = client.post(
            "/api/upload/start",
            json={"project_dir": str(project_dir), "port": "COM99"},
        )
        assert res_second.status_code == 202
        second_id = res_second.json()["upload_id"]
        with client.websocket_connect(f"/api/upload/ws/{second_id}") as ws:
            snap = ws.receive_json()
            assert snap["type"] == "snapshot"

        finished = _wait_upload_finished(svc, second_id, timeout=5.0)
        assert finished.latest_upload.status == "succeeded"

        hist = client.get("/api/upload/history")
        assert hist.status_code == 200
        assert len(hist.json()["history"]) >= 2

        assert client.post("/api/upload/output/clear").status_code == 200
        res_del = client.delete("/api/upload/history")
        assert res_del.status_code == 200
        assert res_del.json()["history"] == []

        assert client.get("/api/upload/invalid!id").status_code == 400
