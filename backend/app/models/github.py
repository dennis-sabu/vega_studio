"""VEGA Studio Backend – Pydantic models for Phase 13 GitHub Integration."""
from __future__ import annotations

import re
from typing import List, Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

GitHubVisibility = Literal["private", "public"]
GitHubOpKind = Literal[
    "auth_login",
    "fetch",
    "pull",
    "push",
    "create_repo",
    "publish",
]
GitHubOpStatus = Literal[
    "idle",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
]

_REMOTE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_REPO_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_SSH_GITHUB_RE = re.compile(
    r"^git@([A-Za-z0-9][A-Za-z0-9.-]*):([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$"
)


def validate_remote_name(raw_name: str) -> str:
    cleaned = raw_name.strip()
    if not cleaned:
        raise ValueError("Remote name must not be empty.")
    if not _REMOTE_NAME_RE.match(cleaned) or ".." in cleaned:
        raise ValueError(
            "Invalid remote name. Use letters, digits, '.', '_', or '-' (e.g. origin)."
        )
    return cleaned


def validate_repo_name(raw_name: str) -> str:
    cleaned = raw_name.strip()
    if not cleaned:
        raise ValueError("GitHub repository name must not be empty.")
    if cleaned in (".", "..", ".git") or cleaned.startswith("-") or cleaned.startswith(".") or cleaned.endswith("."):
        raise ValueError("Invalid GitHub repository name.")
    if not _REPO_NAME_RE.match(cleaned):
        raise ValueError(
            "Repository name may contain letters, digits, '.', '_', and '-' only."
        )
    return cleaned


def validate_remote_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if not cleaned or len(cleaned) > 512 or any(c in cleaned for c in ("\x00", "\n", "\r", " ")):
        raise ValueError("Remote URL is invalid.")
    if cleaned.startswith("-") or cleaned.startswith("ext::"):
        raise ValueError("Unsupported or unsafe Git remote URL.")

    if _SSH_GITHUB_RE.match(cleaned):
        return cleaned

    parsed = urlparse(cleaned)
    if parsed.scheme in ("https", "http"):
        if parsed.username or parsed.password:
            raise ValueError(
                "Embedded credentials in remote URLs are disallowed. Use GitHub CLI authentication instead."
            )
        if not parsed.hostname or not parsed.path or parsed.path == "/":
            raise ValueError("HTTPS remote URL must include host and repository path.")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("Only HTTPS remote URLs are permitted for external hosts.")
        return cleaned

    if parsed.scheme == "ssh":
        if parsed.password or (parsed.username and parsed.username != "git"):
            raise ValueError("SSH remote URL cannot contain embedded passwords or non-git userinfo.")
        if not parsed.hostname or parsed.hostname.startswith("-") or not parsed.path or parsed.path == "/":
            raise ValueError("SSH remote URL must include valid host and repository path.")
        return cleaned

    raise ValueError(
        "Unsupported remote URL format. Use HTTPS (https://github.com/owner/repo.git) or SSH (git@github.com:owner/repo.git)."
    )


class GitRemoteInfo(BaseModel):
    """Configured Git remote entry."""

    name: str
    fetch_url: str
    push_url: str
    is_github: bool = False
    github_owner_repo: Optional[str] = None


class GitHubCliInfo(BaseModel):
    """GitHub CLI (`gh`) installation and authentication snapshot (never includes tokens)."""

    gh_available: bool
    gh_version: Optional[str] = None
    gh_executable: Optional[str] = None
    install_guide_url: str = "https://cli.github.com/"
    unavailable_reason: Optional[str] = None
    authenticated: bool = False
    username: Optional[str] = None
    host: str = "github.com"
    git_protocol: Optional[str] = None
    auth_message: Optional[str] = None


class GitHubStatusResponse(BaseModel):
    """Unified GitHub CLI, authentication, and local project remote state."""

    cli: GitHubCliInfo
    project_dir: Optional[str] = None
    is_git_repository: bool = False
    current_branch: Optional[str] = None
    is_unborn: bool = False
    is_detached: bool = False
    repo_state: str = "not_a_repo"
    upstream: Optional[str] = None
    ahead: int = 0
    behind: int = 0
    remotes: List[GitRemoteInfo] = Field(default_factory=list)
    primary_remote: Optional[GitRemoteInfo] = None
    active_operation: Optional["GitHubOperationSummary"] = None
    latest_operation: Optional["GitHubOperationSummary"] = None


class GitHubRemoteAddRequest(BaseModel):
    project_dir: Optional[str] = None
    name: str = "origin"
    url: str

    @field_validator("name", mode="before")
    @classmethod
    def _v_name(cls, v: str) -> str:
        return validate_remote_name(str(v))

    @field_validator("url", mode="before")
    @classmethod
    def _v_url(cls, v: str) -> str:
        return validate_remote_url(str(v))


class GitHubRemoteUpdateRequest(GitHubRemoteAddRequest):
    confirm: bool = False


class GitHubRemoteRemoveRequest(BaseModel):
    project_dir: Optional[str] = None
    confirm: bool = False


class GitHubAuthStartRequest(BaseModel):
    git_protocol: Literal["https", "ssh"] = "https"


class GitHubCreateRepoRequest(BaseModel):
    project_dir: Optional[str] = None
    name: str
    description: str = Field(default="", max_length=350)
    visibility: GitHubVisibility = "private"
    add_readme: bool = False
    configure_remote: bool = True
    remote_name: str = "origin"
    confirm: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def _v_repo(cls, v: str) -> str:
        return validate_repo_name(str(v))

    @field_validator("remote_name", mode="before")
    @classmethod
    def _v_remote(cls, v: str) -> str:
        return validate_remote_name(str(v))

    @field_validator("description", mode="before")
    @classmethod
    def _v_desc(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        cleaned = str(v).replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()
        return cleaned[:350]


class GitHubPublishPreviewResponse(BaseModel):
    """Non-destructive publishing plan summary reviewed by user before creation/push."""

    project_dir: str
    project_name: str
    suggested_repo_name: str
    gh_available: bool
    authenticated: bool
    username: Optional[str] = None
    is_git_repository: bool
    is_unborn: bool
    is_detached: bool
    current_branch: Optional[str] = None
    head_commit: Optional[str] = None
    committed_ready: bool
    uncommitted_staged_count: int = 0
    uncommitted_unstaged_count: int = 0
    untracked_count: int = 0
    existing_remotes: List[GitRemoteInfo] = Field(default_factory=list)
    blockers: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class GitHubPublishRequest(BaseModel):
    project_dir: Optional[str] = None
    name: str
    description: str = Field(default="", max_length=350)
    visibility: GitHubVisibility = "private"
    remote_name: str = "origin"
    reuse_existing_remote: bool = False
    confirm: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def _v_repo(cls, v: str) -> str:
        return validate_repo_name(str(v))

    @field_validator("remote_name", mode="before")
    @classmethod
    def _v_remote(cls, v: str) -> str:
        return validate_remote_name(str(v))

    @field_validator("description", mode="before")
    @classmethod
    def _v_desc(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        return str(v).replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()[:350]


class GitHubSyncPrecheckResponse(BaseModel):
    """Pre-sync safety check returned before user confirms pull or push."""

    operation: Literal["fetch", "pull", "push"]
    project_dir: str
    current_branch: Optional[str] = None
    target_remote: Optional[str] = None
    upstream: Optional[str] = None
    needs_upstream_setup: bool = False
    is_unborn: bool = False
    is_detached: bool = False
    ahead: int = 0
    behind: int = 0
    staged_count: int = 0
    unstaged_count: int = 0
    untracked_count: int = 0
    conflicted_count: int = 0
    dirty_paths: List[str] = Field(default_factory=list)
    ready: bool = False
    blockers: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class GitHubFetchRequest(BaseModel):
    project_dir: Optional[str] = None
    remote: str = "origin"

    @field_validator("remote", mode="before")
    @classmethod
    def _v_remote(cls, v: str) -> str:
        return validate_remote_name(str(v))


class GitHubPullRequest(BaseModel):
    project_dir: Optional[str] = None
    remote: Optional[str] = None
    confirm: bool = False

    @field_validator("remote", mode="before")
    @classmethod
    def _v_remote(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        return validate_remote_name(str(v))


class GitHubPushRequest(BaseModel):
    project_dir: Optional[str] = None
    remote: Optional[str] = None
    set_upstream: bool = True
    confirm: bool = False

    @field_validator("remote", mode="before")
    @classmethod
    def _v_remote(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        return validate_remote_name(str(v))


class GitHubRemoteRepoDetail(BaseModel):
    """Explicitly fetched GitHub remote metadata and tracking branches."""

    owner_repo: str
    url: str
    ssh_url: Optional[str] = None
    visibility: Optional[str] = None
    description: Optional[str] = None
    default_branch: Optional[str] = None
    remote_branches: List[str] = Field(default_factory=list)
    current_branch: Optional[str] = None
    upstream: Optional[str] = None
    ahead: int = 0
    behind: int = 0


class GitHubOperationSummary(BaseModel):
    """Live or completed GitHub/sync subprocess status (tokens always redacted)."""

    op_id: str
    kind: GitHubOpKind
    status: GitHubOpStatus
    cancellable: bool = True
    project_dir: Optional[str] = None
    remote: Optional[str] = None
    branch: Optional[str] = None
    started_at: str
    finished_at: Optional[str] = None
    exit_code: Optional[int] = None
    cancelled: bool = False
    error_message: Optional[str] = None
    device_code: Optional[str] = None
    verification_url: Optional[str] = None
    output_lines: List[str] = Field(default_factory=list)
    truncated_output: bool = False
