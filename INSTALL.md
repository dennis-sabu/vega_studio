# Installing VEGA Studio

VEGA Studio is a desktop IDE for developing, flashing, and debugging firmware on the **C-DAC VEGA ARIES V3 RISC-V** board.

Choose the installation method that matches your operating system and setup.

---

## Option 1: Install from GitHub Source (Ubuntu / Linux)

### Prerequisites
- **Git** (`2.40+`)
- **Node.js** (`20+` LTS, `24` recommended) and **npm** (`10+`)
- **Python** (`3.12`) with `venv` and `pip`
- *(If building a `.deb` package)* `dpkg-deb` and `fakeroot`

### 1. Clone and set up dependencies

```bash
git clone https://github.com/dennis-sabu/vega_studio.git
cd vega_studio
npm run setup
```

### 2. Run or build the desktop app

- **Run in development mode:**
  ```bash
  npm run dev
  ```

- **Or build and install the Ubuntu `.deb` package:**
  ```bash
  bash scripts/build-linux-release.sh
  sudo apt install ./release/vega-studio_0.1.0_amd64.deb
  ```

After installing the `.deb` package, launch VEGA Studio from the **Ubuntu Applications** menu or by running:

```bash
vega-studio
```

---

## Option 2: Install from a Pre-built `.deb` Package (Ubuntu 24.04 LTS `x86_64`)

If you already have `vega-studio_<version>_amd64.deb` (no Node.js or Python required):

```bash
sudo apt-get update
sudo apt install ./vega-studio_0.1.0_amd64.deb
```

Or double-click the `.deb` file in **Files** and open it with **App Center / Software Install**.

To uninstall later without removing your projects or settings:

```bash
sudo apt remove vega-studio
```

---

## Option 3: Install from a Pre-built `AppImage` (Linux `x86_64`)

```bash
chmod +x vega-studio_0.1.0_x86_64.AppImage
./vega-studio_0.1.0_x86_64.AppImage
```

> **Note:** On Ubuntu 24.04+, the `.deb` package is recommended over the `AppImage` so Chromium's AppArmor user-namespace sandbox works normally. If an AppImage reports a missing `libfuse2`, install `sudo apt install libfuse2t64`.

---

## Option 4: Install from GitHub Source (Windows PowerShell)

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
