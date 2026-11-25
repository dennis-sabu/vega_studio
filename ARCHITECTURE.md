# VEGA Studio — Architecture

> Phase 1: Foundation

---

## 1. Overview

VEGA Studio follows a **three-tier desktop architecture**:

| Layer | Technology | Runs where |
|-------|-----------|-----------|
| Desktop shell | Electron (Node.js) | Native OS process |
| IDE frontend | Next.js + React + TypeScript | Chromium renderer (localhost:3000) |
| Backend service | FastAPI + Python 3.12 | Local Python process (127.0.0.1:8765) |

The three processes communicate through well-defined, local-only interfaces. No internet connectivity is required at runtime.

---

## 2. Layer Responsibilities

### Electron Shell
- Manages native OS capabilities: window chrome, menus, file system dialogs, USB device enumeration (Phase 2+)
- Provides a secure IPC bridge (`contextBridge`) from the renderer to main-process APIs
- Loads the Next.js dev server (development) or static export (production) in a `BrowserWindow`
- Enforces `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`

### Next.js Frontend
- All IDE UI: code editor (Phase 2+), file tree, terminal emulator (Phase 2+), toolbar, status bar
- Backend status indicator that polls `/api/health` every 3 seconds
- Communicates with the FastAPI backend over `http://127.0.0.1:8765`
- Uses Tailwind CSS dark theme, TypeScript strict mode

### FastAPI Backend
- Board communication: serial/UART, flash programming (Phase 2+)
- Project management, file operations (Phase 2+)
- Phase 1: health/status endpoints only
- Runs as a child process spawned and terminated by Electron (`npm run dev`), or standalone via `npm run dev:backend`

---

## 3. Communication

```
  Electron Main Process
        │
        │ IPC (contextBridge)
        ▼
  Renderer (Chromium)
  ┌─────────────────────────────────┐
  │   Next.js SPA                   │
  │   fetch('http://127.0.0.1:8765')│
  └────────────────┬────────────────┘
                   │ HTTP/REST (loopback only)
                   ▼
  ┌─────────────────────────────────┐
  │   FastAPI (uvicorn)             │
  │   Host: 127.0.0.1:8765          │
  └─────────────────────────────────┘
```

**Key constraint**: All communication is strictly loopback (`127.0.0.1`). The backend never binds to `0.0.0.0`.

---

## 4. Security Model

| Concern | Approach |
|---------|---------|
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false` |
| Backend exposure | Binds to `127.0.0.1` only; not accessible from network |
| CORS | Allow-list of `http://127.0.0.1:3000`, `http://localhost:3000` only |
| IPC | All exposed APIs defined explicitly in `preload.ts` via `contextBridge` |
| Input validation | Pydantic v2 models on all backend endpoints |
| Environment secrets | `.env.local` (git-ignored); `.env.example` committed as template |

---

## 5. Phase 1 Scope vs Future Phases

### Phase 1 — Foundation *(current)*
- Monorepo skeleton with npm workspaces
- FastAPI backend with health/status endpoints
- Next.js frontend with backend connection indicator
- Electron shell loading the Next.js app
- Full development tooling and documentation

### Phase 2 — Board Communication
- USB/UART device enumeration and serial communication
- Flash programming workflow
- Backend endpoints for board control
- Terminal emulator in the frontend

### Phase 3 — IDE Features
- Code editor integration (Monaco or CodeMirror)
- File tree with project management
- Build & debug toolchain integration
- Log viewer with filtering

---

## 6. Cross-Platform Notes

| Environment | OS | Notes |
|------------|-----|-------|
| Development | Windows 11/10 | PowerShell, py launcher, npm workspaces |
| Production | Ubuntu 24.04 LTS | systemd service, udev rules for USB |

The `scripts/` directory contains cross-platform Node.js helpers that handle:
- Python interpreter path differences (`Scripts/python.exe` vs `bin/python`)
- Shell invocation differences

Ubuntu/Linux production deployment guide is deferred to a later phase.

---

## 7. Key Design Decisions

### Why Electron + Next.js (not pure Electron)?
Next.js provides hot-module replacement, TypeScript, React component ecosystem, and a clean SPA model. Electron wraps it into a native window without reimplementing a UI framework.

### Why FastAPI (not Node.js for the backend)?
Board communication (serial, USB, build tools) is better served by Python's `pyserial`, `esptool`-style libraries, and the broader embedded toolchain ecosystem. FastAPI provides async performance, Pydantic validation, and automatic OpenAPI docs.

### Why local HTTP (not Electron IPC for backend)?
Keeping the backend as a standard HTTP server:
- Enables independent development and testing without Electron
- Allows future remote-access scenarios (e.g., board connected to a Raspberry Pi)
- Standard REST tooling (curl, Postman, OpenAPI) works out of the box

### Why `127.0.0.1` not `localhost`?
On some systems `localhost` resolves to `::1` (IPv6) first, causing connection failures when the server binds IPv4 only. Using `127.0.0.1` explicitly avoids this.

### Why npm workspaces at the root?
Shares `node_modules` between `frontend` and `electron`, reducing duplication and allowing a single `npm install` at the root to set up both.
