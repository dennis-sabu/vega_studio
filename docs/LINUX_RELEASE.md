# VEGA Studio — Ubuntu 24.04 Linux Packaging & Release Guide

**Target Platform:** Ubuntu 24.04 LTS (`x86_64` / `amd64`)  
**Primary Distribution Format:** Debian Package (`vega-studio_<version>_amd64.deb`)  
**Secondary Distribution Format:** Portable `AppImage` (`vega-studio_<version>_x86_64.AppImage`)  

---

## 1. Installing on Ubuntu 24.04

### Option A — Debian `.deb` Package (Recommended)

Install from a local terminal using `apt` so shared desktop libraries resolve automatically:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
sudo apt-get update
sudo apt install ./vega-studio_<version>_amd64.deb
```

Launch VEGA Studio from:
- **Ubuntu Application Menu** (`VEGA Studio` under Development / IDE)
- **Terminal**: `vega-studio`

To uninstall without deleting your projects or local IDE settings:

```bash
sudo apt remove vega-studio
```

User projects (`~/VEGA Studio Projects`) and user application data (`~/.local/share/vega-studio` and `~/.config/VEGA Studio`) are **preserved on uninstall**.

---

### Option B — Portable AppImage

```bash
chmod +x vega-studio_<version>_x86_64.AppImage
./vega-studio_<version>_x86_64.AppImage
```

> **Ubuntu 24.04 FUSE Note:** If AppImage complains about missing `libfuse2`, install `sudo apt install libfuse2t64` or extract with `--appimage-extract`.

---

## 2. Architecture & Bundled Components

Each release bundles:
1. **Electron Desktop Shell** (`asar` packaged Chromium + hardened Node preload/IPC bridge; `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
2. **Offline Next.js Production Export** (`resources/frontend/out/` served over strict `app://vega-studio/` custom protocol with locally bundled `Geist`, `Geist Mono`, and `JetBrains Mono` fonts).
3. **Standalone Frozen Python Backend** (`resources/backend/vega-backend/vega-backend` built with PyInstaller `--onedir`), including FastAPI, Uvicorn, Pydantic, httpx, WebSockets, POSIX `pty` terminal support, `pyserial`, and built-in examples/documentation catalogs.

---

## 3. Runtime Dependencies & External Tooling

| Component | Handling | Notes |
|---|---|---|
| Frontend UI & Local Fonts | **Bundled** | Requires no Node.js runtime or remote CDN |
| Python 3.12 + Backend + `pyserial` | **Bundled** | Runs standalone without system Python or repo `.venv` |
| Desktop GTK/NSS/Audio/Libsecret Libs | **Debian `Depends`** | Resolved automatically by `apt install ./vega-studio_*.deb` |
| `git`, `make`, `python3`, `libsecret-tools`, `gh` | **Debian `Recommends`** | Missing optional tools never block VEGA Studio launch |
| **VEGA SDK / `riscv32-vega-elf-gcc` / `vega_xmodem.py`** | **External (User-Configured)** | Configure inside **Settings -> SDK & Toolchain** or **SDK Doctor** |
| **OpenCode CLI** | **External (Optional)** | Configure inside **Settings -> OpenCode CLI** |

---

## 4. Serial & USB-UART Access on Ubuntu (`/dev/ttyUSB*`, `/dev/ttyACM*`)

VEGA Studio **never automatically edits `/etc/udev` or modifies user groups** during package installation.

If USB-UART flashing or the Serial Monitor reports `Permission denied` on `/dev/ttyUSB0` or `/dev/ttyACM0`:

```bash
sudo usermod -aG dialout "$USER"
```

Log out and log back in (or reboot) for group membership to take effect, then click **Refresh** in VEGA Studio's Serial Monitor or Upload Output panel.

---

## 5. Secure AI Credentials on Linux

When storing OpenAI, Groq, or custom API keys persistently in **VEGA Assistant**, VEGA Studio uses:
1. Python `keyring` (if backed by a non-plaintext Secret Service backend), or
2. GNOME/KDE `libsecret` CLI (`secret-tool`, from `libsecret-tools`).

If no D-Bus Secret Service session is unlocked (for example in a headless session), persistent OS storage refuses to save plaintext keys and offers explicit **Session-Only (in-memory)** storage instead.

---

## 6. Filesystem Layout (Writable User Directories)

VEGA Studio strictly separates read-only installation files (`/opt/VEGA Studio/`) from writable user state:

- **Application Data, SQLite DB & Backend Logs:**  
  `$XDG_DATA_HOME/vega-studio` (default `~/.local/share/vega-studio/` — contains `vega_studio.db`, `logs/backend.log`)
- **Electron Window State & Shell Logs:**  
  `~/.config/vega-studio/` and `~/.config/vega-studio/logs/vega-electron.log`
- **Default Firmware Projects Folder:**  
  `~/VEGA Studio Projects/`

---

## 7. Building Ubuntu Release Artifacts from Source

Run the repeatable release script on an **Ubuntu 24.04 x86_64** build machine (requires Node.js 20+, Python 3.12+ with `venv`/`pip`, `dpkg-deb`/`fakeroot`):

```bash
npm install
bash scripts/build-linux-release.sh
```

Validate the generated `.deb` archive before distribution:

```bash
bash scripts/validate-linux-deb.sh
# Optional full install + backend smoke + uninstall verification (prompts sudo):
bash scripts/validate-linux-deb.sh --install
```

Outputs are written cleanly to `release/` (ignored by Git):
- `release/vega-studio_<version>_amd64.deb`
- `release/vega-studio_<version>_x86_64.AppImage`
- `release/SHA256SUMS.txt`

---

## 8. Troubleshooting

- **Sandbox launch issue on Ubuntu 24.04 AppArmor systems:**  
  The `.deb` post-install hook sets `chmod 4755 "/opt/VEGA Studio/chrome-sandbox"`. For standalone `AppImage` runs where AppArmor restricts user namespaces, launch with `--no-sandbox` only if your local policy blocks userns, or prefer the `.deb` package.
- **Wayland vs X11:**  
  Electron launches with `--ozone-platform-hint=auto`. Override cleanly with `ELECTRON_OZONE_PLATFORM_HINT=x11 vega-studio` if needed under specific compositors.
- **Inspecting Diagnostics:**  
  Open **Backend Status -> Export Safe Diagnostics** inside VEGA Studio or inspect `~/.local/share/vega-studio/logs/backend.log`.
