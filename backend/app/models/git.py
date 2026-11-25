"""VEGA Studio Backend – Pydantic models for Phase 12 Native Git Integration."""
from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

GitFileStatusCode = Literal[
    "modified",
    "added",
    "deleted",
    "renamed",
    "copied",
    "typechange",
    "unmerged",
    "untracked",
]

GitRepoState = Literal[
    "clean",
    "dirty",
    "unborn",
    "detached",
    "merging",
    "rebasing",
    "cherry_picking",
    "not_a_repo",
    "git_unavailable",
]

_COMMIT_HASH_RE = re.compile(r"^[0-9a-fA-F]{4,64}$")
_BRANCH_NAME_INVALID_RE = re.compile(r"[\s~^:?*\[\]\\@\x00-\x1f\x7f]")


def validate_commit_hash(raw_hash: str) -> str:
    cleaned = raw_hash.strip()
    if not _COMMIT_HASH_RE.match(cleaned):
        raise ValueError("Invalid Git commit hash.")
    return cleaned


def validate_branch_name(raw_name: str) -> str:
    cleaned = raw_name.strip()
    if not cleaned:
        raise ValueError("Branch name must not be empty.")
    if len(cleaned) > 120:
        raise ValueError("Branch name must be 120 characters or fewer.")
    if cleaned.startswith("-") or cleaned.startswith(".") or cleaned.endswith("."):
        raise ValueError("Branch name cannot start with '-' or start/end with '.'.")
    if ".." in cleaned or "//" in cleaned or cleaned.endswith(".lock"):
        raise ValueError("Branch name contains invalid ref sequence.")
    if _BRANCH_NAME_INVALID_RE.search(cleaned):
        raise ValueError("Branch name contains unsupported Git ref characters.")
    return cleaned


def validate_repo_rel_path(raw_path: str) -> str:
    cleaned = raw_path.strip().replace("\\", "/")
    if not cleaned:
        raise ValueError("File path must not be empty.")
    if len(cleaned) > 512 or "\x00" in cleaned:
        raise ValueError("File path is invalid.")
    if cleaned.startswith("/") or (len(cleaned) >= 2 and cleaned[1] == ":"):
        raise ValueError("File path must be relative to the repository root.")
    parts = cleaned.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("File path cannot contain '.' or '..' traversal segments.")
    if parts[0].lower() == ".git":
        raise ValueError("Direct Git operations on '.git' internals are disallowed.")
    return cleaned


class GitFileChange(BaseModel):
    """Single changed file returned from porcelain v2 Git status."""

    path: str
    orig_path: Optional[str] = None
    status: GitFileStatusCode
    staged: bool
    unstaged: bool
    untracked: bool
    conflicted: bool = False
    xy: str = ""


class GitInfoResponse(BaseModel):
    """Git CLI capability and repository binding status for a project."""

    git_available: bool
    git_version: Optional[str] = None
    git_executable: Optional[str] = None
    install_guide_url: str = "https://git-scm.com/downloads"
    unavailable_reason: Optional[str] = None
    project_dir: Optional[str] = None
    is_repository: bool = False
    repo_root: Optional[str] = None
    has_parent_repo: bool = False
    parent_repo_root: Optional[str] = None
    identity_configured: bool = False
    user_name: Optional[str] = None
    user_email: Optional[str] = None


class GitStatusResponse(BaseModel):
    """Full machine-parsed Git status for the active project."""

    git_available: bool
    git_version: Optional[str] = None
    project_dir: str
    is_repository: bool
    repo_root: Optional[str] = None
    has_parent_repo: bool = False
    parent_repo_root: Optional[str] = None
    repo_state: GitRepoState
    current_branch: Optional[str] = None
    head_commit: Optional[str] = None
    upstream: Optional[str] = None
    ahead: int = 0
    behind: int = 0
    is_unborn: bool = False
    is_detached: bool = False
    staged_files: List[GitFileChange] = Field(default_factory=list)
    unstaged_files: List[GitFileChange] = Field(default_factory=list)
    untracked_files: List[GitFileChange] = Field(default_factory=list)
    conflicted_files: List[GitFileChange] = Field(default_factory=list)
    staged_count: int = 0
    unstaged_count: int = 0
    untracked_count: int = 0
    identity_configured: bool = False
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class GitProjectRequest(BaseModel):
    """Generic repository-scoped request targeting a project directory."""

    project_dir: Optional[str] = None


class GitPathsRequest(BaseModel):
    """Repository-scoped operation targeting one or more validated paths."""

    project_dir: Optional[str] = None
    paths: List[str] = Field(min_length=1, max_length=200)

    @field_validator("paths", mode="before")
    @classmethod
    def _clean_paths(cls, value: List[str]) -> List[str]:
        if not isinstance(value, list) or len(value) == 0:
            raise ValueError("Provide at least one repository file path.")
        cleaned: List[str] = []
        seen = set()
        for raw in value:
            norm = validate_repo_rel_path(str(raw))
            if norm not in seen:
                seen.add(norm)
                cleaned.append(norm)
        return cleaned


class GitConfirmPathsRequest(GitPathsRequest):
    """Destructive working-tree operation requiring explicit confirmation."""

    confirm: bool = False


class GitCommitRequest(BaseModel):
    """Commit explicitly staged changes with a non-empty commit message."""

    project_dir: Optional[str] = None
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message", mode="before")
    @classmethod
    def _clean_message(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Commit message must be text.")
        if "\x00" in value:
            raise ValueError("Commit message contains invalid null bytes.")
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Commit message cannot be empty.")
        return cleaned


class GitCommitResponse(BaseModel):
    """Result after committing staged changes."""

    commit_hash: str
    short_hash: str
    branch: Optional[str] = None
    summary: str
    status: GitStatusResponse


class GitBranchInfo(BaseModel):
    """Local Git branch descriptor."""

    name: str
    is_current: bool
    commit_hash: str
    short_hash: str
    subject: str = ""
    committer_date: Optional[str] = None


class GitBranchesResponse(BaseModel):
    """Local repository branches."""

    current_branch: Optional[str] = None
    is_detached: bool = False
    is_unborn: bool = False
    branches: List[GitBranchInfo] = Field(default_factory=list)


class GitBranchSwitchRequest(BaseModel):
    """Switch active HEAD to a local branch safely."""

    project_dir: Optional[str] = None
    name: str

    @field_validator("name", mode="before")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return validate_branch_name(str(value))


class GitBranchCreateRequest(BaseModel):
    """Create a new local branch from current HEAD."""

    project_dir: Optional[str] = None
    name: str
    checkout: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return validate_branch_name(str(value))


class GitSwitchPrecheckResponse(BaseModel):
    """Advisory check before switching branches to warn about local changes."""

    target_branch: str
    has_uncommitted_changes: bool
    potentially_affected_files: List[str] = Field(default_factory=list)
    dirty_files: List[str] = Field(default_factory=list)
    warning: Optional[str] = None


class GitBranchActionResponse(BaseModel):
    """Updated branch list and repository status after branch creation or switch."""

    active_branch: Optional[str] = None
    status: GitStatusResponse
    branches: List[GitBranchInfo] = Field(default_factory=list)


class GitCommitSummary(BaseModel):
    """Single commit entry returned in paginated Git history."""

    hash: str
    short_hash: str
    author_name: str
    author_email: str
    authored_at: str
    subject: str
    parents: List[str] = Field(default_factory=list)


class GitHistoryResponse(BaseModel):
    """Bounded paginated commit history."""

    branch: Optional[str] = None
    limit: int
    offset: int
    has_more: bool
    commits: List[GitCommitSummary] = Field(default_factory=list)


class GitCommitFileStat(BaseModel):
    """Per-file change metadata within a commit detail view."""

    path: str
    orig_path: Optional[str] = None
    status: GitFileStatusCode
    insertions: Optional[int] = None
    deletions: Optional[int] = None
    is_binary: bool = False


class GitCommitDetailResponse(BaseModel):
    """Detailed commit metadata, changed files, and bounded unified diff."""

    hash: str
    short_hash: str
    author_name: str
    author_email: str
    authored_at: str
    subject: str
    body: str = ""
    parents: List[str] = Field(default_factory=list)
    files: List[GitCommitFileStat] = Field(default_factory=list)
    total_insertions: int = 0
    total_deletions: int = 0
    unified_diff: str = ""
    diff_truncated: bool = False
    diff_bytes: int = 0


class GitDiffResponse(BaseModel):
    """Bounded file diff payload supporting both unified diff and Monaco DiffEditor."""

    path: str
    change_type: GitFileStatusCode
    staged: bool
    commit: Optional[str] = None
    is_binary: bool = False
    too_large: bool = False
    truncated: bool = False
    total_bytes: int = 0
    added_lines: int = 0
    removed_lines: int = 0
    unified_diff: str = ""
    original_content: Optional[str] = None
    modified_content: Optional[str] = None
    note: Optional[str] = None
