"""Health and status router."""
from __future__ import annotations

import asyncio
import platform
import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from app.config import settings
from app.models.health import (
    BackendInfo,
    DiagnosticsExportResponse,
    HealthResponse,
    PlatformInfo,
    StatusResponse,
)
from app.services.diagnostics_service import build_safe_diagnostics_bundle

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Liveness check")
async def health() -> HealthResponse:
    """Return a simple liveness response."""
    return HealthResponse(
        status="ok",
        service=settings.APP_NAME,
        version=settings.APP_VERSION,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/status", response_model=StatusResponse, summary="Detailed status")
async def status() -> StatusResponse:
    """Return detailed backend and platform status."""
    return StatusResponse(
        status="ok",
        backend=BackendInfo(
            service=settings.APP_NAME,
            version=settings.APP_VERSION,
            env=settings.APP_ENV,
            host=settings.HOST,
            port=settings.PORT,
        ),
        platform=PlatformInfo(
            python_version=sys.version,
            os=platform.system(),
            os_version=platform.version(),
            architecture=platform.machine(),
        ),
    )


@router.get(
    "/diagnostics/export",
    response_model=DiagnosticsExportResponse,
    summary="Export redacted local diagnostics bundle",
)
async def export_diagnostics(
    project_dir: Optional[str] = Query(default=None),
) -> DiagnosticsExportResponse:
    """Return a non-secret, redacted diagnostics bundle for offline support."""
    return await asyncio.to_thread(build_safe_diagnostics_bundle, project_dir)
