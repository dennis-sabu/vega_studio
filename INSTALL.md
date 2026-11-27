# Installing & Updating VEGA Studio

VEGA Studio is a desktop IDE for developing, flashing, and debugging firmware on the **C-DAC VEGA ARIES V3 RISC-V** board.

---

## Option 1: Quick Install from GitHub Release (Ubuntu 24.04 `x86_64` — Recommended)

No Node.js or Python installation required. Run these commands in your terminal:

```bash
U="https://github.com/dennis-sabu/vega_studio"
U="$U/releases/latest/download"
U="$U/vega-studio_0.1.0_amd64.deb"
sudo curl -fLo /tmp/vega.deb "$U"
sudo apt-get update
sudo apt install -y /tmp/vega.deb
```

Or using GitHub CLI (`gh`):

```bash
gh release download --repo dennis-sabu/vega_studio --pattern "*.deb" -D /tmp
sudo apt-get update
sudo apt install -y /tmp/vega-studio_*.deb
```

Launch VEGA Studio from the **Ubuntu Applications** menu or by running:

```bash
vega-studio
```

---

## Updating an Existing Installation (Ubuntu)

Close VEGA Studio if it is running, then download and reinstall the latest `.deb` in place (your projects and settings are preserved):

```bash
pkill -f "/opt/VEGA Studio/vega-studio" || true
U="https://github.com/dennis-sabu/vega_studio"
U="$U/releases/latest/download"
U="$U/vega-studio_0.1.0_amd64.deb"
sudo curl -fLo /tmp/vega.deb "$U"
sudo apt-get update
sudo apt install --reinstall -y /tmp/vega.deb
```

If you are updating from a local source checkout you built yourself:

```bash
cd vega_studio
git pull
npm run setup
VEGA_LINUX_TARGETS=deb bash scripts/build-linux-release.sh
sudo apt install --reinstall -y ./release/*.deb
```

### Uninstall

To remove VEGA Studio cleanly without deleting your projects or local user data:

```bash
sudo apt remove vega-studio
```

---

## Option 2: Install from a Local `.deb` or `AppImage` File

### `.deb` Package (Ubuntu 24.04 `x86_64`)

```bash
sudo apt-get update
sudo apt install -y ./vega-studio_0.1.0_amd64.deb
```

Or double-click the `.deb` file in **Files** and open it with **App Center / Software Install**.

### `AppImage` (Linux `x86_64`)

```bash
chmod +x vega-studio_0.1.0_x86_64.AppImage
./vega-studio_0.1.0_x86_64.AppImage
```

> **Note:** On Ubuntu 24.04+, the `.deb` package is recommended over the `AppImage` so Chromium's AppArmor user-namespace sandbox works normally. If an AppImage reports a missing `libfuse2`, install `sudo apt install libfuse2t64`.

---

## Option 3: Install & Run from GitHub Source (Ubuntu / Linux)

### Prerequisites
- **Git** (`2.40+`)
- **Node.js** (`20+` LTS, `24` recommended) and **npm** (`10+`)
- **Python** (`3.12`) with `venv` and `pip`
- *(If building a `.deb` package)* `dpkg-deb` and `fakeroot`

### Clone, set up, and run

```bash
git clone https://github.com/dennis-sabu/vega_studio.git
cd vega_studio
npm run setup
```

- **Run in development mode:**
  ```bash
  npm run dev
  ```
- **Build & install `.deb` locally:**
  ```bash
  bash scripts/build-linux-release.sh
  sudo apt install --reinstall -y ./release/*.deb
  ```

---

## Option 4: Install & Run from GitHub Source (Windows PowerShell)

### Prerequisites
- **Git** (`2.40+`)
- **Node.js** (`20+` LTS) and **npm** (`10+`)
- **Python** (`3.12`) with the `py` launcher

### Clone, set up, and run

```powershell
git clone https://github.com/dennis-sabu/vega_studio.git
Set-Location vega_studio
npm install
npm run install:backend
Copy-Item .env.example .env.local
npm run dev
```

---

## Serial / USB-UART Permissions (Ubuntu / Linux)

If flashing or the Serial Monitor reports `Permission denied` on `/dev/ttyUSB0` or `/dev/ttyACM0`, add your user to the `dialout` group:

```bash
sudo usermod -aG dialout "$USER"
```

Log out and log back in (or reboot) for the group change to take effect.

---

## Additional Guides

- [docs/LINUX_RELEASE.md](./docs/LINUX_RELEASE.md) — Ubuntu 24.04 packaging, AppArmor sandbox, credentials, and troubleshooting
- [docs/WINDOWS_SETUP.md](./docs/WINDOWS_SETUP.md) — Detailed Windows setup
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — Full development workflow
