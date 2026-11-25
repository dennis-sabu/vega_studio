"""VEGA Studio Backend – Pydantic models for Phase 6 SDK integration & SDK Doctor."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

DiagnosticStatus = Literal["pass", "warning", "fail", "not_checked"]
DiagnosticCategory = Literal[
    "sdk",
    "toolchain",
    "build_prerequisites",
    "vega_config",
    "upload_prerequisites",
]

DEFAULT_CROSS_COMPILE_PREFIX = "riscv32-vega-elf"
DEFAULT_TARGET_ARCH = "rv32i_zicsr"
DEFAULT_TARGET_MACHINE = "THEJAS32"

_SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$")


def _clean_optional_path_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if "\x00" in cleaned:
        raise ValueError("Configured path cannot contain null bytes.")
    parts = cleaned.replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError("Configured path cannot contain '..' traversal segments.")
    return cleaned


def _clean_safe_token(value: str, fallback: str, label: str) -> str:
    cleaned = value.strip() or fallback
    if not _SAFE_TOKEN_RE.match(cleaned):
        raise ValueError(
            f"{label} must contain only letters, digits, '.', '_', '+', or '-'."
        )
    return cleaned


class SdkConfig(BaseModel):
    """Persistent machine-level VEGA SDK & toolchain configuration."""

    sdk_root: Optional[str] = None
    toolchain_root: Optional[str] = None
    compiler_path: Optional[str] = None
    cross_compile_prefix: str = DEFAULT_CROSS_COMPILE_PREFIX
    make_path: Optional[str] = None
    python_path: Optional[str] = None
    uploader_script: Optional[str] = None
    target_arch: str = DEFAULT_TARGET_ARCH
    target_machine: str = DEFAULT_TARGET_MACHINE
    extra_path_entries: List[str] = Field(default_factory=list)

    @field_validator(
        "sdk_root",
        "toolchain_root",
        "compiler_path",
        "make_path",
        "python_path",
        "uploader_script",
        mode="before",
    )
    @classmethod
    def _validate_optional_paths(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_path_str(value)

    @field_validator("cross_compile_prefix")
    @classmethod
    def _validate_prefix(cls, value: str) -> str:
        return _clean_safe_token(
            value, DEFAULT_CROSS_COMPILE_PREFIX, "Cross-compile prefix"
        )

    @field_validator("target_arch")
    @classmethod
    def _validate_arch(cls, value: str) -> str:
        return _clean_safe_token(
            value, DEFAULT_TARGET_ARCH, "Target architecture"
        )

    @field_validator("target_machine")
    @classmethod
    def _validate_machine(cls, value: str) -> str:
        return _clean_safe_token(
            value, DEFAULT_TARGET_MACHINE, "Target machine"
        )

    @field_validator("extra_path_entries", mode="before")
    @classmethod
    def _validate_extra_paths(cls, values: Optional[List[str]]) -> List[str]:
        if not values:
            return []
        cleaned: List[str] = []
        seen = set()
        for entry in values:
            norm = _clean_optional_path_str(entry)
            if norm and norm not in seen:
                seen.add(norm)
                cleaned.append(norm)
        return cleaned


class SdkConfigUpdateRequest(SdkConfig):
    """Payload to update SDK configuration in application storage."""

    pass


class SdkConfigStateResponse(BaseModel):
    """Current persisted SDK configuration state."""

    config: SdkConfig
    is_customized: bool = False
    updated_at: Optional[str] = None
    validation_warnings: List[str] = Field(default_factory=list)


class DiscoveredTool(BaseModel):
    """Discovered toolchain or prerequisite executable."""

    name: str
    path: str
    source: str


class SdkDiscoverRequest(BaseModel):
    """Optional parameters for controlled SDK discovery."""

    apply_to_config: bool = False


class SdkDiscoveryResult(BaseModel):
    """Result of bounded machine discovery for VEGA SDK components."""

    platform_os: str
    searched_locations: List[str] = Field(default_factory=list)
    sdk_root: Optional[str] = None
    toolchain_root: Optional[str] = None
    compiler_path: Optional[str] = None
    compiler_tools: List[DiscoveredTool] = Field(default_factory=list)
    make_path: Optional[str] = None
    python_path: Optional[str] = None
    uploader_script: Optional[str] = None
    suggested_config: SdkConfig
    notes: List[str] = Field(default_factory=list)


class SdkDiagnosticsRunRequest(BaseModel):
    """Optional config override when previewing diagnostics."""

    config_override: Optional[SdkConfig] = None


class DiagnosticCheckResult(BaseModel):
    """Single structured check emitted by SDK Doctor."""

    id: str
    category: DiagnosticCategory
    title: str
    status: DiagnosticStatus
    summary: str
    detail: Optional[str] = None
    detected_path: Optional[str] = None
    detected_version: Optional[str] = None
    command: Optional[str] = None
    output: Optional[str] = None
    remediation: Optional[str] = None


class DiagnosticSummaryCounts(BaseModel):
    """Aggregate pass/warning/fail/not_checked counts."""

    passed: int = 0
    warning: int = 0
    failed: int = 0
    not_checked: int = 0
    total: int = 0


class SdkDoctorReport(BaseModel):
    """Full SDK Doctor diagnostic report."""

    overall_status: DiagnosticStatus
    checked_at: Optional[str] = None
    platform_os: str
    platform_compatible: bool
    summary: DiagnosticSummaryCounts
    config_used: SdkConfig
    checks: List[DiagnosticCheckResult]
    companion_tools: List[DiscoveredTool] = Field(default_factory=list)
