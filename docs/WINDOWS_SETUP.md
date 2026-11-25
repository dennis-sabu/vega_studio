# VEGA Studio — Windows Setup Guide

This guide walks through setting up a Windows development environment for VEGA Studio from scratch.

---

## 1. Installing Node.js

### Recommended: Node.js 24 LTS

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** installer (`.msi`)
2. Run the installer with default options
3. When prompted, **check "Automatically install necessary tools"** to also install build tools (required for some native modules)
4. Verify:

```powershell
node --version   # v24.x.x or v20.x.x
npm --version    # 10.x.x or 11.x.x
```

### Using nvm-windows (optional — for multiple Node versions)

```powershell
# Install nvm-windows from https://github.com/coreybutler/nvm-windows
nvm install 24
nvm use 24
```

---

## 2. Installing Python 3.12

1. Go to [python.org/downloads](https://www.python.org/downloads/release/python-3120/)
2. Download **Windows installer (64-bit)**
3. Run the installer:
   - ✅ **Check "Add python.exe to PATH"**
   - ✅ **Check "Install launcher for all users (recommended)"** — this installs the `py` launcher
4. Click "Install Now"

Verify:
```powershell
python --version       # Python 3.12.x
py --version           # Python 3.12.x (from py launcher)
py -3.12 --version     # Python 3.12.x (explicit version)
```

> **Note**: Even if you have multiple Python versions installed, VEGA Studio uses `py -3.12` explicitly to ensure the correct version.

---

## 3. Verifying the `py` Launcher

The `py` launcher is a Windows-specific tool that lets you select Python versions with `-3.x` flags.

```powershell
# List all installed Python versions
py --list-paths
```

Expected output (example):
```
 -V:3.12 *        C:\Users\<user>\AppData\Local\Programs\Python\Python312\python.exe
 -V:3.11           C:\Python311\python.exe
```

The `*` marks the default version. If 3.12 is not listed, reinstall Python 3.12 with the `py` launcher option checked.

---

## 4. Setting Up the Monorepo

```powershell
# 1. Clone the repository
git clone <repo-url> vega_studio
Set-Location vega_studio

# 2. Install all Node.js dependencies
npm install
# Installs root devDependencies (concurrently, wait-on)
# Also installs frontend/ and electron/ workspaces

# 3. Set up Python backend
npm run install:backend
# Creates backend\.venv with Python 3.12
# Installs FastAPI, uvicorn, pydantic-settings, pytest, etc.

# 4. Configure environment
Copy-Item .env.example .env.local
notepad .env.local   # Edit if needed (defaults work for local dev)
```

---

## 5. Running Development Servers

### Quick start (all services)

```powershell
npm run dev
```

### Separate terminals (better for debugging)

**PowerShell / Windows Terminal Tab 1:**
```powershell
npm run dev:backend
# Output: INFO: VEGA Studio Backend started on http://127.0.0.1:8765
```

**PowerShell / Windows Terminal Tab 2:**
```powershell
npm run dev:frontend
# Output: ▲ Next.js ... Local: http://localhost:3000
```

**PowerShell / Windows Terminal Tab 3 (optional):**
```powershell
npm run dev:electron
# Waits for frontend, then opens the desktop window
```

### Stopping

Press `Ctrl+C` in each terminal, or close the terminal tab.

---

## 6. Notes on Windows Path Handling

### Backslashes vs Forward Slashes

- Windows uses `\` natively, but most Node.js and Python tools accept `/`
- The VEGA Studio `scripts/` helpers use `path.join()` which automatically uses `\` on Windows
- npm scripts that use `cd` require `&&` on Windows CMD — but we avoid this by using Node.js scripts instead

### Why We Use Node.js Scripts Instead of Shell Commands

npm scripts like `"cmd": "cd backend && python -m app"` have different behavior on:
- **Windows CMD**: works
- **Windows PowerShell**: the `&&` operator requires PowerShell 7+
- **Git Bash / MSYS**: works differently

VEGA Studio avoids this entirely by routing through `scripts/*.js` Node.js files that use `child_process.spawnSync` with explicit working directory (`cwd`) options.

### Python Virtual Environment Activation

You do **not** need to activate the venv manually. The npm scripts call the venv Python directly by its full path:
- Windows: `backend\.venv\Scripts\python.exe`
- Linux/macOS: `backend/.venv/bin/python`

---

## 7. Known Windows-Specific Gotchas

### Execution Policy for PowerShell Scripts

If you try to run `.ps1` scripts directly and get a security error:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

VEGA Studio avoids `.ps1` scripts for portability, using Node.js scripts instead.

### Long Path Support

Some npm packages have deep nested paths. Enable long path support if you see path length errors:
```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

Or in Group Policy: Computer Configuration → Administrative Templates → System → Filesystem → Enable Win32 long paths.

### Windows Defender / Antivirus Slowness

Antivirus scanning of `node_modules` and `.venv` can make npm install and pytest significantly slower. Add these directories to your antivirus exclusions:
- `C:\dev\vega_studio\node_modules`
- `C:\dev\vega_studio\frontend\node_modules`
- `C:\dev\vega_studio\electron\node_modules`
- `C:\dev\vega_studio\backend\.venv`

### Line Endings (CRLF vs LF)

The repo is configured with `.gitattributes` to normalize line endings. If you see issues:
```powershell
git config core.autocrlf input
```

### Port Conflicts

If ports 3000 or 8765 are in use:
```powershell
# Find what's using port 3000
netstat -ano | findstr :3000
# Kill process by PID
Stop-Process -Id <PID> -Force
```

---

## 8. WSL (Windows Subsystem for Linux) — Optional

WSL is **not required** to develop VEGA Studio. The Windows-native setup works fully.

If you prefer a Linux-like environment, WSL 2 with Ubuntu 24.04 is the same as the production target:

```powershell
# Install WSL 2 with Ubuntu 24.04
wsl --install -d Ubuntu-24.04
```

Then follow the standard Linux setup (which mirrors the production deployment guide, to be documented in a later phase).

**Note**: USB/serial port access from WSL requires `usbipd-win` and additional setup. For Phase 1 (no board communication), WSL works fine.
