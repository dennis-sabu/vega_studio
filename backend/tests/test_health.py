"""Tests for /api/health endpoint."""
from __future__ import annotations

from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_returns_200():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_response_shape():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "vega-studio-backend"
    assert data["version"] == "0.1.0"
    assert isinstance(data["timestamp"], str)
    # Verify timestamp is valid ISO-8601
    parsed = datetime.fromisoformat(data["timestamp"])
    assert parsed is not None
