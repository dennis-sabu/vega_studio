"""VEGA Studio Backend – Pydantic models for Phase 9 Firmware Upload System."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

UploadStatus = Literal[
    "idle",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
]
UploadStream = Literal["stdout", "stderr", "system"]
UploadCheckStatus = Literal["pass", "warning", "fail"]
UploadInvocationMode = Literal[
    "auto",
    "positional_port_file",
    "positional_file_port",
    "flagged_port_file",
]

_UPLOAD_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")
_SAFE_PORT_RE = re.compile(r"^[A-Za-z0-9_./:\\+][A-Za-z0-9_./:\\+-]*$")


def validate_upload_id(raw_id: str) -> str:
    cleaned = raw_id.strip().lower()
    if not _UPLOAD_ID_RE.match(cleaned):
        raise ValueError("Invalid upload identifier.")
    return cleaned


def validate_port_token(raw_port: Optional[str]) -> Optional[str]:
    """Validate serial device/port path safely (e.g. COM3, /dev/ttyUSB0, /dev/serial/by-id/...)."""
    if raw_port is None:
        return None
    cleaned = raw_port.strip()
    if not cleaned:
        return None
    if len(cleaned) > 160 or "\x00" in cleaned:
        raise ValueError("Serial port path is invalid.")
    if ".." in cleaned.replace("\\", "/").split("/"):
        raise ValueError("Serial port path cannot contain '..' traversal segments.")
    if not _SAFE_PORT_RE.match(cleaned):
        raise ValueError(
            "Serial port contains unsupported characters. Use a valid port name (e.g. COM3, /dev/ttyUSB0)."
        )
    return cleaned


def validate_artifact_rel_path(raw_path: Optional[str]) -> Optional[str]:
    """Validate project-relative firmware artifact path."""
    if raw_path is None:
        return None
    cleaned = raw_path.strip().replace("\\", "/")
    if not cleaned:
        return None
    if len(cleaned) > 260 or "\x00" in cleaned:
        raise ValueError("Artifact path is invalid.")
    if cleaned.startswith("/") or (len(cleaned) >= 2 and cleaned[1] == ":"):
        raise ValueError("Artifact path must be relative to the project directory.")
    parts = cleaned.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Artifact path must be a safe project-relative path.")
    return cleaned


class SerialDeviceInfo(BaseModel):
    """Discovered serial port/device descriptor."""

    port: str
    display_name: str
    description: str = ""
    hardware_id: Optional[str] = None
    manufacturer: Optional[str] = None
    serial_number: Optional[str] = None
    vendor_id: Optional[str] = None
    product_id: Optional[str] = None
    stable_path: Optional[str] = None
    transport: str = "serial"
    accessible: Optional[bool] = None


class DeviceListResponse(BaseModel):
    """Result of cross-platform serial device discovery."""

    platform_os: str
    discovery_method: str
    discovery_supported: bool
    devices: List[SerialDeviceInfo] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class FirmwareArtifactInfo(BaseModel):
    """Validated firmware artifact found inside the active project directory."""

    relative_path: str
    name: str
    extension: str
    size_bytes: int
    modified_at: str
    stale: bool = False
    stale_reason: Optional[str] = None


class UploadPreflightCheck(BaseModel):
    """Single validation step inside an upload preflight report."""

    id: str
    label: str
    status: UploadCheckStatus
    detail: str
    remediation: Optional[str] = None


class UploadPreflightRequest(BaseModel):
    """Request to run upload prerequisite and artifact validation (never executes flash)."""

    project_dir: str
    port: Optional[str] = None
    artifact_path: Optional[str] = None
    invocation_mode: UploadInvocationMode = "auto"

    @field_validator("port", mode="before")
    @classmethod
    def _clean_port(cls, value: Optional[str]) -> Optional[str]:
        return validate_port_token(value)

    @field_validator("artifact_path", mode="before")
    @classmethod
    def _clean_artifact(cls, value: Optional[str]) -> Optional[str]:
        return validate_artifact_rel_path(value)


class UploadPreflightResponse(BaseModel):
    """Structured preflight check output prior to explicit user-triggered upload."""

    ready: bool
    project_dir: str
    project_name: str
    board_id: Optional[str] = None
    board_name: Optional[str] = None
    board_supported: bool = False
    uploader_path: Optional[str] = None
    python_path: Optional[str] = None
    command_convention_verified: bool = False
    contract_source: str = "provisional_adapter"
    resolved_invocation_mode: str = "positional_port_file"
    command_preview: List[str] = Field(default_factory=list)
    artifacts: List[FirmwareArtifactInfo] = Field(default_factory=list)
    selected_artifact: Optional[FirmwareArtifactInfo] = None
    artifact_ambiguous: bool = False
    devices: List[SerialDeviceInfo] = Field(default_factory=list)
    selected_port: Optional[str] = None
    port_verified_connected: bool = False
    checks: List[UploadPreflightCheck] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    blocking_issues: List[str] = Field(default_factory=list)
    needs_build: bool = False
    needs_sdk_doctor: bool = False
    needs_board_manager: bool = False


class UploadRequest(BaseModel):
    """Explicit user-initiated firmware upload execution request."""

    project_dir: str
    port: Optional[str] = None
    artifact_path: Optional[str] = None
    invocation_mode: UploadInvocationMode = "auto"
    timeout_seconds: int = Field(default=120, ge=5, le=600)
    allow_stale_artifact: bool = True
    strict_port_check: bool = False

    @field_validator("port", mode="before")
    @classmethod
    def _clean_port(cls, value: Optional[str]) -> Optional[str]:
        return validate_port_token(value)

    @field_validator("artifact_path", mode="before")
    @classmethod
    def _clean_artifact(cls, value: Optional[str]) -> Optional[str]:
        return validate_artifact_rel_path(value)


class UploadLogLine(BaseModel):
    """Single bounded upload output line."""

    seq: int
    timestamp: str
    stream: UploadStream
    text: str


class UploadSummary(BaseModel):
    """Summary and live state of a firmware upload execution."""

    upload_id: str
    project_dir: str
    project_name: str
    board_id: str
    board_name: str
    artifact_path: str
    artifact_size_bytes: int
    port: str
    invocation_mode: str
    command_preview: List[str] = Field(default_factory=list)
    command_convention_verified: bool = False
    status: UploadStatus
    started_at: str
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    cancelled: bool = False
    timed_out: bool = False
    error_message: Optional[str] = None
    progress_percent: Optional[float] = None
    progress_indeterminate: bool = True
    log_line_count: int = 0
    truncated_logs: bool = False


class UploadStateResponse(BaseModel):
    """Current upload status and buffered console logs."""

    active_upload: Optional[UploadSummary] = None
    latest_upload: Optional[UploadSummary] = None
    logs: List[UploadLogLine] = Field(default_factory=list)


class UploadHistoryResponse(BaseModel):
    """Bounded upload history newest-first."""

    history: List[UploadSummary] = Field(default_factory=list)
