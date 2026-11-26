"""VEGA Studio Backend – Phase 16 Firmware Examples, Local Documentation & Guided Learning service."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from app.config import Settings, settings
from app.models.learning import (
    CreateProjectFromExampleRequest,
    DocCatalogResponse,
    DocIdeActionRef,
    DocLinkRef,
    DocPageDetailResponse,
    DocPageSummary,
    DocSearchResponse,
    DocSearchResult,
    ExampleCatalogResponse,
    ExampleDetailResponse,
    ExampleFileContentResponse,
    ExampleFileInfo,
    ExampleSummary,
    ExampleValidateRequest,
    ExampleValidationResponse,
    GuidedWorkflowSummary,
    validate_learning_id,
)
from app.models.project import (
    PROJECT_METADATA_FILENAME,
    PROJECT_SCHEMA_VERSION,
    ProjectBuildConfig,
    ProjectTarget,
    VegaProjectMetadata,
    WorkspaceSummary,
)
from app.services.ai_context import is_sensitive_relative_path
from app.services.board_service import BoardService, BoardServiceError
from app.services.explorer_service import _detect_language
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    _render_gitignore,
    _utc_now,
    validate_directory_input,
    validate_project_name,
)
from app.services.sdk_service import SdkService, _resolve_existing_path

_CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"
_BUILTIN_EXAMPLES_DIR = _CONTENT_DIR / "examples"
_BUILTIN_DOCS_DIR = _CONTENT_DIR / "docs"

_MAX_EXAMPLE_FILES = 64
_MAX_EXAMPLE_FILE_BYTES = 256 * 1024
_MAX_PREVIEW_CHARS = 32_000
_MAX_SDK_EXAMPLES = 40
_SKIP_COPY_DIRS = frozenset(
    {".git", ".vega-studio", ".vscode", ".idea", "build", "dist", "node_modules", "__pycache__", ".venv"}
)
_SKIP_COPY_EXTS = frozenset({".o", ".d", ".elf", ".bin", ".hex", ".exe", ".dll", ".so", ".pyc", ".db", ".sqlite"})


class LearningServiceError(Exception):
    """Domain error with HTTP status code for Examples & Documentation."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _safe_rel_token(raw: str) -> str:
    cleaned = raw.replace("\\", "/").strip()
    if not cleaned or "\x00" in cleaned or cleaned.startswith("/") or (len(cleaned) >= 2 and cleaned[1] == ":"):
        raise LearningServiceError("Invalid relative file path.", 400)
    parts = [p for p in cleaned.split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        raise LearningServiceError("Path traversal ('..') is forbidden.", 400)
    return "/".join(parts)


def _is_blocked_example_rel(rel_path: str) -> Optional[str]:
    norm = rel_path.replace("\\", "/").strip("/")
    parts = [p for p in norm.split("/") if p]
    if not parts:
        return "Empty path."
    for seg in parts[:-1]:
        if seg in _SKIP_COPY_DIRS:
            return f"Directory '{seg}' is excluded from examples."
    name = parts[-1].lower()
    if name in ("example.json", "catalog.json", ".ds_store", "thumbs.db"):
        return f"Metadata file '{parts[-1]}' is excluded."
    dot = name.rfind(".")
    ext = name[dot:] if dot >= 0 else ""
    if ext in _SKIP_COPY_EXTS:
        return f"Build/binary artifact '{parts[-1]}' is excluded from template sources."
    sens = is_sensitive_relative_path(norm)
    if sens:
        return sens
    return None


def _collect_safe_example_files(example_root: Path) -> Tuple[List[ExampleFileInfo], List[str]]:
    """Walk example root safely, rejecting symlinks escaping root and sensitive/binary files."""
    files: List[ExampleFileInfo] = []
    warnings: List[str] = []
    try:
        root_resolved = example_root.resolve(strict=True)
    except OSError:
        return [], [f"Example directory '{example_root.name}' cannot be resolved."]

    def _walk(cur: Path, prefix: str) -> None:
        if len(files) >= _MAX_EXAMPLE_FILES:
            return
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as exc:
            warnings.append(f"Skipping unreadable directory '{prefix or '.'}': {exc}")
            return

        for entry in entries:
            if len(files) >= _MAX_EXAMPLE_FILES:
                warnings.append(f"Example file listing capped at {_MAX_EXAMPLE_FILES} files.")
                return
            rel = f"{prefix}/{entry.name}" if prefix else entry.name
            if entry.is_symlink():
                warnings.append(f"Skipped symlink '{rel}' for safety.")
                continue
            try:
                resolved = entry.resolve(strict=True)
            except OSError:
                continue
            if not resolved.is_relative_to(root_resolved):
                warnings.append(f"Skipped out-of-bounds entry '{rel}'.")
                continue

            if entry.is_dir():
                if entry.name in _SKIP_COPY_DIRS or entry.name.startswith("."):
                    continue
                _walk(entry, rel)
                continue

            blocked = _is_blocked_example_rel(rel)
            if blocked:
                continue
            if entry.name.startswith(".") and entry.name != ".gitkeep":
                continue

            try:
                size = entry.stat().st_size
            except OSError:
                continue
            if size > _MAX_EXAMPLE_FILE_BYTES:
                warnings.append(f"Skipped large file '{rel}' ({size} bytes).")
                continue

            lang_label = _detect_language(entry.name, entry.suffix)
            try:
                head = entry.read_bytes()[:2048]
                is_bin = b"\x00" in head
            except OSError:
                is_bin = True

            files.append(
                ExampleFileInfo(
                    relative_path=rel,
                    size_bytes=size,
                    language=lang_label,
                    is_binary=is_bin,
                )
            )

    _walk(example_root, "")
    return files, warnings


class _ResolvedExampleEntry:
    def __init__(
        self,
        *,
        summary: ExampleSummary,
        root_dir: Path,
        long_description: str,
        learning_objectives: List[str],
        prerequisites: List[str],
        board_compatibility_note: str,
        related_doc_slugs: List[str],
        files: List[ExampleFileInfo],
        warnings: List[str],
    ) -> None:
        self.summary = summary
        self.root_dir = root_dir
        self.long_description = long_description
        self.learning_objectives = learning_objectives
        self.prerequisites = prerequisites
        self.board_compatibility_note = board_compatibility_note
        self.related_doc_slugs = related_doc_slugs
        self.files = files
        self.warnings = warnings


class LearningService:
    """Manages VEGA firmware examples, local offline docs, guided workflows, and project creation."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._projects = ProjectService(self._settings)
        self._boards = BoardService(self._settings)
        self._sdk = SdkService(self._settings)

    # ── Built-in & Local SDK Examples Discovery ───────────────────────────────

    def _load_examples_registry(self) -> Tuple[Dict[str, _ResolvedExampleEntry], bool, int, List[str]]:
        registry: Dict[str, _ResolvedExampleEntry] = {}
        all_warnings: List[str] = []

        # 1. Built-in verified / conceptual offline examples catalog
        catalog_file = _BUILTIN_EXAMPLES_DIR / "catalog.json"
        if catalog_file.is_file():
            try:
                raw = json.loads(catalog_file.read_text(encoding="utf-8"))
                for item in raw.get("examples", []):
                    ex_id = validate_learning_id(str(item["id"]), "Example ID")
                    ex_dir = (_BUILTIN_EXAMPLES_DIR / ex_id).resolve(strict=False)
                    if not ex_dir.is_dir() or not ex_dir.is_relative_to(_BUILTIN_EXAMPLES_DIR.resolve()):
                        all_warnings.append(f"Example directory missing for '{ex_id}'.")
                        continue
                    files, w = _collect_safe_example_files(ex_dir)
                    all_warnings.extend(w)
                    summary = ExampleSummary(
                        id=ex_id,
                        title=str(item["title"]),
                        category=str(item["category"]),
                        difficulty=item.get("difficulty", "beginner"),
                        verification_status=item.get("verification_status", "conceptual"),
                        verification_note=str(item.get("verification_note", "")),
                        source="builtin",
                        origin_label="Built-in VEGA Studio Catalog",
                        short_description=str(item.get("short_description", "")),
                        compatible_boards=list(item.get("compatible_boards", ["VEGA_ARIES_V3"])),
                        required_sdk=str(item.get("required_sdk", "")),
                        tags=list(item.get("tags", [])),
                        file_count=len(files),
                        entry_file=item.get("entry_file"),
                    )
                    registry[ex_id] = _ResolvedExampleEntry(
                        summary=summary,
                        root_dir=ex_dir,
                        long_description=str(item.get("long_description", summary.short_description)),
                        learning_objectives=list(item.get("learning_objectives", [])),
                        prerequisites=list(item.get("prerequisites", [])),
                        board_compatibility_note=str(item.get("board_compatibility_note", "")),
                        related_doc_slugs=list(item.get("related_doc_slugs", [])),
                        files=files,
                        warnings=w,
                    )
            except Exception as exc:
                all_warnings.append(f"Failed parsing built-in examples catalog: {exc}")

        # 2. Optional safe discovery inside user's configured local VEGA SDK directory
        sdk_cfg = self._sdk.get_config_state().config
        sdk_path = _resolve_existing_path(sdk_cfg.sdk_root)
        sdk_configured = bool(sdk_path and sdk_path.is_dir())
        sdk_count = 0

        if sdk_configured and sdk_path is not None:
            sdk_resolved = sdk_path.resolve(strict=False)
            for candidate_sub in ("examples", "bsp/examples"):
                ex_root = (sdk_resolved / candidate_sub).resolve(strict=False)
                if not ex_root.is_dir() or not ex_root.is_relative_to(sdk_resolved):
                    continue
                sdk_count += self._scan_sdk_example_tree(
                    sdk_resolved=sdk_resolved,
                    ex_root=ex_root,
                    prefix_rel=candidate_sub,
                    registry=registry,
                    warnings=all_warnings,
                )

        return registry, sdk_configured, sdk_count, all_warnings

    def _scan_sdk_example_tree(
        self,
        *,
        sdk_resolved: Path,
        ex_root: Path,
        prefix_rel: str,
        registry: Dict[str, _ResolvedExampleEntry],
        warnings: List[str],
    ) -> int:
        added = 0
        # Inspect up to 2 directory levels inside <sdk>/examples for actual C/Make folders
        queue_dirs: List[Tuple[Path, str, int]] = [(ex_root, prefix_rel, 0)]
        seen_paths: Set[Path] = set()

        while queue_dirs and added < _MAX_SDK_EXAMPLES:
            cur, rel_label, depth = queue_dirs.pop(0)
            if cur.is_symlink():
                continue
            try:
                cur_res = cur.resolve(strict=True)
            except OSError:
                continue
            if not cur_res.is_relative_to(sdk_resolved) or cur_res in seen_paths:
                continue
            seen_paths.add(cur_res)

            try:
                children = sorted(cur_res.iterdir(), key=lambda p: p.name.lower())
            except OSError:
                continue

            has_code = any(
                c.is_file()
                and not c.is_symlink()
                and (c.suffix.lower() in (".c", ".s", ".cpp") or c.name.lower() == "makefile")
                for c in children
            )
            has_src_sub = False
            for c in children:
                if c.is_dir() and c.name.lower() == "src" and not c.is_symlink():
                    try:
                        if any(
                            f.is_file() and f.suffix.lower() in (".c", ".s")
                            for f in c.iterdir()
                        ):
                            has_src_sub = True
                            break
                    except OSError:
                        continue

            if depth >= 1 and (has_code or has_src_sub):
                files, w = _collect_safe_example_files(cur_res)
                if files:
                    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", rel_label).strip("-")
                    if not slug:
                        continue
                    try:
                        ex_id = validate_learning_id(f"sdk:{slug[:72]}", "SDK Example ID")
                    except ValueError:
                        continue
                    if ex_id not in registry:
                        entry_file = next(
                            (
                                f.relative_path
                                for f in files
                                if f.relative_path.endswith(("main.c", ".c", "Makefile"))
                            ),
                            files[0].relative_path,
                        )
                        category = cur_res.parent.name.replace("_", " ").title() if depth >= 2 else "Local VEGA SDK"
                        summary = ExampleSummary(
                            id=ex_id,
                            title=cur_res.name.replace("_", " ").replace("-", " "),
                            category=category,
                            difficulty="intermediate",
                            verification_status="sdk_discovered",
                            verification_note="Discovered locally in configured VEGA SDK directory. Inspect Makefile & README before compiling.",
                            source="local_sdk",
                            origin_label=f"Local SDK ({rel_label})",
                            short_description=f"Local VEGA SDK example located under {rel_label}.",
                            compatible_boards=["VEGA_ARIES_V3"],
                            required_sdk="Configured local VEGA SDK & riscv32-vega-elf toolchain",
                            tags=["local-sdk", category.lower()],
                            file_count=len(files),
                            entry_file=entry_file,
                        )
                        registry[ex_id] = _ResolvedExampleEntry(
                            summary=summary,
                            root_dir=cur_res,
                            long_description=f"Locally discovered example at `{rel_label}` inside your configured VEGA SDK.",
                            learning_objectives=["Inspect verified local SDK driver/example source"],
                            prerequisites=["Configured Phase 6 VEGA SDK"],
                            board_compatibility_note="Compatibility depends on local SDK target configuration.",
                            related_doc_slugs=["sdk-setup-and-doctor", "building-firmware"],
                            files=files,
                            warnings=w,
                        )
                        added += 1
                continue

            if depth < 2:
                for child in children:
                    if child.is_dir() and not child.is_symlink() and not child.name.startswith("."):
                        if child.name not in _SKIP_COPY_DIRS:
                            queue_dirs.append((child, f"{rel_label}/{child.name}", depth + 1))

        return added

    def list_examples(
        self,
        *,
        category: Optional[str] = None,
        q: Optional[str] = None,
        board_id: Optional[str] = None,
    ) -> ExampleCatalogResponse:
        registry, sdk_cfg, sdk_cnt, warnings = self._load_examples_registry()
        all_items = [e.summary for e in registry.values()]
        categories = sorted({item.category for item in all_items})

        filtered = all_items
        if category and category.strip():
            cat_low = category.strip().lower()
            filtered = [i for i in filtered if i.category.lower() == cat_low]
        if board_id and board_id.strip():
            b_clean = board_id.strip()
            filtered = [i for i in filtered if b_clean in i.compatible_boards]
        if q and q.strip():
            needle = q.strip().lower()
            filtered = [
                i
                for i in filtered
                if needle in i.title.lower()
                or needle in i.short_description.lower()
                or needle in i.category.lower()
                or any(needle in t.lower() for t in i.tags)
            ]

        return ExampleCatalogResponse(
            examples=filtered,
            categories=categories,
            sdk_root_configured=sdk_cfg,
            sdk_examples_count=sdk_cnt,
            validation_warnings=warnings[:20],
        )

    def _get_entry_or_raise(self, raw_example_id: str) -> _ResolvedExampleEntry:
        try:
            ex_id = validate_learning_id(raw_example_id, "Example ID")
        except ValueError as exc:
            raise LearningServiceError(str(exc), 400) from exc
        registry, _, _, _ = self._load_examples_registry()
        entry = registry.get(ex_id)
        if entry is None:
            raise LearningServiceError(f"Example '{ex_id}' not found.", 404)
        return entry

    def get_example_detail(self, raw_example_id: str) -> ExampleDetailResponse:
        entry = self._get_entry_or_raise(raw_example_id)
        readme_content: Optional[str] = None
        for f in entry.files:
            if f.relative_path.lower() in ("readme.md", "readme.txt"):
                try:
                    readme_path = (entry.root_dir / f.relative_path).resolve(strict=True)
                    if readme_path.is_relative_to(entry.root_dir):
                        readme_content = readme_path.read_text(encoding="utf-8", errors="replace")[:_MAX_PREVIEW_CHARS]
                except OSError:
                    pass
                break

        return ExampleDetailResponse(
            example=entry.summary,
            long_description=entry.long_description,
            learning_objectives=entry.learning_objectives,
            prerequisites=entry.prerequisites,
            board_compatibility_note=entry.board_compatibility_note,
            files=entry.files,
            readme_content=readme_content,
            related_doc_slugs=entry.related_doc_slugs,
        )

    def get_example_file(self, raw_example_id: str, raw_rel_path: str) -> ExampleFileContentResponse:
        entry = self._get_entry_or_raise(raw_example_id)
        rel_norm = _safe_rel_token(raw_rel_path)
        blocked = _is_blocked_example_rel(rel_norm)
        if blocked:
            raise LearningServiceError(blocked, 403)

        file_meta = next((f for f in entry.files if f.relative_path == rel_norm), None)
        if file_meta is None:
            raise LearningServiceError(f"File '{rel_norm}' not found in example '{entry.summary.id}'.", 404)
        if file_meta.is_binary:
            raise LearningServiceError(f"Binary file '{rel_norm}' cannot be previewed as text.", 415)

        target = entry.root_dir / rel_norm
        if target.is_symlink():
            raise LearningServiceError("Refusing to read symlinked file outside safety boundary.", 403)
        try:
            resolved = target.resolve(strict=True)
        except OSError as exc:
            raise LearningServiceError(f"Unable to open '{rel_norm}': {exc}", 404) from exc
        if not resolved.is_relative_to(entry.root_dir) or not resolved.is_file():
            raise LearningServiceError("Resolved file escapes example directory.", 403)

        raw = resolved.read_text(encoding="utf-8", errors="replace")
        truncated = len(raw) > _MAX_PREVIEW_CHARS
        return ExampleFileContentResponse(
            example_id=entry.summary.id,
            relative_path=rel_norm,
            content=raw[:_MAX_PREVIEW_CHARS],
            language=file_meta.language,
            size_bytes=file_meta.size_bytes,
            truncated=truncated,
        )

    def validate_example(self, raw_example_id: str, req: ExampleValidateRequest) -> ExampleValidationResponse:
        entry = self._get_entry_or_raise(raw_example_id)
        issues: List[str] = list(entry.warnings)
        warnings: List[str] = []

        target_board_id = (req.board_id or "VEGA_ARIES_V3").strip()
        if req.project_dir:
            try:
                status = self._boards.get_project_board_status(req.project_dir)
                if status.selected_board_id:
                    target_board_id = status.selected_board_id
            except BoardServiceError:
                pass

        try:
            board = self._boards.get_board_or_raise(target_board_id)
            board_supported = True
            compat_report = self._boards.validate_compatibility(board)
            sdk_note = (
                f"SDK Compatibility: {compat_report.status.upper()} "
                f"({len(compat_report.issues)} issue(s), {len(compat_report.warnings)} warning(s))"
            )
            if compat_report.issues:
                warnings.extend(compat_report.issues[:3])
        except BoardServiceError as exc:
            board_supported = False
            sdk_note = exc.message
            issues.append(exc.message)

        compatible = target_board_id in entry.summary.compatible_boards and board_supported
        if board_supported and target_board_id not in entry.summary.compatible_boards:
            issues.append(
                f"Example '{entry.summary.title}' supports {', '.join(entry.summary.compatible_boards)}, not '{target_board_id}'."
            )

        if entry.summary.verification_status == "conceptual":
            warnings.append(
                "Conceptual learning example: verifies structure cleanly, while hardware-specific SDK drivers/headers are left for your local VEGA SDK."
            )

        planned = sorted(
            {
                *(f.relative_path for f in entry.files),
                PROJECT_METADATA_FILENAME,
                ".gitignore",
            }
        )
        return ExampleValidationResponse(
            example_id=entry.summary.id,
            valid=len(issues) == 0 and len(entry.files) > 0,
            compatible=compatible,
            target_board_id=target_board_id,
            board_supported=board_supported,
            sdk_ready_note=sdk_note,
            issues=issues,
            warnings=warnings,
            planned_files=planned,
        )

    def create_project_from_example(self, req: CreateProjectFromExampleRequest) -> WorkspaceSummary:
        entry = self._get_entry_or_raise(req.example_id)

        try:
            name = validate_project_name(req.project_name)
            parent_path = validate_directory_input(req.parent_dir, label="Project location")
            board = self._boards.get_board_or_raise(req.board_id)
        except (ProjectServiceError, BoardServiceError) as exc:
            raise LearningServiceError(exc.message, exc.status_code) from exc

        if board.id not in entry.summary.compatible_boards:
            raise LearningServiceError(
                f"Board '{board.id}' is not compatible with example '{entry.summary.title}'.",
                400,
            )

        if parent_path.exists() and not parent_path.is_dir():
            raise LearningServiceError(f"Project location '{parent_path}' is not a directory.", 400)

        target_dir = (parent_path / name).resolve(strict=False)
        if target_dir.parent != parent_path or target_dir == parent_path:
            raise LearningServiceError("Resolved project directory escapes chosen parent location.", 400)
        if target_dir.is_symlink():
            raise LearningServiceError("Target destination cannot be a symlink.", 400)

        pre_existed = target_dir.exists()
        if pre_existed:
            if not target_dir.is_dir():
                raise LearningServiceError(f"Path '{target_dir}' exists and is not a directory.", 409)
            if not req.confirm_overwrite:
                raise LearningServiceError(
                    f"Directory '{target_dir}' already exists. Choose another name or confirm overwriting example files.",
                    409,
                )

        # Ensure source files are present & verified before writing anything
        if not entry.files:
            raise LearningServiceError(f"Example '{entry.summary.id}' has no valid copyable files.", 422)

        now = _utc_now()
        desc = (req.description or "").strip() or entry.summary.short_description
        metadata = VegaProjectMetadata(
            schemaVersion=PROJECT_SCHEMA_VERSION,
            name=name,
            description=desc[:300],
            template="minimal",
            target=ProjectTarget(
                board=board.id,
                arch=board.isa,
                machine=board.machine,
            ),
            build=ProjectBuildConfig(),
            createdAt=now,
            updatedAt=now,
        )

        created_paths: List[Path] = []
        created_root = False
        try:
            if not parent_path.exists():
                parent_path.mkdir(parents=True, exist_ok=True)
            if not pre_existed:
                target_dir.mkdir(exist_ok=False)
                created_root = True

            # Copy strictly validated, non-sensitive, non-symlinked example files
            for file_info in entry.files:
                src_file = (entry.root_dir / file_info.relative_path).resolve(strict=True)
                if src_file.is_symlink() or not src_file.is_relative_to(entry.root_dir):
                    raise LearningServiceError(f"Blocked unsafe source file '{file_info.relative_path}'.", 403)
                dst_file = (target_dir / file_info.relative_path).resolve(strict=False)
                if not dst_file.is_relative_to(target_dir):
                    raise LearningServiceError("Destination path escapes target project root.", 400)
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                content_bytes = src_file.read_bytes()
                if not req.confirm_overwrite and dst_file.exists():
                    raise LearningServiceError(f"Refusing to overwrite existing '{file_info.relative_path}'.", 409)
                dst_file.write_bytes(content_bytes)
                created_paths.append(dst_file)

            # Ensure standard portable IDE folders & manifest exist cleanly (blocking symlinked targets)
            src_dir = target_dir / metadata.build.sourceDir
            if src_dir.is_symlink():
                raise LearningServiceError("Destination source directory cannot be a symlink.", 403)
            src_dir.mkdir(exist_ok=True)
            inc_dir = target_dir / metadata.build.includeDir
            if inc_dir.is_symlink():
                raise LearningServiceError("Destination include directory cannot be a symlink.", 403)
            inc_dir.mkdir(exist_ok=True)
            keep_path = inc_dir / ".gitkeep"
            if not any(inc_dir.iterdir()):
                if keep_path.is_symlink():
                    raise LearningServiceError("Destination .gitkeep cannot be a symlink.", 403)
                keep_path.write_text("", encoding="utf-8")

            gitignore_path = target_dir / ".gitignore"
            if gitignore_path.is_symlink():
                raise LearningServiceError("Destination .gitignore cannot be a symlink.", 403)
            if not gitignore_path.exists() or req.confirm_overwrite:
                gitignore_path.write_text(_render_gitignore(), encoding="utf-8", newline="\n")

            meta_path = target_dir / PROJECT_METADATA_FILENAME
            if meta_path.is_symlink():
                raise LearningServiceError(f"Destination {PROJECT_METADATA_FILENAME} cannot be a symlink.", 403)
            if not meta_path.exists() or req.confirm_overwrite:
                meta_path.write_text(
                    json.dumps(metadata.model_dump(mode="json"), indent=2) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
        except LearningServiceError:
            if created_root and target_dir.exists():
                for p in reversed(created_paths):
                    p.unlink(missing_ok=True)
                import shutil
                shutil.rmtree(target_dir, ignore_errors=True)
            raise
        except OSError as exc:
            if created_root and target_dir.exists():
                import shutil
                shutil.rmtree(target_dir, ignore_errors=True)
            raise LearningServiceError(f"Failed creating project from example: {exc}", 500) from exc

        try:
            return self._projects.open_project(str(target_dir))
        except ProjectServiceError as exc:
            raise LearningServiceError(exc.message, exc.status_code) from exc

    # ── Local Offline Documentation & Guided Workflows ────────────────────────

    def _load_docs_catalog(self) -> Tuple[List[dict], List[GuidedWorkflowSummary]]:
        catalog_path = _BUILTIN_DOCS_DIR / "docs_catalog.json"
        if not catalog_path.is_file():
            return [], []
        raw = json.loads(catalog_path.read_text(encoding="utf-8"))
        docs = list(raw.get("docs", []))
        guides = [GuidedWorkflowSummary.model_validate(g) for g in raw.get("guides", [])]
        return docs, guides

    @staticmethod
    def _doc_item_to_summary(item: dict) -> DocPageSummary:
        return DocPageSummary(
            slug=validate_learning_id(str(item["slug"]), "Doc slug"),
            title=str(item["title"]),
            category=str(item["category"]),
            summary=str(item["summary"]),
            tags=list(item.get("tags", [])),
            badge=item.get("badge", "ide_verified"),
            estimated_minutes=int(item.get("estimated_minutes", 3)),
            related_example_ids=list(item.get("related_example_ids", [])),
        )

    def _read_doc_markdown(self, slug: str) -> str:
        clean_slug = validate_learning_id(slug, "Doc slug")
        docs_root = _BUILTIN_DOCS_DIR.resolve(strict=True)
        md_path = (docs_root / f"{clean_slug}.md").resolve(strict=False)
        if not md_path.is_relative_to(docs_root) or not md_path.is_file():
            raise LearningServiceError(f"Documentation page '{clean_slug}' not found.", 404)
        return md_path.read_text(encoding="utf-8", errors="replace")

    def list_docs(self, *, category: Optional[str] = None, q: Optional[str] = None) -> DocCatalogResponse:
        raw_docs, guides = self._load_docs_catalog()
        summaries = [self._doc_item_to_summary(d) for d in raw_docs]
        categories = sorted({d.category for d in summaries})

        if category and category.strip():
            cat_low = category.strip().lower()
            summaries = [d for d in summaries if d.category.lower() == cat_low]
        if q and q.strip():
            hits = {r.slug for r in self.search_docs(q, category=category).results}
            summaries = [d for d in summaries if d.slug in hits]

        return DocCatalogResponse(docs=summaries, categories=categories, guides=guides)

    def get_doc_detail(self, raw_slug: str) -> DocPageDetailResponse:
        try:
            slug = validate_learning_id(raw_slug, "Doc slug")
        except ValueError as exc:
            raise LearningServiceError(str(exc), 400) from exc

        raw_docs, _ = self._load_docs_catalog()
        item = next((d for d in raw_docs if d.get("slug") == slug), None)
        if item is None:
            raise LearningServiceError(f"Documentation page '{slug}' not found.", 404)

        summary = self._doc_item_to_summary(item)
        md_content = self._read_doc_markdown(slug)
        ext_links = [
            DocLinkRef.model_validate(link)
            for link in item.get("external_links", [])
            if str(link.get("url", "")).startswith(("https://", "http://"))
        ]
        ide_actions = [DocIdeActionRef.model_validate(act) for act in item.get("ide_actions", [])]

        return DocPageDetailResponse(
            doc=summary,
            markdown_content=md_content,
            related_slugs=list(item.get("related_slugs", [])),
            external_links=ext_links,
            ide_actions=ide_actions,
        )

    def search_docs(self, raw_query: str, *, category: Optional[str] = None) -> DocSearchResponse:
        query = raw_query.strip()
        if not query:
            return DocSearchResponse(query="", results=[])
        needle = query.lower()
        terms = [t for t in needle.split() if t]

        raw_docs, _ = self._load_docs_catalog()
        results: List[DocSearchResult] = []
        for item in raw_docs:
            if category and category.strip() and item.get("category", "").lower() != category.strip().lower():
                continue
            summary = self._doc_item_to_summary(item)
            try:
                body = self._read_doc_markdown(summary.slug)
            except LearningServiceError:
                body = ""

            score = 0
            title_low = summary.title.lower()
            cat_low = summary.category.lower()
            sum_low = summary.summary.lower()
            tags_low = " ".join(summary.tags).lower()
            body_low = body.lower()

            for term in terms:
                if term in title_low:
                    score += 12
                if term in tags_low:
                    score += 7
                if term in sum_low:
                    score += 5
                if term in cat_low:
                    score += 4
                cnt = body_low.count(term)
                if cnt:
                    score += min(cnt, 5) * 2

            if score <= 0:
                continue

            # Extract compact snippet around first matching term in body or summary
            snippet = summary.summary
            idx = body_low.find(terms[0])
            if idx >= 0:
                start = max(0, idx - 50)
                end = min(len(body), idx + 150)
                snippet = " ".join(body[start:end].replace("#", "").split())
                if start > 0:
                    snippet = "…" + snippet
                if end < len(body):
                    snippet = snippet + "…"

            results.append(
                DocSearchResult(
                    slug=summary.slug,
                    title=summary.title,
                    category=summary.category,
                    summary=summary.summary,
                    badge=summary.badge,
                    snippet=snippet,
                    score=score,
                )
            )

        results.sort(key=lambda r: (-r.score, r.title.lower()))
        return DocSearchResponse(query=query, results=results[:30])


_learning_service_instance: Optional[LearningService] = None


def get_learning_service() -> LearningService:
    global _learning_service_instance
    if _learning_service_instance is None:
        _learning_service_instance = LearningService(settings)
    return _learning_service_instance
