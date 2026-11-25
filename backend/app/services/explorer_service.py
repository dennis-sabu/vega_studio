"""VEGA Studio Backend – Safe, root-confined File Explorer service."""
from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

from app.config import Settings, settings
from app.models.explorer import (
    CreateEntryRequest,
    DeleteEntryRequest,
    DirectoryListingResponse,
    EntryKind,
    EntryOperationResponse,
    FileNode,
    FileStatResponse,
    RenameEntryRequest,
)
from app.models.project import PROJECT_METADATA_FILENAME
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    validate_directory_input,
)

MAX_DIR_ENTRIES = 500
_INVALID_ENTRY_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAMES = frozenset(
    {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
)
# Internal IDE directory names that must never surface as user project files.
_INTERNAL_IDE_DIRS = frozenset({".vega-studio"})

_LANGUAGE_MAP = {
    ".c": "C Source",
    ".h": "C Header",
    ".cpp": "C++ Source",
    ".cc": "C++ Source",
    ".cxx": "C++ Source",
    ".hpp": "C++ Header",
    ".s": "Assembly",
    ".asm": "Assembly",
    ".mk": "Makefile",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".md": "Markdown",
    ".txt": "Plain Text",
    ".py": "Python",
    ".sh": "Shell Script",
}


class ExplorerServiceError(Exception):
    """Domain error with an HTTP status code for File Explorer operations."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def validate_entry_name(raw_name: str) -> str:
    """Validate a single file or folder name across Windows and Linux."""
    name = raw_name.strip()
    if not name:
        raise ExplorerServiceError("Name cannot be empty.", 400)
    if len(name) > 128:
        raise ExplorerServiceError("Name must be 128 characters or fewer.", 400)
    if name in (".", "..") or ".." in name:
        raise ExplorerServiceError(
            "Name cannot be '.' or '..' or contain '..'.", 400
        )
    if _INVALID_ENTRY_CHARS_RE.search(name):
        raise ExplorerServiceError(
            "Name contains invalid filesystem characters.", 400
        )
    if name.endswith(".") or name.endswith(" "):
        raise ExplorerServiceError(
            "Name cannot end with a period or space.", 400
        )
    if name.split(".")[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise ExplorerServiceError(
            f"'{name}' is a reserved system device name.", 400
        )
    if name in _INTERNAL_IDE_DIRS:
        raise ExplorerServiceError(
            f"'{name}' is reserved for internal VEGA Studio metadata.", 400
        )
    return name


def _normalize_relative_path(raw_rel: str) -> Tuple[str, List[str]]:
    """Validate and normalize a project-relative POSIX path."""
    cleaned = raw_rel.strip().replace("\\", "/")
    if not cleaned:
        return "", []
    if "\x00" in cleaned:
        raise ExplorerServiceError("Path contains invalid null byte.", 400)
    if cleaned.startswith("/") or (len(cleaned) >= 2 and cleaned[1] == ":"):
        raise ExplorerServiceError(
            "Explorer path must be relative to the active project root.", 400
        )
    parts = [p for p in cleaned.split("/") if p != ""]
    for part in parts:
        if part in (".", "..") or ".." in part:
            raise ExplorerServiceError(
                "Path cannot contain '.' or '..' traversal segments.", 400
            )
        if part in _INTERNAL_IDE_DIRS:
            raise ExplorerServiceError(
                "Access to internal IDE directory is not permitted.", 403
            )
    return "/".join(parts), parts


def _detect_language(name: str, ext: str) -> str:
    lower_name = name.lower()
    if lower_name == "makefile" or lower_name.startswith("makefile."):
        return "Makefile"
    if lower_name == ".gitignore":
        return "Git Ignore"
    return _LANGUAGE_MAP.get(ext.lower(), "Plain Text")


class ExplorerService:
    """Provides root-confined directory browsing and safe file/folder mutations."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._project_service = ProjectService(self._settings)

    def _resolve_project_root(self, raw_project_dir: str) -> Path:
        """Verify project_dir exists and is a valid VEGA Studio project root."""
        try:
            project_path = validate_directory_input(
                raw_project_dir, label="Project directory"
            )
        except ProjectServiceError as exc:
            raise ExplorerServiceError(exc.message, exc.status_code) from exc

        if not project_path.exists() or not project_path.is_dir():
            raise ExplorerServiceError(
                f"Project directory '{project_path}' does not exist.", 404
            )

        meta_path = project_path / PROJECT_METADATA_FILENAME
        if not meta_path.is_file():
            raise ExplorerServiceError(
                f"Directory '{project_path}' is not an active VEGA Studio project.",
                400,
            )

        try:
            return project_path.resolve(strict=True)
        except OSError as exc:
            raise ExplorerServiceError(
                f"Unable to resolve project root: {exc}", 400
            ) from exc

    def _resolve_inside_root(
        self,
        project_root: Path,
        raw_rel_path: str,
        *,
        must_exist: bool = True,
    ) -> Tuple[str, Path]:
        """Resolve a project-relative path while preventing traversal and symlink escapes."""
        norm_rel, parts = _normalize_relative_path(raw_rel_path)
        current = project_root

        for idx, part in enumerate(parts):
            current = current / part
            is_last = idx == len(parts) - 1
            if current.is_symlink():
                try:
                    resolved = current.resolve(strict=True)
                except OSError as exc:
                    raise ExplorerServiceError(
                        f"Broken symlink at '{'/'.join(parts[: idx + 1])}': {exc}",
                        400,
                    ) from exc
                if not resolved.is_relative_to(project_root):
                    raise ExplorerServiceError(
                        "Access denied: symlink escapes the active project root.",
                        403,
                    )
            if not is_last and not current.exists():
                raise ExplorerServiceError(
                    f"Parent directory '{'/'.join(parts[: idx + 1])}' does not exist.",
                    404,
                )

        if must_exist and not (current.exists() or current.is_symlink()):
            raise ExplorerServiceError(
                f"Path '{norm_rel or '.'}' does not exist in project.", 404
            )

        # Verify canonical containment for existing nodes (or existing parent for new nodes).
        check_target = current if (current.exists() and not current.is_symlink()) else current.parent
        try:
            resolved_check = check_target.resolve(strict=True)
        except OSError as exc:
            raise ExplorerServiceError(
                f"Unable to access path '{norm_rel}': {exc}", 400
            ) from exc

        if not resolved_check.is_relative_to(project_root):
            raise ExplorerServiceError(
                "Access denied: path resolves outside the active project root.",
                403,
            )

        return norm_rel, current

    def _build_node(
        self,
        entry: Path,
        project_root: Path,
        parent_rel: str,
        show_hidden: bool,
    ) -> Optional[FileNode]:
        """Convert a directory entry into a safe FileNode without crashing on errors."""
        name = entry.name
        if name in _INTERNAL_IDE_DIRS:
            return None
        if not show_hidden and name.startswith("."):
            return None

        rel_path = f"{parent_rel}/{name}" if parent_rel else name

        # Guard against external symlinks
        if entry.is_symlink():
            try:
                resolved = entry.resolve(strict=True)
                if not resolved.is_relative_to(project_root):
                    return FileNode(
                        name=name,
                        path=rel_path,
                        kind="dir" if resolved.is_dir() else "file",
                        accessible=False,
                        error="Symlink points outside project root",
                    )
            except OSError:
                return FileNode(
                    name=name,
                    path=rel_path,
                    kind="file",
                    accessible=False,
                    error="Unreachable symlink",
                )

        try:
            is_dir = entry.is_dir()
            if is_dir:
                has_children = False
                try:
                    for child in entry.iterdir():
                        if child.name in _INTERNAL_IDE_DIRS:
                            continue
                        if not show_hidden and child.name.startswith("."):
                            continue
                        has_children = True
                        break
                except OSError:
                    has_children = False
                return FileNode(
                    name=name,
                    path=rel_path,
                    kind="dir",
                    has_children=has_children,
                    accessible=True,
                )

            stat = entry.stat()
            return FileNode(
                name=name,
                path=rel_path,
                kind="file",
                size=stat.st_size,
                extension=entry.suffix.lower(),
                has_children=False,
                accessible=True,
            )
        except OSError as exc:
            return FileNode(
                name=name,
                path=rel_path,
                kind="file",
                accessible=False,
                error=str(exc),
            )

    def list_directory(
        self,
        raw_project_dir: str,
        raw_rel_path: str = "",
        show_hidden: bool = True,
    ) -> DirectoryListingResponse:
        """List directory contents strictly inside the active project root."""
        project_root = self._resolve_project_root(raw_project_dir)
        norm_rel, target_dir = self._resolve_inside_root(
            project_root, raw_rel_path, must_exist=True
        )

        if not target_dir.is_dir():
            raise ExplorerServiceError(
                f"'{norm_rel}' is not a directory.", 400
            )

        try:
            raw_entries = list(target_dir.iterdir())
        except PermissionError as exc:
            raise ExplorerServiceError(
                f"Permission denied accessing '{norm_rel or '.'}': {exc}", 403
            ) from exc
        except OSError as exc:
            raise ExplorerServiceError(
                f"Unable to read directory '{norm_rel or '.'}': {exc}", 500
            ) from exc

        nodes: List[FileNode] = []
        for entry in raw_entries:
            node = self._build_node(entry, project_root, norm_rel, show_hidden)
            if node is not None:
                nodes.append(node)

        nodes.sort(key=lambda n: (n.kind != "dir", n.name.lower(), n.name))
        total_count = len(nodes)
        truncated = total_count > MAX_DIR_ENTRIES
        if truncated:
            nodes = nodes[:MAX_DIR_ENTRIES]

        return DirectoryListingResponse(
            project_dir=str(project_root),
            relative_path=norm_rel,
            entries=nodes,
            truncated=truncated,
            total_count=total_count,
        )

    def stat_file(
        self, raw_project_dir: str, raw_rel_path: str
    ) -> FileStatResponse:
        """Inspect read-only metadata of a file inside the project (Phase 5 boundary)."""
        project_root = self._resolve_project_root(raw_project_dir)
        norm_rel, target = self._resolve_inside_root(
            project_root, raw_rel_path, must_exist=True
        )
        if not norm_rel:
            raise ExplorerServiceError("Cannot inspect project root as a file.", 400)
        if not target.is_file():
            raise ExplorerServiceError(f"'{norm_rel}' is not a regular file.", 400)

        try:
            stat = target.stat()
            with open(target, "rb") as handle:
                head = handle.read(1024)
            is_binary = b"\x00" in head
        except PermissionError as exc:
            raise ExplorerServiceError(
                f"Permission denied reading '{norm_rel}': {exc}", 403
            ) from exc
        except OSError as exc:
            raise ExplorerServiceError(
                f"Failed to inspect '{norm_rel}': {exc}", 500
            ) from exc

        modified_at = datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat()
        ext = target.suffix.lower()

        return FileStatResponse(
            name=target.name,
            relative_path=norm_rel,
            size=stat.st_size,
            extension=ext,
            language=_detect_language(target.name, ext),
            is_binary=is_binary,
            modified_at=modified_at,
        )

    def create_entry(self, req: CreateEntryRequest) -> EntryOperationResponse:
        """Create a new empty file or directory safely inside the active project."""
        project_root = self._resolve_project_root(req.project_dir)
        parent_rel, parent_dir = self._resolve_inside_root(
            project_root, req.parent_path, must_exist=True
        )
        if not parent_dir.is_dir():
            raise ExplorerServiceError(
                f"Target parent '{parent_rel}' is not a directory.", 400
            )

        name = validate_entry_name(req.name)
        target = parent_dir / name
        rel_path = f"{parent_rel}/{name}" if parent_rel else name

        if target.exists() or target.is_symlink():
            raise ExplorerServiceError(
                f"An item named '{name}' already exists in '{parent_rel or 'project root'}'.",
                409,
            )

        try:
            resolved_parent = parent_dir.resolve(strict=True)
            if not resolved_parent.is_relative_to(project_root):
                raise ExplorerServiceError(
                    "Access denied: parent escapes project root.", 403
                )
            if req.kind == "dir":
                target.mkdir(exist_ok=False)
            else:
                with open(target, "x", encoding="utf-8"):
                    pass
        except FileExistsError as exc:
            raise ExplorerServiceError(
                f"An item named '{name}' already exists.", 409
            ) from exc
        except PermissionError as exc:
            raise ExplorerServiceError(
                f"Permission denied creating '{rel_path}': {exc}", 403
            ) from exc
        except OSError as exc:
            raise ExplorerServiceError(
                f"Failed to create '{rel_path}': {exc}", 500
            ) from exc

        node = self._build_node(target, project_root, parent_rel, show_hidden=True)
        return EntryOperationResponse(
            ok=True,
            action="create",
            relative_path=rel_path,
            node=node,
            message=f"Created {'folder' if req.kind == 'dir' else 'file'} '{rel_path}'.",
        )

    def rename_entry(self, req: RenameEntryRequest) -> EntryOperationResponse:
        """Rename a file or directory safely inside the active project."""
        project_root = self._resolve_project_root(req.project_dir)
        norm_rel, target = self._resolve_inside_root(
            project_root, req.target_path, must_exist=True
        )
        if not norm_rel:
            raise ExplorerServiceError(
                "Cannot rename the active project root.", 400
            )
        if norm_rel == PROJECT_METADATA_FILENAME:
            raise ExplorerServiceError(
                f"Cannot rename '{PROJECT_METADATA_FILENAME}': required VEGA Studio project manifest.",
                400,
            )

        new_name = validate_entry_name(req.new_name)
        if new_name == target.name:
            raise ExplorerServiceError(
                "New name is unchanged.", 400
            )

        dest = target.parent / new_name
        parent_rel = norm_rel.rsplit("/", 1)[0] if "/" in norm_rel else ""
        new_rel = f"{parent_rel}/{new_name}" if parent_rel else new_name

        case_only_same = os.name == "nt" and new_name.lower() == target.name.lower()
        if (dest.exists() or dest.is_symlink()) and not case_only_same:
            raise ExplorerServiceError(
                f"Cannot rename: '{new_name}' already exists.", 409
            )

        try:
            target.rename(dest)
        except PermissionError as exc:
            raise ExplorerServiceError(
                f"Permission denied renaming '{norm_rel}': {exc}", 403
            ) from exc
        except OSError as exc:
            raise ExplorerServiceError(
                f"Failed to rename '{norm_rel}': {exc}", 500
            ) from exc

        node = self._build_node(dest, project_root, parent_rel, show_hidden=True)
        return EntryOperationResponse(
            ok=True,
            action="rename",
            relative_path=new_rel,
            previous_path=norm_rel,
            node=node,
            message=f"Renamed '{norm_rel}' to '{new_rel}'.",
        )

    def delete_entry(self, req: DeleteEntryRequest) -> EntryOperationResponse:
        """Delete a file or directory inside the active project safely."""
        project_root = self._resolve_project_root(req.project_dir)
        norm_rel, target = self._resolve_inside_root(
            project_root, req.target_path, must_exist=True
        )
        if not norm_rel:
            raise ExplorerServiceError(
                "Cannot delete the active project root.", 400
            )
        if norm_rel == PROJECT_METADATA_FILENAME:
            raise ExplorerServiceError(
                f"Cannot delete '{PROJECT_METADATA_FILENAME}': required VEGA Studio project manifest.",
                400,
            )

        try:
            if target.is_symlink() or target.is_file():
                target.unlink()
            elif target.is_dir():
                has_items = any(target.iterdir())
                if has_items and not req.recursive:
                    raise ExplorerServiceError(
                        f"Folder '{norm_rel}' is not empty. Explicit confirmation is required to delete its contents.",
                        409,
                    )
                if has_items:
                    shutil.rmtree(target)
                else:
                    target.rmdir()
            else:
                raise ExplorerServiceError(
                    f"Unsupported filesystem entry at '{norm_rel}'.", 400
                )
        except ExplorerServiceError:
            raise
        except PermissionError as exc:
            raise ExplorerServiceError(
                f"Permission denied deleting '{norm_rel}': {exc}", 403
            ) from exc
        except OSError as exc:
            raise ExplorerServiceError(
                f"Failed to delete '{norm_rel}': {exc}", 500
            ) from exc

        return EntryOperationResponse(
            ok=True,
            action="delete",
            relative_path=norm_rel,
            message=f"Deleted '{norm_rel}'.",
        )


def get_explorer_service() -> ExplorerService:
    """FastAPI dependency returning an ExplorerService configured from settings."""
    return ExplorerService(settings)
