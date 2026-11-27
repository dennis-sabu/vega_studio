"""VEGA Studio Backend – Pydantic models for Phase 14 OpenCode CLI Integration."""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

OpenCodePermissionMode = Literal["ask_all", "workspace_assisted", "read_only"]
OpenCodeSessionStatus = Literal[
    "creating",
    "idle",
    "running",
    "waiting_permission",
    "interrupted",
    "completed",
    "error",
    "closed",
    "unavailable",
]
OpenCodePermissionDecision = Literal["once", "always", "reject"]
OpenCodeToolStatus = Literal["streaming", "running", "completed", "error"]
OpenCodeMessageRole = Literal["user", "assistant", "system", "tool", "error"]

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$")
_ALLOWED_EXECUTABLE_NAMES = frozenset(
    {
        "opencode",
        "opencode.exe",
        "opencode.cmd",
        "opencode.bat",
    }
)
_MODEL_REF_RE = re.compile(r"^[A-Za-z0-9._:/#-]{1,120}$")


def validate_opencode_session_id(raw_id: str) -> str:
    cleaned = raw_id.strip()
    if not _SESSION_ID_RE.match(cleaned) or ".." in cleaned:
        raise ValueError("Invalid OpenCode session identifier.")
    return cleaned


def validate_opencode_executable_path(raw_path: Optional[str]) -> Optional[str]:
    """Allow empty/null (auto-discover) or a validated path whose basename is opencode."""
    if raw_path is None:
        return None
    cleaned = raw_path.strip()
    if not cleaned:
        return None
    if "\x00" in cleaned or "\n" in cleaned or "\r" in cleaned:
        raise ValueError("Executable path contains invalid characters.")
    if cleaned.startswith("-"):
        raise ValueError("Executable path cannot begin with '-'.")
    basename = Path(cleaned).name.lower()
    if basename not in _ALLOWED_EXECUTABLE_NAMES:
        raise ValueError(
            "Executable must refer to the OpenCode CLI binary (opencode, opencode.exe, opencode.cmd, or opencode.bat)."
        )
    return cleaned


class OpenCodeConfig(BaseModel):
    """Non-secret persisted configuration for OpenCode CLI orchestration."""

    executable_path: Optional[str] = None
    default_permission_mode: OpenCodePermissionMode = "ask_all"
    default_model: Optional[str] = None
    startup_timeout_seconds: float = Field(default=20.0, ge=5.0, le=60.0)

    @field_validator("executable_path", mode="before")
    @classmethod
    def _v_exec(cls, value: Optional[str]) -> Optional[str]:
        return validate_opencode_executable_path(value)

    @field_validator("default_model", mode="before")
    @classmethod
    def _v_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        if not _MODEL_REF_RE.match(cleaned):
            raise ValueError("Invalid model reference format.")
        return cleaned


class OpenCodeConfigUpdateRequest(BaseModel):
    executable_path: Optional[str] = None
    default_permission_mode: OpenCodePermissionMode = "ask_all"
    default_model: Optional[str] = None
    startup_timeout_seconds: float = Field(default=20.0, ge=5.0, le=60.0)

    @field_validator("executable_path", mode="before")
    @classmethod
    def _v_exec(cls, value: Optional[str]) -> Optional[str]:
        return validate_opencode_executable_path(value)

    @field_validator("default_model", mode="before")
    @classmethod
    def _v_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        if not _MODEL_REF_RE.match(cleaned):
            raise ValueError("Invalid model reference format.")
        return cleaned


class OpenCodeModelOption(BaseModel):
    id: str
    name: str
    provider_id: Optional[str] = None


class OpenCodeInfoResponse(BaseModel):
    """OpenCode CLI detection, version, runtime health, and safety capabilities."""

    available: bool
    version: Optional[str] = None
    executable_path: Optional[str] = None
    configured_executable_path: Optional[str] = None
    executable_source: Literal["configured", "discovered", "missing"] = "missing"
    unavailable_reason: Optional[str] = None
    install_guide_url: str = "https://opencode.ai/docs"
    server_running: bool = False
    server_url: Optional[str] = None
    server_pid: Optional[int] = None
    active_sessions_count: int = 0
    max_active_sessions: int = 6
    sandbox_notice: str = (
        "Workspace boundaries and permission prompts restrict IDE operations cleanly, "
        "but do not form a kernel-level OS sandbox."
    )
    available_models: List[OpenCodeModelOption] = Field(default_factory=list)


class OpenCodeConfigStateResponse(BaseModel):
    config: OpenCodeConfig
    info: OpenCodeInfoResponse
    updated_at: Optional[str] = None


class OpenCodeContextAttachment(BaseModel):
    """Explicitly selected workspace file/selection/diagnostic context attached by user."""

    kind: Literal["selection", "file", "build_error", "serial_note"] = "selection"
    title: str = Field(max_length=160)
    relative_path: Optional[str] = Field(default=None, max_length=512)
    start_line: Optional[int] = Field(default=None, ge=1)
    end_line: Optional[int] = Field(default=None, ge=1)
    language: Optional[str] = Field(default=None, max_length=64)
    snippet: Optional[str] = Field(default=None, max_length=16384)
    truncated: bool = False


class OpenCodeSessionCreateRequest(BaseModel):
    project_dir: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=120)
    permission_mode: Optional[OpenCodePermissionMode] = None
    model: Optional[str] = None

    @field_validator("title", mode="before")
    @classmethod
    def _v_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()
        return cleaned[:120] or None

    @field_validator("model", mode="before")
    @classmethod
    def _v_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        if not _MODEL_REF_RE.match(cleaned):
            raise ValueError("Invalid model reference.")
        return cleaned


class OpenCodeSessionPromptRequest(BaseModel):
    project_dir: Optional[str] = None
    prompt: str = Field(min_length=1, max_length=32768)
    model: Optional[str] = None
    contexts: List[OpenCodeContextAttachment] = Field(default_factory=list, max_length=8)

    @field_validator("prompt", mode="before")
    @classmethod
    def _v_prompt(cls, value: str) -> str:
        cleaned = str(value).replace("\x00", "").strip()
        if not cleaned:
            raise ValueError("Prompt must not be empty.")
        return cleaned

    @field_validator("model", mode="before")
    @classmethod
    def _v_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        if not _MODEL_REF_RE.match(cleaned):
            raise ValueError("Invalid model reference.")
        return cleaned


class OpenCodePermissionReplyRequest(BaseModel):
    project_dir: Optional[str] = None
    decision: OpenCodePermissionDecision
    message: Optional[str] = Field(default=None, max_length=500)


class OpenCodeToolEvent(BaseModel):
    tool_id: str
    name: str
    status: OpenCodeToolStatus
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


class OpenCodeMessageItem(BaseModel):
    id: str
    role: OpenCodeMessageRole
    text: str = ""
    reasoning: Optional[str] = None
    tools: List[OpenCodeToolEvent] = Field(default_factory=list)
    contexts: List[OpenCodeContextAttachment] = Field(default_factory=list)
    created_at: str
    completed_at: Optional[str] = None
    is_streaming: bool = False


class OpenCodePermissionRequestInfo(BaseModel):
    request_id: str
    session_id: str
    opencode_session_id: str
    action: str
    resources: List[str] = Field(default_factory=list)
    message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_sensitive: bool = False
    sensitivity_reasons: List[str] = Field(default_factory=list)
    created_at: str
    status: Literal["pending", "approved_once", "approved_always", "rejected"] = "pending"


class OpenCodeSessionSummary(BaseModel):
    session_id: str
    opencode_session_id: Optional[str] = None
    title: str
    project_dir: str
    project_name: str
    status: OpenCodeSessionStatus
    permission_mode: OpenCodePermissionMode
    model: Optional[str] = None
    created_at: str
    updated_at: str
    last_error: Optional[str] = None
    pending_permissions_count: int = 0
    message_count: int = 0
    recoverable: bool = True


class OpenCodeSessionDetailResponse(BaseModel):
    session: OpenCodeSessionSummary
    messages: List[OpenCodeMessageItem] = Field(default_factory=list)
    pending_permissions: List[OpenCodePermissionRequestInfo] = Field(default_factory=list)
    truncated_messages: bool = False


class OpenCodeSessionListResponse(BaseModel):
    sessions: List[OpenCodeSessionSummary] = Field(default_factory=list)
    active_count: int = 0
    max_active_sessions: int = 6
