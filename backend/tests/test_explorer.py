"""Tests for Phase 4 File Explorer listing, mutations, and filesystem safety."""
from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import app
from app.routers.projects import get_project_service
from app.services.project_service import ProjectService


@pytest.fixture
async def project_workspace(tmp_path: Path):
    """Create an isolated VEGA Studio project and return (client_app, project_dir, tmp_path)."""
    data_dir = tmp_path / "app_data"
    service = ProjectService(Settings(DATA_DIR=str(data_dir)))
    app.dependency_overrides[get_project_service] = lambda: service

    summary = service.create_project(
        type(
            "Req",
            (),
            {
                "name": "explorer_proj",
                "parent_dir": str(tmp_path / "projects"),
                "description": "Explorer test project",
                "template": "minimal",
            },
        )()
    )
    yield Path(summary.project_dir), tmp_path
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_directory_hierarchy_and_internal_filtering(
    project_workspace: tuple[Path, Path],
):
    project_dir, _ = project_workspace
    # Simulate an internal IDE directory that must never appear in project explorer
    (project_dir / ".vega-studio").mkdir()
    (project_dir / ".vega-studio" / "secret.db").write_text("internal", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        root_resp = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": "", "show_hidden": "true"},
        )
        assert root_resp.status_code == 200
        root_data = root_resp.json()
        names = [e["name"] for e in root_data["entries"]]
        assert ".vega-studio" not in names
        assert ".gitignore" in names
        assert "src" in names
        assert "include" in names
        assert "vega-project.json" in names

        # Directories sorted before files
        kinds = [e["kind"] for e in root_data["entries"]]
        assert kinds[:2] == ["dir", "dir"]

        # Hide dotfiles when show_hidden=false
        no_hidden = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": "", "show_hidden": "false"},
        )
        assert ".gitignore" not in [e["name"] for e in no_hidden.json()["entries"]]

        # Nested listing inside src
        src_resp = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": "src"},
        )
        assert src_resp.status_code == 200
        assert [e["path"] for e in src_resp.json()["entries"]] == ["src/main.c"]


@pytest.mark.asyncio
async def test_large_directory_is_capped_cleanly(
    project_workspace: tuple[Path, Path],
):
    project_dir, _ = project_workspace
    bulk_dir = project_dir / "bulk"
    bulk_dir.mkdir()
    for i in range(520):
        (bulk_dir / f"item_{i:03d}.c").write_text("", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": "bulk"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is True
    assert data["total_count"] == 520
    assert len(data["entries"]) == 500


@pytest.mark.asyncio
async def test_create_rename_delete_file_and_folder_lifecycle(
    project_workspace: tuple[Path, Path],
):
    project_dir, _ = project_workspace
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Create folder inside src
        c_dir = await client.post(
            "/api/explorer/create",
            json={
                "project_dir": str(project_dir),
                "parent_path": "src",
                "name": "drivers",
                "kind": "dir",
            },
        )
        assert c_dir.status_code == 201
        assert c_dir.json()["relative_path"] == "src/drivers"
        assert (project_dir / "src" / "drivers").is_dir()

        # Create empty file inside src/drivers
        c_file = await client.post(
            "/api/explorer/create",
            json={
                "project_dir": str(project_dir),
                "parent_path": "src/drivers",
                "name": "uart.c",
                "kind": "file",
            },
        )
        assert c_file.status_code == 201
        assert (project_dir / "src" / "drivers" / "uart.c").is_file()

        # Duplicate creation must fail with 409 without overwriting
        (project_dir / "src" / "drivers" / "uart.c").write_text("keep", encoding="utf-8")
        c_dup = await client.post(
            "/api/explorer/create",
            json={
                "project_dir": str(project_dir),
                "parent_path": "src/drivers",
                "name": "uart.c",
                "kind": "file",
            },
        )
        assert c_dup.status_code == 409
        assert (project_dir / "src" / "drivers" / "uart.c").read_text(encoding="utf-8") == "keep"

        # Rename file
        r_file = await client.post(
            "/api/explorer/rename",
            json={
                "project_dir": str(project_dir),
                "target_path": "src/drivers/uart.c",
                "new_name": "uart_v3.c",
            },
        )
        assert r_file.status_code == 200
        assert r_file.json()["relative_path"] == "src/drivers/uart_v3.c"
        assert (project_dir / "src" / "drivers" / "uart_v3.c").is_file()

        # Non-recursive delete on non-empty folder must fail (409)
        d_non_empty = await client.post(
            "/api/explorer/delete",
            json={
                "project_dir": str(project_dir),
                "target_path": "src/drivers",
                "recursive": False,
            },
        )
        assert d_non_empty.status_code == 409
        assert (project_dir / "src" / "drivers" / "uart_v3.c").is_file()

        # Explicit recursive delete removes folder cleanly
        d_recursive = await client.post(
            "/api/explorer/delete",
            json={
                "project_dir": str(project_dir),
                "target_path": "src/drivers",
                "recursive": True,
            },
        )
        assert d_recursive.status_code == 200
        assert not (project_dir / "src" / "drivers").exists()


@pytest.mark.asyncio
async def test_explorer_protects_root_manifest_and_blocks_traversal(
    project_workspace: tuple[Path, Path],
):
    project_dir, tmp_path = project_workspace
    outside_dir = tmp_path / "outside_secret"
    outside_dir.mkdir()
    (outside_dir / "secret.txt").write_text("topsecret", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Path traversal blocked across all endpoints
        r_list = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": "../outside_secret"},
        )
        r_create = await client.post(
            "/api/explorer/create",
            json={
                "project_dir": str(project_dir),
                "parent_path": "..",
                "name": "pwn.txt",
                "kind": "file",
            },
        )
        r_abs = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(project_dir), "path": str(outside_dir)},
        )
        assert r_list.status_code == 400
        assert r_create.status_code == 400
        assert r_abs.status_code == 400

        # Non-project directory rejected
        r_non_proj = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(outside_dir), "path": ""},
        )
        assert r_non_proj.status_code == 400

        # Cannot rename or delete project root or vega-project.json
        r_del_root = await client.post(
            "/api/explorer/delete",
            json={"project_dir": str(project_dir), "target_path": "", "recursive": True},
        )
        r_ren_root = await client.post(
            "/api/explorer/rename",
            json={"project_dir": str(project_dir), "target_path": "", "new_name": "other"},
        )
        r_del_manifest = await client.post(
            "/api/explorer/delete",
            json={
                "project_dir": str(project_dir),
                "target_path": "vega-project.json",
                "recursive": False,
            },
        )
        r_ren_manifest = await client.post(
            "/api/explorer/rename",
            json={
                "project_dir": str(project_dir),
                "target_path": "vega-project.json",
                "new_name": "other.json",
            },
        )
        assert r_del_root.status_code == 400
        assert r_ren_root.status_code == 400
        assert r_del_manifest.status_code == 400
        assert r_ren_manifest.status_code == 400
        assert (project_dir / "vega-project.json").is_file()


@pytest.mark.asyncio
async def test_explorer_stat_boundary_and_symlink_escape(
    project_workspace: tuple[Path, Path],
):
    project_dir, tmp_path = project_workspace
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("outside", encoding="utf-8")

    # Binary file inside project
    (project_dir / "firmware.bin").write_bytes(b"\x00\x01\x02\x03")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        s_c = await client.get(
            "/api/explorer/stat",
            params={"project_dir": str(project_dir), "path": "src/main.c"},
        )
        assert s_c.status_code == 200
        assert s_c.json()["language"] == "C Source"
        assert s_c.json()["is_binary"] is False

        s_bin = await client.get(
            "/api/explorer/stat",
            params={"project_dir": str(project_dir), "path": "firmware.bin"},
        )
        assert s_bin.status_code == 200
        assert s_bin.json()["is_binary"] is True

        # Optional symlink escape check when OS grants symlink creation
        link_path = project_dir / "escape_link.txt"
        try:
            link_path.symlink_to(outside_file)
        except OSError:
            link_path = None

        if link_path is not None:
            s_escape = await client.get(
                "/api/explorer/stat",
                params={"project_dir": str(project_dir), "path": "escape_link.txt"},
            )
            assert s_escape.status_code == 403
            listing = await client.get(
                "/api/explorer/tree",
                params={"project_dir": str(project_dir), "path": ""},
            )
            escape_nodes = [
                n for n in listing.json()["entries"] if n["name"] == "escape_link.txt"
            ]
            assert len(escape_nodes) == 1
            assert escape_nodes[0]["accessible"] is False
