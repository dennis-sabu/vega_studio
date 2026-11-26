"""VEGA Studio Backend – Pydantic response models for health and status."""
from __future__ import annotations

from typing import Any, Dict, List

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


class DiagnosticsExportResponse(BaseModel):
    schema_version: str = "1"
    generated_at: str
    redaction_applied: bool = True
    excluded_items: List[str]
    backend: BackendInfo
    platform: PlatformInfo
    workspace: Dict[str, Any]
    sdk: Dict[str, Any]
    boards: Dict[str, Any]
    git: Dict[str, Any]
    github: Dict[str, Any]
    opencode: Dict[str, Any]
    ai: Dict[str, Any]
    recent_backend_logs: List[str]
