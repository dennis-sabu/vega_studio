# VEGA Studio

> **Desktop IDE for the C-DAC VEGA ARIES V3 RISC-V board**

![Phase](https://img.shields.io/badge/Phase%201-Foundation-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Ubuntu-lightgrey)
![Node](https://img.shields.io/badge/Node.js-20%2B-brightgreen)
![Python](https://img.shields.io/badge/Python-3.12-blue)

VEGA Studio is a desktop IDE purpose-built for developing, flashing, and debugging firmware on the **C-DAC VEGA ARIES V3 RISC-V** single-board computer. It combines a native Electron shell, a React/Next.js IDE frontend, and a FastAPI Python backend that talks directly to the target board over USB/UART.

---

## Project Status — Phase 1: Foundation

Phase 1 establishes the monorepo skeleton, development tooling, and the three-layer architecture. No board communication is implemented yet; that arrives in Phase 2.

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Node.js | 20 LTS | [nodejs.org](https://nodejs.org) — 24 recommended |
| npm | 10+ | Bundled with Node 20+ |
| Python | 3.12 | [python.org](https://www.python.org/downloads/) |
| `py` launcher | any | Installed automatically with Python on Windows |
| Git | 2.40+ | [git-scm.com](https://git-scm.com) |

---

## Quick Start (Windows)

```powershell
# 1. Clone the repository
git clone <repo-url> vega_studio
Set-Location vega_studio

# 2. Install Node dependencies (root + workspaces)
npm install

# 3. Set up Python backend (creates .venv, installs packages)
npm run install:backend

# 4. Copy and edit environment config
Copy-Item .env.example .env.local
# Edit .env.local if needed (defaults work for local dev)
```

### Running Development Servers

Launch the full desktop application (Next.js frontend + Electron shell, which automatically spawns and manages the FastAPI backend) with one command:
```powershell
npm run dev
```

Or run components individually in separate terminals (useful for browser-only frontend development):

**Terminal 1 — Backend (standalone)**
```powershell
npm run dev:backend
# FastAPI starts at http://127.0.0.1:8765
```

**Terminal 2 — Frontend**
```powershell
npm run dev:frontend
# Next.js starts at http://localhost:3000
```

**Terminal 3 — Electron** *(optional — if not using `npm run dev`; stop standalone backend first since Electron spawns its own)*
```powershell
npm run dev:electron
# Waits for http://localhost:3000, builds Electron, and opens the desktop window
```

**View the frontend** at [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
vega_studio/
├── backend/                   # FastAPI Python backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── __main__.py        # Entry point: py -3.12 -m app
│   │   ├── main.py            # FastAPI app + lifespan
│   │   ├── config.py          # pydantic-settings configuration
│   │   └── routers/
│   │       └── health.py      # /api/health, /api/status
│   ├── tests/
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── .env.example
│
├── frontend/                  # Next.js / React / TypeScript
│   ├── src/
│   │   ├── app/               # Next.js App Router
│   │   └── components/        # Shared UI components
│   ├── public/
│   └── package.json
│
├── electron/                  # Electron desktop shell
│   ├── src/
│   │   ├── main.ts            # Main process
│   │   └── preload.ts         # Preload / context bridge
│   └── package.json
│
├── scripts/                   # Cross-platform helper scripts
│   ├── start-backend.js
│   ├── start-electron.js
│   ├── setup-backend.js
│   └── test-backend.js
│
├── docs/
│   ├── DEVELOPMENT.md         # Full dev guide
│   └── WINDOWS_SETUP.md       # Windows-specific setup
│
├── package.json               # Root — npm workspaces
├── .gitignore
├── .env.example
├── README.md
└── ARCHITECTURE.md
```

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│          Electron Shell (Node.js)        │
│  - Native OS APIs (file system, USB)    │
│  - Window management                    │
│  - IPC bridge to renderer               │
└───────────────┬─────────────────────────┘
                │ loads
┌───────────────▼─────────────────────────┐
│       Next.js Frontend (React/TS)        │
│  - IDE UI: editor, terminal, file tree  │
│  - Connects to backend via REST         │
│  - Runs at localhost:3000               │
└───────────────┬─────────────────────────┘
                │ HTTP REST (127.0.0.1:8765)
┌───────────────▼─────────────────────────┐
│       FastAPI Backend (Python 3.12)     │
│  - Board communication (Phase 2+)       │
│  - File/project management              │
│  - Health & status endpoints            │
└─────────────────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design decisions.

---

## Testing

```powershell
# Backend tests (pytest)
npm run test:backend

# Frontend lint
npm run test:frontend
```

---

## Development Notes

- **Development OS**: Windows 11 / Windows 10 with PowerShell
- **Production target**: Ubuntu 24.04 LTS (`x86_64`) via `bash scripts/build-linux-release.sh`
- All helper scripts under `scripts/` support both Windows and Linux
- Packaging checks: `npm run test:packaging`, `npm run build:frontend:export`, `npm run build:backend`
- The backend binds to loopback (`127.0.0.1`) only — never `0.0.0.0`

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design & layer responsibilities |
| [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) | Obsidian UI/UX design tokens & typography |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | Full development workflow guide |
| [docs/WINDOWS_SETUP.md](./docs/WINDOWS_SETUP.md) | Windows environment setup |
| [docs/LINUX_RELEASE.md](./docs/LINUX_RELEASE.md) | Ubuntu 24.04 packaging, installation, serial & release guide |
| [backend/README.md](./backend/README.md) | Backend-specific documentation |

---

## License

Proprietary — C-DAC / Internal use only.
