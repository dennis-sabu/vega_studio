"""VEGA Studio Backend – FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import build as build_router
from app.routers import explorer as explorer_router
from app.routers import health as health_router
from app.routers import projects as projects_router
from app.routers import sdk as sdk_router
from app.services.build_service import get_build_service

logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vega_studio.backend")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context manager for startup and graceful shutdown."""
    logger.info(
        "VEGA Studio Backend started on http://%s:%d",
        settings.HOST,
        settings.PORT,
    )
    yield
    get_build_service().shutdown()
    logger.info("VEGA Studio Backend shutting down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    application = FastAPI(
        title="VEGA Studio Backend",
        version=settings.APP_VERSION,
        description="Local backend service for VEGA Studio.",
        lifespan=lifespan,
    )

    # CORS – local origins only, no wildcard
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(health_router.router)
    application.include_router(projects_router.router)
    application.include_router(explorer_router.router)
    application.include_router(sdk_router.router)
    application.include_router(build_router.router)

    return application


app = create_app()
