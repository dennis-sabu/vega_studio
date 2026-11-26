"""VEGA Studio Backend – Phase 13 GitHub CLI, remote, publish, and sync service."""
from __future__ import annotations

from collections import deque
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import uuid
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from app.config import Settings, settings
from app.models.github import (
    GitHubAuthStartRequest,
    GitHubCliInfo,
    GitHubCreateRepoRequest,
    GitHubFetchRequest,
    GitHubOpKind,
    GitHubOperationSummary,
    GitHubPublishPreviewResponse,
    GitHubPublishRequest,
    GitHubPullRequest,
    GitHubPushRequest,
    GitHubRemoteAddRequest,
    GitHubRemoteRemoveRequest,
    GitHubRemoteRepoDetail,
    GitHubRemoteUpdateRequest,
    GitHubStatusResponse,
    GitHubSyncPrecheckResponse,
    GitRemoteInfo,
    validate_remote_name,
)
from app.services.git_service import GitService, GitServiceError, get_git_service
from app.services.process_utils import terminate_process_tree, utc_now_iso

_MAX_OUTPUT_LINES = 500
_SYNC_TIMEOUT_SECONDS = 120.0
_AUTH_TIMEOUT_SECONDS = 300.0
_QUICK_TIMEOUT_SECONDS = 15.0

_TOKEN_PATTERNS = (
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{8,})\b"),
    re.compile(r"\b(github_pat_[A-Za-z0-9_]{16,})\b"),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    re.compile(r"(x-access-token:)[^\s@\"']+", re.IGNORECASE),
    re.compile(r"(https?://)([^:/\s@]+):([^@/\s]+)@"),
)

_GH_VERSION_RE = re.compile(r"gh version\s+([0-9]+\.[0-9]+\.[0-9]+[^\s]*)", re.IGNORECASE)
_AUTH_USER_RE = re.compile(
    r"Logged in to [^\s]+ (?:account|as)\s+([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))",
    re.IGNORECASE,
)
_AUTH_PROTO_RE = re.compile(r"Git operations(?: protocol)?:\s*(https|ssh)", re.IGNORECASE)
_DEVICE_CODE_RE = re.compile(r"\b([A-Z0-9]{4}-[A-Z0-9]{4})\b")
_VERIFICATION_URL_RE = re.compile(r"(https://github\.com/login/device[^\s]*)")
_REPO_URL_RE = re.compile(r"(https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+)")
_SSH_OWNER_REPO_RE = re.compile(
    r"^git@([^:]+):([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+?)(?:\.git)?$"
)


def redact_secrets(text: str) -> str:
    """Scrub GitHub tokens, Bearer headers, and embedded URL credentials from text."""
    if not text:
        return ""
    scrubbed = text
    scrubbed = _TOKEN_PATTERNS[0].sub("[REDACTED_TOKEN]", scrubbed)
    scrubbed = _TOKEN_PATTERNS[1].sub("[REDACTED_TOKEN]", scrubbed)
    scrubbed = _TOKEN_PATTERNS[2].sub(r"\1[REDACTED_TOKEN]", scrubbed)
    scrubbed = _TOKEN_PATTERNS[3].sub(r"\1[REDACTED]", scrubbed)
    scrubbed = _TOKEN_PATTERNS[4].sub(r"\1[REDACTED]@", scrubbed)
    return scrubbed


def parse_github_remote(url: str) -> Tuple[bool, Optional[str]]:
    """Return (is_github, owner/repo) if url targets github.com."""
    cleaned = url.strip()
    if not cleaned:
        return False, None
    ssh_match = _SSH_OWNER_REPO_RE.match(cleaned)
    if ssh_match:
        host, owner, repo = ssh_match.groups()
        is_gh = host.lower() == "github.com"
        return is_gh, f"{owner}/{repo}" if is_gh else None

    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()
    if host != "github.com":
        return False, None
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2:
        return True, f"{parts[0]}/{parts[1]}"
    return True, None


class GitHubServiceError(Exception):
    """Domain error mapped to HTTP status codes by router."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(redact_secrets(message))
        self.message = redact_secrets(message)
        self.status_code = status_code


class _LiveOperation:
    """Mutable internal state for a single running or finished GitHub/sync operation."""

    def __init__(
        self,
        op_id: str,
        kind: GitHubOpKind,
        cancellable: bool,
        project_dir: Optional[str],
        remote: Optional[str],
        branch: Optional[str],
    ) -> None:
        self.op_id = op_id
        self.kind: GitHubOpKind = kind
        self.status: str = "running"
        self.cancellable = cancellable
        self.project_dir = project_dir
        self.remote = remote
        self.branch = branch
        self.started_at = utc_now_iso()
        self.finished_at: Optional[str] = None
        self.exit_code: Optional[int] = None
        self.cancelled = False
        self.error_message: Optional[str] = None
        self.device_code: Optional[str] = None
        self.verification_url: Optional[str] = None
        self.lines: Deque[str] = deque(maxlen=_MAX_OUTPUT_LINES)
        self.truncated_output = False
        self.proc: Optional[subprocess.Popen[str]] = None
        self.cancel_event = threading.Event()

    def append_line(self, line: str) -> None:
        clean = redact_secrets(line.rstrip("\r\n"))
        if len(self.lines) >= _MAX_OUTPUT_LINES:
            self.truncated_output = True
        self.lines.append(clean)
        if not self.device_code:
            code_match = _DEVICE_CODE_RE.search(clean)
            if code_match:
                self.device_code = code_match.group(1)
        if not self.verification_url:
            url_match = _VERIFICATION_URL_RE.search(clean)
            if url_match:
                self.verification_url = url_match.group(1)

    def to_summary(self) -> GitHubOperationSummary:
        return GitHubOperationSummary(
            op_id=self.op_id,
            kind=self.kind,
            status=self.status,  # type: ignore[arg-type]
            cancellable=self.cancellable,
            project_dir=self.project_dir,
            remote=self.remote,
            branch=self.branch,
            started_at=self.started_at,
            finished_at=self.finished_at,
            exit_code=self.exit_code,
            cancelled=self.cancelled,
            error_message=self.error_message,
            device_code=self.device_code,
            verification_url=self.verification_url,
            output_lines=list(self.lines),
            truncated_output=self.truncated_output,
        )


class GitHubService:
    """Orchestrates GitHub CLI discovery/auth, remote CRUD, repo creation, publish, and sync."""

    def __init__(self, app_settings: Optional[Settings] = None) -> None:
        self._settings = app_settings or settings
        self._git_service = (
            get_git_service() if app_settings is None else GitService(self._settings)
        )
        self._op_lock = threading.Lock()
        self._active_op: Optional[_LiveOperation] = None
        self._latest_op: Optional[_LiveOperation] = None

    # ── Lifecycle & Process Env ──────────────────────────────────────────────────

    def shutdown(self) -> None:
        with self._op_lock:
            op = self._active_op
            if op is not None:
                op.cancel_event.set()
                proc = op.proc
                if proc is not None and proc.poll() is None:
                    terminate_process_tree(proc)

    def _subprocess_env(self, *, disable_prompts: bool = True) -> Dict[str, str]:
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GCM_INTERACTIVE"] = "never"
        env["GIT_ASKPASS"] = ""
        env["SSH_ASKPASS"] = ""
        env["NO_COLOR"] = "1"
        env["CLICOLOR"] = "0"
        if disable_prompts:
            env["GH_PROMPT_DISABLED"] = "1"
        else:
            env.pop("GH_PROMPT_DISABLED", None)
        return env

    @staticmethod
    def _popen_kwargs() -> Dict[str, Any]:
        if os.name == "nt":
            return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
        return {"start_new_session": True}

    # ── GitHub CLI Detection & Auth ──────────────────────────────────────────────

    def detect_gh(self) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
        candidates: List[str] = []
        which_gh = shutil.which("gh")
        if which_gh:
            candidates.append(which_gh)
        if os.name == "nt":
            for fixed in (
                r"C:\Program Files\GitHub CLI\gh.exe",
                r"C:\Program Files (x86)\GitHub CLI\gh.exe",
            ):
                if os.path.isfile(fixed) and fixed not in candidates:
                    candidates.append(fixed)
        else:
            for fixed in ("/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh"):
                if os.path.isfile(fixed) and fixed not in candidates:
                    candidates.append(fixed)

        if not candidates:
            return (
                False,
                None,
                None,
                "GitHub CLI (`gh`) was not found on PATH. Install GitHub CLI to sign in and create repositories.",
            )

        for candidate in candidates:
            try:
                proc = subprocess.run(
                    [candidate, "--version"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=8,
                    env=self._subprocess_env(),
                    **self._popen_kwargs(),
                )
            except (OSError, subprocess.SubprocessError):
                continue

            if proc.returncode == 0:
                raw_ver = (proc.stdout or proc.stderr or "").strip()
                match = _GH_VERSION_RE.search(raw_ver)
                version = match.group(1) if match else (raw_ver.splitlines()[0] if raw_ver else "unknown")
                return True, candidate, version, None

        return (
            False,
            None,
            None,
            "GitHub CLI (`gh`) was located but could not be executed successfully.",
        )

    def check_auth_status(self) -> GitHubCliInfo:
        available, gh_exe, version, reason = self.detect_gh()
        if not available or not gh_exe:
            return GitHubCliInfo(
                gh_available=False,
                gh_version=None,
                gh_executable=None,
                unavailable_reason=reason,
                authenticated=False,
                auth_message=reason,
            )

        try:
            proc = subprocess.run(
                [gh_exe, "auth", "status", "--hostname", "github.com"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                env=self._subprocess_env(),
                **self._popen_kwargs(),
            )
        except subprocess.TimeoutExpired:
            return GitHubCliInfo(
                gh_available=True,
                gh_version=version,
                gh_executable=gh_exe,
                authenticated=False,
                auth_message="Timed out checking GitHub authentication status.",
            )
        except OSError as exc:
            return GitHubCliInfo(
                gh_available=True,
                gh_version=version,
                gh_executable=gh_exe,
                authenticated=False,
                auth_message=redact_secrets(f"Unable to run gh auth status: {exc}"),
            )

        combined = redact_secrets(
            "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()
        )
        user_match = _AUTH_USER_RE.search(combined)
        proto_match = _AUTH_PROTO_RE.search(combined)
        username = user_match.group(1) if user_match else None
        git_proto = proto_match.group(1).lower() if proto_match else None
        authenticated = proc.returncode == 0 and username is not None

        if authenticated:
            msg = f"Authenticated as {username} on github.com"
        elif proc.returncode == 0:
            authenticated = True
            msg = "Authenticated on github.com"
        else:
            first_line = combined.splitlines()[0] if combined else "Not logged into GitHub CLI."
            msg = first_line

        return GitHubCliInfo(
            gh_available=True,
            gh_version=version,
            gh_executable=gh_exe,
            authenticated=authenticated,
            username=username,
            host="github.com",
            git_protocol=git_proto,
            auth_message=msg,
        )

    def _require_gh_authenticated(self) -> Tuple[str, GitHubCliInfo]:
        cli = self.check_auth_status()
        if not cli.gh_available or not cli.gh_executable:
            raise GitHubServiceError(
                cli.unavailable_reason
                or "GitHub CLI (`gh`) is required for this action. Install it from https://cli.github.com/.",
                status_code=503,
            )
        if not cli.authenticated:
            raise GitHubServiceError(
                cli.auth_message
                or "Not signed in to GitHub CLI. Run Sign In with GitHub (`gh auth login`) first.",
                status_code=401,
            )
        return cli.gh_executable, cli

    # ── Status & Remotes ─────────────────────────────────────────────────────────

    def _parse_remotes(self, git_exe: str, repo_root: Path) -> List[GitRemoteInfo]:
        rc, stdout, stderr = self._git_service._run_git_text(
            git_exe, repo_root, ["remote", "-v"], timeout=10
        )
        if rc != 0:
            raise GitHubServiceError(
                redact_secrets(stderr.strip() or "Failed to inspect Git remotes."),
                status_code=500,
            )

        entries: Dict[str, Dict[str, str]] = {}
        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            name, url, direction = parts[0], parts[1], parts[2].strip("()")
            bucket = entries.setdefault(name, {"fetch": url, "push": url})
            if direction == "fetch":
                bucket["fetch"] = url
            elif direction == "push":
                bucket["push"] = url

        remotes: List[GitRemoteInfo] = []
        for name, urls in entries.items():
            fetch_url = redact_secrets(urls["fetch"])
            push_url = redact_secrets(urls["push"])
            is_gh, owner_repo = parse_github_remote(fetch_url)
            if not is_gh:
                is_gh, owner_repo = parse_github_remote(push_url)
            remotes.append(
                GitRemoteInfo(
                    name=name,
                    fetch_url=fetch_url,
                    push_url=push_url,
                    is_github=is_gh,
                    github_owner_repo=owner_repo,
                )
            )
        return remotes

    @staticmethod
    def _pick_primary_remote(remotes: List[GitRemoteInfo]) -> Optional[GitRemoteInfo]:
        for r in remotes:
            if r.name == "origin":
                return r
        for r in remotes:
            if r.is_github:
                return r
        return remotes[0] if remotes else None

    def get_status(self, raw_project_dir: Optional[str] = None) -> GitHubStatusResponse:
        cli = self.check_auth_status()
        active_op, latest_op = self._operation_snapshots()

        project_dir_str: Optional[str] = None
        is_git_repo = False
        current_branch: Optional[str] = None
        is_unborn = False
        is_detached = False
        repo_state = "not_a_repo"
        upstream: Optional[str] = None
        ahead = 0
        behind = 0
        remotes: List[GitRemoteInfo] = []

        if raw_project_dir and raw_project_dir.strip():
            try:
                git_status = self._git_service.get_status(raw_project_dir)
                project_dir_str = git_status.project_dir
                is_git_repo = git_status.is_repository
                current_branch = git_status.current_branch
                is_unborn = git_status.is_unborn
                is_detached = git_status.is_detached
                repo_state = git_status.repo_state
                upstream = git_status.upstream
                ahead = git_status.ahead
                behind = git_status.behind
                if is_git_repo:
                    git_exe, repo_root = self._git_service._require_git_and_repo(raw_project_dir)
                    remotes = self._parse_remotes(git_exe, repo_root)
            except GitServiceError as exc:
                raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        return GitHubStatusResponse(
            cli=cli,
            project_dir=project_dir_str,
            is_git_repository=is_git_repo,
            current_branch=current_branch,
            is_unborn=is_unborn,
            is_detached=is_detached,
            repo_state=repo_state,
            upstream=upstream,
            ahead=ahead,
            behind=behind,
            remotes=remotes,
            primary_remote=self._pick_primary_remote(remotes),
            active_operation=active_op,
            latest_operation=latest_op,
        )

    def list_remotes(self, raw_project_dir: Optional[str] = None) -> List[GitRemoteInfo]:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(raw_project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc
        return self._parse_remotes(git_exe, repo_root)

    def add_remote(self, req: GitHubRemoteAddRequest) -> List[GitRemoteInfo]:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        with self._git_service._get_repo_lock(repo_root):
            existing = self._parse_remotes(git_exe, repo_root)
            if any(r.name == req.name for r in existing):
                raise GitHubServiceError(
                    f"Remote '{req.name}' already exists. Use update remote with confirmation to change its URL.",
                    status_code=409,
                )
            rc, _, stderr = self._git_service._run_git_text(
                git_exe, repo_root, ["remote", "add", "--", req.name, req.url], timeout=10
            )
            if rc != 0:
                raise GitHubServiceError(
                    redact_secrets(stderr.strip() or f"Failed to add remote '{req.name}'."),
                    status_code=400,
                )
            return self._parse_remotes(git_exe, repo_root)

    def update_remote(self, remote_name: str, req: GitHubRemoteUpdateRequest) -> List[GitRemoteInfo]:
        try:
            cleaned_name = validate_remote_name(remote_name)
        except ValueError as exc:
            raise GitHubServiceError(str(exc), status_code=400) from exc
        if not req.confirm:
            raise GitHubServiceError(
                "Changing an existing remote URL requires explicit confirmation.",
                status_code=400,
            )
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        with self._git_service._get_repo_lock(repo_root):
            existing = self._parse_remotes(git_exe, repo_root)
            if not any(r.name == cleaned_name for r in existing):
                raise GitHubServiceError(
                    f"Remote '{cleaned_name}' does not exist.", status_code=404
                )
            rc, _, stderr = self._git_service._run_git_text(
                git_exe, repo_root, ["remote", "set-url", "--", cleaned_name, req.url], timeout=10
            )
            if rc != 0:
                raise GitHubServiceError(
                    redact_secrets(stderr.strip() or f"Failed to update remote '{cleaned_name}'."),
                    status_code=400,
                )
            return self._parse_remotes(git_exe, repo_root)

    def remove_remote(self, remote_name: str, req: GitHubRemoteRemoveRequest) -> List[GitRemoteInfo]:
        try:
            cleaned_name = validate_remote_name(remote_name)
        except ValueError as exc:
            raise GitHubServiceError(str(exc), status_code=400) from exc
        if not req.confirm:
            raise GitHubServiceError(
                "Removing a Git remote requires explicit confirmation.", status_code=400
            )
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        with self._git_service._get_repo_lock(repo_root):
            existing = self._parse_remotes(git_exe, repo_root)
            if not any(r.name == cleaned_name for r in existing):
                raise GitHubServiceError(
                    f"Remote '{cleaned_name}' does not exist.", status_code=404
                )
            rc, _, stderr = self._git_service._run_git_text(
                git_exe, repo_root, ["remote", "remove", "--", cleaned_name], timeout=10
            )
            if rc != 0:
                raise GitHubServiceError(
                    redact_secrets(stderr.strip() or f"Failed to remove remote '{cleaned_name}'."),
                    status_code=400,
                )
            return self._parse_remotes(git_exe, repo_root)

    # ── Background Operation Harness ─────────────────────────────────────────────

    def _operation_snapshots(
        self,
    ) -> Tuple[Optional[GitHubOperationSummary], Optional[GitHubOperationSummary]]:
        with self._op_lock:
            return (
                self._active_op.to_summary() if self._active_op else None,
                self._latest_op.to_summary() if self._latest_op else None,
            )

    def get_operation_state(
        self,
    ) -> Tuple[Optional[GitHubOperationSummary], Optional[GitHubOperationSummary]]:
        return self._operation_snapshots()

    def cancel_operation(self) -> GitHubOperationSummary:
        with self._op_lock:
            op = self._active_op
            if op is None:
                raise GitHubServiceError("No GitHub operation is currently running.", status_code=404)
            if not op.cancellable:
                raise GitHubServiceError(
                    f"Operation '{op.kind}' cannot be safely cancelled mid-request once submitted.",
                    status_code=409,
                )
            op.cancel_event.set()
            op.cancelled = True
            proc = op.proc
        if proc is not None and proc.poll() is None:
            terminate_process_tree(proc)
        with self._op_lock:
            return op.to_summary()

    def _register_operation(
        self,
        kind: GitHubOpKind,
        *,
        cancellable: bool,
        project_dir: Optional[str] = None,
        remote: Optional[str] = None,
        branch: Optional[str] = None,
    ) -> _LiveOperation:
        with self._op_lock:
            if self._active_op is not None:
                raise GitHubServiceError(
                    f"A GitHub/sync operation ('{self._active_op.kind}') is already running. Cancel or wait for it to finish.",
                    status_code=409,
                )
            op = _LiveOperation(
                op_id=f"ghop-{uuid.uuid4().hex[:10]}",
                kind=kind,
                cancellable=cancellable,
                project_dir=project_dir,
                remote=remote,
                branch=branch,
            )
            self._active_op = op
            self._latest_op = op
            return op

    def _finish_operation(
        self,
        op: _LiveOperation,
        *,
        status: str,
        exit_code: Optional[int],
        error_message: Optional[str] = None,
    ) -> None:
        with self._op_lock:
            op.status = status
            op.exit_code = exit_code
            op.error_message = redact_secrets(error_message) if error_message else None
            op.finished_at = utc_now_iso()
            op.proc = None
            if self._active_op is op:
                self._active_op = None
            self._latest_op = op

    def _run_streaming_command(
        self,
        op: _LiveOperation,
        cmd: List[str],
        cwd: Optional[Path],
        *,
        timeout_seconds: float,
        disable_prompts: bool = True,
        classify_error: Optional[Callable[[int, str], str]] = None,
        stdin_text: Optional[str] = None,
    ) -> Tuple[int, str]:
        collected: List[str] = []
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(cwd) if cwd else None,
                stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=self._subprocess_env(disable_prompts=disable_prompts),
                **self._popen_kwargs(),
            )
        except OSError as exc:
            err = redact_secrets(f"Failed to start command: {exc}")
            op.append_line(err)
            self._finish_operation(op, status="failed", exit_code=1, error_message=err)
            return 1, err

        with self._op_lock:
            op.proc = proc

        if stdin_text is not None and proc.stdin is not None:
            try:
                proc.stdin.write(stdin_text)
                proc.stdin.flush()
                proc.stdin.close()
            except OSError:
                pass

        def _reader() -> None:
            if proc.stdout is None:
                return
            try:
                for line in proc.stdout:
                    clean = redact_secrets(line.rstrip("\r\n"))
                    if len(collected) < 2000:
                        collected.append(clean)
                    op.append_line(clean)
            finally:
                try:
                    proc.stdout.close()
                except OSError:
                    pass

        reader_thread = threading.Thread(target=_reader, daemon=True)
        reader_thread.start()

        deadline = time.monotonic() + timeout_seconds
        timed_out = False
        while proc.poll() is None:
            if op.cancel_event.is_set():
                terminate_process_tree(proc)
                break
            if time.monotonic() > deadline:
                timed_out = True
                terminate_process_tree(proc)
                break
            time.sleep(0.05)

        reader_thread.join(timeout=2.0)
        rc = proc.returncode if proc.returncode is not None else 1
        combined = "\n".join(collected)

        if op.cancel_event.is_set() or op.cancelled:
            op.cancelled = True
            self._finish_operation(
                op,
                status="cancelled",
                exit_code=rc,
                error_message="Operation cancelled by user.",
            )
            return rc, combined

        if timed_out:
            msg = f"Operation timed out after {int(timeout_seconds)} seconds."
            op.append_line(msg)
            self._finish_operation(op, status="timed_out", exit_code=rc, error_message=msg)
            return rc, combined

        if rc == 0:
            self._finish_operation(op, status="succeeded", exit_code=0)
            return 0, combined

        err_msg = (
            classify_error(rc, combined)
            if classify_error is not None
            else (collected[-1] if collected else f"Command exited with code {rc}.")
        )
        self._finish_operation(op, status="failed", exit_code=rc, error_message=err_msg)
        return rc, combined

    # ── Guided Auth Login ────────────────────────────────────────────────────────

    def start_auth_login(self, req: GitHubAuthStartRequest) -> GitHubOperationSummary:
        available, gh_exe, _, reason = self.detect_gh()
        if not available or not gh_exe:
            raise GitHubServiceError(
                reason or "GitHub CLI (`gh`) is not installed.",
                status_code=503,
            )

        op = self._register_operation("auth_login", cancellable=True)
        op.append_line(f"Starting GitHub CLI authentication ({req.git_protocol} protocol)...")
        cmd = [
            gh_exe,
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            req.git_protocol,
            "--web",
        ]

        def _worker() -> None:
            self._run_streaming_command(
                op,
                cmd,
                None,
                timeout_seconds=_AUTH_TIMEOUT_SECONDS,
                disable_prompts=False,
                stdin_text="\n",
            )

        threading.Thread(target=_worker, daemon=True).start()
        return op.to_summary()

    # ── Repo Create & Guided Publish ─────────────────────────────────────────────

    def _create_remote_repo_blocking(
        self,
        gh_exe: str,
        cli: GitHubCliInfo,
        git_exe: str,
        repo_root: Path,
        *,
        repo_name: str,
        description: str,
        visibility: str,
        remote_name: str,
        configure_remote: bool,
        add_readme: bool = False,
    ) -> Tuple[str, str, Optional[GitRemoteInfo]]:
        """Invoke `gh repo create` without auto-committing or overwriting local files."""
        readme_path = repo_root / "README.md"
        if add_readme and readme_path.exists():
            raise GitHubServiceError(
                "README.md already exists locally; refusing to overwrite or create a conflicting README on GitHub.",
                status_code=409,
            )

        if configure_remote:
            existing_remotes = self._parse_remotes(git_exe, repo_root)
            if any(r.name == remote_name for r in existing_remotes):
                raise GitHubServiceError(
                    f"Remote '{remote_name}' already exists locally. Update/remove it or publish using the existing remote.",
                    status_code=409,
                )

        cmd = [gh_exe, "repo", "create", repo_name, f"--{visibility}"]
        if description:
            cmd.extend(["--description", description])
        if add_readme:
            cmd.append("--add-readme")

        try:
            proc = subprocess.run(
                cmd,
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                env=self._subprocess_env(),
                **self._popen_kwargs(),
            )
        except subprocess.TimeoutExpired as exc:
            raise GitHubServiceError("Timed out waiting for GitHub repository creation.", status_code=504) from exc
        except OSError as exc:
            raise GitHubServiceError(f"Failed to execute gh repo create: {exc}", status_code=500) from exc

        combined = redact_secrets(
            "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()
        )
        if proc.returncode != 0:
            lowered = combined.lower()
            if "already exists" in lowered or "name already exists" in lowered:
                raise GitHubServiceError(
                    f"GitHub repository '{repo_name}' already exists on your account.",
                    status_code=409,
                )
            raise GitHubServiceError(
                combined or f"GitHub repository creation failed with code {proc.returncode}.",
                status_code=400,
            )

        url_match = _REPO_URL_RE.search(combined)
        owner_prefix = f"{cli.username}/" if cli.username else ""
        https_url = url_match.group(1) if url_match else (
            f"https://github.com/{owner_prefix}{repo_name}" if owner_prefix else ""
        )
        if not https_url:
            raise GitHubServiceError(
                "Repository was created on GitHub, but its URL could not be determined from gh output.",
                status_code=502,
            )
        git_url = https_url if https_url.endswith(".git") else f"{https_url}.git"
        is_gh, owner_repo = parse_github_remote(git_url)
        remote_url = (
            f"git@github.com:{owner_repo}.git"
            if (cli.git_protocol == "ssh" and owner_repo)
            else git_url
        )

        added_remote: Optional[GitRemoteInfo] = None
        if configure_remote:
            rc, _, stderr = self._git_service._run_git_text(
                git_exe, repo_root, ["remote", "add", "--", remote_name, remote_url], timeout=10
            )
            if rc != 0:
                raise GitHubServiceError(
                    redact_secrets(stderr.strip() or f"Created GitHub repo, but failed to configure remote '{remote_name}'."),
                    status_code=500,
                )
            for item in self._parse_remotes(git_exe, repo_root):
                if item.name == remote_name:
                    added_remote = item
                    break

        return https_url, remote_url, added_remote

    def create_repository(
        self, req: GitHubCreateRepoRequest
    ) -> Dict[str, Any]:
        if not req.confirm:
            raise GitHubServiceError(
                "Creating a GitHub repository requires explicit confirmation.", status_code=400
            )
        gh_exe, cli = self._require_gh_authenticated()
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        op = self._register_operation(
            "create_repo",
            cancellable=False,
            project_dir=str(repo_root),
            remote=req.remote_name if req.configure_remote else None,
        )
        op.append_line(f"Creating GitHub repository '{req.name}' ({req.visibility})...")

        try:
            with self._git_service._get_repo_lock(repo_root):
                https_url, remote_url, added_remote = self._create_remote_repo_blocking(
                    gh_exe,
                    cli,
                    git_exe,
                    repo_root,
                    repo_name=req.name,
                    description=req.description,
                    visibility=req.visibility,
                    remote_name=req.remote_name,
                    configure_remote=req.configure_remote,
                    add_readme=req.add_readme,
                )
        except GitHubServiceError as exc:
            op.append_line(exc.message)
            self._finish_operation(op, status="failed", exit_code=1, error_message=exc.message)
            raise

        op.append_line(f"Repository ready: {https_url}")
        if added_remote:
            op.append_line(f"Configured remote '{added_remote.name}' -> {remote_url}")
        self._finish_operation(op, status="succeeded", exit_code=0)
        return {
            "url": https_url,
            "remote_url": remote_url,
            "remote": added_remote.model_dump() if added_remote else None,
            "operation": op.to_summary().model_dump(),
        }

    def preview_publish(self, raw_project_dir: Optional[str] = None) -> GitHubPublishPreviewResponse:
        try:
            project_dir = self._git_service._resolve_project_dir(raw_project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        cli = self.check_auth_status()
        status = self._git_service.get_status(str(project_dir))
        remotes: List[GitRemoteInfo] = []
        if status.is_repository:
            git_exe, repo_root = self._git_service._require_git_and_repo(str(project_dir))
            remotes = self._parse_remotes(git_exe, repo_root)

        sanitized_repo = re.sub(r"[^A-Za-z0-9._-]+", "-", project_dir.name).strip("-.") or "vega-firmware"
        staged_count = status.staged_count
        unstaged_count = status.unstaged_count + len(status.conflicted_files)
        untracked_count = status.untracked_count

        blockers: List[str] = []
        warnings: List[str] = []

        if not status.is_repository:
            blockers.append("Initialize a local Git repository before publishing to GitHub.")
        elif status.is_detached:
            blockers.append("HEAD is detached. Check out a local branch before publishing.")
        elif status.is_unborn:
            blockers.append(
                "Repository has no commits yet. Stage and commit your project files explicitly before publishing."
            )

        if not cli.gh_available:
            blockers.append("GitHub CLI (`gh`) is not installed on this machine.")
        elif not cli.authenticated:
            blockers.append("Sign in to GitHub (`gh auth login`) before publishing.")

        if staged_count > 0 or unstaged_count > 0 or untracked_count > 0:
            warnings.append(
                f"Working tree has uncommitted changes ({staged_count} staged, {unstaged_count} unstaged, {untracked_count} untracked). "
                "VEGA Studio will NOT auto-stage or auto-commit them; only committed history will be pushed."
            )
        if any(r.name == "origin" for r in remotes):
            warnings.append(
                "Remote 'origin' already exists. Choose a different remote name or opt in to reuse 'origin'."
            )

        return GitHubPublishPreviewResponse(
            project_dir=str(project_dir),
            project_name=project_dir.name,
            suggested_repo_name=sanitized_repo,
            gh_available=cli.gh_available,
            authenticated=cli.authenticated,
            username=cli.username,
            is_git_repository=status.is_repository,
            is_unborn=status.is_unborn,
            is_detached=status.is_detached,
            current_branch=status.current_branch,
            head_commit=status.head_commit,
            committed_ready=bool(
                status.is_repository and not status.is_unborn and not status.is_detached
            ),
            uncommitted_staged_count=staged_count,
            uncommitted_unstaged_count=unstaged_count,
            untracked_count=untracked_count,
            existing_remotes=remotes,
            blockers=blockers,
            warnings=warnings,
        )

    def publish_project(self, req: GitHubPublishRequest) -> GitHubOperationSummary:
        if not req.confirm:
            raise GitHubServiceError(
                "Publishing to GitHub requires explicit user confirmation.", status_code=400
            )
        gh_exe, cli = self._require_gh_authenticated()
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        status = self._git_service.get_status(str(repo_root))
        if status.is_detached or not status.current_branch:
            raise GitHubServiceError(
                "HEAD is detached. Check out a named branch before publishing.", status_code=409
            )
        if status.is_unborn:
            raise GitHubServiceError(
                "Cannot publish an unborn repository with zero commits. Create an explicit commit first.",
                status_code=409,
            )

        remotes = self._parse_remotes(git_exe, repo_root)
        remote_exists = any(r.name == req.remote_name for r in remotes)
        if remote_exists and not req.reuse_existing_remote:
            raise GitHubServiceError(
                f"Remote '{req.remote_name}' already exists. Opt in to push to the existing remote or pick a new remote name.",
                status_code=409,
            )

        op = self._register_operation(
            "publish",
            cancellable=not remote_exists,
            project_dir=str(repo_root),
            remote=req.remote_name,
            branch=status.current_branch,
        )

        try:
            if not remote_exists:
                with self._op_lock:
                    op.cancellable = False
                op.append_line(f"Creating GitHub repository '{req.name}' ({req.visibility})...")
                with self._git_service._get_repo_lock(repo_root):
                    https_url, remote_url, _ = self._create_remote_repo_blocking(
                        gh_exe,
                        cli,
                        git_exe,
                        repo_root,
                        repo_name=req.name,
                        description=req.description,
                        visibility=req.visibility,
                        remote_name=req.remote_name,
                        configure_remote=True,
                        add_readme=False,
                    )
                op.append_line(f"Connected remote '{req.remote_name}' -> {remote_url} ({https_url})")
            else:
                op.append_line(f"Reusing configured remote '{req.remote_name}'.")
        except GitHubServiceError as exc:
            op.append_line(exc.message)
            self._finish_operation(op, status="failed", exit_code=1, error_message=exc.message)
            raise

        with self._op_lock:
            op.cancellable = True
        op.append_line(f"Pushing branch '{status.current_branch}' to '{req.remote_name}' with upstream tracking...")
        push_cmd = [git_exe, "push", "-u", "--", req.remote_name, status.current_branch]

        def _worker() -> None:
            with self._git_service._get_repo_lock(repo_root):
                self._run_streaming_command(
                    op,
                    push_cmd,
                    repo_root,
                    timeout_seconds=_SYNC_TIMEOUT_SECONDS,
                    classify_error=self._classify_push_error,
                )

        threading.Thread(target=_worker, daemon=True).start()
        return op.to_summary()

    # ── Sync Prechecks & Operations (Fetch / Pull / Push) ────────────────────────

    def _resolve_target_remote(
        self,
        remotes: List[GitRemoteInfo],
        explicit_remote: Optional[str],
        upstream: Optional[str],
    ) -> Optional[str]:
        names = {r.name for r in remotes}
        if explicit_remote:
            if explicit_remote not in names:
                raise GitHubServiceError(
                    f"Remote '{explicit_remote}' is not configured in this repository.",
                    status_code=404,
                )
            return explicit_remote
        if upstream and "/" in upstream:
            candidate = upstream.split("/", 1)[0]
            if candidate in names:
                return candidate
        if "origin" in names:
            return "origin"
        return remotes[0].name if remotes else None

    def precheck_pull(
        self, raw_project_dir: Optional[str] = None, remote: Optional[str] = None
    ) -> GitHubSyncPrecheckResponse:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(raw_project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        status = self._git_service.get_status(str(repo_root))
        remotes = self._parse_remotes(git_exe, repo_root)
        target_remote = self._resolve_target_remote(remotes, remote, status.upstream)

        dirty_paths = [
            f.path
            for f in (*status.conflicted_files, *status.staged_files, *status.unstaged_files)
        ][:20]
        staged_count = status.staged_count
        unstaged_count = status.unstaged_count
        untracked_count = status.untracked_count
        conflicted_count = len(status.conflicted_files)

        blockers: List[str] = []
        warnings: List[str] = []

        if not target_remote:
            blockers.append("No Git remote is configured for this repository.")
        if status.is_detached:
            blockers.append("HEAD is detached. Check out a branch before pulling.")
        if conflicted_count > 0:
            blockers.append(
                f"Repository has {conflicted_count} conflicted file(s). Resolve conflicts before pulling."
            )
        if staged_count > 0 or unstaged_count > 0:
            blockers.append(
                "Local tracked files have uncommitted changes. Commit, stash, or explicitly discard them before pulling so local edits are not lost or blocked."
            )

        if untracked_count > 0:
            warnings.append(
                f"{untracked_count} untracked file(s) exist; pulling may fail if remote files share the same paths."
            )
        if status.is_unborn:
            warnings.append("Current branch has no local commits yet.")

        return GitHubSyncPrecheckResponse(
            operation="pull",
            project_dir=str(repo_root),
            current_branch=status.current_branch,
            target_remote=target_remote,
            upstream=status.upstream,
            needs_upstream_setup=False,
            is_unborn=status.is_unborn,
            is_detached=status.is_detached,
            ahead=status.ahead,
            behind=status.behind,
            staged_count=staged_count,
            unstaged_count=unstaged_count,
            untracked_count=untracked_count,
            conflicted_count=conflicted_count,
            dirty_paths=dirty_paths,
            ready=len(blockers) == 0,
            blockers=blockers,
            warnings=warnings,
        )

    def precheck_push(
        self, raw_project_dir: Optional[str] = None, remote: Optional[str] = None
    ) -> GitHubSyncPrecheckResponse:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(raw_project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        status = self._git_service.get_status(str(repo_root))
        remotes = self._parse_remotes(git_exe, repo_root)
        target_remote = self._resolve_target_remote(remotes, remote, status.upstream)

        staged_count = status.staged_count
        unstaged_count = status.unstaged_count
        untracked_count = status.untracked_count
        conflicted_count = len(status.conflicted_files)

        blockers: List[str] = []
        warnings: List[str] = []

        if not target_remote:
            blockers.append("No Git remote is configured. Add a remote or publish to GitHub first.")
        if status.is_detached:
            blockers.append("HEAD is detached. Check out a branch before pushing.")
        if status.is_unborn:
            blockers.append("Current branch has no commits yet. Commit changes before pushing.")
        if conflicted_count > 0:
            blockers.append("Repository has unresolved merge conflicts. Resolve them before pushing.")

        if staged_count > 0 or unstaged_count > 0 or untracked_count > 0:
            warnings.append(
                f"Working tree has uncommitted changes ({staged_count} staged, {unstaged_count} unstaged, {untracked_count} untracked); only committed commits will be pushed."
            )
        if status.behind > 0:
            warnings.append(
                f"Local branch is {status.behind} commit(s) behind upstream; push may be rejected until you pull."
            )

        return GitHubSyncPrecheckResponse(
            operation="push",
            project_dir=str(repo_root),
            current_branch=status.current_branch,
            target_remote=target_remote,
            upstream=status.upstream,
            needs_upstream_setup=not bool(status.upstream),
            is_unborn=status.is_unborn,
            is_detached=status.is_detached,
            ahead=status.ahead,
            behind=status.behind,
            staged_count=staged_count,
            unstaged_count=unstaged_count,
            untracked_count=untracked_count,
            conflicted_count=conflicted_count,
            dirty_paths=[],
            ready=len(blockers) == 0,
            blockers=blockers,
            warnings=warnings,
        )

    @staticmethod
    def _classify_fetch_error(_rc: int, output: str) -> str:
        low = output.lower()
        if "authentication failed" in low or "permission denied" in low or "could not read username" in low:
            return "Fetch failed due to remote authentication/permission error. Verify GitHub CLI sign-in or SSH access."
        if "could not resolve host" in low or "unable to access" in low:
            return "Unable to reach remote repository. Check network connectivity and remote URL."
        return output.splitlines()[-1] if output.splitlines() else "Git fetch failed."

    @staticmethod
    def _classify_pull_error(_rc: int, output: str) -> str:
        low = output.lower()
        if "conflict" in low or "automatic merge failed" in low:
            return "Pull stopped due to merge conflicts. Your working tree has conflict markers for safe resolution."
        if "would be overwritten" in low or "uncommitted changes" in low:
            return "Pull aborted because local files would be overwritten."
        if "couldn't find remote ref" in low:
            return "Remote branch does not exist on the target remote yet."
        if "authentication failed" in low or "permission denied" in low or "could not read username" in low:
            return "Pull failed due to authentication or permission error."
        return output.splitlines()[-1] if output.splitlines() else "Git pull failed."

    @staticmethod
    def _classify_push_error(_rc: int, output: str) -> str:
        low = output.lower()
        if "non-fast-forward" in low or "fetch first" in low or "[rejected]" in low:
            return "Push rejected because the remote has newer commits. Fetch and pull remote changes first."
        if "authentication failed" in low or "permission denied" in low or "could not read username" in low:
            return "Push rejected due to authentication or repository write permission error."
        return output.splitlines()[-1] if output.splitlines() else "Git push failed."

    def start_fetch(self, req: GitHubFetchRequest) -> GitHubOperationSummary:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        remotes = self._parse_remotes(git_exe, repo_root)
        target_remote = self._resolve_target_remote(remotes, req.remote, None)
        if not target_remote:
            raise GitHubServiceError("Remote not found.", status_code=404)

        op = self._register_operation(
            "fetch",
            cancellable=True,
            project_dir=str(repo_root),
            remote=target_remote,
        )
        op.append_line(f"Fetching updates from remote '{target_remote}'...")
        cmd = [git_exe, "fetch", "--prune", "--", target_remote]

        def _worker() -> None:
            self._run_streaming_command(
                op,
                cmd,
                repo_root,
                timeout_seconds=_SYNC_TIMEOUT_SECONDS,
                classify_error=self._classify_fetch_error,
            )

        threading.Thread(target=_worker, daemon=True).start()
        return op.to_summary()

    def start_pull(self, req: GitHubPullRequest) -> GitHubOperationSummary:
        if not req.confirm:
            raise GitHubServiceError("Pull requires explicit user confirmation.", status_code=400)

        precheck = self.precheck_pull(req.project_dir, req.remote)
        if not precheck.ready or not precheck.target_remote or not precheck.current_branch:
            raise GitHubServiceError(
                precheck.blockers[0] if precheck.blockers else "Repository is not ready to pull.",
                status_code=409,
            )

        git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        op = self._register_operation(
            "pull",
            cancellable=True,
            project_dir=str(repo_root),
            remote=precheck.target_remote,
            branch=precheck.current_branch,
        )
        op.append_line(
            f"Pulling '{precheck.current_branch}' from remote '{precheck.target_remote}' (non-destructive merge)..."
        )
        cmd = [
            git_exe,
            "pull",
            "--no-rebase",
            "--",
            precheck.target_remote,
            precheck.current_branch,
        ]

        def _worker() -> None:
            self._run_streaming_command(
                op,
                cmd,
                repo_root,
                timeout_seconds=_SYNC_TIMEOUT_SECONDS,
                classify_error=self._classify_pull_error,
            )

        threading.Thread(target=_worker, daemon=True).start()
        return op.to_summary()

    def start_push(self, req: GitHubPushRequest) -> GitHubOperationSummary:
        if not req.confirm:
            raise GitHubServiceError("Push requires explicit user confirmation.", status_code=400)

        precheck = self.precheck_push(req.project_dir, req.remote)
        if not precheck.ready or not precheck.target_remote or not precheck.current_branch:
            raise GitHubServiceError(
                precheck.blockers[0] if precheck.blockers else "Repository is not ready to push.",
                status_code=409,
            )

        git_exe, repo_root = self._git_service._require_git_and_repo(req.project_dir)
        use_upstream = bool(req.set_upstream and precheck.needs_upstream_setup)
        op = self._register_operation(
            "push",
            cancellable=True,
            project_dir=str(repo_root),
            remote=precheck.target_remote,
            branch=precheck.current_branch,
        )
        op.append_line(
            f"Pushing branch '{precheck.current_branch}' to '{precheck.target_remote}'"
            + (" (setting upstream tracking)..." if use_upstream else "...")
        )
        cmd = [git_exe, "push"]
        if use_upstream:
            cmd.append("-u")
        cmd.extend(["--", precheck.target_remote, precheck.current_branch])

        def _worker() -> None:
            self._run_streaming_command(
                op,
                cmd,
                repo_root,
                timeout_seconds=_SYNC_TIMEOUT_SECONDS,
                classify_error=self._classify_push_error,
            )

        threading.Thread(target=_worker, daemon=True).start()
        return op.to_summary()

    # ── Explicit Remote Repository Info ──────────────────────────────────────────

    def get_remote_repo_info(
        self, raw_project_dir: Optional[str] = None, remote: Optional[str] = None
    ) -> GitHubRemoteRepoDetail:
        try:
            git_exe, repo_root = self._git_service._require_git_and_repo(raw_project_dir)
        except GitServiceError as exc:
            raise GitHubServiceError(exc.message, status_code=exc.status_code) from exc

        status = self._git_service.get_status(str(repo_root))
        remotes = self._parse_remotes(git_exe, repo_root)
        target_name = self._resolve_target_remote(remotes, remote, status.upstream)
        if not target_name:
            raise GitHubServiceError("No Git remote is configured.", status_code=404)

        remote_info = next(r for r in remotes if r.name == target_name)

        # Explicitly inspect remote heads using read-only ls-remote
        remote_branches: List[str] = []
        rc, ls_stdout, ls_stderr = self._git_service._run_git_text(
            git_exe, repo_root, ["ls-remote", "--heads", "--", target_name], timeout=15
        )
        if rc != 0:
            raise GitHubServiceError(
                redact_secrets(ls_stderr.strip() or f"Failed to query remote '{target_name}'."),
                status_code=502,
            )
        for line in ls_stdout.splitlines():
            parts = line.split("\t")
            if len(parts) == 2 and parts[1].startswith("refs/heads/"):
                remote_branches.append(parts[1][len("refs/heads/") :])

        owner_repo = remote_info.github_owner_repo or remote_info.name
        detail = GitHubRemoteRepoDetail(
            owner_repo=owner_repo,
            url=remote_info.fetch_url,
            ssh_url=None,
            visibility=None,
            description=None,
            default_branch=None,
            remote_branches=remote_branches,
            current_branch=status.current_branch,
            upstream=status.upstream,
            ahead=status.ahead,
            behind=status.behind,
        )

        # If remote targets GitHub and gh is authenticated, enrich with metadata
        if (
            remote_info.is_github
            and remote_info.github_owner_repo
            and not remote_info.github_owner_repo.startswith("-")
        ):
            available, gh_exe, _, _ = self.detect_gh()
            if available and gh_exe:
                try:
                    proc = subprocess.run(
                        [
                            gh_exe,
                            "repo",
                            "view",
                            "--json",
                            "nameWithOwner,url,sshUrl,visibility,description,defaultBranchRef",
                            "--",
                            remote_info.github_owner_repo,
                        ],
                        cwd=str(repo_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=_QUICK_TIMEOUT_SECONDS,
                        env=self._subprocess_env(),
                        **self._popen_kwargs(),
                    )
                    if proc.returncode == 0 and proc.stdout.strip():
                        import json

                        payload = json.loads(proc.stdout)
                        detail.owner_repo = payload.get("nameWithOwner") or detail.owner_repo
                        detail.url = redact_secrets(payload.get("url") or detail.url)
                        detail.ssh_url = payload.get("sshUrl")
                        vis = payload.get("visibility")
                        detail.visibility = str(vis).lower() if vis else None
                        detail.description = payload.get("description")
                        default_ref = payload.get("defaultBranchRef") or {}
                        if isinstance(default_ref, dict):
                            detail.default_branch = default_ref.get("name")
                except (OSError, subprocess.SubprocessError, ValueError):
                    pass

        return detail


_github_service_singleton: Optional[GitHubService] = None


def get_github_service() -> GitHubService:
    global _github_service_singleton
    if _github_service_singleton is None:
        _github_service_singleton = GitHubService(settings)
    return _github_service_singleton
