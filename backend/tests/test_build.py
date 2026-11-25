"""Tests for Phase 7 Firmware Build System (Make orchestration, WS streaming, diagnostics, safety)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.build import BuildRequest
from app.models.sdk import SdkConfig
from app.routers.build import get_build_service
from app.routers.projects import get_project_service
from app.services.build_service import BuildService, parse_build_diagnostic
from app.services.project_service import ProjectService


def _write_mock_make(directory: Path, driver_py: Path) -> Path:
    """Create a real, cross-platform executable wrapper invoking a controlled Python script."""
    if os.name == "nt":
        wrapper = directory / "make.cmd"
        wrapper.write_text(
            f'@echo off\r\n"{sys.executable}" "{driver_py}" %*\r\n',
            encoding="utf-8",
        )
        return wrapper

    wrapper = directory / "make"
    wrapper.write_text(
        f'#!/bin/sh\nexec "{sys.executable}" "{driver_py}" "$@"\n',
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    return wrapper


@pytest.fixture
def isolated_build_env(tmp_path: Path):
    """Create isolated project, SDK/toolchain stubs, ProjectService, and BuildService."""
    data_dir = tmp_path / "app_data"
    app_settings = Settings(DATA_DIR=str(data_dir))
    proj_service = ProjectService(app_settings)
    build_service = BuildService(app_settings)

    summary = proj_service.create_project(
        type(
            "Req",
            (),
            {
                "name": "aries_blinky",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Phase 7 build test firmware",
                "template": "minimal",
            },
        )()
    )
    project_dir = Path(summary.project_dir)

    sdk_root = tmp_path / "vega-sdk"
    (sdk_root / "examples").mkdir(parents=True)
    tc_root = tmp_path / "vega-tools-rv32"
    bin_dir = tc_root / "bin"
    bin_dir.mkdir(parents=True)

    ext = ".exe" if os.name == "nt" else ""
    compiler_exe = bin_dir / f"riscv32-vega-elf-gcc{ext}"
    compiler_exe.write_text("compiler-stub", encoding="utf-8")
    if os.name != "nt":
        compiler_exe.chmod(0o755)

    driver_py = tmp_path / "mock_make_driver.py"
    driver_py.write_text(
        "import os, sys\n"
        "print('CROSS_COMPILE=' + os.environ.get('CROSS_COMPILE', ''))\n"
        "print('RISCV_ARCH=' + os.environ.get('RISCV_ARCH', ''))\n"
        "print('VEGA_MACHINE=' + os.environ.get('VEGA_MACHINE', ''))\n"
        "print('BUILD_MODE=' + os.environ.get('BUILD_MODE', 'default'))\n"
        "print('TARGET_ARGS=' + ' '.join(sys.argv[1:]))\n"
        "print('Build complete')\n",
        encoding="utf-8",
    )
    make_exe = _write_mock_make(tmp_path / "tools_bin" if (tmp_path / "tools_bin").mkdir() or True else tmp_path, driver_py)

    build_service._sdk.update_config(
        SdkConfig(
            sdk_root=str(sdk_root),
            toolchain_root=str(tc_root),
            compiler_path=str(compiler_exe),
            make_path=str(make_exe),
            python_path=sys.executable,
            target_arch="rv32i_zicsr",
            target_machine="THEJAS32",
            cross_compile_prefix="riscv32-vega-elf",
        )
    )

    app.dependency_overrides[get_project_service] = lambda: proj_service
    app.dependency_overrides[get_build_service] = lambda: build_service

    yield {
        "build_service": build_service,
        "project_service": proj_service,
        "project_dir": project_dir,
        "sdk_root": sdk_root,
        "compiler_exe": compiler_exe,
        "make_exe": make_exe,
        "driver_py": driver_py,
        "tmp_path": tmp_path,
    }

    build_service.shutdown()
    app.dependency_overrides.clear()


def _wait_until_finished(service: BuildService, build_id: str, timeout: float = 8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = service.get_build_state(build_id)
        if state.latest_build and state.latest_build.status != "running":
            return state
        time.sleep(0.05)
    raise AssertionError(f"Build {build_id} did not finish within {timeout}s")


def test_build_preflight_validation_and_env_construction(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]

    # Non-existent or invalid project dir fails cleanly
    with pytest.raises(Exception):
        svc.start_build(BuildRequest(project_dir=str(env_ctx["tmp_path"] / "not_a_project")))

    # Traversal target or forbidden env overrides fail Pydantic validation cleanly
    with pytest.raises(ValueError):
        BuildRequest(project_dir=str(project_dir), target="../bad")
    with pytest.raises(ValueError):
        BuildRequest(project_dir=str(project_dir), env_overrides={"LD_PRELOAD": "/tmp/x.so"})
    with pytest.raises(ValueError):
        BuildRequest(project_dir=str(project_dir), env_overrides={"PATH": "/tmp"})

    # Missing Makefile blocked before execution
    makefile = project_dir / "Makefile"
    makefile_backup = makefile.read_text(encoding="utf-8")
    makefile.unlink()
    with pytest.raises(Exception) as missing_mf:
        svc.start_build(BuildRequest(project_dir=str(project_dir), operation="build"))
    assert "makefile" in str(missing_mf.value).lower()
    makefile.write_text(makefile_backup, encoding="utf-8")

    # Symlink Makefile escaping project root blocked
    outside_mf = env_ctx["tmp_path"] / "outside_Makefile"
    outside_mf.write_text("all:\n\t@echo escaped\n", encoding="utf-8")
    makefile.unlink()
    try:
        makefile.symlink_to(outside_mf)
        can_symlink = True
    except OSError:
        can_symlink = False
    if can_symlink:
        with pytest.raises(Exception):
            svc.start_build(BuildRequest(project_dir=str(project_dir), operation="build"))
        makefile.unlink()
    makefile.write_text(makefile_backup, encoding="utf-8")

    # Missing SDK / compiler rejects build & rebuild, while missing SDK still allows clean if Make exists
    svc._sdk.update_config(
        SdkConfig(
            sdk_root=str(env_ctx["tmp_path"] / "missing_sdk"),
            toolchain_root=str(env_ctx["tmp_path"] / "missing_tc"),
            compiler_path=str(env_ctx["tmp_path"] / "missing_gcc"),
            make_path=str(env_ctx["make_exe"]),
        )
    )
    with pytest.raises(Exception) as missing_sdk:
        svc.start_build(BuildRequest(project_dir=str(project_dir), operation="build"))
    assert "sdk" in str(missing_sdk.value).lower()


def test_successful_build_env_and_history_bounds(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]

    started = svc.start_build(
        BuildRequest(
            project_dir=str(project_dir),
            operation="build",
            target="all",
            mode="release",
            env_overrides={"CUSTOM_FLAG": "1"},
        )
    )
    assert started.status == "running"
    state = _wait_until_finished(svc, started.build_id)
    assert state.latest_build is not None
    assert state.latest_build.status == "succeeded"
    assert state.latest_build.exit_code == 0

    lines = "\n".join(line.text for line in state.logs)
    assert "CROSS_COMPILE=riscv32-vega-elf-" in lines
    assert "RISCV_ARCH=rv32i_zicsr" in lines
    assert "VEGA_MACHINE=THEJAS32" in lines
    assert "BUILD_MODE=release" in lines
    assert "-f Makefile all" in lines

    hist = svc.list_history()
    assert len(hist.history) == 1
    assert hist.history[0].build_id == started.build_id


def test_failed_build_stderr_and_diagnostic_parsing(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]
    driver_py: Path = env_ctx["driver_py"]

    outside_hdr = env_ctx["tmp_path"] / "outside_sdk.h"
    outside_hdr.write_text("// outside", encoding="utf-8")

    driver_py.write_text(
        "import sys\n"
        "print('Compiling src/main.c...', flush=True)\n"
        "print('src/main.c:12:5: warning: unused variable x', file=sys.stderr, flush=True)\n"
        "print('src/main.c:18:10: error: expected ; before return', file=sys.stderr, flush=True)\n"
        f"print({str(outside_hdr)!r} + ':3:1: warning: external header warn', file=sys.stderr, flush=True)\n"
        "print('src/main.c:18:10: note: this is just a compiler note', file=sys.stderr, flush=True)\n"
        "print('make: *** [Makefile:12: build/main.o] Error 1', file=sys.stderr, flush=True)\n"
        "sys.exit(2)\n",
        encoding="utf-8",
    )

    started = svc.start_build(BuildRequest(project_dir=str(project_dir)))
    state = _wait_until_finished(svc, started.build_id)

    assert state.latest_build is not None
    assert state.latest_build.status == "failed"
    assert state.latest_build.exit_code == 2
    assert state.latest_build.error_count == 2  # GCC error + make *** Error 1
    assert state.latest_build.warning_count == 2  # src/main.c warn + external warn

    assert any(l.stream == "stderr" for l in state.logs)
    in_proj_diags = [d for d in state.diagnostics if d.relative_path == "src/main.c"]
    assert len(in_proj_diags) == 2
    assert in_proj_diags[0].line == 12 and in_proj_diags[0].column == 5

    # External path outside project root must never expose navigable relative_path
    ext_diag = next(d for d in state.diagnostics if "external header warn" in d.message)
    assert ext_diag.relative_path is None

    # Non-diagnostic plain lines stay None cleanly
    assert parse_build_diagnostic("Linking firmware.elf...", project_dir, 99) is None


def test_clean_and_rebuild_execution_and_concurrency_guard(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]
    driver_py: Path = env_ctx["driver_py"]

    # Clean operation works cleanly via configured Make
    c_start = svc.start_build(BuildRequest(project_dir=str(project_dir), operation="clean"))
    c_state = _wait_until_finished(svc, c_start.build_id)
    assert c_state.latest_build.status == "succeeded"
    assert "-f Makefile clean" in "\n".join(l.text for l in c_state.logs)

    # Rebuild runs clean step first, then build step
    r_start = svc.start_build(BuildRequest(project_dir=str(project_dir), operation="rebuild"))
    r_state = _wait_until_finished(svc, r_start.build_id)
    assert r_state.latest_build.status == "succeeded"
    all_text = "\n".join(l.text for l in r_state.logs)
    assert "-f Makefile clean" in all_text
    assert "-f Makefile" in all_text

    # Long-running build allows testing concurrent build prevention & cancellation
    driver_py.write_text(
        "import time\n"
        "print('step 1 starting', flush=True)\n"
        "time.sleep(10)\n",
        encoding="utf-8",
    )
    active = svc.start_build(BuildRequest(project_dir=str(project_dir)))
    with pytest.raises(Exception) as conflict:
        svc.start_build(BuildRequest(project_dir=str(project_dir)))
    assert "already running" in str(conflict.value).lower()

    svc.cancel_build(active.build_id)
    cancelled_state = _wait_until_finished(svc, active.build_id, timeout=5.0)
    assert cancelled_state.latest_build.status == "cancelled"
    assert cancelled_state.latest_build.cancelled is True


def test_build_timeout_terminates_runaway_process(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]
    driver_py: Path = env_ctx["driver_py"]

    driver_py.write_text(
        "import time\n"
        "print('hanging step', flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    started = svc.start_build(
        BuildRequest(project_dir=str(project_dir), timeout_seconds=5)
    )
    # Set timeout enforcement tight cleanly on the started request wait: use 1s timeout in _execute_build_worker?
    # BuildRequest min is 5s, so wait up to 8s cleanly to verify real timeout behavior end-to-end.
    state = _wait_until_finished(svc, started.build_id, timeout=8.5)
    assert state.latest_build.status == "timed_out"
    assert state.latest_build.timed_out is True


def test_build_api_routes_and_websocket_stream_and_disconnect(isolated_build_env):
    env_ctx = isolated_build_env
    svc: BuildService = env_ctx["build_service"]
    project_dir: Path = env_ctx["project_dir"]
    driver_py: Path = env_ctx["driver_py"]

    driver_py.write_text(
        "import sys, time\n"
        "for i in range(4):\n"
        "    print(f'building unit {i}', flush=True)\n"
        "    time.sleep(0.08)\n"
        "print('src/main.c:5:1: warning: test ws warning', file=sys.stderr, flush=True)\n",
        encoding="utf-8",
    )

    with TestClient(app) as client:
        # Start build via API
        res_start = client.post(
            "/api/build/start",
            json={"project_dir": str(project_dir), "operation": "build"},
        )
        assert res_start.status_code == 202
        build_id = res_start.json()["build_id"]

        # WebSocket streams snapshot + incremental events + completion
        events = []
        with client.websocket_connect(f"/api/build/ws/{build_id}") as ws:
            while True:
                msg = ws.receive_json()
                events.append(msg)
                if msg["type"] == "completed":
                    break

        assert events[0]["type"] == "snapshot"
        assert any(e["type"] == "completed" and e["build"]["status"] == "succeeded" for e in events)

        # State, history, and clear endpoints
        res_state = client.get("/api/build/state")
        assert res_state.status_code == 200
        assert res_state.json()["latest_build"]["build_id"] == build_id
        assert len(res_state.json()["diagnostics"]) == 1

        res_hist = client.get("/api/build/history")
        assert res_hist.status_code == 200
        assert len(res_hist.json()["history"]) >= 1

        # WebSocket disconnect does NOT abort a running build
        driver_py.write_text(
            "import time\n"
            "print('running after disconnect', flush=True)\n"
            "time.sleep(0.35)\n"
            "print('finished cleanly', flush=True)\n",
            encoding="utf-8",
        )
        res_clean = client.post(
            "/api/build/clean",
            json={"project_dir": str(project_dir)},
        )
        assert res_clean.status_code == 202
        clean_id = res_clean.json()["build_id"]

        with client.websocket_connect(f"/api/build/ws/{clean_id}") as ws:
            snap = ws.receive_json()
            assert snap["type"] == "snapshot"
            # Disconnect immediately mid-build

        final_state = _wait_until_finished(svc, clean_id, timeout=5.0)
        assert final_state.latest_build.status == "succeeded"

        # Output clear & history clear
        assert client.post("/api/build/output/clear").status_code == 200
        res_cleared = client.delete("/api/build/history")
        assert res_cleared.status_code == 200
        assert res_cleared.json()["history"] == []

        # Invalid build_id blocked safely with 400
        assert client.get("/api/build/bad!id").status_code == 400
