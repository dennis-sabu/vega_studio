"""VEGA Studio Backend – Pydantic models for Phase 11 Integrated Terminal."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

TerminalStatus = Literal["starting", "running", "exited", "error", "closed"]
TerminalPtyBackend = Literal["posix_pty", "winpty_conpty", "unavailable"]

_SESSION_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")
_SHELL_ID_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


def validate_session_id(raw_id: str) -> str:
    """Validate backend-assigned terminal session identifier safely."""
    cleaned = raw_id.strip().lower()
    if not _SESSION_ID_RE.match(cleaned):
        raise ValueError("Invalid terminal session identifier.")
    return cleaned


def validate_shell_id(raw_shell: Optional[str]) -> Optional[str]:
    """Validate symbolic shell identifier (never accepts raw executable paths)."""
    if raw_shell is None:
        return None
    cleaned = raw_shell.strip().lower()
    if not cleaned:
        return None
    if not _SHELL_ID_RE.match(cleaned):
        raise ValueError(
            "Invalid shell identifier. Select one of the detected shells."
        )
    return cleaned


def _clean_optional_dir(raw_dir: Optional[str], label: str) -> Optional[str]:
    if raw_dir is None:
        return None
    cleaned = raw_dir.strip()
    if not cleaned:
        return None
    if len(cleaned) > 512 or "\x00" in cleaned:
        raise ValueError(f"{label} path is invalid.")
    return cleaned


class TerminalShellInfo(BaseModel):
    """Detected OS shell safe to launch inside the integrated terminal."""

    id: str
    label: str
    executable: str
    default_args: List[str] = Field(default_factory=list)
    available: bool = True
    is_default: bool = False


class TerminalShellsResponse(BaseModel):
    """Cross-platform shell and PTY capability report."""

    platform_os: str
    pty_backend: TerminalPtyBackend
    pty_supported: bool
    pty_message: Optional[str] = None
    default_shell_id: Optional[str] = None
    shells: List[TerminalShellInfo] = Field(default_factory=list)


class TerminalSessionCreateRequest(BaseModel):
    """Explicit user request to create and start an interactive PTY terminal."""

    shell_id: Optional[str] = None
    cwd: Optional[str] = None
    project_dir: Optional[str] = None
    cols: int = Field(default=100, ge=20, le=500)
    rows: int = Field(default=28, ge=5, le=200)
    title: Optional[str] = Field(default=None, max_length=60)

    @field_validator("shell_id", mode="before")
    @classmethod
    def _clean_shell(cls, value: Optional[str]) -> Optional[str]:
        return validate_shell_id(value)

    @field_validator("cwd", mode="before")
    @classmethod
    def _clean_cwd(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_dir(value, "Working directory")

    @field_validator("project_dir", mode="before")
    @classmethod
    def _clean_project_dir(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_dir(value, "Project directory")

    @field_validator("title", mode="before")
    @classmethod
    def _clean_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if "\x00" in cleaned or "\n" in cleaned or "\r" in cleaned:
            raise ValueError("Terminal title contains invalid characters.")
        return cleaned[:60]


class TerminalResizeRequest(BaseModel):
    """PTY column/row dimension update."""

    cols: int = Field(ge=20, le=500)
    rows: int = Field(ge=5, le=200)


class TerminalSessionSummary(BaseModel):
    """Snapshot summary of a backend-managed terminal session."""

    session_id: str
    title: str
    shell_id: str
    shell_label: str
    executable: str
    initial_cwd: str
    cwd: str
    project_dir: Optional[str] = None
    cols: int
    rows: int
    pid: Optional[int] = None
    status: TerminalStatus
    exit_code: Optional[int] = None
    error_message: Optional[str] = None
    created_at: str
    exited_at: Optional[str] = None
    last_activity_at: str
    output_bytes: int = 0
    buffer_bytes: int = 0
    buffer_truncated: bool = False


class TerminalSessionListResponse(BaseModel):
    """Active and retained terminal sessions plus configured limits."""

    max_sessions: int
    pty_backend: TerminalPtyBackend
    pty_supported: bool
    sessions: List[TerminalSessionSummary] = Field(default_factory=list)


class TerminalSessionStateResponse(BaseModel):
    """Detailed session state plus bounded buffered ANSI replay."""

    session: TerminalSessionSummary
    replay: str = ""


class TerminalCloseResponse(BaseModel):
    """Confirmation payload after closing a terminal session."""

    closed: bool
    session_id: str
