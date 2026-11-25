"""VEGA Studio Backend – Pydantic models for Phase 8 Board Manager."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.project import ProjectTarget, WorkspaceSummary

BoardSupportStatus = Literal["supported", "preview", "deprecated"]
CompatibilityStatus = Literal["compatible", "warning", "incompatible"]

_BOARD_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")


def validate_board_id_token(raw_id: str) -> str:
    cleaned = raw_id.strip()
    if not _BOARD_ID_RE.match(cleaned):
        raise ValueError(
            "Board ID must start with a letter or digit and use only letters, digits, '_', or '-'."
        )
    return cleaned


class BoardBuildProfile(BaseModel):
    """Trusted build-system settings tied to a verified VEGA board profile."""

    cross_compile_prefix: str
    expected_arch: str
    expected_machine: str
    build_system: str = "vega-sdk-make"


class BoardUploadProfile(BaseModel):
    """Verified/adaptable firmware upload integration contract for a board."""

    method: str = "vega-xmodem"
    uploader_name: str = "vega_xmodem.py"
    requires_port: bool = True
    artifact_extensions: List[str] = Field(
        default_factory=lambda: [".bin", ".elf", ".hex"]
    )
    command_convention_verified: bool = False
    notes: str = (
        "Orchestrates VEGA SDK vega_xmodem.py over USB-UART serial connection. "
        "Exact downstream CLI flags depend on the local SDK uploader script."
    )


class BoardProfile(BaseModel):
    """Verified hardware and toolchain profile for a supported target board."""

    id: str
    name: str
    vendor: str
    family: str
    status: BoardSupportStatus = "supported"
    architecture: str
    core: str
    cpu_frequency_mhz: int
    isa: str
    machine: str
    sram_kb: int
    sensors: List[str] = Field(default_factory=list)
    summary: str
    build: BoardBuildProfile
    upload: Optional[BoardUploadProfile] = None


class BoardListResponse(BaseModel):
    """Catalogue of registered hardware boards."""

    boards: List[BoardProfile] = Field(default_factory=list)


class CompatibilityCheckItem(BaseModel):
    """Individual compatibility check between a board profile and configured SDK."""

    id: str
    label: str
    status: CompatibilityStatus
    detail: str


class BoardCompatibilityReport(BaseModel):
    """Structured compatibility check between a board profile and local SDK config."""

    board_id: str
    board_name: str
    status: CompatibilityStatus
    compatible: bool
    checks: List[CompatibilityCheckItem] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)


class ProjectBoardStatusResponse(BaseModel):
    """Active project's selected board status, profile, and SDK compatibility."""

    project_dir: str
    selected_board_id: Optional[str] = None
    board_supported: bool
    board: Optional[BoardProfile] = None
    project_target: ProjectTarget
    compatibility: Optional[BoardCompatibilityReport] = None
    warnings: List[str] = Field(default_factory=list)


class SelectProjectBoardRequest(BaseModel):
    """Payload to assign a verified registry board target to an active project."""

    project_dir: str
    board_id: str

    @field_validator("board_id")
    @classmethod
    def _validate_board_id(cls, value: str) -> str:
        return validate_board_id_token(value)


class SelectProjectBoardResponse(BaseModel):
    """Updated workspace and board status after selecting a project board."""

    ok: bool = True
    workspace: WorkspaceSummary
    board_status: ProjectBoardStatusResponse
    message: str


class ValidateBoardCompatibilityRequest(BaseModel):
    """Payload to validate compatibility of a registered board with SDK config."""

    board_id: str

    @field_validator("board_id")
    @classmethod
    def _validate_board_id(cls, value: str) -> str:
        return validate_board_id_token(value)
