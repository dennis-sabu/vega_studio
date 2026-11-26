# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller specification for VEGA Studio production backend (--onedir bundle)."""

from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

SPEC_DIR = Path(SPECPATH).resolve()
BACKEND_DIR = SPEC_DIR.parent
REPO_ROOT = BACKEND_DIR.parent

hidden_imports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "anyio._backends._asyncio",
    "serial",
    "serial.tools",
    "serial.tools.list_ports",
    "serial.tools.list_ports_common",
    "serial.tools.list_ports_posix",
    "serial.tools.list_ports_linux",
    "serial.tools.list_ports_windows",
]
hidden_imports += collect_submodules("app")

datas = [
    (str(BACKEND_DIR / "app" / "content"), "app/content"),
]

excludes = [
    "pytest",
    "_pytest",
    "tkinter",
    "unittest.mock",
    "tests",
]

a = Analysis(
    [str(BACKEND_DIR / "packaging" / "entrypoint.py")],
    pathex=[str(BACKEND_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="vega-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="vega-backend",
)
