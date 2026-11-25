"""VEGA Studio Backend – Pydantic models for Phase 4 File Explorer."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

EntryKind = Literal["file", "dir"]
ExplorerAction = Literal["create", "rename", "delete"]
LineEnding = Literal["LF", "CRLF"]


class FileNode(BaseModel):
    """Single filesystem entry inside an active VEGA Studio project."""

    name: str
    path: str  # Project-relative POSIX path (e.g., "src/main.c")
    kind: EntryKind
    size: Optional[int] = None
    extension: str = ""
    has_children: bool = False
    accessible: bool = True
    error: Optional[str] = None


class DirectoryListingResponse(BaseModel):
    """Entries inside a specific directory of the active project."""

    project_dir: str
    relative_path: str
    entries: List[FileNode] = Field(default_factory=list)
    truncated: bool = False
    total_count: int = 0


class FileStatResponse(BaseModel):
    """Read-only metadata for a selected file."""

    name: str
    relative_path: str
    size: int
    extension: str
    language: str
    is_binary: bool
    modified_at: str


class FileReadResponse(BaseModel):
    """Text file content and metadata returned to the Monaco editor."""

    name: str
    relative_path: str
    content: str
    encoding: str = "utf-8"
    line_ending: LineEnding = "LF"
    size: int
    extension: str
    language: str
    monaco_language: str
    modified_at: str
    version_stamp: str


class FileWriteRequest(BaseModel):
    """Payload to save edited file content inside the active project root."""

    project_dir: str
    relative_path: str
    content: str
    expected_version: Optional[str] = None
    overwrite_conflict: bool = False


class FileWriteResponse(BaseModel):
    """Result of an atomic save operation inside the active project."""

    ok: bool = True
    relative_path: str
    size: int
    modified_at: str
    version_stamp: str
    line_ending: LineEnding
    message: str


class CreateEntryRequest(BaseModel):
    """Payload to create a new empty file or folder inside the active project."""

    project_dir: str
    parent_path: str = ""
    name: str
    kind: EntryKind


class RenameEntryRequest(BaseModel):
    """Payload to rename an existing file or folder inside the active project."""

    project_dir: str
    target_path: str
    new_name: str


class DeleteEntryRequest(BaseModel):
    """Payload to delete a file or folder inside the active project."""

    project_dir: str
    target_path: str
    recursive: bool = False


class EntryOperationResponse(BaseModel):
    """Result of a filesystem mutation inside the active project."""

    ok: bool = True
    action: ExplorerAction
    relative_path: str
    previous_path: Optional[str] = None
    node: Optional[FileNode] = None
    message: str
