"""VEGA Studio Backend – Pydantic models for Phase 7 Firmware Build System."""
from __future__ import annotations

import re
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

BuildOperation = Literal["build", "clean", "rebuild"]
BuildMode = Literal["default", "debug", "release"]
BuildStatus = Literal[
    "idle",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
]
BuildDiagnosticSeverity = Literal["error", "warning"]
BuildStream = Literal["stdout", "stderr", "system"]

_TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_ENV_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,47}$")
_BUILD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

_FORBIDDEN_ENV_KEYS = frozenset(
    {
        "PATH",
        "SHELL",
        "MAKE",
        "MAKEFLAGS",
        "MFLAGS",
        "IFS",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "PYTHONPATH",
        "PYTHONHOME",
        "COMSPEC",
        "SYSTEMROOT",
    }
)


def validate_build_id(raw_id: str) -> str:
    cleaned = raw_id.strip()
    if not _BUILD_ID_RE.match(cleaned):
        raise ValueError("Invalid build identifier.")
    return cleaned


class BuildDiagnostic(BaseModel):
    """Single compiler or Make warning/error parsed from build output."""

    id: str
    severity: BuildDiagnosticSeverity
    message: str
    file_path: Optional[str] = None
    relative_path: Optional[str] = None
    line: Optional[int] = None
    column: Optional[int] = None
    raw_line: str


class BuildLogLine(BaseModel):
    """Single streamed line captured from stdout, stderr, or IDE build runner."""

    seq: int
    timestamp: str
    stream: BuildStream
    text: str


class BuildRequest(BaseModel):
    """Payload to start a firmware build, clean, or rebuild in the active project."""

    project_dir: str
    operation: BuildOperation = "build"
    target: Optional[str] = None
    clean_target: str = "clean"
    mode: BuildMode = "default"
    timeout_seconds: int = Field(default=180, ge=5, le=1800)
    env_overrides: Dict[str, str] = Field(default_factory=dict)

    @field_validator("target")
    @classmethod
    def _validate_target(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not _TARGET_RE.match(cleaned):
            raise ValueError(
                "Build target must start with a letter or digit and use only letters, digits, '.', '_', or '-'."
            )
        return cleaned

    @field_validator("clean_target")
    @classmethod
    def _validate_clean_target(cls, value: str) -> str:
        cleaned = value.strip() or "clean"
        if not _TARGET_RE.match(cleaned):
            raise ValueError("Invalid Make clean target name.")
        return cleaned

    @field_validator("env_overrides")
    @classmethod
    def _validate_env_overrides(cls, value: Dict[str, str]) -> Dict[str, str]:
        cleaned: Dict[str, str] = {}
        for k, v in value.items():
            key = k.strip()
            if not _ENV_KEY_RE.match(key):
                raise ValueError(
                    f"Environment override key '{k}' must match UPPER_SNAKE_CASE."
                )
            if key in _FORBIDDEN_ENV_KEYS:
                raise ValueError(
                    f"Environment variable '{key}' cannot be overridden for security reasons."
                )
            if "\x00" in v or "\n" in v or "\r" in v:
                raise ValueError(
                    f"Environment override '{key}' contains invalid control characters."
                )
            cleaned[key] = v
        return cleaned


class BuildSummary(BaseModel):
    """Metadata and execution status summary for a single build run."""

    build_id: str
    project_dir: str
    project_name: str
    operation: BuildOperation
    target: Optional[str] = None
    mode: BuildMode = "default"
    makefile_path: str
    command_preview: List[str]
    status: BuildStatus
    started_at: str
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    cancelled: bool = False
    timed_out: bool = False
    error_message: Optional[str] = None
    error_count: int = 0
    warning_count: int = 0
    log_line_count: int = 0
    truncated_logs: bool = False


class BuildStateResponse(BaseModel):
    """Current build snapshot including bounded log output and parsed diagnostics."""

    active_build: Optional[BuildSummary] = None
    latest_build: Optional[BuildSummary] = None
    logs: List[BuildLogLine] = Field(default_factory=list)
    diagnostics: List[BuildDiagnostic] = Field(default_factory=list)


class BuildHistoryResponse(BaseModel):
    """Bounded session history of build runs."""

    history: List[BuildSummary] = Field(default_factory=list)
