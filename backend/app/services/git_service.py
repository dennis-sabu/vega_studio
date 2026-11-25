"""VEGA Studio Backend – Phase 12 Native Git CLI Integration Service.

Security & reliability guarantees:
- Uses `shutil.which("git")` + safe fallback discovery; never allows user-supplied git binary paths.
- Always invokes subprocesses with argument lists and `shell=False`.
- Confines all operations to the active project root repository (never traverses to parent repos).
- Validates every file path cleanly against the repo root and blocks `.git` / `..` / null bytes.
- Always inserts `--` before file paths to prevent option injection (e.g. filenames starting with `-`).
- Uses machine-readable `-z` NUL-delimited Git outputs with `-c core.quotePath=false`.
- Requires explicit confirmation (`confirm=True`) for destructive discard and untracked deletion.
- Never auto-stages on commit, never silently discards changes on branch switch, never pushes/pulls.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import threading
from typing import Dict, List, Optional, Tuple

from app.config import Settings, settings
from app.models.git import (
    GitBranchActionResponse,
    GitBranchCreateRequest,
    GitBranchesResponse,
    GitBranchInfo,
    GitBranchSwitchRequest,
    GitCommitDetailResponse,
    GitCommitFileStat,
    GitCommitRequest,
    GitCommitResponse,
    GitCommitSummary,
    GitConfirmPathsRequest,
    GitDiffResponse,
    GitFileChange,
    GitFileStatusCode,
    GitHistoryResponse,
    GitInfoResponse,
    GitPathsRequest,
    GitRepoState,
    GitStatusResponse,
    GitSwitchPrecheckResponse,
    validate_branch_name,
    validate_commit_hash,
    validate_repo_rel_path,
)
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    validate_directory_input,
)
from app.services.sdk_service import _host_os_name

_DEFAULT_GIT_TIMEOUT_S = 12.0
_MAX_DIFF_BYTES = 512 * 1024  # 512 KiB max diff/content payload returned to UI
_MAX_CAPTURE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap for raw git output reading
_GIT_INSTALL_URL = "https://git-scm.com/downloads"


class GitServiceError(Exception):
    """Domain error carrying an HTTP status code for Git API responses."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _map_status_char(code: str) -> GitFileStatusCode:
    mapping: Dict[str, GitFileStatusCode] = {
        "M": "modified",
        "A": "added",
        "D": "deleted",
        "R": "renamed",
        "C": "copied",
        "T": "typechange",
        "U": "unmerged",
        "?": "untracked",
    }
    return mapping.get(code[:1].upper(), "modified")


def _safe_git_env() -> Dict[str, str]:
    """Build non-interactive subprocess environment for local Git CLI execution."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    env["LC_ALL"] = "C.UTF-8"
    env["LANG"] = "C.UTF-8"
    return env


def _looks_like_binary(raw: bytes) -> bool:
    if not raw:
        return False
    return b"\x00" in raw[:8192]


class GitService:
    """Thread-safe local Git CLI orchestration service scoped per active project."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._projects = ProjectService(self._settings)
        self._repo_locks_guard = threading.Lock()
        self._repo_locks: Dict[str, threading.Lock] = {}

    def _get_repo_lock(self, repo_root: Path) -> threading.Lock:
        key = str(repo_root.resolve(strict=False))
        with self._repo_locks_guard:
            lock = self._repo_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._repo_locks[key] = lock
            return lock

    # ------------------------------------------------------------------ #
    # Git executable discovery
    # ------------------------------------------------------------------ #

    def _find_git_executable(self) -> Optional[str]:
        found = shutil.which("git")
        if found:
            return found

        if _host_os_name() == "windows":
            candidates = [
                Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
                / "Git"
                / "cmd"
                / "git.exe",
                Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
                / "Git"
                / "bin"
                / "git.exe",
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "Programs"
                / "Git"
                / "cmd"
                / "git.exe",
            ]
        else:
            candidates = [Path("/usr/bin/git"), Path("/usr/local/bin/git")]

        for cand in candidates:
            try:
                if cand.is_file():
                    return str(cand)
            except OSError:
                continue
        return None

    def detect_git(self) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
        """Detect installed Git executable and parse its version cleanly."""
        git_exe = self._find_git_executable()
        if not git_exe:
            return (
                False,
                None,
                None,
                "Git CLI executable was not found in PATH. Install Git and restart or refresh Source Control.",
            )

        try:
            proc = subprocess.run(
                [git_exe, "--version"],
                shell=False,
                env=_safe_git_env(),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=4.0,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            return (
                False,
                None,
                git_exe,
                f"Failed to execute Git CLI at '{git_exe}': {exc}",
            )

        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            return (
                False,
                None,
                git_exe,
                f"Git CLI check exited with status {proc.returncode}: {err}",
            )

        out = proc.stdout.decode("utf-8", errors="replace").strip()
        first_line = out.splitlines()[0].strip() if out else "git"
        return True, first_line, git_exe, None

    # ------------------------------------------------------------------ #
    # Subprocess execution wrapper
    # ------------------------------------------------------------------ #

    def _run_git_bytes(
        self,
        git_exe: str,
        repo_dir: Path,
        args: List[str],
        *,
        timeout: float = _DEFAULT_GIT_TIMEOUT_S,
        stdin_bytes: Optional[bytes] = None,
    ) -> subprocess.CompletedProcess[bytes]:
        cmd = [git_exe, "-c", "core.quotePath=false", "-C", str(repo_dir), *args]
        try:
            proc = subprocess.run(
                cmd,
                shell=False,
                env=_safe_git_env(),
                input=stdin_bytes,
                stdin=None if stdin_bytes is not None else subprocess.DEVNULL,
                capture_output=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitServiceError(
                f"Git command timed out after {timeout:.0f}s.",
                status_code=504,
            ) from exc
        except OSError as exc:
            raise GitServiceError(
                f"Failed to invoke Git CLI: {exc}",
                status_code=500,
            ) from exc

        stderr_lower = proc.stderr.decode("utf-8", errors="replace").lower()
        if proc.returncode != 0 and (
            "index.lock" in stderr_lower
            or "another git process seems to be running" in stderr_lower
        ):
            raise GitServiceError(
                "Repository index is locked by another Git process (.git/index.lock). Wait a moment and retry.",
                status_code=409,
            )
        return proc

    def _run_git_text(
        self,
        git_exe: str,
        repo_dir: Path,
        args: List[str],
        *,
        timeout: float = _DEFAULT_GIT_TIMEOUT_S,
        stdin_text: Optional[str] = None,
    ) -> Tuple[int, str, str]:
        stdin_bytes = (
            stdin_text.encode("utf-8", errors="replace")
            if stdin_text is not None
            else None
        )
        proc = self._run_git_bytes(
            git_exe,
            repo_dir,
            args,
            timeout=timeout,
            stdin_bytes=stdin_bytes,
        )
        stdout = proc.stdout[:_MAX_CAPTURE_BYTES].decode("utf-8", errors="replace")
        stderr = proc.stderr[:65536].decode("utf-8", errors="replace")
        return proc.returncode, stdout, stderr

    # ------------------------------------------------------------------ #
    # Project & path confinement helpers
    # ------------------------------------------------------------------ #

    def _resolve_project_dir(self, raw_project_dir: Optional[str]) -> Path:
        candidate = raw_project_dir.strip() if raw_project_dir else None
        if not candidate:
            candidate = self._projects.persistence.get_active_project_dir()
        if not candidate:
            raise GitServiceError(
                "No active project directory is open.", status_code=400
            )
        try:
            resolved = validate_directory_input(candidate, label="Project directory")
        except ProjectServiceError as exc:
            raise GitServiceError(exc.message, status_code=exc.status_code) from exc

        if not resolved.exists() or not resolved.is_dir():
            raise GitServiceError(
                f"Project directory does not exist: '{resolved}'.",
                status_code=404,
            )
        return resolved

    def _inspect_repo_boundary(
        self, project_dir: Path, git_exe: str
    ) -> Tuple[bool, Optional[Path], bool, Optional[Path]]:
        """Verify whether `project_dir` itself is the Git repository root cleanly."""
        rc, out, _ = self._run_git_text(
            git_exe, project_dir, ["rev-parse", "--show-toplevel"]
        )
        if rc != 0 or not out.strip():
            return False, None, False, None

        top = Path(out.strip()).resolve(strict=False)
        proj_resolved = project_dir.resolve(strict=False)

        if top == proj_resolved:
            return True, top, False, None

        # An ancestor folder above the project contains a .git repo; keep operations confined.
        return False, None, True, top

    def _require_git_and_repo(
        self, raw_project_dir: Optional[str]
    ) -> Tuple[str, Path]:
        project_dir = self._resolve_project_dir(raw_project_dir)
        avail, _, git_exe, reason = self.detect_git()
        if not avail or not git_exe:
            raise GitServiceError(
                reason or "Git CLI is not installed.", status_code=503
            )

        is_repo, repo_root, _, _ = self._inspect_repo_boundary(project_dir, git_exe)
        if not is_repo or repo_root is None:
            raise GitServiceError(
                "Active project directory is not a Git repository. Initialize Git first.",
                status_code=400,
            )
        return git_exe, repo_root

    def _confine_repo_paths(
        self, repo_root: Path, rel_paths: List[str]
    ) -> List[str]:
        root_resolved = repo_root.resolve(strict=False)
        confined: List[str] = []
        for raw in rel_paths:
            try:
                norm = validate_repo_rel_path(raw)
            except ValueError as exc:
                raise GitServiceError(str(exc), status_code=400) from exc
            target = root_resolved / norm
            target_resolved = target.resolve(strict=False)
            if not target_resolved.is_relative_to(root_resolved):
                raise GitServiceError(
                    f"Path '{raw}' escapes the active project repository boundary.",
                    status_code=400,
                )
            # Reject symlinks whose targets resolve outside the repository root
            if target.is_symlink():
                try:
                    real = Path(os.path.realpath(target))
                    if not real.is_relative_to(root_resolved):
                        raise GitServiceError(
                            f"Symlink '{raw}' points outside the repository root.",
                            status_code=400,
                        )
                except OSError as exc:
                    raise GitServiceError(
                        f"Invalid symlink path '{raw}': {exc}", status_code=400
                    ) from exc
            confined.append(norm)
        return confined

    def _has_head_commit(self, git_exe: str, repo_root: Path) -> bool:
        rc, _, _ = self._run_git_text(
            git_exe, repo_root, ["rev-parse", "--verify", "--quiet", "HEAD"]
        )
        return rc == 0

    def _read_git_identity(
        self, git_exe: str, target_dir: Path
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        _, raw_name, _ = self._run_git_text(git_exe, target_dir, ["config", "user.name"])
        _, raw_email, _ = self._run_git_text(git_exe, target_dir, ["config", "user.email"])
        name = raw_name.strip() or None
        email = raw_email.strip() or None
        return bool(name and email), name, email

    # ------------------------------------------------------------------ #
    # Repository info, init, status parsing
    # ------------------------------------------------------------------ #

    def get_info(self, raw_project_dir: Optional[str] = None) -> GitInfoResponse:
        avail, version, git_exe, reason = self.detect_git()
        if not avail or not git_exe:
            proj_str: Optional[str] = None
            try:
                proj_str = str(self._resolve_project_dir(raw_project_dir))
            except GitServiceError:
                proj_str = None
            return GitInfoResponse(
                git_available=False,
                git_version=version,
                git_executable=git_exe,
                install_guide_url=_GIT_INSTALL_URL,
                unavailable_reason=reason,
                project_dir=proj_str,
                is_repository=False,
            )

        project_dir: Optional[Path] = None
        try:
            project_dir = self._resolve_project_dir(raw_project_dir)
        except GitServiceError:
            return GitInfoResponse(
                git_available=True,
                git_version=version,
                git_executable=git_exe,
                install_guide_url=_GIT_INSTALL_URL,
                project_dir=None,
                is_repository=False,
            )

        is_repo, repo_root, has_parent, parent_root = self._inspect_repo_boundary(
            project_dir, git_exe
        )
        id_ok, u_name, u_email = self._read_git_identity(git_exe, project_dir)
        return GitInfoResponse(
            git_available=True,
            git_version=version,
            git_executable=git_exe,
            install_guide_url=_GIT_INSTALL_URL,
            project_dir=str(project_dir),
            is_repository=is_repo,
            repo_root=str(repo_root) if repo_root else None,
            has_parent_repo=has_parent,
            parent_repo_root=str(parent_root) if parent_root else None,
            identity_configured=id_ok,
            user_name=u_name,
            user_email=u_email,
        )

    def _detect_in_progress_state(self, repo_root: Path) -> Optional[GitRepoState]:
        git_dir = repo_root / ".git"
        if not git_dir.is_dir():
            return None
        if (git_dir / "MERGE_HEAD").exists():
            return "merging"
        if (git_dir / "rebase-merge").exists() or (git_dir / "rebase-apply").exists():
            return "rebasing"
        if (git_dir / "CHERRY_PICK_HEAD").exists():
            return "cherry_picking"
        return None

    def _parse_porcelain_v2_z(
        self, raw_bytes: bytes
    ) -> Tuple[
        Optional[str],
        Optional[str],
        Optional[str],
        int,
        int,
        bool,
        bool,
        List[GitFileChange],
        List[GitFileChange],
        List[GitFileChange],
        List[GitFileChange],
    ]:
        text = raw_bytes.decode("utf-8", errors="replace")
        tokens = text.split("\x00")

        current_branch: Optional[str] = None
        head_commit: Optional[str] = None
        upstream: Optional[str] = None
        ahead = 0
        behind = 0
        is_unborn = False
        is_detached = False

        staged: List[GitFileChange] = []
        unstaged: List[GitFileChange] = []
        untracked: List[GitFileChange] = []
        conflicted: List[GitFileChange] = []

        idx = 0
        n = len(tokens)
        while idx < n:
            rec = tokens[idx]
            idx += 1
            if not rec:
                continue

            if rec.startswith("# "):
                if rec.startswith("# branch.oid "):
                    oid = rec[len("# branch.oid ") :].strip()
                    if oid == "(initial)":
                        is_unborn = True
                        head_commit = None
                    else:
                        head_commit = oid
                elif rec.startswith("# branch.head "):
                    head = rec[len("# branch.head ") :].strip()
                    if head == "(detached)":
                        is_detached = True
                        current_branch = None
                    else:
                        current_branch = head
                elif rec.startswith("# branch.upstream "):
                    upstream = rec[len("# branch.upstream ") :].strip() or None
                elif rec.startswith("# branch.ab "):
                    ab_parts = rec[len("# branch.ab ") :].strip().split()
                    for part in ab_parts:
                        if part.startswith("+"):
                            try:
                                ahead = abs(int(part[1:]))
                            except ValueError:
                                pass
                        elif part.startswith("-"):
                            try:
                                behind = abs(int(part[1:]))
                            except ValueError:
                                pass
                continue

            if rec.startswith("1 "):
                parts = rec.split(" ", 8)
                if len(parts) < 9:
                    continue
                xy = parts[1]
                path = parts[8]
                x, y = (xy[0] if len(xy) > 0 else "."), (xy[1] if len(xy) > 1 else ".")
                if x != ".":
                    staged.append(
                        GitFileChange(
                            path=path,
                            status=_map_status_char(x),
                            staged=True,
                            unstaged=y != ".",
                            untracked=False,
                            xy=xy,
                        )
                    )
                if y != ".":
                    unstaged.append(
                        GitFileChange(
                            path=path,
                            status=_map_status_char(y),
                            staged=x != ".",
                            unstaged=True,
                            untracked=False,
                            xy=xy,
                        )
                    )
                continue

            if rec.startswith("2 "):
                # Rename/copy: path in first record, origPath in subsequent NUL token
                parts = rec.split(" ", 9)
                orig_path = tokens[idx] if idx < n else None
                idx += 1
                if len(parts) < 10:
                    continue
                xy = parts[1]
                path = parts[9]
                x, y = (xy[0] if len(xy) > 0 else "."), (xy[1] if len(xy) > 1 else ".")
                if x != ".":
                    staged.append(
                        GitFileChange(
                            path=path,
                            orig_path=orig_path,
                            status=_map_status_char(x),
                            staged=True,
                            unstaged=y != ".",
                            untracked=False,
                            xy=xy,
                        )
                    )
                if y != ".":
                    unstaged.append(
                        GitFileChange(
                            path=path,
                            orig_path=orig_path,
                            status=_map_status_char(y),
                            staged=x != ".",
                            unstaged=True,
                            untracked=False,
                            xy=xy,
                        )
                    )
                continue

            if rec.startswith("u "):
                parts = rec.split(" ", 10)
                if len(parts) < 11:
                    continue
                xy = parts[1]
                path = parts[10]
                item = GitFileChange(
                    path=path,
                    status="unmerged",
                    staged=False,
                    unstaged=True,
                    untracked=False,
                    conflicted=True,
                    xy=xy,
                )
                conflicted.append(item)
                unstaged.append(item)
                continue

            if rec.startswith("? "):
                path = rec[2:]
                untracked.append(
                    GitFileChange(
                        path=path,
                        status="untracked",
                        staged=False,
                        unstaged=False,
                        untracked=True,
                        xy="??",
                    )
                )

        return (
            current_branch,
            head_commit,
            upstream,
            ahead,
            behind,
            is_unborn,
            is_detached,
            staged,
            unstaged,
            untracked,
            conflicted,
        )

    def get_status(self, raw_project_dir: Optional[str] = None) -> GitStatusResponse:
        project_dir = self._resolve_project_dir(raw_project_dir)
        avail, version, git_exe, reason = self.detect_git()
        if not avail or not git_exe:
            return GitStatusResponse(
                git_available=False,
                git_version=version,
                project_dir=str(project_dir),
                is_repository=False,
                repo_state="git_unavailable",
                warnings=[reason] if reason else [],
            )

        is_repo, repo_root, has_parent, parent_root = self._inspect_repo_boundary(
            project_dir, git_exe
        )
        if not is_repo or repo_root is None:
            warnings: List[str] = []
            if has_parent and parent_root:
                warnings.append(
                    f"Parent directory '{parent_root}' is a Git repository, but this project folder is not initialized independently."
                )
            return GitStatusResponse(
                git_available=True,
                git_version=version,
                project_dir=str(project_dir),
                is_repository=False,
                has_parent_repo=has_parent,
                parent_repo_root=str(parent_root) if parent_root else None,
                repo_state="not_a_repo",
                warnings=warnings,
            )

        proc = self._run_git_bytes(
            git_exe,
            repo_root,
            ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            raise GitServiceError(
                f"Git status check failed: {err or 'unknown error'}",
                status_code=500,
            )

        (
            current_branch,
            head_commit,
            upstream,
            ahead,
            behind,
            is_unborn,
            is_detached,
            staged,
            unstaged,
            untracked,
            conflicted,
        ) = self._parse_porcelain_v2_z(proc.stdout)

        in_progress = self._detect_in_progress_state(repo_root)
        if in_progress is not None:
            repo_state: GitRepoState = in_progress
        elif is_unborn:
            repo_state = "unborn"
        elif is_detached:
            repo_state = "detached"
        elif staged or unstaged or untracked or conflicted:
            repo_state = "dirty"
        else:
            repo_state = "clean"

        id_ok, u_name, u_email = self._read_git_identity(git_exe, repo_root)
        status_warnings: List[str] = []
        if not id_ok:
            status_warnings.append(
                "Git author identity (user.name / user.email) is not configured yet for commits."
            )
        if conflicted:
            status_warnings.append(
                f"{len(conflicted)} file(s) have unresolved merge conflicts."
            )

        return GitStatusResponse(
            git_available=True,
            git_version=version,
            project_dir=str(project_dir),
            is_repository=True,
            repo_root=str(repo_root),
            repo_state=repo_state,
            current_branch=current_branch,
            head_commit=head_commit,
            upstream=upstream,
            ahead=ahead,
            behind=behind,
            is_unborn=is_unborn,
            is_detached=is_detached,
            staged_files=staged,
            unstaged_files=unstaged,
            untracked_files=untracked,
            conflicted_files=conflicted,
            staged_count=len(staged),
            unstaged_count=len(unstaged),
            untracked_count=len(untracked),
            identity_configured=id_ok,
            user_name=u_name,
            user_email=u_email,
            warnings=status_warnings,
        )

    def init_repository(
        self, raw_project_dir: Optional[str] = None
    ) -> GitStatusResponse:
        project_dir = self._resolve_project_dir(raw_project_dir)
        avail, _, git_exe, reason = self.detect_git()
        if not avail or not git_exe:
            raise GitServiceError(
                reason or "Git CLI is not installed.", status_code=503
            )

        with self._get_repo_lock(project_dir):
            is_repo, _, _, _ = self._inspect_repo_boundary(project_dir, git_exe)
            if is_repo:
                raise GitServiceError(
                    "Active project is already initialized as a Git repository.",
                    status_code=409,
                )

            rc, _, err = self._run_git_text(git_exe, project_dir, ["init", "-b", "main"])
            if rc != 0:
                # Fallback for older Git (<2.28) without `init -b`
                rc2, _, err2 = self._run_git_text(git_exe, project_dir, ["init"])
                if rc2 != 0:
                    raise GitServiceError(
                        f"Failed to initialize Git repository: {(err2 or err).strip()}",
                        status_code=500,
                    )

        return self.get_status(str(project_dir))

    # ------------------------------------------------------------------ #
    # Stage / Unstage / Discard / Untracked deletion
    # ------------------------------------------------------------------ #

    def stage_paths(self, req: GitPathsRequest) -> GitStatusResponse:
        git_exe, repo_root = self._require_git_and_repo(req.project_dir)
        safe_paths = self._confine_repo_paths(repo_root, req.paths)
        with self._get_repo_lock(repo_root):
            rc, _, err = self._run_git_text(
                git_exe, repo_root, ["add", "-A", "--", *safe_paths]
            )
            if rc != 0:
                raise GitServiceError(
                    f"Failed to stage files: {err.strip()}", status_code=400
                )
        return self.get_status(str(repo_root))

    def stage_all(self, raw_project_dir: Optional[str] = None) -> GitStatusResponse:
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)
        with self._get_repo_lock(repo_root):
            rc, _, err = self._run_git_text(git_exe, repo_root, ["add", "-A"])
            if rc != 0:
                raise GitServiceError(
                    f"Failed to stage all changes: {err.strip()}", status_code=400
                )
        return self.get_status(str(repo_root))

    def unstage_paths(self, req: GitPathsRequest) -> GitStatusResponse:
        git_exe, repo_root = self._require_git_and_repo(req.project_dir)
        safe_paths = self._confine_repo_paths(repo_root, req.paths)
        with self._get_repo_lock(repo_root):
            if self._has_head_commit(git_exe, repo_root):
                rc, _, err = self._run_git_text(
                    git_exe, repo_root, ["reset", "-q", "HEAD", "--", *safe_paths]
                )
            else:
                # Unborn repository (no commits yet): remove from index without deleting worktree files
                rc, _, err = self._run_git_text(
                    git_exe,
                    repo_root,
                    ["rm", "--cached", "-r", "-f", "--quiet", "--", *safe_paths],
                )
            if rc != 0:
                raise GitServiceError(
                    f"Failed to unstage files: {err.strip()}", status_code=400
                )
        return self.get_status(str(repo_root))

    def unstage_all(self, raw_project_dir: Optional[str] = None) -> GitStatusResponse:
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)
        with self._get_repo_lock(repo_root):
            cur = self.get_status(str(repo_root))
            if cur.staged_count == 0:
                return cur
            if self._has_head_commit(git_exe, repo_root):
                rc, _, err = self._run_git_text(
                    git_exe, repo_root, ["reset", "-q", "HEAD", "--"]
                )
            else:
                rc, _, err = self._run_git_text(
                    git_exe,
                    repo_root,
                    ["rm", "--cached", "-r", "-f", "--quiet", "--", "."],
                )
            if rc != 0:
                raise GitServiceError(
                    f"Failed to unstage all changes: {err.strip()}", status_code=400
                )
        return self.get_status(str(repo_root))

    def discard_changes(self, req: GitConfirmPathsRequest) -> GitStatusResponse:
        if not req.confirm:
            raise GitServiceError(
                "Explicit confirmation (confirm=true) is required to discard unstaged changes.",
                status_code=400,
            )

        git_exe, repo_root = self._require_git_and_repo(req.project_dir)
        safe_paths = self._confine_repo_paths(repo_root, req.paths)

        with self._get_repo_lock(repo_root):
            status = self.get_status(str(repo_root))
            untracked_set = {f.path for f in status.untracked_files}
            unstaged_set = {f.path for f in status.unstaged_files}

            for path in safe_paths:
                if path in untracked_set:
                    raise GitServiceError(
                        f"Cannot discard untracked file '{path}'. Use explicit untracked deletion instead.",
                        status_code=400,
                    )
                if path not in unstaged_set:
                    raise GitServiceError(
                        f"File '{path}' has no unstaged working-tree modifications to discard.",
                        status_code=400,
                    )

            rc, _, err = self._run_git_text(
                git_exe, repo_root, ["checkout", "--", *safe_paths]
            )
            if rc != 0:
                raise GitServiceError(
                    f"Failed to discard working-tree changes: {err.strip()}",
                    status_code=400,
                )

        return self.get_status(str(repo_root))

    def delete_untracked(self, req: GitConfirmPathsRequest) -> GitStatusResponse:
        if not req.confirm:
            raise GitServiceError(
                "Explicit confirmation (confirm=true) is required to permanently delete untracked files.",
                status_code=400,
            )

        _, repo_root = self._require_git_and_repo(req.project_dir)
        safe_paths = self._confine_repo_paths(repo_root, req.paths)
        root_resolved = repo_root.resolve(strict=False)

        with self._get_repo_lock(repo_root):
            status = self.get_status(str(repo_root))
            untracked_set = {f.path for f in status.untracked_files}
            for rel in safe_paths:
                if rel not in untracked_set:
                    raise GitServiceError(
                        f"Path '{rel}' is not an untracked file and cannot be deleted via untracked cleanup.",
                        status_code=400,
                    )

            for rel in safe_paths:
                target = (root_resolved / rel).resolve(strict=False)
                if not target.is_relative_to(root_resolved):
                    raise GitServiceError(
                        f"Path '{rel}' escapes the repository root.", status_code=400
                    )
                try:
                    if target.is_symlink() or target.is_file():
                        target.unlink()
                    elif target.is_dir():
                        shutil.rmtree(target)
                except OSError as exc:
                    raise GitServiceError(
                        f"Failed to delete untracked file '{rel}': {exc}",
                        status_code=500,
                    ) from exc

        return self.get_status(str(repo_root))

    # ------------------------------------------------------------------ #
    # Commit (never auto-stages)
    # ------------------------------------------------------------------ #

    def commit(self, req: GitCommitRequest) -> GitCommitResponse:
        git_exe, repo_root = self._require_git_and_repo(req.project_dir)

        with self._get_repo_lock(repo_root):
            cur = self.get_status(str(repo_root))
            if cur.conflicted_files:
                raise GitServiceError(
                    "Resolve merge conflicts before committing.", status_code=409
                )
            if cur.staged_count == 0:
                raise GitServiceError(
                    "No staged changes to commit. Stage modified or untracked files first.",
                    status_code=400,
                )

            rc, out, err = self._run_git_text(
                git_exe,
                repo_root,
                ["commit", "-F", "-"],
                stdin_text=req.message,
            )
            if rc != 0:
                combined = f"{err}\n{out}".strip()
                lower = combined.lower()
                if (
                    "author identity unknown" in lower
                    or "please tell me who you are" in lower
                    or "unable to auto-detect email" in lower
                ):
                    raise GitServiceError(
                        "Git author identity is not configured. Run `git config user.name \"Your Name\"` and `git config user.email \"you@example.com\"` before committing.",
                        status_code=400,
                    )
                raise GitServiceError(
                    f"Git commit failed: {combined or 'unknown error'}",
                    status_code=400,
                )

            rc_h, hash_out, _ = self._run_git_text(
                git_exe, repo_root, ["rev-parse", "HEAD"]
            )
            commit_hash = hash_out.strip() if rc_h == 0 else ""
            short_hash = commit_hash[:8] if commit_hash else "HEAD"
            first_line = req.message.splitlines()[0].strip()

        updated_status = self.get_status(str(repo_root))
        return GitCommitResponse(
            commit_hash=commit_hash,
            short_hash=short_hash,
            branch=updated_status.current_branch,
            summary=first_line,
            status=updated_status,
        )

    # ------------------------------------------------------------------ #
    # Local Branches (no remote push/pull/fetch)
    # ------------------------------------------------------------------ #

    def list_branches(
        self, raw_project_dir: Optional[str] = None
    ) -> GitBranchesResponse:
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)
        status = self.get_status(str(repo_root))

        rc, out, err = self._run_git_text(
            git_exe,
            repo_root,
            [
                "for-each-ref",
                "--sort=-HEAD",
                "--sort=refname:short",
                "--format=%(HEAD)%1f%(refname:short)%1f%(objectname)%1f%(objectname:short)%1f%(committerdate:iso-strict)%1f%(subject)%1e",
                "refs/heads",
            ],
        )
        if rc != 0:
            raise GitServiceError(
                f"Failed to list local branches: {err.strip()}", status_code=500
            )

        branches: List[GitBranchInfo] = []
        for rec in out.split("\x1e"):
            cleaned = rec.strip("\r\n")
            if not cleaned:
                continue
            parts = cleaned.split("\x1f")
            if len(parts) < 6:
                continue
            head_marker, name, full_hash, short_hash, c_date, subject = (
                parts[0],
                parts[1],
                parts[2],
                parts[3],
                parts[4],
                parts[5],
            )
            branches.append(
                GitBranchInfo(
                    name=name,
                    is_current=(head_marker.strip() == "*"),
                    commit_hash=full_hash,
                    short_hash=short_hash,
                    committer_date=c_date or None,
                    subject=subject,
                )
            )

        return GitBranchesResponse(
            current_branch=status.current_branch,
            is_detached=status.is_detached,
            is_unborn=status.is_unborn,
            branches=branches,
        )

    def precheck_switch(
        self, target_branch: str, raw_project_dir: Optional[str] = None
    ) -> GitSwitchPrecheckResponse:
        branch = validate_branch_name(target_branch)
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)

        rc_ref, _, _ = self._run_git_text(
            git_exe, repo_root, ["show-ref", "--verify", "--quiet", f"refs/heads/{branch}"]
        )
        if rc_ref != 0:
            raise GitServiceError(
                f"Local branch '{branch}' does not exist.", status_code=404
            )

        status = self.get_status(str(repo_root))
        dirty_set = set()
        for f in status.staged_files + status.unstaged_files:
            dirty_set.add(f.path)
        for f in status.untracked_files:
            dirty_set.add(f.path)
        dirty_files = sorted(dirty_set)

        potentially_affected: List[str] = []
        if dirty_files and self._has_head_commit(git_exe, repo_root):
            proc = self._run_git_bytes(
                git_exe,
                repo_root,
                ["diff", "--name-only", "-z", "HEAD", f"refs/heads/{branch}"],
            )
            if proc.returncode == 0:
                branch_diff_paths = {
                    p
                    for p in proc.stdout.decode("utf-8", errors="replace").split("\x00")
                    if p
                }
                potentially_affected = sorted(dirty_set & branch_diff_paths)

        warning: Optional[str] = None
        if potentially_affected:
            warning = (
                f"{len(potentially_affected)} locally modified file(s) differ on branch '{branch}'. "
                "Switching may conflict unless changes are committed, staged carefully, or discarded."
            )
        elif dirty_files:
            warning = (
                f"Working tree has {len(dirty_files)} uncommitted change(s). "
                "Git will carry compatible changes across, or abort if files conflict."
            )

        return GitSwitchPrecheckResponse(
            target_branch=branch,
            has_uncommitted_changes=bool(dirty_files),
            potentially_affected_files=potentially_affected,
            dirty_files=dirty_files,
            warning=warning,
        )

    def switch_branch(self, req: GitBranchSwitchRequest) -> GitBranchActionResponse:
        git_exe, repo_root = self._require_git_and_repo(req.project_dir)
        with self._get_repo_lock(repo_root):
            rc_ref, _, _ = self._run_git_text(
                git_exe,
                repo_root,
                ["show-ref", "--verify", "--quiet", f"refs/heads/{req.name}"],
            )
            if rc_ref != 0:
                raise GitServiceError(
                    f"Local branch '{req.name}' does not exist.", status_code=404
                )

            rc, out, err = self._run_git_text(
                git_exe, repo_root, ["switch", req.name]
            )
            if rc != 0 and "unknown command" in err.lower():
                rc, out, err = self._run_git_text(
                    git_exe, repo_root, ["checkout", req.name]
                )

            if rc != 0:
                detail = (err or out).strip()
                lower = detail.lower()
                if (
                    "would be overwritten" in lower
                    or "local changes" in lower
                    or "please commit your changes" in lower
                ):
                    raise GitServiceError(
                        f"Branch switch aborted to preserve uncommitted changes:\n{detail}",
                        status_code=409,
                    )
                raise GitServiceError(
                    f"Failed to switch branch to '{req.name}': {detail}",
                    status_code=400,
                )

        branches = self.list_branches(str(repo_root))
        status = self.get_status(str(repo_root))
        return GitBranchActionResponse(
            active_branch=status.current_branch,
            status=status,
            branches=branches.branches,
        )

    def create_branch(self, req: GitBranchCreateRequest) -> GitBranchActionResponse:
        git_exe, repo_root = self._require_git_and_repo(req.project_dir)
        with self._get_repo_lock(repo_root):
            rc_fmt, _, _ = self._run_git_text(
                git_exe, repo_root, ["check-ref-format", "--branch", req.name]
            )
            if rc_fmt != 0:
                raise GitServiceError(
                    f"Invalid Git branch name '{req.name}'.", status_code=400
                )

            if not self._has_head_commit(git_exe, repo_root):
                raise GitServiceError(
                    "Cannot create a new branch before creating an initial commit.",
                    status_code=400,
                )

            rc_exists, _, _ = self._run_git_text(
                git_exe,
                repo_root,
                ["show-ref", "--verify", "--quiet", f"refs/heads/{req.name}"],
            )
            if rc_exists == 0:
                raise GitServiceError(
                    f"Local branch '{req.name}' already exists.", status_code=409
                )

            if req.checkout:
                rc, out, err = self._run_git_text(
                    git_exe, repo_root, ["switch", "-c", req.name]
                )
                if rc != 0 and "unknown command" in err.lower():
                    rc, out, err = self._run_git_text(
                        git_exe, repo_root, ["checkout", "-b", req.name]
                    )
            else:
                rc, out, err = self._run_git_text(
                    git_exe, repo_root, ["branch", req.name]
                )

            if rc != 0:
                detail = (err or out).strip()
                raise GitServiceError(
                    f"Failed to create branch '{req.name}': {detail}",
                    status_code=400,
                )

        branches = self.list_branches(str(repo_root))
        status = self.get_status(str(repo_root))
        return GitBranchActionResponse(
            active_branch=status.current_branch,
            status=status,
            branches=branches.branches,
        )

    # ------------------------------------------------------------------ #
    # Bounded History & Commit Detail Inspection
    # ------------------------------------------------------------------ #

    def get_history(
        self,
        raw_project_dir: Optional[str] = None,
        limit: int = 25,
        offset: int = 0,
    ) -> GitHistoryResponse:
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)
        clamped_limit = max(1, min(100, int(limit)))
        clamped_offset = max(0, int(offset))
        status = self.get_status(str(repo_root))

        if not self._has_head_commit(git_exe, repo_root):
            return GitHistoryResponse(
                branch=status.current_branch,
                limit=clamped_limit,
                offset=clamped_offset,
                has_more=False,
                commits=[],
            )

        rc, out, err = self._run_git_text(
            git_exe,
            repo_root,
            [
                "log",
                f"--skip={clamped_offset}",
                f"--max-count={clamped_limit + 1}",
                "--date=iso-strict",
                "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1e",
                "HEAD",
            ],
        )
        if rc != 0:
            raise GitServiceError(
                f"Failed to load commit history: {err.strip()}", status_code=500
            )

        commits: List[GitCommitSummary] = []
        for rec in out.split("\x1e"):
            cleaned = rec.strip("\r\n")
            if not cleaned:
                continue
            parts = cleaned.split("\x1f")
            if len(parts) < 7:
                continue
            commits.append(
                GitCommitSummary(
                    hash=parts[0],
                    short_hash=parts[1],
                    author_name=parts[2],
                    author_email=parts[3],
                    authored_at=parts[4],
                    subject=parts[5],
                    parents=[p for p in parts[6].split() if p],
                )
            )

        has_more = len(commits) > clamped_limit
        return GitHistoryResponse(
            branch=status.current_branch,
            limit=clamped_limit,
            offset=clamped_offset,
            has_more=has_more,
            commits=commits[:clamped_limit],
        )

    def _parse_commit_file_stats(
        self, git_exe: str, repo_root: Path, commit_hash: str
    ) -> Tuple[List[GitCommitFileStat], int, int]:
        proc_ns = self._run_git_bytes(
            git_exe,
            repo_root,
            ["diff-tree", "-M", "--root", "--no-commit-id", "-r", "--name-status", "-z", commit_hash],
        )
        proc_nm = self._run_git_bytes(
            git_exe,
            repo_root,
            ["diff-tree", "-M", "--root", "--no-commit-id", "-r", "--numstat", "-z", commit_hash],
        )

        # Parse --name-status -z
        status_map: Dict[str, Tuple[GitFileStatusCode, Optional[str]]] = {}
        ordered_paths: List[str] = []
        ns_tokens = proc_ns.stdout.decode("utf-8", errors="replace").split("\x00")
        i = 0
        while i < len(ns_tokens):
            code = ns_tokens[i]
            i += 1
            if not code:
                continue
            lead = code[0].upper()
            if lead in ("R", "C"):
                orig = ns_tokens[i] if i < len(ns_tokens) else None
                new_p = ns_tokens[i + 1] if i + 1 < len(ns_tokens) else ""
                i += 2
                if new_p:
                    status_map[new_p] = (_map_status_char(lead), orig)
                    ordered_paths.append(new_p)
            else:
                path = ns_tokens[i] if i < len(ns_tokens) else ""
                i += 1
                if path:
                    status_map[path] = (_map_status_char(lead), None)
                    ordered_paths.append(path)

        # Parse --numstat -z (adds/deletes, handling binary `-\t-` and rename empty-tail format)
        num_map: Dict[str, Tuple[Optional[int], Optional[int], bool]] = {}
        nm_tokens = proc_nm.stdout.decode("utf-8", errors="replace").split("\x00")
        j = 0
        while j < len(nm_tokens):
            tok = nm_tokens[j]
            j += 1
            if not tok:
                continue
            parts = tok.split("\t", 2)
            if len(parts) < 3:
                continue
            add_s, del_s, path_part = parts[0], parts[1], parts[2]
            is_bin = add_s == "-" and del_s == "-"
            ins = None if is_bin else int(add_s) if add_s.isdigit() else None
            dels = None if is_bin else int(del_s) if del_s.isdigit() else None
            if path_part == "":
                # Rename entry: next two NUL tokens are orig_path and new_path
                _orig = nm_tokens[j] if j < len(nm_tokens) else ""
                new_p = nm_tokens[j + 1] if j + 1 < len(nm_tokens) else ""
                j += 2
                if new_p:
                    num_map[new_p] = (ins, dels, is_bin)
            else:
                num_map[path_part] = (ins, dels, is_bin)

        files: List[GitCommitFileStat] = []
        total_ins = 0
        total_dels = 0
        for p in ordered_paths:
            st, orig = status_map[p]
            ins, dels, is_bin = num_map.get(p, (None, None, False))
            if ins is not None:
                total_ins += ins
            if dels is not None:
                total_dels += dels
            files.append(
                GitCommitFileStat(
                    path=p,
                    orig_path=orig,
                    status=st,
                    insertions=ins,
                    deletions=dels,
                    is_binary=is_bin,
                )
            )
        return files, total_ins, total_dels

    def get_commit_detail(
        self, commit_hash: str, raw_project_dir: Optional[str] = None
    ) -> GitCommitDetailResponse:
        try:
            clean_hash = validate_commit_hash(commit_hash)
        except ValueError as exc:
            raise GitServiceError(str(exc), status_code=400) from exc

        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)

        rc_t, type_out, _ = self._run_git_text(
            git_exe, repo_root, ["cat-file", "-t", clean_hash]
        )
        if rc_t != 0 or type_out.strip() != "commit":
            raise GitServiceError(
                f"Commit '{clean_hash}' was not found in repository.",
                status_code=404,
            )

        rc_m, meta_out, err_m = self._run_git_text(
            git_exe,
            repo_root,
            [
                "show",
                "-s",
                "--date=iso-strict",
                "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x1f%b",
                clean_hash,
            ],
        )
        if rc_m != 0:
            raise GitServiceError(
                f"Failed to read commit metadata: {err_m.strip()}", status_code=500
            )

        parts = meta_out.split("\x1f", 7)
        if len(parts) < 8:
            raise GitServiceError("Malformed commit metadata output.", status_code=500)

        full_hash = parts[0]
        short_hash = parts[1]
        author_name = parts[2]
        author_email = parts[3]
        authored_at = parts[4]
        parents = [p for p in parts[5].split() if p]
        subject = parts[6]
        body = parts[7].strip()

        files, total_ins, total_dels = self._parse_commit_file_stats(
            git_exe, repo_root, full_hash
        )

        patch_proc = self._run_git_bytes(
            git_exe,
            repo_root,
            ["show", "--root", "--patch", "--no-color", "--format=", full_hash],
        )
        diff_bytes = len(patch_proc.stdout)
        truncated = diff_bytes > _MAX_DIFF_BYTES
        diff_slice = patch_proc.stdout[:_MAX_DIFF_BYTES]
        unified_diff = diff_slice.decode("utf-8", errors="replace")

        return GitCommitDetailResponse(
            hash=full_hash,
            short_hash=short_hash,
            author_name=author_name,
            author_email=author_email,
            authored_at=authored_at,
            subject=subject,
            body=body,
            parents=parents,
            files=files,
            total_insertions=total_ins,
            total_deletions=total_dels,
            unified_diff=unified_diff,
            diff_truncated=truncated,
            diff_bytes=diff_bytes,
        )

    # ------------------------------------------------------------------ #
    # Bounded File Diff Viewer (Working Tree, Staged, Commit, Untracked)
    # ------------------------------------------------------------------ #

    def _read_git_blob_text(
        self, git_exe: str, repo_root: Path, spec: str
    ) -> Tuple[Optional[str], bool, bool]:
        """Read a git object (`HEAD:path`, `:path`, `<hash>^:path`) safely with binary & size guards."""
        proc = self._run_git_bytes(git_exe, repo_root, ["cat-file", "-s", spec])
        if proc.returncode != 0:
            return None, False, False
        try:
            size = int(proc.stdout.decode("utf-8", errors="replace").strip())
        except ValueError:
            size = 0
        if size > _MAX_DIFF_BYTES:
            return None, False, True

        show_proc = self._run_git_bytes(git_exe, repo_root, ["show", spec])
        if show_proc.returncode != 0:
            return None, False, False
        if _looks_like_binary(show_proc.stdout):
            return None, True, False
        return show_proc.stdout.decode("utf-8", errors="replace"), False, False

    def _read_worktree_text(
        self, repo_root: Path, rel_path: str
    ) -> Tuple[Optional[str], bool, bool, int]:
        target = (repo_root / rel_path).resolve(strict=False)
        if not target.exists() or not target.is_file():
            return None, False, False, 0
        try:
            size = target.stat().st_size
            if size > _MAX_DIFF_BYTES:
                return None, False, True, size
            raw = target.read_bytes()
        except OSError:
            return None, False, False, 0
        if _looks_like_binary(raw):
            return None, True, False, size
        return raw.decode("utf-8", errors="replace"), False, False, size

    def _count_diff_lines(self, unified_diff: str) -> Tuple[int, int]:
        added = 0
        removed = 0
        for line in unified_diff.splitlines():
            if line.startswith("+++") or line.startswith("---"):
                continue
            if line.startswith("+"):
                added += 1
            elif line.startswith("-"):
                removed += 1
        return added, removed

    def get_diff(
        self,
        raw_path: str,
        *,
        raw_project_dir: Optional[str] = None,
        staged: bool = False,
        commit_hash: Optional[str] = None,
    ) -> GitDiffResponse:
        git_exe, repo_root = self._require_git_and_repo(raw_project_dir)
        norm_path = self._confine_repo_paths(repo_root, [raw_path])[0]

        if commit_hash is not None:
            try:
                clean_hash = validate_commit_hash(commit_hash)
            except ValueError as exc:
                raise GitServiceError(str(exc), status_code=400) from exc

            files, _, _ = self._parse_commit_file_stats(git_exe, repo_root, clean_hash)
            matched = next((f for f in files if f.path == norm_path), None)
            change_type: GitFileStatusCode = matched.status if matched else "modified"
            lookup_prev = matched.orig_path or norm_path if matched else norm_path

            patch_proc = self._run_git_bytes(
                git_exe,
                repo_root,
                ["show", "--root", "--patch", "--no-color", "--format=", clean_hash, "--", norm_path],
            )
            diff_bytes = len(patch_proc.stdout)
            truncated = diff_bytes > _MAX_DIFF_BYTES
            unified_diff = patch_proc.stdout[:_MAX_DIFF_BYTES].decode(
                "utf-8", errors="replace"
            )
            added, removed = self._count_diff_lines(unified_diff)

            if matched and matched.is_binary:
                return GitDiffResponse(
                    path=norm_path,
                    change_type=change_type,
                    staged=False,
                    commit=clean_hash,
                    is_binary=True,
                    total_bytes=diff_bytes,
                    unified_diff=unified_diff,
                    note="Binary file diff cannot be rendered inline.",
                )

            rc_p, parent_out, _ = self._run_git_text(
                git_exe, repo_root, ["rev-list", "--parents", "-n", "1", clean_hash]
            )
            parent_hash: Optional[str] = None
            if rc_p == 0:
                toks = parent_out.strip().split()
                if len(toks) >= 2:
                    parent_hash = toks[1]

            orig_text = ""
            orig_bin = False
            orig_large = False
            if parent_hash and change_type != "added":
                t, orig_bin, orig_large = self._read_git_blob_text(
                    git_exe, repo_root, f"{parent_hash}:{lookup_prev}"
                )
                orig_text = t or ""

            mod_text = ""
            mod_bin = False
            mod_large = False
            if change_type != "deleted":
                t2, mod_bin, mod_large = self._read_git_blob_text(
                    git_exe, repo_root, f"{clean_hash}:{norm_path}"
                )
                mod_text = t2 or ""

            too_large = orig_large or mod_large or truncated
            is_binary = orig_bin or mod_bin
            return GitDiffResponse(
                path=norm_path,
                change_type=change_type,
                staged=False,
                commit=clean_hash,
                is_binary=is_binary,
                too_large=too_large,
                truncated=truncated,
                total_bytes=diff_bytes,
                added_lines=added,
                removed_lines=removed,
                unified_diff=unified_diff,
                original_content=None if (is_binary or too_large) else orig_text,
                modified_content=None if (is_binary or too_large) else mod_text,
                note=(
                    "Binary file diff cannot be rendered inline."
                    if is_binary
                    else "File is too large for full side-by-side diff; showing truncated preview."
                    if too_large
                    else None
                ),
            )

        # Working tree / Index diff
        status = self.get_status(str(repo_root))
        untracked_match = next(
            (f for f in status.untracked_files if f.path == norm_path), None
        )
        if untracked_match and not staged:
            wt_text, is_bin, too_large, total_bytes = self._read_worktree_text(
                repo_root, norm_path
            )
            if is_bin:
                return GitDiffResponse(
                    path=norm_path,
                    change_type="untracked",
                    staged=False,
                    is_binary=True,
                    total_bytes=total_bytes,
                    note="Binary untracked file cannot be rendered inline.",
                )
            if too_large or wt_text is None:
                return GitDiffResponse(
                    path=norm_path,
                    change_type="untracked",
                    staged=False,
                    too_large=True,
                    total_bytes=total_bytes,
                    note="Untracked file exceeds 512 KiB diff display limit.",
                )
            lines = wt_text.splitlines()
            synthetic_diff = "\n".join(
                [
                    f"--- /dev/null",
                    f"+++ b/{norm_path}",
                    f"@@ -0,0 +1,{len(lines)} @@",
                    *(f"+{ln}" for ln in lines),
                ]
            )
            return GitDiffResponse(
                path=norm_path,
                change_type="untracked",
                staged=False,
                total_bytes=total_bytes,
                added_lines=len(lines),
                removed_lines=0,
                unified_diff=synthetic_diff,
                original_content="",
                modified_content=wt_text,
            )

        if staged:
            staged_match = next(
                (f for f in status.staged_files if f.path == norm_path), None
            )
            ctype: GitFileStatusCode = staged_match.status if staged_match else "modified"
            prev_path = (
                staged_match.orig_path or norm_path if staged_match else norm_path
            )
            diff_args = ["diff", "--cached", "--no-color", "--", norm_path]
        else:
            unstaged_match = next(
                (f for f in status.unstaged_files if f.path == norm_path), None
            )
            ctype = unstaged_match.status if unstaged_match else "modified"
            prev_path = norm_path
            diff_args = ["diff", "--no-color", "--", norm_path]

        diff_proc = self._run_git_bytes(git_exe, repo_root, diff_args)
        diff_bytes = len(diff_proc.stdout)
        truncated = diff_bytes > _MAX_DIFF_BYTES
        unified_diff = diff_proc.stdout[:_MAX_DIFF_BYTES].decode(
            "utf-8", errors="replace"
        )
        added, removed = self._count_diff_lines(unified_diff)

        # Check numstat binary detection cleanly
        num_proc = self._run_git_bytes(
            git_exe,
            repo_root,
            ["diff", *(["--cached"] if staged else []), "--numstat", "--", norm_path],
        )
        num_text = num_proc.stdout.decode("utf-8", errors="replace").strip()
        num_binary = num_text.startswith("-\t-")

        if num_binary:
            return GitDiffResponse(
                path=norm_path,
                change_type=ctype,
                staged=staged,
                is_binary=True,
                total_bytes=diff_bytes,
                unified_diff=unified_diff,
                note="Binary file diff cannot be rendered inline.",
            )

        orig_text = ""
        orig_bin = False
        orig_large = False
        mod_text = ""
        mod_bin = False
        mod_large = False
        mod_bytes = 0

        if staged:
            if ctype != "added" and self._has_head_commit(git_exe, repo_root):
                t, orig_bin, orig_large = self._read_git_blob_text(
                    git_exe, repo_root, f"HEAD:{prev_path}"
                )
                orig_text = t or ""
            if ctype != "deleted":
                t2, mod_bin, mod_large = self._read_git_blob_text(
                    git_exe, repo_root, f":{norm_path}"
                )
                mod_text = t2 or ""
        else:
            t, orig_bin, orig_large = self._read_git_blob_text(
                git_exe, repo_root, f":{norm_path}"
            )
            orig_text = t or ""
            if ctype != "deleted":
                t2, mod_bin, mod_large, mod_bytes = self._read_worktree_text(
                    repo_root, norm_path
                )
                mod_text = t2 or ""

        is_binary = orig_bin or mod_bin
        too_large = orig_large or mod_large or truncated
        total = max(diff_bytes, mod_bytes)

        return GitDiffResponse(
            path=norm_path,
            change_type=ctype,
            staged=staged,
            is_binary=is_binary,
            too_large=too_large,
            truncated=truncated,
            total_bytes=total,
            added_lines=added,
            removed_lines=removed,
            unified_diff=unified_diff,
            original_content=None if (is_binary or too_large) else orig_text,
            modified_content=None if (is_binary or too_large) else mod_text,
            note=(
                "Binary file diff cannot be rendered inline."
                if is_binary
                else "File exceeds 512 KiB size guard for side-by-side rendering."
                if too_large
                else None
            ),
        )


_git_service_instance: Optional[GitService] = None
_git_service_lock = threading.Lock()


def get_git_service() -> GitService:
    """FastAPI dependency returning the singleton GitService bound to active settings."""
    global _git_service_instance
    if _git_service_instance is None:
        with _git_service_lock:
            if _git_service_instance is None:
                _git_service_instance = GitService(settings)
    return _git_service_instance
