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

        # Relative project root rejected while external directory without vega-project.json is browsable
        r_rel_proj = await client.get(
            "/api/explorer/tree",
            params={"project_dir": "relative/outside", "path": ""},
        )
        assert r_rel_proj.status_code == 400
        r_ext_proj = await client.get(
            "/api/explorer/tree",
            params={"project_dir": str(outside_dir), "path": ""},
        )
        assert r_ext_proj.status_code == 200
        assert [e["name"] for e in r_ext_proj.json()["entries"]] == ["secret.txt"]

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


@pytest.mark.asyncio
async def test_read_and_write_file_lifecycle_and_languages(
    project_workspace: tuple[Path, Path],
):
    project_dir, _ = project_workspace
    (project_dir / "script.py").write_text("print('vega')\r\n", encoding="utf-8")
    (project_dir / "config.yaml").write_text("board: aries_v3\n", encoding="utf-8")
    (project_dir / "startup.s").write_text(".globl _start\n_start:\n  nop\n", encoding="utf-8")
    (project_dir / "flash.sh").write_text("#!/bin/sh\necho ok\n", encoding="utf-8")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r_main = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "src/main.c"},
        )
        assert r_main.status_code == 200
        main_data = r_main.json()
        assert main_data["monaco_language"] == "c"
        assert main_data["language"] == "C Source"
        assert main_data["version_stamp"]
        assert "main(" in main_data["content"]

        r_make = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "Makefile"},
        )
        assert r_make.status_code == 200
        assert r_make.json()["monaco_language"] == "makefile"

        r_py = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "script.py"},
        )
        assert r_py.status_code == 200
        assert r_py.json()["monaco_language"] == "python"
        assert r_py.json()["line_ending"] == "CRLF"

        r_yaml = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "config.yaml"},
        )
        assert r_yaml.status_code == 200
        assert r_yaml.json()["monaco_language"] == "yaml"

        r_asm = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "startup.s"},
        )
        assert r_asm.status_code == 200
        assert r_asm.json()["monaco_language"] == "riscv-asm"

        r_sh = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "flash.sh"},
        )
        assert r_sh.status_code == 200
        assert r_sh.json()["monaco_language"] == "shell"

        # Save edited content cleanly with matching version_stamp
        updated_src = "int main(void) {\n    return 0;\n}\n"
        w_res = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": "src/main.c",
                "content": updated_src,
                "expected_version": main_data["version_stamp"],
            },
        )
        assert w_res.status_code == 200
        assert (project_dir / "src" / "main.c").read_text(encoding="utf-8") == updated_src
        new_stamp = w_res.json()["version_stamp"]
        assert new_stamp


@pytest.mark.asyncio
async def test_write_file_conflict_missing_binary_and_confinement(
    project_workspace: tuple[Path, Path],
):
    project_dir, _ = project_workspace
    (project_dir / "bad_bytes.txt").write_bytes(b"\xff\xfe\xfd\x80")
    (project_dir / "artifact.bin").write_bytes(b"\x00\x01\x02")
    (project_dir / "huge.txt").write_bytes(b"a" * (5 * 1024 * 1024 + 64))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Stale version conflict detection
        r_main = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "src/main.c"},
        )
        stale_stamp = r_main.json()["version_stamp"]

        # Simulate external edit on disk (bump size & mtime cleanly)
        (project_dir / "src" / "main.c").write_text(
            "// external change on disk\nint main(void) { return 42; }\n",
            encoding="utf-8",
        )

        w_conflict = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": "src/main.c",
                "content": "// editor change\n",
                "expected_version": stale_stamp,
                "overwrite_conflict": False,
            },
        )
        assert w_conflict.status_code == 409

        # Explicit conflict override succeeds
        w_force = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": "src/main.c",
                "content": "// editor override\n",
                "expected_version": stale_stamp,
                "overwrite_conflict": True,
            },
        )
        assert w_force.status_code == 200
        assert (project_dir / "src" / "main.c").read_text(encoding="utf-8") == "// editor override\n"

        # Binary, invalid UTF-8, and huge files blocked safely
        r_bin = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "artifact.bin"},
        )
        assert r_bin.status_code == 415

        r_bad_utf8 = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "bad_bytes.txt"},
        )
        assert r_bad_utf8.status_code == 415

        r_huge = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "huge.txt"},
        )
        assert r_huge.status_code == 413

        # Saving missing / deleted file fails with 404 instead of recreating silently
        w_missing = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": "src/deleted.c",
                "content": "int x;\n",
            },
        )
        assert w_missing.status_code == 404

        # Path traversal & .vega-studio blocked on read & write
        r_trav = await client.get(
            "/api/explorer/file",
            params={"project_dir": str(project_dir), "path": "../outside.txt"},
        )
        assert r_trav.status_code == 400

        w_trav = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": "../outside.txt",
                "content": "hacked",
            },
        )
        assert w_trav.status_code == 400

        w_ide = await client.put(
            "/api/explorer/file",
            json={
                "project_dir": str(project_dir),
                "relative_path": ".vega-studio/state.json",
                "content": "{}",
            },
        )
        assert w_ide.status_code == 403
