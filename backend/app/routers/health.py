"""Health and status router."""
from __future__ import annotations

import platform
import sys
from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.models.health import (
    BackendInfo,
    HealthResponse,
    PlatformInfo,
    StatusResponse,
)

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
