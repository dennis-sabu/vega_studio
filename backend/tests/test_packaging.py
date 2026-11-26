"""Phase 18 packaging, frozen runtime, security, XDG path, and Linux integration tests."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import (
    Settings,
    get_backend_package_root,
    is_allowed_ws_origin,
    is_frozen_backend,
)
from app.main import app
from app.models.sdk import SdkConfig
from app.services.ai_credentials import (
    AICredentialManager,
    CredentialStorageUnavailableError,
    UnavailableOSCredentialBackend,
    detect_default_os_credential_backend,
)
from app.services.learning_service import LearningService
from app.services.sdk_service import SdkService
from app.services.upload_service import UploadService

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_frozen_package_root_resolution(monkeypatch, tmp_path: Path):
    assert is_frozen_backend() is False
    assert get_backend_package_root() == REPO_ROOT / "backend" / "app"

    fake_meipass = tmp_path / "_internal"
    (fake_meipass / "app" / "content").mkdir(parents=True)
    monkeypatch.setattr("app.config.sys.frozen", True, raising=False)
    monkeypatch.setattr("app.config.sys._MEIPASS", str(fake_meipass), raising=False)

    assert is_frozen_backend() is True
    assert get_backend_package_root() == (fake_meipass / "app").resolve()


def test_frozen_learning_catalog_loads_from_meipass(monkeypatch, tmp_path: Path):
    fake_meipass = tmp_path / "_internal"
    bundled_content = fake_meipass / "app" / "content"
    shutil.copytree(REPO_ROOT / "backend" / "app" / "content", bundled_content)

    monkeypatch.setattr("app.config.sys.frozen", True, raising=False)
    monkeypatch.setattr("app.config.sys._MEIPASS", str(fake_meipass), raising=False)

    content_root = get_backend_package_root() / "content"
    monkeypatch.setattr("app.services.learning_service._CONTENT_DIR", content_root)
    monkeypatch.setattr(
        "app.services.learning_service._BUILTIN_EXAMPLES_DIR", content_root / "examples"
    )
    monkeypatch.setattr(
        "app.services.learning_service._BUILTIN_DOCS_DIR", content_root / "docs"
    )

    svc = LearningService(Settings(DATA_DIR=str(tmp_path / "data")))
    examples = svc.list_examples()
    docs = svc.list_docs()
    assert len(examples.examples) >= 1
    assert len(docs.docs) >= 1


def test_cors_and_ws_origin_restrictions_for_packaged_electron():
    cfg = Settings()
    assert "app://vega-studio" in cfg.CORS_ORIGINS
    assert is_allowed_ws_origin("app://vega-studio") is True

    # Arbitrary custom protocols, null origin, and remote origins stay blocked
    assert is_allowed_ws_origin("app://untrusted-origin") is False
    assert is_allowed_ws_origin("vega://anything") is False
    assert is_allowed_ws_origin("file://") is False
    assert is_allowed_ws_origin("null") is False
    assert is_allowed_ws_origin("https://attacker.example") is False

    for bad in ("*", "https://attacker.example", "app://untrusted-origin", "file://"):
        with pytest.raises(ValidationError):
            Settings(CORS_ORIGINS=[bad])

    client = TestClient(app)
    resp = client.options(
        "/api/health",
        headers={
            "Origin": "app://vega-studio",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code in (200, 204)
    assert resp.headers.get("access-control-allow-origin") == "app://vega-studio"


def test_frozen_sdk_service_does_not_treat_frozen_binary_as_python(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr("app.services.sdk_service.is_frozen_backend", lambda: True)
    monkeypatch.setattr("app.services.sdk_service.shutil.which", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.sdk_service.os.path.exists", lambda _p: False)
    monkeypatch.setattr(
        "app.services.sdk_service.sys.executable",
        "/opt/VEGA Studio/resources/backend/vega-backend/vega-backend",
    )

    svc = SdkService(Settings(DATA_DIR=str(tmp_path / "data")))
    discovery = svc.discover_environment()
    assert discovery.python_path is None or "vega-backend" not in discovery.python_path


def test_frozen_upload_service_probe_uses_inprocess_pyserial(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr("app.services.upload_service.is_frozen_backend", lambda: True)
    subproc_mock = MagicMock()
    monkeypatch.setattr("app.services.upload_service.subprocess.run", subproc_mock)

    fake_port = SimpleNamespace(
        device="/dev/ttyUSB0",
        description="CP2102 USB to UART Bridge",
        hwid="USB VID:PID=10C4:EA60",
        manufacturer="Silicon Labs",
        serial_number="0001",
        vid=0x10C4,
        pid=0xEA60,
    )
    fake_serial_mod = SimpleNamespace(
        tools=SimpleNamespace(list_ports=SimpleNamespace(comports=lambda: [fake_port]))
    )
    monkeypatch.setitem(__import__("sys").modules, "serial", fake_serial_mod)
    monkeypatch.setitem(__import__("sys").modules, "serial.tools", fake_serial_mod.tools)
    monkeypatch.setitem(
        __import__("sys").modules,
        "serial.tools.list_ports",
        fake_serial_mod.tools.list_ports,
    )
    monkeypatch.setattr(
        "app.services.upload_service.importlib.util.find_spec",
        lambda name: object() if name == "serial" else None,
    )

    svc = UploadService(Settings(DATA_DIR=str(tmp_path / "data")))
    devices, err = svc._probe_pyserial_ports(SdkConfig())
    assert err is None
    assert devices is not None
    assert len(devices) == 1
    assert devices[0].port == "/dev/ttyUSB0"
    assert devices[0].vendor_id == "10C4"
    assert devices[0].product_id == "EA60"
    subproc_mock.assert_not_called()


def test_linux_xdg_data_dir_resolution(monkeypatch, tmp_path: Path):
    xdg = tmp_path / "xdg-data"
    monkeypatch.setattr(
        "app.config.os",
        SimpleNamespace(name="posix", environ={**os.environ, "XDG_DATA_HOME": str(xdg)}),
    )
    cfg = Settings(DATA_DIR=None)
    resolved = cfg.get_data_dir()
    assert resolved == xdg / "vega-studio"
    assert not str(resolved).startswith(("/opt", "/usr"))


def test_linux_credential_store_fails_closed_when_unavailable(monkeypatch):
    monkeypatch.setattr("app.services.ai_credentials.sys.platform", "linux")
    monkeypatch.setattr(
        "app.services.ai_credentials.importlib",
        SimpleNamespace(
            import_module=lambda _name: (_ for _ in ()).throw(ImportError("no keyring"))
        ),
    )
    monkeypatch.setattr("app.services.ai_credentials.shutil.which", lambda _cmd: None)
    monkeypatch.delenv("DBUS_SESSION_BUS_ADDRESS", raising=False)

    backend = detect_default_os_credential_backend()
    assert isinstance(backend, UnavailableOSCredentialBackend)
    mgr = AICredentialManager(backend=backend)
    assert mgr.get_storage_info().os_storage_available is False

    with pytest.raises(CredentialStorageUnavailableError) as exc_info:
        mgr.set_secret("openai", "sk-test-1234567890", session_only=False)
    assert exc_info.value.status_code == 503


def test_linux_devfs_discovery_does_not_require_root(monkeypatch, tmp_path: Path):
    dev_dir = tmp_path / "dev"
    by_id_dir = dev_dir / "serial" / "by-id"
    by_id_dir.mkdir(parents=True)
    usb0 = dev_dir / "ttyUSB0"
    acm0 = dev_dir / "ttyACM0"
    usb0.write_text("", encoding="utf-8")
    acm0.write_text("", encoding="utf-8")

    real_path_cls = Path

    def fake_path(*args):
        joined = "/".join(str(a) for a in args)
        if joined == "/dev/serial/by-id":
            return by_id_dir
        if joined == "/dev":
            return dev_dir
        return real_path_cls(*args)

    monkeypatch.setattr("app.services.upload_service.Path", fake_path)
    monkeypatch.setattr("app.services.upload_service.os.access", lambda _p, _m: True)
    devices, warnings = UploadService._discover_linux_devfs_ports()
    assert warnings == []
    assert [d.port for d in devices] == [str(usb0), str(acm0)]


def test_version_parity_and_packaging_manifests():
    root_ver = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    fe_ver = json.loads((REPO_ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]
    el_ver = json.loads((REPO_ROOT / "electron" / "package.json").read_text(encoding="utf-8"))["version"]
    assert root_ver == fe_ver == el_ver == Settings().APP_VERSION

    builder_yml = (REPO_ROOT / "electron" / "electron-builder.yml").read_text(encoding="utf-8")
    assert "appId: com.vega.studio" in builder_yml
    assert "target: deb" in builder_yml
    assert "frontend/out" in builder_yml
    assert "backend/vega-backend" in builder_yml

    after_remove_lines = [
        line.strip()
        for line in (REPO_ROOT / "build" / "linux" / "after-remove.sh")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    after_remove_cmd = "\n".join(after_remove_lines)
    assert ".local/share/vega-studio" not in after_remove_cmd
    assert "HOME" not in after_remove_cmd

    after_install_cmd = "\n".join(
        line.strip()
        for line in (REPO_ROOT / "build" / "linux" / "after-install.sh")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.strip().startswith("#")
    )
    assert "usermod" not in after_install_cmd
    assert "udev" not in after_install_cmd
