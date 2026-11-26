"""Tests for Phase 16 Firmware Examples, Local Documentation & Guided Learning."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.config import Settings
from app.main import app
from app.models.learning import (
    CreateProjectFromExampleRequest,
    ExampleValidateRequest,
)
from app.models.sdk import SdkConfig
from app.routers.learning import get_learning_service
from app.services.learning_service import LearningService, LearningServiceError
from app.services.project_service import PROJECT_METADATA_FILENAME
from app.services.sdk_service import SdkService


@pytest.fixture
def isolated_learning_env(tmp_path: Path):
    """Provide isolated LearningService + TestClient with temporary app data & workspaces."""
    data_dir = tmp_path / "app_data"
    projects_dir = tmp_path / "projects"
    projects_dir.mkdir(parents=True)

    app_settings = Settings(DATA_DIR=str(data_dir))
    sdk_service = SdkService(app_settings)
    learning_service = LearningService(app_settings)

    app.dependency_overrides[get_learning_service] = lambda: learning_service
    try:
        with TestClient(app) as client:
            yield {
                "settings": app_settings,
                "sdk_service": sdk_service,
                "service": learning_service,
                "client": client,
                "tmp_path": tmp_path,
                "projects_dir": projects_dir,
            }
    finally:
        app.dependency_overrides.pop(get_learning_service, None)


def test_builtin_example_catalog_filters_and_honest_labels(isolated_learning_env):
    svc: LearningService = isolated_learning_env["service"]

    catalog = svc.list_examples()
    assert len(catalog.examples) >= 6
    assert catalog.sdk_root_configured is False
    assert catalog.sdk_examples_count == 0
    assert "Getting Started" in catalog.categories

    by_id = {ex.id: ex for ex in catalog.examples}
    assert "minimal_c_entry" in by_id
    assert by_id["minimal_c_entry"].verification_status == "template_verified"
    assert by_id["riscv_rv32i_zicsr_csrs"].verification_status == "conceptual"
    assert by_id["uart_framing_concepts"].verification_status == "conceptual"
    assert all("VEGA_ARIES_V3" in ex.compatible_boards for ex in catalog.examples)

    uart_filtered = svc.list_examples(q="checksum")
    assert [e.id for e in uart_filtered.examples] == ["uart_framing_concepts"]

    cat_filtered = svc.list_examples(category="RISC-V Architecture")
    assert [e.id for e in cat_filtered.examples] == ["riscv_rv32i_zicsr_csrs"]

    empty_board = svc.list_examples(board_id="NONEXISTENT_BOARD")
    assert empty_board.examples == []


def test_example_detail_preview_and_safety_boundaries(isolated_learning_env):
    svc: LearningService = isolated_learning_env["service"]

    detail = svc.get_example_detail("minimal_c_entry")
    assert detail.example.id == "minimal_c_entry"
    assert detail.readme_content and "VEGA ARIES V3" in detail.readme_content
    rel_paths = {f.relative_path for f in detail.files}
    assert {"README.md", "Makefile", "src/main.c", "include/app_config.h"}.issubset(rel_paths)

    preview = svc.get_example_file("minimal_c_entry", "src/main.c")
    assert preview.example_id == "minimal_c_entry"
    assert "main(" in preview.content
    assert preview.language == "C Source"

    for bad_path in ("../docs/docs_catalog.json", "../../config.py", "/etc/passwd", "C:\\Windows\\win.ini"):
        with pytest.raises(LearningServiceError) as exc_info:
            svc.get_example_file("minimal_c_entry", bad_path)
        assert exc_info.value.status_code == 400

    with pytest.raises(LearningServiceError) as missing_exc:
        svc.get_example_file("minimal_c_entry", "src/does_not_exist.c")
    assert missing_exc.value.status_code == 404

    with pytest.raises(LearningServiceError) as bad_id_exc:
        svc.get_example_detail("../secret")
    assert bad_id_exc.value.status_code == 400


def test_local_sdk_example_discovery_and_filtering(isolated_learning_env):
    svc: LearningService = isolated_learning_env["service"]
    sdk_service: SdkService = isolated_learning_env["sdk_service"]
    tmp_path: Path = isolated_learning_env["tmp_path"]

    sdk_root = tmp_path / "local_vega_sdk"
    gpio_dir = sdk_root / "examples" / "gpio" / "led_toggle"
    gpio_dir.mkdir(parents=True)
    (gpio_dir / "main.c").write_text("int main(void) { return 0; }\n", encoding="utf-8")
    (gpio_dir / "Makefile").write_text("all:\n\t@echo build\n", encoding="utf-8")
    # Sensitive, binary, and ignored build files must never be exposed or copied
    (gpio_dir / ".env").write_text("SECRET_TOKEN=nope\n", encoding="utf-8")
    (gpio_dir / "firmware.elf").write_bytes(b"\x7fELF\x00\x01\x02")
    (gpio_dir / "build").mkdir()
    (gpio_dir / "build" / "temp.o").write_bytes(b"\x00\x01")

    outside_dir = tmp_path / "outside_secret"
    outside_dir.mkdir()
    (outside_dir / "leak.txt").write_text("do not leak", encoding="utf-8")
    try:
        os.symlink(outside_dir / "leak.txt", gpio_dir / "leak_link.txt")
    except OSError:
        # Windows without Developer Mode may disallow symlinks; service still handles cleanly
        pass

    sdk_service.update_config(SdkConfig(sdk_root=str(sdk_root)))

    catalog = svc.list_examples()
    assert catalog.sdk_root_configured is True
    assert catalog.sdk_examples_count == 1
    sdk_examples = [e for e in catalog.examples if e.source == "local_sdk"]
    assert len(sdk_examples) == 1
    ex = sdk_examples[0]
    assert ex.verification_status == "sdk_discovered"

    detail = svc.get_example_detail(ex.id)
    rels = {f.relative_path for f in detail.files}
    assert rels == {"Makefile", "main.c"}

    with pytest.raises(LearningServiceError) as blocked_env:
        svc.get_example_file(ex.id, ".env")
    assert blocked_env.value.status_code == 403

    with pytest.raises(LearningServiceError) as blocked_elf:
        svc.get_example_file(ex.id, "firmware.elf")
    assert blocked_elf.value.status_code == 403


def test_validate_and_create_project_from_example_with_overwrite_guard(isolated_learning_env):
    svc: LearningService = isolated_learning_env["service"]
    projects_dir: Path = isolated_learning_env["projects_dir"]

    valid_res = svc.validate_example("minimal_c_entry", ExampleValidateRequest(board_id="VEGA_ARIES_V3"))
    assert valid_res.valid is True
    assert valid_res.compatible is True
    assert PROJECT_METADATA_FILENAME in valid_res.planned_files

    bad_board = svc.validate_example("minimal_c_entry", ExampleValidateRequest(board_id="UNKNOWN_MCU"))
    assert bad_board.valid is False
    assert bad_board.compatible is False

    workspace = svc.create_project_from_example(
        CreateProjectFromExampleRequest(
            example_id="minimal_c_entry",
            project_name="aries_starter_app",
            parent_dir=str(projects_dir),
            board_id="VEGA_ARIES_V3",
            description="Custom starter workspace",
        )
    )
    assert workspace.project is not None
    assert workspace.project.name == "aries_starter_app"
    assert workspace.project.target.board == "VEGA_ARIES_V3"

    created_root = projects_dir / "aries_starter_app"
    assert (created_root / PROJECT_METADATA_FILENAME).is_file()
    assert (created_root / ".gitignore").is_file()
    assert (created_root / "src" / "main.c").is_file()
    assert (created_root / "include" / "app_config.h").is_file()
    assert (created_root / "Makefile").is_file()

    meta = json.loads((created_root / PROJECT_METADATA_FILENAME).read_text(encoding="utf-8"))
    assert meta["schemaVersion"] == "1.0"
    assert meta["target"]["board"] == "VEGA_ARIES_V3"

    # Must block collision without explicit confirmation
    with pytest.raises(LearningServiceError) as collision_exc:
        svc.create_project_from_example(
            CreateProjectFromExampleRequest(
                example_id="uart_framing_concepts",
                project_name="aries_starter_app",
                parent_dir=str(projects_dir),
                board_id="VEGA_ARIES_V3",
                confirm_overwrite=False,
            )
        )
    assert collision_exc.value.status_code == 409

    # Explicit confirmation updates destination cleanly
    overwritten = svc.create_project_from_example(
        CreateProjectFromExampleRequest(
            example_id="uart_framing_concepts",
            project_name="aries_starter_app",
            parent_dir=str(projects_dir),
            board_id="VEGA_ARIES_V3",
            confirm_overwrite=True,
        )
    )
    assert overwritten.project is not None
    assert (created_root / "include" / "uart_framer.h").is_file()


def test_offline_docs_catalog_search_guides_and_content_safety(isolated_learning_env):
    svc: LearningService = isolated_learning_env["service"]

    docs_cat = svc.list_docs()
    assert len(docs_cat.docs) >= 14
    assert len(docs_cat.guides) == 3
    assert "Toolchain & Build" in docs_cat.categories

    search = svc.search_docs("xmodem upload baud")
    assert len(search.results) >= 1
    assert search.results[0].slug == "uploading-firmware"
    assert search.results[0].score > 0
    assert search.results[0].snippet

    detail = svc.get_doc_detail("vega-aries-v3-overview")
    assert "VEGA ET1031" in detail.markdown_content
    assert "rv32i_zicsr" in detail.markdown_content
    assert "THEJAS32" in detail.markdown_content
    assert any(act.action_id == "open_board_manager" for act in detail.ide_actions)
    assert all(link.url.startswith(("https://", "http://")) for link in detail.external_links)

    # Verify all bundled markdown pages contain zero executable HTML/script payloads
    for doc_summary in docs_cat.docs:
        page = svc.get_doc_detail(doc_summary.slug)
        low = page.markdown_content.lower()
        assert "<script" not in low
        assert "<iframe" not in low
        assert "javascript:" not in low

    with pytest.raises(LearningServiceError) as bad_slug:
        svc.get_doc_detail("../etc/passwd")
    assert bad_slug.value.status_code == 400


def test_learning_rest_endpoints_end_to_end(isolated_learning_env):
    client: TestClient = isolated_learning_env["client"]
    projects_dir: Path = isolated_learning_env["projects_dir"]

    res = client.get("/api/examples")
    assert res.status_code == 200
    assert len(res.json()["examples"]) >= 6

    det = client.get("/api/examples/minimal_c_entry")
    assert det.status_code == 200
    assert det.json()["example"]["id"] == "minimal_c_entry"

    fres = client.get("/api/examples/minimal_c_entry/files", params={"path": "Makefile"})
    assert fres.status_code == 200
    assert "CROSS_COMPILE" in fres.json()["content"]

    bad_fres = client.get("/api/examples/minimal_c_entry/files", params={"path": "../secret.txt"})
    assert bad_fres.status_code == 400

    vres = client.post("/api/examples/minimal_c_entry/validate", json={"board_id": "VEGA_ARIES_V3"})
    assert vres.status_code == 200
    assert vres.json()["valid"] is True

    cres = client.post(
        "/api/examples/create-project",
        json={
            "example_id": "embedded_c_sram_ringbuf",
            "project_name": "ringbuf_lab",
            "parent_dir": str(projects_dir),
            "board_id": "VEGA_ARIES_V3",
        },
    )
    assert cres.status_code == 200
    assert cres.json()["project"]["name"] == "ringbuf_lab"

    dcat = client.get("/api/docs")
    assert dcat.status_code == 200
    assert len(dcat.json()["docs"]) >= 14
    assert len(dcat.json()["guides"]) == 3

    # Important: verify /api/docs/search routes before /api/docs/{slug}
    dsearch = client.get("/api/docs/search", params={"q": "xmodem"})
    assert dsearch.status_code == 200
    assert len(dsearch.json()["results"]) >= 1

    ddet = client.get("/api/docs/getting-started-ide")
    assert ddet.status_code == 200
    assert "VEGA Studio" in ddet.json()["markdown_content"]
