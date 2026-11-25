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

        # Missing metadata directory
        no_meta_dir = tmp_path / "not_a_project"
        no_meta_dir.mkdir()
        r_missing = await client.post(
            "/api/projects/open", json={"project_dir": str(no_meta_dir)}
        )
        assert r_missing.status_code == 400

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
