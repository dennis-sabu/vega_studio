"""Tests for /api/status endpoint."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_status_returns_200():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/status")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_status_response_shape():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/status")
    data = response.json()
    assert data["status"] == "ok"

    backend = data["backend"]
    assert backend["service"] == "vega-studio-backend"
    assert backend["version"] == "0.1.0"
    assert "env" in backend
    assert backend["host"] == "127.0.0.1"
    assert isinstance(backend["port"], int)

    platform_info = data["platform"]
    assert "python_version" in platform_info
    assert "os" in platform_info
    assert "os_version" in platform_info
    assert "architecture" in platform_info
