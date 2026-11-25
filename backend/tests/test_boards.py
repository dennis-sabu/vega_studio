"""Tests for Phase 8 Board Manager (registry, selection persistence, compatibility, API)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.sdk import SdkConfig
from app.routers.boards import get_board_service
from app.routers.projects import get_project_service
from app.routers.sdk import get_sdk_service
from app.services.board_service import BoardService, BoardServiceError
from app.services.project_service import ProjectService
from app.services.sdk_service import SdkService


@pytest.fixture
def isolated_board_env(tmp_path: Path):
    """Create isolated BoardService, ProjectService, SdkService, and TestClient overrides."""
    data_dir = tmp_path / "app_data"
    app_settings = Settings(DATA_DIR=str(data_dir))

    proj_service = ProjectService(app_settings)
    sdk_service = SdkService(app_settings)
    board_service = BoardService(app_settings)

    summary = proj_service.create_project(
        type(
            "Req",
            (),
            {
                "name": "aries_board_demo",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Board manager test firmware",
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

    sdk_service.update_config(
        SdkConfig(
            sdk_root=str(sdk_root),
            toolchain_root=str(tc_root),
            compiler_path=str(compiler_exe),
            python_path=sys.executable,
            target_arch="rv32i_zicsr",
            target_machine="THEJAS32",
            cross_compile_prefix="riscv32-vega-elf",
        )
    )

    app.dependency_overrides[get_project_service] = lambda: proj_service
    app.dependency_overrides[get_sdk_service] = lambda: sdk_service
    app.dependency_overrides[get_board_service] = lambda: board_service

    yield {
        "board_service": board_service,
        "project_service": proj_service,
        "sdk_service": sdk_service,
        "project_dir": project_dir,
        "sdk_root": sdk_root,
        "tc_root": tc_root,
        "compiler_exe": compiler_exe,
        "tmp_path": tmp_path,
    }

    app.dependency_overrides.clear()


def test_board_registry_contains_verified_aries_v3(isolated_board_env):
    svc: BoardService = isolated_board_env["board_service"]
    listing = svc.list_boards()
    assert len(listing.boards) >= 1

    aries = svc.get_board_or_raise("VEGA_ARIES_V3")
    assert aries.name == "VEGA ARIES V3"
    assert aries.vendor == "C-DAC"
    assert aries.status == "supported"
    assert aries.architecture == "RISC-V 32-bit"
    assert aries.core == "VEGA ET1031"
    assert aries.cpu_frequency_mhz == 100
    assert aries.isa == "rv32i_zicsr"
    assert aries.machine == "THEJAS32"
    assert aries.sram_kb == 256
    assert aries.sensors == ["MPU6050 IMU", "BMP280 Barometer"]
    assert aries.build.cross_compile_prefix == "riscv32-vega-elf"


def test_board_lookup_rejects_invalid_and_unknown_ids(isolated_board_env):
    svc: BoardService = isolated_board_env["board_service"]

    with pytest.raises(BoardServiceError) as invalid_exc:
        svc.get_board_or_raise("../etc/passwd")
    assert invalid_exc.value.status_code == 400

    with pytest.raises(BoardServiceError) as space_exc:
        svc.get_board_or_raise("VEGA ARIES")
    assert space_exc.value.status_code == 400

    with pytest.raises(BoardServiceError) as missing_exc:
        svc.get_board_or_raise("UNKNOWN_VEGA_BOARD")
    assert missing_exc.value.status_code == 404


def test_sdk_compatibility_detection(isolated_board_env):
    svc: BoardService = isolated_board_env["board_service"]
    sdk_svc: SdkService = isolated_board_env["sdk_service"]
    aries = svc.get_board_or_raise("VEGA_ARIES_V3")

    # Clean match
    report_ok = svc.validate_compatibility(aries)
    assert report_ok.status == "compatible"
    assert report_ok.compatible is True
    assert report_ok.issues == []

    # Architecture & prefix mismatch detected clearly
    sdk_svc.update_config(
        SdkConfig(
            sdk_root=str(isolated_board_env["sdk_root"]),
            toolchain_root=str(isolated_board_env["tc_root"]),
            compiler_path=str(isolated_board_env["compiler_exe"]),
            target_arch="rv64imac",
            target_machine="OTHER_SOC",
            cross_compile_prefix="riscv64-unknown-elf",
        )
    )
    report_bad = svc.validate_compatibility(aries)
    assert report_bad.status == "incompatible"
    assert report_bad.compatible is False
    assert len(report_bad.issues) >= 3


def test_legacy_and_unknown_board_project_handling_without_silent_mutation(
    isolated_board_env,
):
    proj_svc: ProjectService = isolated_board_env["project_service"]
    board_svc: BoardService = isolated_board_env["board_service"]
    project_dir: Path = isolated_board_env["project_dir"]
    meta_path = project_dir / "vega-project.json"

    # Legacy project missing `target` entirely -> board is None (not silently defaulted)
    raw = json.loads(meta_path.read_text(encoding="utf-8"))
    raw.pop("target", None)
    legacy_text = json.dumps(raw, indent=2) + "\n"
    meta_path.write_text(legacy_text, encoding="utf-8")

    opened_legacy = proj_svc.open_project(str(project_dir))
    assert opened_legacy.project.target.board is None
    assert any("no target board selected" in w.lower() for w in opened_legacy.warnings)
    # File on disk remains untouched when opening
    assert meta_path.read_text(encoding="utf-8") == legacy_text

    status_legacy = board_svc.get_project_board_status(str(project_dir))
    assert status_legacy.selected_board_id is None
    assert status_legacy.board_supported is False
    assert status_legacy.board is None

    # Assign verified board safely -> persisted and readable after reopen
    main_c = project_dir / "src" / "main.c"
    main_c_before = main_c.read_text(encoding="utf-8")
    selected = board_svc.select_project_board(str(project_dir), "VEGA_ARIES_V3")
    assert selected.ok is True
    assert selected.workspace.project.target.board == "VEGA_ARIES_V3"
    assert selected.workspace.project.target.arch == "rv32i_zicsr"
    assert selected.workspace.project.target.machine == "THEJAS32"
    assert main_c.read_text(encoding="utf-8") == main_c_before

    reopened = proj_svc.open_project(str(project_dir))
    assert reopened.project.target.board == "VEGA_ARIES_V3"

    # Unknown board in vega-project.json surfaces warning gracefully without crashing
    updated_raw = json.loads(meta_path.read_text(encoding="utf-8"))
    updated_raw["target"] = {
        "board": "FUTURE_BOARD_X",
        "arch": "rv32imac",
        "machine": "CUSTOM",
    }
    meta_path.write_text(json.dumps(updated_raw, indent=2) + "\n", encoding="utf-8")

    status_unknown = board_svc.get_project_board_status(str(project_dir))
    assert status_unknown.selected_board_id == "FUTURE_BOARD_X"
    assert status_unknown.board_supported is False
    assert status_unknown.board is None
    assert any("unrecognized" in w.lower() or "unsupported" in w.lower() for w in status_unknown.warnings)


def test_board_api_endpoints(isolated_board_env):
    project_dir: Path = isolated_board_env["project_dir"]

    with TestClient(app) as client:
        res_list = client.get("/api/boards")
        assert res_list.status_code == 200
        boards = res_list.json()["boards"]
        assert any(b["id"] == "VEGA_ARIES_V3" for b in boards)

        res_detail = client.get("/api/boards/VEGA_ARIES_V3")
        assert res_detail.status_code == 200
        assert res_detail.json()["core"] == "VEGA ET1031"

        assert client.get("/api/boards/NONEXISTENT_BOARD").status_code == 404

        res_compat = client.post(
            "/api/boards/compatibility",
            json={"board_id": "VEGA_ARIES_V3"},
        )
        assert res_compat.status_code == 200
        assert res_compat.json()["compatible"] is True

        res_status = client.get(
            "/api/boards/project/status",
            params={"project_dir": str(project_dir)},
        )
        assert res_status.status_code == 200
        assert res_status.json()["selected_board_id"] == "VEGA_ARIES_V3"
        assert res_status.json()["board_supported"] is True

        res_select = client.post(
            "/api/boards/project/select",
            json={
                "project_dir": str(project_dir),
                "board_id": "VEGA_ARIES_V3",
            },
        )
        assert res_select.status_code == 200
        assert res_select.json()["ok"] is True
        assert res_select.json()["board_status"]["selected_board_id"] == "VEGA_ARIES_V3"
