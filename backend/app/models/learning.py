"""VEGA Studio Backend – Pydantic models for Phase 16 Examples, Documentation & Guided Learning."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

ExampleVerificationStatus = Literal[
    "template_verified",
    "conceptual",
    "sdk_discovered",
]
ExampleDifficulty = Literal["beginner", "intermediate", "advanced"]
ExampleSource = Literal["builtin", "local_sdk"]

DocBadge = Literal[
    "ide_verified",
    "hardware_specs_verified",
    "conceptual",
    "external_reference",
]

IdeActionId = Literal[
    "new_project",
    "open_project",
    "open_sdk_doctor",
    "open_sdk_settings",
    "open_board_manager",
    "open_build",
    "open_upload",
    "open_serial",
    "open_terminal",
    "open_git",
    "open_native_ai",
    "open_opencode",
    "open_examples",
]

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$")


def validate_learning_id(raw: str, label: str = "Identifier") -> str:
    cleaned = raw.strip()
    if not _SAFE_ID_RE.match(cleaned) or ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        raise ValueError(f"Invalid {label.lower()}: '{raw}'.")
    return cleaned


class ExampleSummary(BaseModel):
    id: str
    title: str
    category: str
    difficulty: ExampleDifficulty
    verification_status: ExampleVerificationStatus
    verification_note: str
    source: ExampleSource
    origin_label: str
    short_description: str
    compatible_boards: List[str] = Field(default_factory=lambda: ["VEGA_ARIES_V3"])
    required_sdk: str
    tags: List[str] = Field(default_factory=list)
    file_count: int = 0
    entry_file: Optional[str] = None


class ExampleFileInfo(BaseModel):
    relative_path: str
    size_bytes: int
    language: str
    is_binary: bool = False


class ExampleDetailResponse(BaseModel):
    example: ExampleSummary
    long_description: str
    learning_objectives: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    board_compatibility_note: str
    files: List[ExampleFileInfo] = Field(default_factory=list)
    readme_content: Optional[str] = None
    related_doc_slugs: List[str] = Field(default_factory=list)


class ExampleFileContentResponse(BaseModel):
    example_id: str
    relative_path: str
    content: str
    language: str
    size_bytes: int
    truncated: bool = False


class ExampleCatalogResponse(BaseModel):
    examples: List[ExampleSummary] = Field(default_factory=list)
    categories: List[str] = Field(default_factory=list)
    sdk_root_configured: bool = False
    sdk_examples_count: int = 0
    validation_warnings: List[str] = Field(default_factory=list)


class ExampleValidateRequest(BaseModel):
    project_dir: Optional[str] = None
    board_id: Optional[str] = "VEGA_ARIES_V3"


class ExampleValidationResponse(BaseModel):
    example_id: str
    valid: bool
    compatible: bool
    target_board_id: str
    board_supported: bool
    sdk_ready_note: str
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    planned_files: List[str] = Field(default_factory=list)


class CreateProjectFromExampleRequest(BaseModel):
    example_id: str
    project_name: str
    parent_dir: str
    board_id: str = "VEGA_ARIES_V3"
    description: Optional[str] = Field(default=None, max_length=300)
    confirm_overwrite: bool = False

    @field_validator("example_id")
    @classmethod
    def _clean_example_id(cls, value: str) -> str:
        return validate_learning_id(value, "Example ID")


# ── Documentation & Guided Workflows ─────────────────────────────────────────


class DocLinkRef(BaseModel):
    label: str
    url: str
    external: bool = True


class DocIdeActionRef(BaseModel):
    label: str
    action_id: IdeActionId


class DocPageSummary(BaseModel):
    slug: str
    title: str
    category: str
    summary: str
    tags: List[str] = Field(default_factory=list)
    badge: DocBadge = "ide_verified"
    estimated_minutes: int = 3
    related_example_ids: List[str] = Field(default_factory=list)


class DocPageDetailResponse(BaseModel):
    doc: DocPageSummary
    markdown_content: str
    related_slugs: List[str] = Field(default_factory=list)
    external_links: List[DocLinkRef] = Field(default_factory=list)
    ide_actions: List[DocIdeActionRef] = Field(default_factory=list)


class DocSearchResult(BaseModel):
    slug: str
    title: str
    category: str
    summary: str
    badge: DocBadge
    snippet: str
    score: int


class GuidedWorkflowStep(BaseModel):
    step_number: int
    title: str
    detail: str
    doc_slug: Optional[str] = None
    ide_action: Optional[DocIdeActionRef] = None


class GuidedWorkflowSummary(BaseModel):
    id: str
    title: str
    description: str
    difficulty: ExampleDifficulty
    estimated_minutes: int
    steps: List[GuidedWorkflowStep] = Field(default_factory=list)


class DocCatalogResponse(BaseModel):
    docs: List[DocPageSummary] = Field(default_factory=list)
    categories: List[str] = Field(default_factory=list)
    guides: List[GuidedWorkflowSummary] = Field(default_factory=list)


class DocSearchResponse(BaseModel):
    query: str
    results: List[DocSearchResult] = Field(default_factory=list)
