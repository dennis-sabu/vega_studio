"""VEGA Studio Backend – Pydantic response models for health and status."""
from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: str


class PlatformInfo(BaseModel):
    python_version: str
    os: str
    os_version: str
    architecture: str


class BackendInfo(BaseModel):
    service: str
    version: str
    env: str
    host: str
    port: int


class StatusResponse(BaseModel):
    status: str
    backend: BackendInfo
    platform: PlatformInfo
