"""VEGA Studio Backend – FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import ai as ai_router
from app.routers import boards as boards_router
from app.routers import build as build_router
from app.routers import explorer as explorer_router
from app.routers import git as git_router
from app.routers import github as github_router
from app.routers import health as health_router
from app.routers import learning as learning_router
from app.routers import projects as projects_router
from app.routers import sdk as sdk_router
from app.routers import serial as serial_router
from app.routers import terminal as terminal_router
from app.routers import upload as upload_router
from app.services.ai_service import get_ai_service
from app.services.build_service import get_build_service
from app.services.diagnostics_service import configure_backend_logging
from app.services.github_service import get_github_service
from app.services.serial_service import get_serial_service
from app.services.terminal_service import get_terminal_service
from app.services.upload_service import get_upload_service

configure_backend_logging(settings)
logger = logging.getLogger("vega_studio.backend")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context manager for startup and graceful shutdown."""
    configure_backend_logging(settings)
    logger.info(
        "VEGA Studio Backend started on http://%s:%d",
        settings.HOST,
        settings.PORT,
    )
    yield
    for name, getter in (
        ("build", get_build_service),
        ("upload", get_upload_service),
        ("serial", get_serial_service),
        ("terminal", get_terminal_service),
        ("github", get_github_service),
        ("ai", get_ai_service),
    ):
        try:
            getter().shutdown()
        except Exception:
            logger.exception("Error shutting down %s service", name)
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
    application.include_router(boards_router.router)
    application.include_router(build_router.router)
    application.include_router(upload_router.router)
    application.include_router(serial_router.router)
    application.include_router(terminal_router.router)
    application.include_router(git_router.router)
    application.include_router(github_router.router)
    application.include_router(ai_router.router)
    application.include_router(learning_router.router)

    return application


app = create_app()
