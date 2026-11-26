"""Tests for Phase 3 project creation, metadata validation, opening, and workspace state."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import app
from app.routers.projects import get_project_service
from app.services.project_service import ProjectService


@pytest.fixture
def isolated_service(tmp_path: Path) -> ProjectService:
    """Provide a ProjectService backed by an isolated temporary SQLite data dir."""
    data_dir = tmp_path / "app_data"
    test_settings = Settings(DATA_DIR=str(data_dir))
    return ProjectService(test_settings)


@pytest.fixture
def client_with_isolated_workspace(isolated_service: ProjectService):
    app.dependency_overrides[get_project_service] = lambda: isolated_service
    yield isolated_service
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_minimal_project_structure_and_metadata(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    projects_root = tmp_path / "projects"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/projects",
            json={
                "name": "blinky_aries",
                "parent_dir": str(projects_root),
                "description": "ARIES V3 starter project",
                "template": "minimal",
            },
        )

    assert resp.status_code == 201
    data = resp.json()
    project_dir = Path(data["project_dir"])
    assert project_dir == (projects_root / "blinky_aries").resolve()
    assert data["structure_valid"] is True
    assert data["warnings"] == []

    # Verify expected portable project layout
    assert (project_dir / "vega-project.json").is_file()
    assert (project_dir / "src" / "main.c").is_file()
    assert (project_dir / "include" / ".gitkeep").is_file()
    assert (project_dir / "Makefile").is_file()
    assert (project_dir / "README.md").is_file()
    assert (project_dir / ".gitignore").is_file()

    # Verify portable metadata contents (no host-specific paths)
    meta = json.loads((project_dir / "vega-project.json").read_text(encoding="utf-8"))
    assert meta["schemaVersion"] == "1.0"
    assert meta["name"] == "blinky_aries"
    assert meta["target"]["board"] == "VEGA_ARIES_V3"
    assert meta["target"]["arch"] == "rv32i_zicsr"
    assert meta["target"]["machine"] == "THEJAS32"
    assert meta["build"]["sourceDir"] == "src"
    assert meta["build"]["includeDir"] == "include"
    assert meta["build"]["makefile"] == "Makefile"
    assert str(tmp_path) not in json.dumps(meta)


@pytest.mark.asyncio
async def test_create_empty_project_template(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    projects_root = tmp_path / "projects"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/projects",
            json={
                "name": "empty_fw",
                "parent_dir": str(projects_root),
                "template": "empty",
            },
        )

    assert resp.status_code == 201
    project_dir = Path(resp.json()["project_dir"])
    assert (project_dir / "vega-project.json").is_file()
    assert (project_dir / "src" / ".gitkeep").is_file()
    assert (project_dir / "include" / ".gitkeep").is_file()
    assert not (project_dir / "Makefile").exists()


@pytest.mark.asyncio
async def test_create_project_refuses_existing_directory(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    existing = tmp_path / "projects" / "existing_app"
    existing.mkdir(parents=True)
    marker = existing / "keep.txt"
    marker.write_text("do-not-overwrite", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/projects",
            json={
                "name": "existing_app",
                "parent_dir": str(tmp_path / "projects"),
            },
        )

    assert resp.status_code == 409
    assert marker.read_text(encoding="utf-8") == "do-not-overwrite"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_name",
    ["", "   ", "../escape", "a/b", "a\\b", "bad:name", "CON", "nul.txt", "trailing."],
)
async def test_create_project_rejects_unsafe_names(
    bad_name: str,
    tmp_path: Path,
    client_with_isolated_workspace: ProjectService,
):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/projects",
            json={
                "name": bad_name,
                "parent_dir": str(tmp_path),
            },
        )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_project_rejects_path_traversal_and_relative_parent(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r_rel = await client.post(
            "/api/projects",
            json={"name": "valid_name", "parent_dir": "relative/path"},
        )
        r_trav = await client.post(
            "/api/projects",
            json={
                "name": "valid_name",
                "parent_dir": str(tmp_path / ".." / "escape"),
            },
        )

    assert r_rel.status_code == 400
    assert r_trav.status_code == 400


@pytest.mark.asyncio
async def test_open_project_is_readonly_and_handles_invalid_metadata(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    projects_root = tmp_path / "projects"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        create_resp = await client.post(
            "/api/projects",
            json={"name": "uart_demo", "parent_dir": str(projects_root)},
        )
        assert create_resp.status_code == 201
        project_dir = Path(create_resp.json()["project_dir"])
        meta_file = project_dir / "vega-project.json"
        original_meta_text = meta_file.read_text(encoding="utf-8")

        # Close, then re-open
        await client.post("/api/workspace/close")
        open_resp = await client.post(
            "/api/projects/open", json={"project_dir": str(project_dir)}
        )
        assert open_resp.status_code == 200
        assert meta_file.read_text(encoding="utf-8") == original_meta_text

        # Folder without vega-project.json opens cleanly as an external workspace without mutating disk files
        no_meta_dir = tmp_path / "external_firmware_repo"
        no_meta_dir.mkdir()
        (no_meta_dir / "Makefile").write_text("all:\n\t@echo ok\n", encoding="utf-8")
        (no_meta_dir / "main.c").write_text("int main(void) { return 0; }\n", encoding="utf-8")
        r_ext = await client.post(
            "/api/projects/open", json={"project_dir": str(no_meta_dir)}
        )
        assert r_ext.status_code == 200
        ext_data = r_ext.json()
        assert ext_data["has_metadata"] is False
        assert ext_data["project"]["name"] == "external_firmware_repo"
        assert ext_data["project"]["build"]["sourceDir"] == "."
        assert "Makefile" in ext_data["detected_indicators"]
        assert "C/RISC-V sources" in ext_data["detected_indicators"]
        assert not (no_meta_dir / "vega-project.json").exists()

        # Malformed JSON metadata
        malformed_dir = tmp_path / "malformed"
        malformed_dir.mkdir()
        (malformed_dir / "vega-project.json").write_text("{bad json", encoding="utf-8")
        r_bad_json = await client.post(
            "/api/projects/open", json={"project_dir": str(malformed_dir)}
        )
        assert r_bad_json.status_code == 422

        # Non-existent directory
        r_not_found = await client.post(
            "/api/projects/open",
            json={"project_dir": str(tmp_path / "does_not_exist")},
        )
        assert r_not_found.status_code == 404

        # File path instead of directory
        plain_file = tmp_path / "plain_file.txt"
        plain_file.write_text("hello", encoding="utf-8")
        r_file = await client.post(
            "/api/projects/open", json={"project_dir": str(plain_file)}
        )
        assert r_file.status_code == 400

        # Traversal inside build.sourceDir in vega-project.json
        bad_build_dir = tmp_path / "bad_build_path"
        bad_build_dir.mkdir()
        (bad_build_dir / "vega-project.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0",
                    "name": "bad_build",
                    "build": {"sourceDir": "../outside"},
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                }
            ),
            encoding="utf-8",
        )
        r_bad_build = await client.post(
            "/api/projects/open", json={"project_dir": str(bad_build_dir)}
        )
        assert r_bad_build.status_code == 422

        # Unsupported schemaVersion
        unsupported_dir = tmp_path / "future_schema"
        unsupported_dir.mkdir()
        (unsupported_dir / "vega-project.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "2.0",
                    "name": "future",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                }
            ),
            encoding="utf-8",
        )
        r_future = await client.post(
            "/api/projects/open", json={"project_dir": str(unsupported_dir)}
        )
        assert r_future.status_code == 422


@pytest.mark.asyncio
async def test_workspace_restoration_switching_and_missing_recovery(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    projects_root = tmp_path / "projects"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r1 = await client.post(
            "/api/projects",
            json={"name": "proj_one", "parent_dir": str(projects_root)},
        )
        r2 = await client.post(
            "/api/projects",
            json={"name": "proj_two", "parent_dir": str(projects_root)},
        )
        assert r1.status_code == 201 and r2.status_code == 201

        ws = await client.get("/api/workspace")
        assert ws.status_code == 200
        ws_data = ws.json()
        assert ws_data["active_project"]["project"]["name"] == "proj_two"
        assert [p["name"] for p in ws_data["recent_projects"]] == [
            "proj_two",
            "proj_one",
        ]

        # Switch back to proj_one
        r_switch = await client.post(
            "/api/projects/open",
            json={"project_dir": r1.json()["project_dir"]},
        )
        assert r_switch.status_code == 200
        assert r_switch.json()["project"]["name"] == "proj_one"

        # Simulate external deletion of active project -> graceful recovery
        import shutil

        shutil.rmtree(r1.json()["project_dir"])
        ws_after_delete = await client.get("/api/workspace")
        assert ws_after_delete.status_code == 200
        recovered = ws_after_delete.json()
        assert recovered["active_project"] is None
        assert recovered["warning"] is not None

        # Recent entry should reflect exists=False
        by_name = {p["name"]: p for p in recovered["recent_projects"]}
        assert by_name["proj_one"]["exists"] is False
        assert by_name["proj_two"]["exists"] is True

        # Close workspace explicitly
        r_close = await client.post("/api/workspace/close")
        assert r_close.status_code == 200
        assert r_close.json()["active_project"] is None


@pytest.mark.asyncio
async def test_external_projects_with_spaces_explorer_build_and_default_dir_config(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    from app.config import Settings
    from app.services.board_service import BoardService
    from app.services.build_service import BuildService
    from app.services.explorer_service import ExplorerService
    from app.services.sdk_service import SdkService
    from app.models.build import BuildRequest
    import os
    import sys
    import time

    # 1. Configurable default_projects_dir via API + persistence across workspace state reads
    custom_default = tmp_path / "Custom Workspace Root"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r_cfg = await client.put(
            "/api/workspace/config",
            json={"default_projects_dir": str(custom_default)},
        )
        assert r_cfg.status_code == 200
        assert Path(r_cfg.json()["default_projects_dir"]) == custom_default.resolve()
        assert custom_default.is_dir()

        # 2. Open external project outside default dir with spaces & no vega-project.json
        ext_proj = tmp_path / "Elsewhere SDK Projects" / "Servo Demo Project"
        ext_proj.mkdir(parents=True)
        (ext_proj / "main.c").write_text("int main(void) { return 0; }\n", encoding="utf-8")

        # Separate independent SDK/toolchain fake executables so BuildService runs anywhere
        sdk_root = tmp_path / "Separate VEGA SDK"
        tools_bin = tmp_path / "Separate Tools" / "bin"
        tools_bin.mkdir(parents=True)
        sdk_root.mkdir()
        fake_compiler = tools_bin / "riscv32-vega-elf-gcc"
        fake_compiler.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        fake_make = tools_bin / "make"
        fake_make.write_text(
            f"#!{sys.executable}\nimport os, pathlib, sys\nprint('BUILD_CWD=' + os.getcwd())\n",
            encoding="utf-8",
        )
        os.chmod(fake_compiler, 0o755)
        os.chmod(fake_make, 0o755)

        (ext_proj / "Makefile").write_text("all:\n\t@echo building\n", encoding="utf-8")

        r_open = await client.post(
            "/api/projects/open", json={"project_dir": str(ext_proj)}
        )
        assert r_open.status_code == 200
        assert r_open.json()["has_metadata"] is False
        assert Path(r_open.json()["project_dir"]) == ext_proj.resolve()
        assert not (ext_proj / "vega-project.json").exists()

        # Recent list keeps exists=True even without vega-project.json
        r_ws = await client.get("/api/workspace")
        assert r_ws.status_code == 200
        recents = r_ws.json()["recent_projects"]
        assert len(recents) == 1
        assert recents[0]["exists"] is True
        assert recents[0]["schema_version"] == "external"

        # 3. Reset default_projects_dir back to OS default cleanly
        r_reset = await client.put(
            "/api/workspace/config",
            json={"default_projects_dir": None},
        )
        assert r_reset.status_code == 200
        assert Path(r_reset.json()["default_projects_dir"]) != custom_default.resolve()

    # 4. Explorer, BoardManager local preference, and BuildService work directly in external folder
    app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
    explorer = ExplorerService(app_settings)
    tree = explorer.list_directory(str(ext_proj), "")
    assert [e.name for e in tree.entries] == ["main.c", "Makefile"]

    board_svc = BoardService(app_settings)
    selected = board_svc.select_project_board(str(ext_proj), "VEGA_ARIES_V3")
    assert selected.ok is True
    assert not (ext_proj / "vega-project.json").exists()

    sdk_svc = SdkService(app_settings)
    cfg = sdk_svc.get_config_state().config
    sdk_svc.update_config(
        cfg.model_copy(
            update={
                "sdk_root": str(sdk_root),
                "toolchain_root": str(tools_bin.parent),
                "compiler_path": str(fake_compiler),
                "make_path": str(fake_make),
                "cross_compile_prefix": "riscv32-vega-elf",
                "target_arch": "rv32i_zicsr",
                "target_machine": "THEJAS32",
            }
        )
    )

    build_svc = BuildService(app_settings)
    started = build_svc.start_build(
        BuildRequest(project_dir=str(ext_proj), operation="build")
    )
    deadline = time.monotonic() + 5.0
    state = build_svc.get_build_state(started.build_id)
    while state.latest_build and state.latest_build.status in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.05)
        state = build_svc.get_build_state(started.build_id)
    assert state.latest_build is not None
    assert state.latest_build.status == "succeeded"
    assert any(str(ext_proj.resolve()) in line.text for line in state.logs)


@pytest.mark.asyncio
async def test_arbitrary_plain_folder_explorer_and_switching_without_artifacts(
    tmp_path: Path, client_with_isolated_workspace: ProjectService
):
    plain_a = tmp_path / "Arbitrary Folder A"
    (plain_a / "notes" / "deep").mkdir(parents=True)
    (plain_a / "README.txt").write_text("hello plain workspace", encoding="utf-8")
    (plain_a / ".env").write_text("MODE=dev\n", encoding="utf-8")
    (plain_a / "notes" / "deep" / "todo.md").write_text("- item 1\n", encoding="utf-8")

    plain_b = tmp_path / "Second Workspace"
    plain_b.mkdir()
    (plain_b / "config.yaml").write_text("key: value\n", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r_a = await client.post("/api/projects/open", json={"project_dir": str(plain_a)})
        assert r_a.status_code == 200
        data_a = r_a.json()
        assert data_a["project"]["name"] == "Arbitrary Folder A"
        assert data_a["warnings"] == []
        assert data_a["has_metadata"] is False
        assert not (plain_a / "vega-project.json").exists()
        assert not (plain_a / "src").exists()
        assert not (plain_a / "include").exists()

        # Root, hidden file, nested subfolder, and file read work
        tree_root = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(plain_a), "path": "", "show_hidden": "true"},
        )
        assert tree_root.status_code == 200
        assert [e["name"] for e in tree_root.json()["entries"]] == [
            "notes",
            ".env",
            "README.txt",
        ]

        tree_nested = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(plain_a), "path": "notes/deep"},
        )
        assert tree_nested.status_code == 200
        assert [e["path"] for e in tree_nested.json()["entries"]] == [
            "notes/deep/todo.md"
        ]

        read_todo = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(plain_a), "path": "notes/deep/todo.md"},
        )
        assert read_todo.status_code == 200
        assert read_todo.json()["content"] == "- item 1\n"

        # Switch to second plain folder -> active project updates cleanly
        r_b = await client.post("/api/projects/open", json={"project_dir": str(plain_b)})
        assert r_b.status_code == 200
        assert r_b.json()["project"]["name"] == "Second Workspace"
        tree_b = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(plain_b), "path": ""},
        )
        assert tree_b.status_code == 200
        assert [e["name"] for e in tree_b.json()["entries"]] == ["config.yaml"]
