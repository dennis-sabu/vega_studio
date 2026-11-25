"""VEGA Studio Backend – Pydantic models for Phase 15 Native VEGA AI Assistant."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

AIProviderId = Literal["openai", "groq", "openai_compatible"]
AIRole = Literal["user", "assistant", "system"]
AIContextKind = Literal[
    "selection",
    "file",
    "build_error",
    "build_output",
    "serial_output",
    "terminal_output",
    "git_status",
    "board_sdk",
    "project_summary",
]
AIConversationStatus = Literal["idle", "streaming", "cancelled", "error"]
AICodeApplyMode = Literal["insert_at_cursor", "replace_selection", "replace_file"]

MAX_AI_PROMPT_CHARS = 16_000
MAX_AI_ATTACHMENT_CHARS = 8_000
MAX_AI_ATTACHMENTS = 8
MAX_AI_RESPONSE_CHARS = 64_000
MAX_AI_TITLE_CHARS = 120
MAX_AI_TOOL_OUTPUT_CHARS = 8_000

_SAFE_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_SAFE_CONV_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def validate_ai_model_name(raw: Optional[str]) -> Optional[str]:
    """Validate an AI model identifier safely."""
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    if len(cleaned) > 128 or not _SAFE_MODEL_RE.match(cleaned):
        raise ValueError(
            "Model identifier must be 1–128 characters of alphanumeric, '.', '_', '-', ':', or '/'."
        )
    return cleaned


def validate_ai_base_url(raw: Optional[str]) -> Optional[str]:
    """Validate optional custom OpenAI-compatible or proxy base URL (HTTP/HTTPS, no embedded creds)."""
    if raw is None:
        return None
    cleaned = raw.strip().rstrip("/")
    if not cleaned:
        return None
    if len(cleaned) > 512:
        raise ValueError("Base URL exceeds 512 characters.")
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Base URL must be a valid http:// or https:// URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(
            "Base URL must not embed credentials (user:pass@host). Configure API keys in the credential store instead."
        )
    return cleaned


def validate_ai_conversation_id(raw: str) -> str:
    cleaned = raw.strip()
    if not _SAFE_CONV_ID_RE.match(cleaned):
        raise ValueError("Invalid AI conversation identifier.")
    return cleaned


class AIProviderProfileConfig(BaseModel):
    """Non-secret configuration for a single provider."""

    model: str = "gpt-4o-mini"
    base_url: Optional[str] = None

    @field_validator("model")
    @classmethod
    def _clean_model(cls, value: str) -> str:
        checked = validate_ai_model_name(value)
        if not checked:
            raise ValueError("Model name cannot be empty.")
        return checked

    @field_validator("base_url")
    @classmethod
    def _clean_base_url(cls, value: Optional[str]) -> Optional[str]:
        return validate_ai_base_url(value)


class AIConfig(BaseModel):
    """Non-secret persisted settings for Native VEGA AI Assistant."""

    active_provider: AIProviderId = "openai"
    providers: Dict[AIProviderId, AIProviderProfileConfig] = Field(
        default_factory=lambda: {
            "openai": AIProviderProfileConfig(model="gpt-4o-mini", base_url=None),
            "groq": AIProviderProfileConfig(model="llama-3.3-70b-versatile", base_url=None),
            "openai_compatible": AIProviderProfileConfig(
                model="qwen2.5-coder:7b",
                base_url="http://127.0.0.1:11434/v1",
            ),
        }
    )
    temperature: float = Field(default=0.2, ge=0.0, le=1.5)
    max_tokens: int = Field(default=2048, ge=128, le=16384)
    timeout_seconds: float = Field(default=45.0, ge=5.0, le=180.0)
    allow_context_tools: bool = True
    auto_include_workspace_summary: bool = True


class AIConfigUpdateRequest(BaseModel):
    active_provider: AIProviderId = "openai"
    providers: Dict[AIProviderId, AIProviderProfileConfig]
    temperature: float = Field(default=0.2, ge=0.0, le=1.5)
    max_tokens: int = Field(default=2048, ge=128, le=16384)
    timeout_seconds: float = Field(default=45.0, ge=5.0, le=180.0)
    allow_context_tools: bool = True
    auto_include_workspace_summary: bool = True


class AICredentialUpdateRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=512)
    session_only: bool = False

    @field_validator("api_key")
    @classmethod
    def _clean_key(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned or any(ch.isspace() for ch in cleaned):
            raise ValueError("API key must be a non-empty single token without whitespace.")
        return cleaned


class AICredentialStatus(BaseModel):
    provider_id: AIProviderId
    has_api_key: bool
    key_hint: Optional[str] = None
    persistence_mode: Literal["os_keyring", "session_memory", "none"] = "none"


class AISecureStorageInfo(BaseModel):
    os_storage_available: bool
    backend_name: str
    detail: str


class AIProviderStatusInfo(BaseModel):
    id: AIProviderId
    label: str
    description: str
    default_base_url: str
    requires_base_url: bool
    api_key_optional: bool
    supports_streaming: bool
    supports_tools: bool
    recommended_models: List[str] = Field(default_factory=list)
    configured_model: str
    configured_base_url: Optional[str] = None
    credential: AICredentialStatus
    ready: bool
    status_reason: Optional[str] = None


class AIProvidersStateResponse(BaseModel):
    config: AIConfig
    storage: AISecureStorageInfo
    providers: List[AIProviderStatusInfo]
    updated_at: Optional[str] = None


class AIConnectionTestRequest(BaseModel):
    provider_id: AIProviderId
    model: Optional[str] = None
    base_url: Optional[str] = None
    api_key_override: Optional[str] = Field(default=None, max_length=512)

    @field_validator("model")
    @classmethod
    def _clean_model(cls, value: Optional[str]) -> Optional[str]:
        return validate_ai_model_name(value)

    @field_validator("base_url")
    @classmethod
    def _clean_url(cls, value: Optional[str]) -> Optional[str]:
        return validate_ai_base_url(value)


class AIConnectionTestResponse(BaseModel):
    ok: bool
    provider_id: AIProviderId
    endpoint: str
    model: str
    latency_ms: int
    message: str
    error_code: Optional[str] = None
    discovered_models: List[str] = Field(default_factory=list)


class AIContextAttachment(BaseModel):
    kind: AIContextKind
    title: str = Field(..., min_length=1, max_length=160)
    relative_path: Optional[str] = Field(default=None, max_length=512)
    start_line: Optional[int] = Field(default=None, ge=1, le=5_000_000)
    end_line: Optional[int] = Field(default=None, ge=1, le=5_000_000)
    language: Optional[str] = Field(default=None, max_length=48)
    snippet: Optional[str] = Field(default=None, max_length=MAX_AI_ATTACHMENT_CHARS + 512)
    truncated: bool = False

    @model_validator(mode="after")
    def _check_lines(self) -> "AIContextAttachment":
        if self.start_line is not None and self.end_line is not None and self.end_line < self.start_line:
            self.end_line = self.start_line
        return self


class AIToolTraceItem(BaseModel):
    call_id: str
    name: str
    arguments_preview: str
    status: Literal["running", "completed", "denied", "error"]
    output_preview: Optional[str] = None
    truncated: bool = False


class AIUsageInfo(BaseModel):
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class AIMessageItem(BaseModel):
    id: str
    seq: int
    role: AIRole
    content: str
    attachments: List[AIContextAttachment] = Field(default_factory=list)
    tool_traces: List[AIToolTraceItem] = Field(default_factory=list)
    provider_id: Optional[AIProviderId] = None
    model: Optional[str] = None
    finish_reason: Optional[str] = None
    usage: Optional[AIUsageInfo] = None
    error_message: Optional[str] = None
    created_at: str
    is_streaming: bool = False


class AIConversationSummary(BaseModel):
    conversation_id: str
    title: str
    project_dir: Optional[str] = None
    project_name: Optional[str] = None
    provider_id: Optional[AIProviderId] = None
    model: Optional[str] = None
    allow_tools: bool = True
    status: AIConversationStatus = "idle"
    message_count: int = 0
    created_at: str
    updated_at: str
    last_error: Optional[str] = None


class AIConversationDetailResponse(BaseModel):
    conversation: AIConversationSummary
    messages: List[AIMessageItem] = Field(default_factory=list)


class AIConversationListResponse(BaseModel):
    conversations: List[AIConversationSummary] = Field(default_factory=list)


class AIConversationCreateRequest(BaseModel):
    project_dir: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=MAX_AI_TITLE_CHARS)
    allow_tools: bool = True


class AIConversationUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=MAX_AI_TITLE_CHARS)
    allow_tools: Optional[bool] = None


class AISendMessageRequest(BaseModel):
    project_dir: Optional[str] = None
    prompt: str = Field(..., min_length=1, max_length=MAX_AI_PROMPT_CHARS)
    attachments: List[AIContextAttachment] = Field(default_factory=list, max_length=MAX_AI_ATTACHMENTS)
    provider_id: Optional[AIProviderId] = None
    model: Optional[str] = None
    allow_tools: Optional[bool] = None
    include_workspace_summary: Optional[bool] = None

    @field_validator("prompt")
    @classmethod
    def _clean_prompt(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Prompt cannot be empty.")
        return cleaned

    @field_validator("model")
    @classmethod
    def _clean_model(cls, value: Optional[str]) -> Optional[str]:
        return validate_ai_model_name(value)


class AIContextPreviewRequest(BaseModel):
    project_dir: Optional[str] = None
    attachments: List[AIContextAttachment] = Field(default_factory=list, max_length=MAX_AI_ATTACHMENTS)
    include_workspace_summary: bool = True


class AIContextPreviewResponse(BaseModel):
    project_dir: Optional[str] = None
    project_name: Optional[str] = None
    board_id: Optional[str] = None
    summary_sections: List[str] = Field(default_factory=list)
    included_attachments: List[AIContextAttachment] = Field(default_factory=list)
    excluded_warnings: List[str] = Field(default_factory=list)
    estimated_chars: int = 0
    redacted_secrets_count: int = 0


class AICodeApplyValidateRequest(BaseModel):
    project_dir: str = Field(..., min_length=1)
    relative_path: str = Field(..., min_length=1, max_length=512)
    mode: AICodeApplyMode
    code: str = Field(..., min_length=1, max_length=65_536)


class AICodeApplyValidateResponse(BaseModel):
    allowed: bool
    normalized_relative_path: str
    exists: bool
    is_protected: bool
    reason: Optional[str] = None
    current_excerpt: Optional[str] = None
