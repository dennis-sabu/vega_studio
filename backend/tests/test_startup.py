"""Tests for app startup / shutdown lifecycle and security configuration."""
from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.config import Settings
from app.main import app, create_app, lifespan


@pytest.mark.asyncio
async def test_app_creates_successfully():
    """create_app() should return a FastAPI instance without raising."""
    new_app = create_app()
    assert isinstance(new_app, FastAPI)


@pytest.mark.asyncio
async def test_lifespan_runs_without_error(caplog):
    """The lifespan context manager should log startup and shutdown messages."""
    with caplog.at_level(logging.INFO, logger="vega_studio.backend"):
        async with lifespan(app):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/api/health")
                assert response.status_code == 200

    assert any(
        "VEGA Studio Backend started on http://127.0.0.1:8765" in rec.message
        for rec in caplog.records
    )
    assert any(
        "VEGA Studio Backend shutting down" in rec.message
        for rec in caplog.records
    )


@pytest.mark.asyncio
async def test_cors_allows_localhost_origin():
    """CORS headers should be present for an allowed localhost origin."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_settings_rejects_wildcard_and_public_host():
    """Settings must reject 0.0.0.0 and wildcard CORS."""
    with pytest.raises(ValidationError):
        Settings(HOST="0.0.0.0")
    with pytest.raises(ValidationError):
        Settings(CORS_ORIGINS=["*"])
    with pytest.raises(ValidationError):
        Settings(CORS_ORIGINS=["https://example.com"])
