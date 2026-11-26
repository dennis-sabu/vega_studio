"""Tests for Phase 6 VEGA SDK discovery, config persistence, and SDK Doctor diagnostics."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import app
from app.models.sdk import SdkConfig
from app.routers.sdk import get_sdk_service
from app.services.sdk_service import SdkService


@pytest.fixture
def isolated_sdk_service(tmp_path: Path):
    """Provide an isolated SdkService backed by a temporary SQLite DATA_DIR."""
    data_dir = tmp_path / "app_data"
    service = SdkService(Settings(DATA_DIR=str(data_dir)))
    app.dependency_overrides[get_sdk_service] = lambda: service
    yield service, tmp_path
    app.dependency_overrides.clear()


def _create_fake_vega_env(root: Path, *, windows_exts: bool = False) -> dict[str, Path]:
    sdk_dir = root / "vega" / "vega-sdk"
    (sdk_dir / "examples").mkdir(parents=True)
    (sdk_dir / "bsp").mkdir(parents=True)

    tc_dir = root / "vega" / "vega-tools-rv32"
    bin_dir = tc_dir / "bin"
    bin_dir.mkdir(parents=True)

    ext = ".exe" if windows_exts else ""
    gcc_path = bin_dir / f"riscv32-vega-elf-gcc{ext}"
    gcc_path.write_text("#!/bin/sh\necho gcc\n", encoding="utf-8")
    objcopy_path = bin_dir / f"riscv32-vega-elf-objcopy{ext}"
    objcopy_path.write_text("tool", encoding="utf-8")
    make_path = root / f"make{ext}"
    make_path.write_text("make", encoding="utf-8")
    py_path = root / f"python3{ext}"
    py_path.write_text("py", encoding="utf-8")

    tools_dir = root / "vega" / "tools"
    tools_dir.mkdir(parents=True)
    uploader = tools_dir / "vega_xmodem.py"
    uploader.write_text(
        "import sys\nimport serial\nimport xmodem\nprint('should never run')\n",
        encoding="utf-8",
    )
    if not windows_exts:
        try:
            gcc_path.chmod(0o755)
        except OSError:
            pass

    return {
        "sdk_root": sdk_dir,
        "toolchain_root": tc_dir,
        "compiler_path": gcc_path,
        "objcopy_path": objcopy_path,
        "make_path": make_path,
        "python_path": py_path,
        "uploader_script": uploader,
    }


def test_sdk_config_persistence_and_reset(isolated_sdk_service):
    service, tmp_path = isolated_sdk_service
    initial = service.get_config_state()
    assert initial.is_customized is False
    assert initial.config.cross_compile_prefix == "riscv32-vega-elf"
    assert initial.config.target_arch == "rv32i_zicsr"
    assert initial.config.target_machine == "THEJAS32"

    custom_sdk = tmp_path / "custom_sdk"
    custom_sdk.mkdir()
    saved = service.update_config(
        SdkConfig(
            sdk_root=str(custom_sdk),
            target_machine="THEJAS32",
        )
    )
    assert saved.is_customized is True
    assert saved.config.sdk_root == str(custom_sdk.resolve())
    assert saved.updated_at is not None

    # Recreate service with same DATA_DIR -> persistence survives restart
    restarted = SdkService(Settings(DATA_DIR=str(tmp_path / "app_data")))
    loaded = restarted.get_config_state()
    assert loaded.is_customized is True
    assert loaded.config.sdk_root == str(custom_sdk.resolve())

    # Invalid paths must fail validation safely
    with pytest.raises(Exception):
        service.update_config(SdkConfig(sdk_root=str(tmp_path / ".." / "escape")))
    with pytest.raises(Exception):
        service.update_config(SdkConfig(sdk_root="relative/sdk"))

    reset_state = service.reset_config()
    assert reset_state.is_customized is False


def test_sdk_discovery_finds_reference_layout_without_full_scan(
    isolated_sdk_service, monkeypatch
):
    service, tmp_path = isolated_sdk_service
    fake_home = tmp_path / "home"
    paths = _create_fake_vega_env(fake_home, windows_exts=True)

    # Point HOME & USERPROFILE cleanly to fake_home
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("USERPROFILE", str(fake_home))
    for k in ("VEGA_SDK", "VEGA_SDK_HOME", "VEGA_TOOLS", "RISCV_TOOLS", "VEGA_XMODEM"):
        monkeypatch.delenv(k, raising=False)

    with (
        patch("app.services.sdk_service._host_os_name", return_value="windows"),
        patch("app.services.sdk_service.shutil.which", return_value=None),
    ):
        discovery = service.discover_environment(apply_to_config=False)

    assert discovery.sdk_root == str(paths["sdk_root"].resolve())
    assert discovery.toolchain_root == str(paths["toolchain_root"].resolve())
    assert discovery.compiler_path == str(paths["compiler_path"].resolve())
    assert discovery.uploader_script == str(paths["uploader_script"].resolve())
    tool_names = [t.name for t in discovery.compiler_tools]
    assert "riscv32-vega-elf-objcopy" in tool_names


def test_diagnostics_linux_pass_with_mocked_subprocesses(
    isolated_sdk_service, monkeypatch
):
    service, tmp_path = isolated_sdk_service
    paths = _create_fake_vega_env(tmp_path, windows_exts=False)

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    def fake_run(cmd, **_kwargs):
        exe = Path(cmd[0]).name
        args = cmd[1:]
        if "gcc" in exe and args == ["--version"]:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="riscv32-vega-elf-gcc (GCC) 12.2.0\n", stderr=""
            )
        if "gcc" in exe and args == ["-dumpmachine"]:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="riscv32-vega-elf\n", stderr=""
            )
        if "make" in exe and args == ["--version"]:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="GNU Make 4.3\n", stderr=""
            )
        if "python" in exe and args == ["--version"]:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="Python 3.12.1\n", stderr=""
            )
        if "python" in exe and "-c" in args:
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=json.dumps({"sys": True, "serial": True, "xmodem": True}),
                stderr="",
            )
        raise AssertionError(f"Unexpected command invoked: {cmd}")

    cfg = SdkConfig(
        sdk_root=str(paths["sdk_root"]),
        toolchain_root=str(paths["toolchain_root"]),
        compiler_path=str(paths["compiler_path"]),
        make_path=str(paths["make_path"]),
        python_path=str(paths["python_path"]),
        uploader_script=str(paths["uploader_script"]),
    )

    with (
        patch("app.services.sdk_service._host_os_name", return_value="linux"),
        patch("app.services.sdk_service.os.access", return_value=True),
        patch("app.services.sdk_service.subprocess.run", side_effect=fake_run),
    ):
        report = service.run_diagnostics(config_override=cfg)

    assert report.overall_status == "pass"
    assert report.platform_os == "linux"
    assert report.platform_compatible is True
    assert report.summary.failed == 0
    assert report.summary.warning == 0
    checks_by_id = {c.id: c for c in report.checks}
    assert checks_by_id["sdk_contents_valid"].status == "pass"
    assert "GCC" in (checks_by_id["compiler_invocation"].detected_version or "")
    assert checks_by_id["compiler_target"].status == "pass"
    assert checks_by_id["uploader_inspection"].status == "pass"
    assert checks_by_id["uploader_dependencies"].status == "pass"


def test_diagnostics_missing_toolchain_missing_uploader_and_timeout(
    isolated_sdk_service, monkeypatch
):
    service, tmp_path = isolated_sdk_service
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    # Unset SDK env vars so auto-discovery cannot fall back to the real on-disk SDK
    monkeypatch.delenv("VEGA_SDK", raising=False)
    monkeypatch.delenv("VEGA_SDK_HOME", raising=False)
    monkeypatch.delenv("VEGA_TOOLS", raising=False)
    monkeypatch.delenv("RISCV_TOOLS", raising=False)

    # Empty temp environment with configured bad/missing paths + Make timeout
    fake_make = tmp_path / "make.exe"
    fake_make.write_text("make", encoding="utf-8")
    fake_py = tmp_path / "python3.exe"
    fake_py.write_text("py", encoding="utf-8")

    def fake_run(cmd, **_kwargs):
        exe = Path(cmd[0]).name
        if "make" in exe:
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=5.0)
        if "python" in exe:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="Python 3.12.1\n", stderr=""
            )
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="err")

    cfg = SdkConfig(
        sdk_root=str(tmp_path / "missing_sdk"),
        toolchain_root=str(tmp_path / "missing_tc"),
        compiler_path=str(tmp_path / "missing_gcc"),
        make_path=str(fake_make),
        python_path=str(fake_py),
        uploader_script=str(tmp_path / "missing_xmodem.py"),
    )

    with (
        patch("app.services.sdk_service._host_os_name", return_value="linux"),
        patch("app.services.sdk_service.shutil.which", return_value=None),
        patch("app.services.sdk_service.subprocess.run", side_effect=fake_run),
    ):
        report = service.run_diagnostics(config_override=cfg)

    assert report.overall_status == "fail"
    checks = {c.id: c for c in report.checks}
    assert checks["sdk_dir_exists"].status == "fail"
    assert checks["sdk_contents_valid"].status == "not_checked"
    assert checks["compiler_exists"].status == "fail"
    assert checks["compiler_invocation"].status == "not_checked"
    assert checks["make_version"].status == "fail"
    assert "timed out" in (checks["make_version"].detail or "").lower()
    assert checks["uploader_exists"].status == "fail"
    assert checks["uploader_inspection"].status == "not_checked"


def test_windows_graceful_handling_and_posix_staged_paths(
    isolated_sdk_service, monkeypatch
):
    service, tmp_path = isolated_sdk_service
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    # Unset SDK env vars so auto-discovery cannot fall back to the real on-disk SDK
    monkeypatch.delenv("VEGA_SDK", raising=False)
    monkeypatch.delenv("VEGA_SDK_HOME", raising=False)
    monkeypatch.delenv("VEGA_TOOLS", raising=False)
    monkeypatch.delenv("RISCV_TOOLS", raising=False)

    # Stage a Linux POSIX path while running on Windows
    with patch("app.services.sdk_service._host_os_name", return_value="windows"):
        saved = service.update_config(
            SdkConfig(
                sdk_root="/home/vega/vega-sdk",
                toolchain_root="/home/vega/vega-tools-rv32",
            )
        )
        assert saved.config.sdk_root == "/home/vega/vega-sdk"
        assert len(saved.validation_warnings) >= 2

        with patch("app.services.sdk_service.shutil.which", return_value=None):
            report = service.run_diagnostics()

    assert report.platform_os == "windows"
    assert report.platform_compatible is False
    checks = {c.id: c for c in report.checks}
    assert checks["sdk_dir_exists"].status == "warning"
    assert checks["compiler_exists"].status == "warning"
    assert checks["vega_env_alignment"].status == "warning"


def test_uploader_syntax_error_and_missing_dependency_detection(
    isolated_sdk_service,
):
    service, tmp_path = isolated_sdk_service
    bad_script = tmp_path / "broken_xmodem.py"
    bad_script.write_text("def broken(:\n  pass\n", encoding="utf-8")

    fake_py = tmp_path / "python3"
    fake_py.write_text("py", encoding="utf-8")

    with patch("app.services.sdk_service._host_os_name", return_value="linux"):
        report = service.run_diagnostics(
            config_override=SdkConfig(
                uploader_script=str(bad_script),
                python_path=str(fake_py),
            )
        )
    checks = {c.id: c for c in report.checks}
    assert checks["uploader_inspection"].status == "fail"
    assert "syntax error" in checks["uploader_inspection"].summary.lower()

    # Valid script missing pyserial module
    valid_script = tmp_path / "vega_xmodem.py"
    valid_script.write_text("import serial\nimport xmodem\n", encoding="utf-8")

    def fake_run(cmd, **_kwargs):
        exe = Path(cmd[0]).name
        if "python" in exe and "-c" in cmd:
            return subprocess.CompletedProcess(
                cmd,
                0,
                stdout=json.dumps({"serial": False, "xmodem": False}),
                stderr="",
            )
        return subprocess.CompletedProcess(cmd, 0, stdout="Python 3.12.1\n", stderr="")

    with (
        patch("app.services.sdk_service._host_os_name", return_value="linux"),
        patch("app.services.sdk_service.subprocess.run", side_effect=fake_run),
    ):
        report_deps = service.run_diagnostics(
            config_override=SdkConfig(
                uploader_script=str(valid_script),
                python_path=str(fake_py),
            )
        )
    dep_checks = {c.id: c for c in report_deps.checks}
    assert dep_checks["uploader_inspection"].status == "pass"
    assert dep_checks["uploader_dependencies"].status == "warning"
    assert "serial" in dep_checks["uploader_dependencies"].summary


@pytest.mark.asyncio
async def test_sdk_api_endpoints_contracts(isolated_sdk_service, monkeypatch):
    _, tmp_path = isolated_sdk_service
    paths = _create_fake_vega_env(tmp_path, windows_exts=True)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Initial config & baseline not_checked diagnostics
        r_cfg = await client.get("/api/sdk/config")
        assert r_cfg.status_code == 200
        assert r_cfg.json()["is_customized"] is False

        r_diag0 = await client.get("/api/sdk/diagnostics")
        assert r_diag0.status_code == 200
        d0 = r_diag0.json()
        assert d0["overall_status"] == "not_checked"
        assert d0["summary"]["not_checked"] == d0["summary"]["total"]

        # Update config via PUT
        r_put = await client.put(
            "/api/sdk/config",
            json={
                "sdk_root": str(paths["sdk_root"]),
                "toolchain_root": str(paths["toolchain_root"]),
                "cross_compile_prefix": "riscv32-vega-elf",
                "target_arch": "rv32i_zicsr",
                "target_machine": "THEJAS32",
            },
        )
        assert r_put.status_code == 200
        assert r_put.json()["is_customized"] is True

        # Reject invalid traversal path via API
        r_bad = await client.put(
            "/api/sdk/config",
            json={"sdk_root": "../outside"},
        )
        assert r_bad.status_code == 422

        # Discovery endpoint
        r_disc = await client.post("/api/sdk/discover", json={"apply_to_config": False})
        assert r_disc.status_code == 200
        assert r_disc.json()["sdk_root"] == str(paths["sdk_root"].resolve())

        # Run diagnostics endpoint
        r_run = await client.post("/api/sdk/diagnostics/run", json={})
        assert r_run.status_code == 200
        run_data = r_run.json()
        assert run_data["checked_at"] is not None
        assert run_data["summary"]["total"] == len(run_data["checks"])

        # Subsequent GET diagnostics returns persisted report
        r_diag1 = await client.get("/api/sdk/diagnostics")
        assert r_diag1.status_code == 200
        assert r_diag1.json()["checked_at"] == run_data["checked_at"]

        # Reset config clears customization cleanly
        r_reset = await client.post("/api/sdk/config/reset")
        assert r_reset.status_code == 200
        assert r_reset.json()["is_customized"] is False


def test_sdk_discovery_finds_nested_toolchain_bin_layout(
    isolated_sdk_service, monkeypatch
):
    """Ensure C-DAC VEGA's nested `vega-tools-rv32/toolchain/bin` layout is discovered."""
    service, tmp_path = isolated_sdk_service
    sdk_root = tmp_path / "vega" / "vega-sdk"
    (sdk_root / "examples").mkdir(parents=True)
    tc_root = tmp_path / "vega" / "vega-tools-rv32"
    tc_bin = tc_root / "toolchain" / "bin"
    tc_bin.mkdir(parents=True)
    gcc_exe = tc_bin / "riscv32-vega-elf-gcc"
    gcc_exe.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    gcc_exe.chmod(0o755)

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    for var in ("VEGA_SDK", "VEGA_SDK_HOME", "VEGA_TOOLS", "RISCV_TOOLS", "VEGA_XMODEM"):
        monkeypatch.delenv(var, raising=False)

    with (
        patch("app.services.sdk_service._host_os_name", return_value="linux"),
        patch("app.services.sdk_service.shutil.which", return_value=None),
    ):
        discovery = service.discover_environment(apply_to_config=False)

    assert discovery.toolchain_root == str(tc_root.resolve())
    assert discovery.compiler_path == str(gcc_exe.resolve())

    import os
    from app.services.sdk_service import _build_safe_subprocess_env

    env = _build_safe_subprocess_env(discovery.suggested_config)
    path_entries = env["PATH"].split(os.pathsep)
    assert str(tc_bin.resolve()) in path_entries
