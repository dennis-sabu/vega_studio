"""VEGA Studio Backend – Pydantic models for portable project metadata and workspace state."""
from __future__ import annotations

from pathlib import PurePosixPath, PureWindowsPath
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

PROJECT_SCHEMA_VERSION = "1.0"
PROJECT_METADATA_FILENAME = "vega-project.json"

ProjectTemplate = Literal["minimal", "empty"]
TargetBoard = str


def _is_safe_relative_path(raw: str) -> bool:
    """Return True if raw is a clean relative sub-path without traversal or drive roots."""
    if not raw or "\x00" in raw:
        return False
    if raw.startswith("/") or raw.startswith("\\"):
        return False
    if PureWindowsPath(raw).is_absolute() or PurePosixPath(raw).is_absolute():
        return False
    parts = raw.replace("\\", "/").split("/")
    return all(part not in ("", ".", "..") for part in parts)


class ProjectTarget(BaseModel):
    """Target hardware descriptor (portable, board-scoped)."""

    board: Optional[TargetBoard] = "VEGA_ARIES_V3"
    arch: str = "rv32i_zicsr"
    machine: str = "THEJAS32"

    @field_validator("board", mode="before")
    @classmethod
    def _clean_board(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Board identifier must be a string or null.")
        cleaned = value.strip()
        return cleaned or None


class ProjectBuildConfig(BaseModel):
    """Project-relative build layout (never stores host SDK or compiler paths)."""

    system: Literal["vega-sdk-make"] = "vega-sdk-make"
    makefile: str = "Makefile"
    sourceDir: str = "src"
    includeDir: str = "include"

    @field_validator("makefile", "sourceDir", "includeDir")
    @classmethod
    def _validate_relative(cls, value: str) -> str:
        cleaned = value.strip()
        if not _is_safe_relative_path(cleaned):
            raise ValueError(
                f"Build path '{value}' must be a safe project-relative path."
            )
        return cleaned


class VegaProjectMetadata(BaseModel):
    """Portable vega-project.json schema (v1.x)."""

    schemaVersion: str = PROJECT_SCHEMA_VERSION
    name: str
    description: str = ""
    template: ProjectTemplate = "minimal"
    target: ProjectTarget = Field(default_factory=ProjectTarget)
    build: ProjectBuildConfig = Field(default_factory=ProjectBuildConfig)
    createdAt: str
    updatedAt: str

    @field_validator("schemaVersion")
    @classmethod
    def _validate_schema_version(cls, value: str) -> str:
        cleaned = value.strip()
        major = cleaned.split(".", 1)[0]
        if major != "1":
            raise ValueError(
                f"Unsupported project schemaVersion '{value}'. Expected '1.x'."
            )
        return cleaned

    @field_validator("name")
    @classmethod
    def _validate_name_non_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name in vega-project.json cannot be empty.")
        return cleaned


class CreateProjectRequest(BaseModel):
    """Payload to create a new VEGA Studio project."""

    name: str
    parent_dir: str
    description: str = ""
    template: ProjectTemplate = "minimal"


class OpenProjectRequest(BaseModel):
    """Payload to open an existing VEGA Studio project directory."""

    project_dir: str


class RemoveRecentRequest(BaseModel):
    """Payload to remove an entry from the recent projects list."""

    project_dir: str


class ProjectEntrySummary(BaseModel):
    """Read-only summary of a top-level item inside a project directory."""

    name: str
    kind: Literal["dir", "file"]


class WorkspaceSummary(BaseModel):
    """Active opened project context returned to the frontend shell."""

    project: VegaProjectMetadata
    project_dir: str
    structure_valid: bool
    warnings: List[str]
    top_level_entries: List[ProjectEntrySummary]


class RecentProjectEntry(BaseModel):
    """Tracked recent project record stored in local SQLite state."""

    name: str
    project_dir: str
    board: str
    schema_version: str
    last_opened_at: str
    exists: bool


class WorkspaceStateResponse(BaseModel):
    """Current workspace restoration state and recent project history."""

    active_project: Optional[WorkspaceSummary] = None
    recent_projects: List[RecentProjectEntry] = Field(default_factory=list)
    default_projects_dir: str
    warning: Optional[str] = None
