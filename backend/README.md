# VEGA Studio Backend

FastAPI-based local backend service for VEGA Studio, running on `http://127.0.0.1:8765`.

## Requirements

- Python 3.12+
- pip

## Quick Start

### Windows

```powershell
cd backend
.\setup.ps1
.venv\Scripts\Activate.ps1
python -m app
```

### Linux / macOS

```bash
cd backend
bash setup.sh
source .venv/bin/activate
python -m app
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check – returns `{ status, service, version, timestamp }` |
| GET | `/api/status` | Detailed status – returns backend + platform info |

### Example responses

**GET /api/health**
```json
{
  "status": "ok",
  "service": "vega-studio-backend",
  "version": "0.1.0",
  "timestamp": "2026-01-01T00:00:00+00:00"
}
```

**GET /api/status**
```json
{
  "status": "ok",
  "backend": {
    "service": "vega-studio-backend",
    "version": "0.1.0",
    "env": "development",
    "host": "127.0.0.1",
    "port": 8765
  },
  "platform": {
    "python_version": "3.12.x ...",
    "os": "Windows",
    "os_version": "...",
    "architecture": "AMD64"
  }
}
```

## Configuration

Copy `.env.example` to `.env` and edit as needed:

```ini
HOST=127.0.0.1          # Never 0.0.0.0
PORT=8765
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173
LOG_LEVEL=info
APP_ENV=development
```

> **Security**: The backend only binds to `127.0.0.1` by default and rejects `0.0.0.0`. CORS only allows explicitly listed localhost / `127.0.0.1` origins — no wildcard.

## Running Tests

```powershell
# Windows
.venv\Scripts\pytest tests/ -v

# Linux
.venv/bin/pytest tests/ -v
```

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── __main__.py      # Entry point: py -3.12 -m app
│   ├── main.py          # FastAPI app factory, lifespan, CORS
│   ├── config.py        # pydantic-settings configuration
│   ├── routers/
│   │   ├── __init__.py
│   │   └── health.py    # /api/health, /api/status
│   └── models/
│       ├── __init__.py
│       └── health.py    # Pydantic response models
├── tests/
│   ├── __init__.py
│   ├── test_health.py
│   ├── test_status.py
│   └── test_startup.py
├── requirements.txt
├── requirements-dev.txt
├── .env.example
├── pytest.ini
├── setup.ps1            # Windows setup script
├── setup.sh             # Linux setup script
└── README.md
```

## Startup / Shutdown Log Signatures

Electron uses these log lines to detect readiness:

- **Started**: `VEGA Studio Backend started on http://127.0.0.1:8765`
- **Shutdown**: `VEGA Studio Backend shutting down`
