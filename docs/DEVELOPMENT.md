# VEGA Studio — Development Guide

---

## 1. Prerequisites

Before you begin, ensure the following are installed and working:

| Tool | Version | Verify |
|------|---------|--------|
| Node.js | 20+ LTS (24 recommended) | `node --version` |
| npm | 10+ | `npm --version` |
| Python | 3.12 | `py -3.12 --version` |
| `py` launcher | any | `py --list-paths` |
| Git | 2.40+ | `git --version` |

See [docs/WINDOWS_SETUP.md](./WINDOWS_SETUP.md) for installation instructions.

---

## 2. First-Time Setup

```powershell
# 1. Clone
git clone <repo-url> vega_studio
Set-Location vega_studio

# 2. Install Node dependencies (root + all npm workspaces)
npm install
# This installs: concurrently, wait-on, and all frontend/electron deps

# 3. Set up Python backend
npm run install:backend
# This runs scripts/setup-backend.js which:
#   - Creates backend/.venv with py -3.12
#   - Installs requirements.txt + requirements-dev.txt

# 4. Configure environment
Copy-Item .env.example .env.local
# Defaults work for local development; edit only if you need custom ports
```

After setup, verify:
```powershell
# Check backend venv exists
Test-Path backend\.venv\Scripts\python.exe   # should be True

# Check concurrently installed
npx concurrently --version

# Syntax-check the helper scripts
node --check scripts/start-backend.js
node --check scripts/start-electron.js
node --check scripts/setup-backend.js
node --check scripts/test-backend.js
```

---

## 3. Development Workflow

### Option A — All-in-one (recommended for quick checks)

```powershell
npm run dev
```

This uses `concurrently` to run BACKEND, FRONTEND, and ELECTRON simultaneously with colored output. All output is prefixed with the service name.

**Limitation**: It's harder to read individual service logs. Use separate terminals for deeper debugging.

### Option B — Separate terminals (recommended for active development)

**Terminal 1 — Backend**
```powershell
npm run dev:backend
# Starts FastAPI on http://127.0.0.1:8765
# Logs: "VEGA Studio Backend started on http://127.0.0.1:8765"
```

**Terminal 2 — Frontend**
```powershell
npm run dev:frontend
# Starts Next.js dev server on http://localhost:3000
# Hot-module replacement enabled
```

**Terminal 3 — Electron** *(optional)*
```powershell
npm run dev:electron
# Waits until http://localhost:3000 is responding (up to 60s)
# Then opens the Electron desktop window
```

### Stopping services

- **Terminal-based**: `Ctrl+C` in each terminal
- **All-in-one**: `Ctrl+C` once — concurrently sends SIGINT to all child processes

---

## 4. Running Tests

### Backend (pytest)
```powershell
npm run test:backend
# Runs: backend/.venv/Scripts/pytest tests/ -v
```

To run a specific test file:
```powershell
Set-Location backend
.venv\Scripts\pytest tests\test_health.py -v
```

To run with coverage:
```powershell
Set-Location backend
.venv\Scripts\pytest tests\ -v --cov=app --cov-report=term-missing
```

### Frontend (lint)
```powershell
npm run test:frontend
# Runs: npm --prefix frontend run lint (ESLint + TypeScript check)
```

---

## 5. Environment Variables

The app reads environment configuration from `.env.local` (git-ignored). Copy from `.env.example`:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | `127.0.0.1` | Interface the backend binds to |
| `BACKEND_PORT` | `8765` | Port the backend listens on |
| `APP_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` |

**Backend** (`backend/.env` or environment):

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Bind host (never change to 0.0.0.0) |
| `PORT` | `8765` | Bind port |
| `CORS_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | Allowed CORS origins |
| `LOG_LEVEL` | `info` | Uvicorn/app log level |
| `APP_ENV` | `development` | Application environment |

---

## 6. Troubleshooting

### `npm run install:backend` fails — "py not found"
Python's `py` launcher isn't in PATH. See [WINDOWS_SETUP.md](./WINDOWS_SETUP.md#2-installing-python-312).

### Backend won't start — "No module named app"
The venv isn't activated. The scripts handle this automatically — the venv Python is used directly by path. Verify:
```powershell
Test-Path backend\.venv\Scripts\python.exe
```
If missing, re-run `npm run install:backend`.

### Frontend says "Backend disconnected"
The backend isn't running. Start it with `npm run dev:backend` in a separate terminal.

### Port 8765 already in use
```powershell
# Find the process using port 8765
netstat -ano | findstr :8765
# Kill it (replace <PID> with actual PID)
Stop-Process -Id <PID> -Force
```

### Port 3000 already in use
```powershell
netstat -ano | findstr :3000
Stop-Process -Id <PID> -Force
```

### Electron window is blank / "site not reachable"
The frontend isn't running yet. Start `npm run dev:frontend` and wait for it to show "Ready" before launching Electron.

### `npm install` warns about missing peer dependencies in workspaces
This is usually harmless if the workspace packages list their own dependencies. Run `npm install --legacy-peer-deps` if errors block the install.

### Python import errors after adding a new package
```powershell
Set-Location backend
.venv\Scripts\pip install <package>
# Then add to requirements.txt:
Add-Content requirements.txt "<package>>=<version>"
```

---

## 7. Code Organization

### Backend (`backend/app/`)

```
app/
├── __init__.py          # Package init
├── __main__.py          # Entry point (py -3.12 -m app)
├── main.py              # FastAPI app instance + lifespan + CORS
├── config.py            # pydantic-settings Settings class
└── routers/
    ├── __init__.py
    └── health.py        # /api/health, /api/status
```

**Adding a new module**: create `app/routers/my_feature.py`, define a `router = APIRouter()`, and include it in `app/main.py` with `app.include_router(my_router, prefix="/api")`.

### Frontend (`frontend/src/`)

```
src/
├── app/                 # Next.js App Router pages
│   ├── layout.tsx       # Root layout (dark theme, fonts)
│   ├── page.tsx         # Home / main IDE view
│   └── globals.css
└── components/          # Shared React components
    └── BackendStatus.tsx
```

---

## 8. Adding New Backend Endpoints

1. Create or extend a router file in `backend/app/routers/`
2. Define Pydantic response models in `backend/app/models/`
3. Register the router in `backend/app/main.py`
4. Write tests in `backend/tests/`

Example:
```python
# backend/app/routers/boards.py
from fastapi import APIRouter
from app.models.board import BoardListResponse

router = APIRouter()

@router.get("/boards", response_model=BoardListResponse)
async def list_boards():
    return BoardListResponse(boards=[])
```

```python
# backend/app/main.py — add:
from app.routers import boards
app.include_router(boards.router, prefix="/api")
```

---

## 9. Adding New Frontend Pages/Components

### New page (Next.js App Router)
```
frontend/src/app/settings/page.tsx
```
Access at `http://localhost:3000/settings`

### New component
```
frontend/src/components/MyComponent.tsx
```

Import with:
```typescript
import MyComponent from '@/components/MyComponent';
```

TypeScript strict mode is enabled — all props must be typed.
