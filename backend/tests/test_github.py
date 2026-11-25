"""Tests for Phase 13 Native GitHub Integration.

All tests run strictly inside isolated `tmp_path` directories with temporary bare
Git repositories and controlled mock `gh` executables—never touching real GitHub
or the VEGA Studio repository itself.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Optional
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.config import Settings
from app.main import app
from app.models.git import GitCommitRequest
from app.models.github import (
    GitHubAuthStartRequest,
    GitHubCreateRepoRequest,
    GitHubFetchRequest,
    GitHubPublishRequest,
    GitHubPullRequest,
    GitHubPushRequest,
    GitHubRemoteAddRequest,
    GitHubRemoteRemoveRequest,
    GitHubRemoteUpdateRequest,
    validate_remote_url,
)
from app.routers.github import get_github_service
from app.services.git_service import GitService
from app.services.github_service import (
    GitHubService,
    GitHubServiceError,
    parse_github_remote,
    redact_secrets,
)
from app.services.project_service import ProjectService


def _git_raw(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        shell=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _create_isolated_project(
    tmp_path: Path, name: str = "aries_github_proj"
) -> tuple[Settings, Path]:
    app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
    proj_svc = ProjectService(app_settings)
    summary = proj_svc.create_project(
        type(
            "Req",
            (),
            {
                "name": name,
                "parent_dir": str(tmp_path / "projects"),
                "description": "Phase 13 isolated GitHub test project",
                "template": "minimal",
            },
        )()
    )
    return app_settings, Path(summary.project_dir)


def _init_committed_repo(
    tmp_path: Path, name: str = "aries_github_proj"
) -> tuple[Settings, Path, GitService, GitHubService]:
    app_settings, proj_dir = _create_isolated_project(tmp_path, name)
    git_svc = GitService(app_settings)
    git_svc.init_repository(str(proj_dir))
    assert _git_raw(proj_dir, "config", "user.name", "VEGA Tester").returncode == 0
    assert _git_raw(proj_dir, "config", "user.email", "tester@vega.local").returncode == 0
    assert _git_raw(proj_dir, "branch", "-M", "main").returncode == 0
    git_svc.stage_all(str(proj_dir))
    git_svc.commit(GitCommitRequest(project_dir=str(proj_dir), message="Initial commit"))
    gh_svc = GitHubService(app_settings)
    return app_settings, proj_dir, git_svc, gh_svc


def _write_mock_gh(bin_dir: Path, script_body: str) -> Path:
    """Create a cross-platform mock `gh` CLI wrapper in bin_dir using current Python."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    py_script = bin_dir / "mock_gh.py"
    py_script.write_text(script_body, encoding="utf-8")
    if os.name == "nt":
        wrapper = bin_dir / "gh.cmd"
        wrapper.write_text(f'@echo off\r\n"{sys.executable}" "{py_script}" %*\r\n', encoding="utf-8")
        return wrapper
    wrapper = bin_dir / "gh"
    wrapper.write_text(f'#!/usr/bin/env sh\nexec "{sys.executable}" "{py_script}" "$@"\n', encoding="utf-8")
    wrapper.chmod(0o755)
    return wrapper


def _wait_for_op(svc: GitHubService, timeout: float = 10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        active, latest = svc.get_operation_state()
        if active is None and latest is not None and latest.status != "running":
            return latest
        time.sleep(0.03)
    pytest.fail("Timed out waiting for GitHub background operation to complete")


def _setup_bare_remote(tmp_path: Path, repo_name: str = "remote.git") -> tuple[Path, str]:
    bare_dir = tmp_path / repo_name
    res = subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(bare_dir)],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    return bare_dir, bare_dir.as_uri()


# ---------------------------------------------------------------------------
# 1. Secret Redaction & URL Validation
# ---------------------------------------------------------------------------


class TestSecurityAndValidation:
    def test_redact_secrets_scrubs_tokens_headers_and_embedded_url_passwords(self):
        sample = (
            "Authorization: Bearer ghp_1234567890abcdefABCDEF "
            "url=https://vegauser:supersecretpass@github.com/vega/fw.git "
            "pat=github_pat_11ABCDEF1234567890_xyz "
            "x-access-token:gho_abc123456789@github.com/org/repo.git"
        )
        redacted = redact_secrets(sample)
        assert "ghp_1234567890abcdefABCDEF" not in redacted
        assert "supersecretpass" not in redacted
        assert "github_pat_11ABCDEF1234567890_xyz" not in redacted
        assert "gho_abc123456789" not in redacted
        assert "[REDACTED" in redacted

    def test_validate_remote_url_allows_clean_https_and_ssh_and_rejects_unsafe(self):
        assert validate_remote_url("https://github.com/cdac-vega/aries-fw.git") == (
            "https://github.com/cdac-vega/aries-fw.git"
        )
        assert validate_remote_url("git@github.com:cdac-vega/aries-fw.git") == (
            "git@github.com:cdac-vega/aries-fw.git"
        )
        assert parse_github_remote("git@github.com:cdac-vega/aries-fw.git") == (
            True,
            "cdac-vega/aries-fw",
        )
        assert parse_github_remote("https://gitlab.com/org/repo.git") == (False, None)

        for bad_url in (
            "https://user:ghp_secret1234@github.com/org/repo.git",
            "https://user@github.com/org/repo.git",
            "ext::sh -c whoami",
            "file:///C:/repos/bare.git",
            "-oProxyCommand=calc",
            "ftp://github.com/org/repo.git",
        ):
            with pytest.raises(ValueError):
                validate_remote_url(bad_url)

    def test_model_validators_reject_invalid_repo_and_remote_names(self):
        with pytest.raises(ValidationError):
            GitHubRemoteAddRequest(name="../bad", url="https://github.com/a/b.git")
        with pytest.raises(ValidationError):
            GitHubCreateRepoRequest(name=".hidden", confirm=True)
        with pytest.raises(ValidationError):
            GitHubCreateRepoRequest(name="-badflag", confirm=True)


# ---------------------------------------------------------------------------
# 2. GitHub CLI Discovery, Auth Status, Missing CLI & Guided Login
# ---------------------------------------------------------------------------


class TestCliDetectionAndAuth:
    def test_missing_gh_cli_reports_clean_guidance_and_returns_503_on_actions(self, tmp_path: Path):
        _, proj_dir, _, gh_svc = _init_committed_repo(tmp_path)
        with (
            patch("app.services.github_service.shutil.which", return_value=None),
            patch("app.services.github_service.os.path.isfile", return_value=False),
        ):
            cli = gh_svc.check_auth_status()
            assert cli.gh_available is False
            assert cli.authenticated is False
            assert cli.install_guide_url == "https://cli.github.com/"
            assert cli.unavailable_reason and "gh" in cli.unavailable_reason.lower()

            with pytest.raises(GitHubServiceError) as exc:
                gh_svc.create_repository(
                    GitHubCreateRepoRequest(project_dir=str(proj_dir), name="demo-fw", confirm=True)
                )
            assert exc.value.status_code == 503

    def test_mock_gh_parses_version_and_unauthenticated_then_authenticated(self, tmp_path: Path):
        bin_dir = tmp_path / "mock_bin"
        flag_file = tmp_path / "logged_in.flag"
        _write_mock_gh(
            bin_dir,
            f"""
import sys, pathlib
args = sys.argv[1:]
if args[0] == "--version":
    print("gh version 2.62.0 (2025-11-01)")
    sys.exit(0)
if args[:2] == ["auth", "status"]:
    if pathlib.Path(r"{flag_file}").exists():
        print("github.com")
        print("  ✓ Logged in to github.com account vega-pilot (keyring)")
        print("  - Git operations protocol: https")
        print("  - Token: ghp_MUSTNEVERAPPEAR9999999")
        sys.exit(0)
    print("You are not logged into any GitHub hosts. To log in, run: gh auth login", file=sys.stderr)
    sys.exit(1)
sys.exit(1)
""",
        )
        gh_svc = GitHubService(Settings(DATA_DIR=str(tmp_path / "data")))
        with patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"}):
            unauth = gh_svc.check_auth_status()
            assert unauth.gh_available is True
            assert unauth.gh_version == "2.62.0"
            assert unauth.authenticated is False

            flag_file.write_text("ok", encoding="utf-8")
            authed = gh_svc.check_auth_status()
            assert authed.gh_available is True
            assert authed.authenticated is True
            assert authed.username == "vega-pilot"
            assert authed.git_protocol == "https"
            assert "ghp_MUSTNEVERAPPEAR" not in (authed.auth_message or "")

    def test_auth_login_streams_device_code_and_supports_cancellation(self, tmp_path: Path):
        bin_dir = tmp_path / "mock_bin"
        _write_mock_gh(
            bin_dir,
            """
import sys, time
args = sys.argv[1:]
if args[0] == "--version":
    print("gh version 2.62.0")
    sys.exit(0)
if args[:2] == ["auth", "status"]:
    sys.exit(1)
if args[:2] == ["auth", "login"]:
    print("! First copy your one-time code: AB12-CD34", flush=True)
    print("- Open this URL in your browser: https://github.com/login/device", flush=True)
    time.sleep(15)
    sys.exit(0)
""",
        )
        gh_svc = GitHubService(Settings(DATA_DIR=str(tmp_path / "data")))
        with patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"}):
            op = gh_svc.start_auth_login(GitHubAuthStartRequest(git_protocol="https"))
            assert op.kind == "auth_login"

            deadline = time.monotonic() + 5.0
            seen_code: Optional[str] = None
            while time.monotonic() < deadline:
                active, _ = gh_svc.get_operation_state()
                if active and active.device_code:
                    seen_code = active.device_code
                    break
                time.sleep(0.04)

            assert seen_code == "AB12-CD34"
            active, _ = gh_svc.get_operation_state()
            assert active is not None
            assert active.verification_url == "https://github.com/login/device"

            cancelled = gh_svc.cancel_operation()
            assert cancelled.cancelled is True
            done = _wait_for_op(gh_svc)
            assert done.status == "cancelled"


# ---------------------------------------------------------------------------
# 3. Remote Management & Workspace Confinement
# ---------------------------------------------------------------------------


class TestRemoteManagement:
    def test_add_update_remove_remotes_with_explicit_confirmation_guards(self, tmp_path: Path):
        _, proj_dir, _, gh_svc = _init_committed_repo(tmp_path)

        assert gh_svc.list_remotes(str(proj_dir)) == []

        remotes = gh_svc.add_remote(
            GitHubRemoteAddRequest(
                project_dir=str(proj_dir),
                name="origin",
                url="https://github.com/cdac-vega/aries-blink.git",
            )
        )
        assert len(remotes) == 1
        assert remotes[0].is_github is True
        assert remotes[0].github_owner_repo == "cdac-vega/aries-blink"

        with pytest.raises(GitHubServiceError) as dup_exc:
            gh_svc.add_remote(
                GitHubRemoteAddRequest(
                    project_dir=str(proj_dir),
                    name="origin",
                    url="https://github.com/cdac-vega/other.git",
                )
            )
        assert dup_exc.value.status_code == 409

        # Update requires confirm=True
        with pytest.raises(GitHubServiceError) as upd_noconfirm:
            gh_svc.update_remote(
                "origin",
                GitHubRemoteUpdateRequest(
                    project_dir=str(proj_dir),
                    name="origin",
                    url="git@github.com:cdac-vega/aries-blink.git",
                    confirm=False,
                ),
            )
        assert upd_noconfirm.value.status_code == 400

        updated = gh_svc.update_remote(
            "origin",
            GitHubRemoteUpdateRequest(
                project_dir=str(proj_dir),
                name="origin",
                url="git@github.com:cdac-vega/aries-blink.git",
                confirm=True,
            ),
        )
        assert updated[0].fetch_url == "git@github.com:cdac-vega/aries-blink.git"

        # Remove requires confirm=True
        with pytest.raises(GitHubServiceError) as rem_noconfirm:
            gh_svc.remove_remote(
                "origin", GitHubRemoteRemoveRequest(project_dir=str(proj_dir), confirm=False)
            )
        assert rem_noconfirm.value.status_code == 400

        after_remove = gh_svc.remove_remote(
            "origin", GitHubRemoteRemoveRequest(project_dir=str(proj_dir), confirm=True)
        )
        assert after_remove == []

    def test_status_confines_to_project_and_never_leaks_parent_repo_remotes(self, tmp_path: Path):
        parent_repo = tmp_path / "parent_monorepo"
        parent_repo.mkdir()
        assert _git_raw(parent_repo, "init").returncode == 0
        assert (
            _git_raw(parent_repo, "remote", "add", "origin", "https://github.com/org/parent.git").returncode
            == 0
        )

        child_proj = parent_repo / "vega_child_proj"
        child_proj.mkdir()
        app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
        gh_svc = GitHubService(app_settings)

        status = gh_svc.get_status(str(child_proj))
        assert status.is_git_repository is False
        assert status.remotes == []

        with pytest.raises(GitHubServiceError) as exc:
            gh_svc.list_remotes(str(child_proj))
        assert exc.value.status_code == 400

        with pytest.raises(GitHubServiceError) as missing_exc:
            gh_svc.get_status(str(tmp_path / "nonexistent_dir"))
        assert missing_exc.value.status_code == 404


# ---------------------------------------------------------------------------
# 4. Repository Creation & Guided Publish Workflow
# ---------------------------------------------------------------------------


class TestRepoCreateAndPublish:
    def test_create_repository_blocks_unconfirmed_and_protects_existing_readme(self, tmp_path: Path):
        _, proj_dir, _, gh_svc = _init_committed_repo(tmp_path)
        bin_dir = tmp_path / "mock_bin"
        _write_mock_gh(
            bin_dir,
            """
import sys
args = sys.argv[1:]
if args[0] == "--version":
    print("gh version 2.62.0")
    sys.exit(0)
if args[:2] == ["auth", "status"]:
    print("Logged in to github.com account vega-user")
    print("Git operations protocol: https")
    sys.exit(0)
if args[:2] == ["repo", "create"]:
    name = args[2]
    print(f"https://github.com/vega-user/{name}")
    sys.exit(0)
""",
        )

        with patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"}):
            with pytest.raises(GitHubServiceError) as no_conf:
                gh_svc.create_repository(
                    GitHubCreateRepoRequest(project_dir=str(proj_dir), name="fw-demo", confirm=False)
                )
            assert no_conf.value.status_code == 400

            # Local README exists -> add_readme=True must fail cleanly without touching local file
            readme = proj_dir / "README.md"
            readme.write_text("# Local Firmware\nDo not overwrite me.\n", encoding="utf-8")
            with pytest.raises(GitHubServiceError) as readme_guard:
                gh_svc.create_repository(
                    GitHubCreateRepoRequest(
                        project_dir=str(proj_dir),
                        name="fw-demo",
                        add_readme=True,
                        confirm=True,
                    )
                )
            assert readme_guard.value.status_code == 409
            assert "Do not overwrite me." in readme.read_text(encoding="utf-8")

            created = gh_svc.create_repository(
                GitHubCreateRepoRequest(
                    project_dir=str(proj_dir),
                    name="fw-demo",
                    visibility="private",
                    add_readme=False,
                    confirm=True,
                )
            )
            assert created["url"] == "https://github.com/vega-user/fw-demo"
            assert created["remote"]["name"] == "origin"
            assert created["remote"]["fetch_url"] == "https://github.com/vega-user/fw-demo.git"

    def test_publish_workflow_never_auto_commits_and_pushes_committed_branch_to_remote(
        self, tmp_path: Path
    ):
        _, proj_dir, git_svc, gh_svc = _init_committed_repo(tmp_path)
        bare_dir, bare_uri = _setup_bare_remote(tmp_path, "published_target.git")
        # Redirect GitHub HTTPS URL in isolated project git config to local bare repo
        assert (
            _git_raw(
                proj_dir,
                "config",
                f"url.{bare_uri}.insteadOf",
                "https://github.com/vega-user/published-fw.git",
            ).returncode
            == 0
        )

        bin_dir = tmp_path / "mock_bin"
        _write_mock_gh(
            bin_dir,
            """
import sys
args = sys.argv[1:]
if args[0] == "--version":
    print("gh version 2.62.0")
    sys.exit(0)
if args[:2] == ["auth", "status"]:
    print("Logged in to github.com account vega-user")
    print("Git operations protocol: https")
    sys.exit(0)
if args[:2] == ["repo", "create"]:
    print(f"https://github.com/vega-user/{args[2]}")
    sys.exit(0)
""",
        )

        # Add an untracked draft file and uncommitted modification -> must remain uncommitted!
        draft = proj_dir / "notes_untracked.txt"
        draft.write_text("keep me untracked\n", encoding="utf-8")

        with patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"}):
            preview = gh_svc.preview_publish(str(proj_dir))
            assert preview.committed_ready is True
            assert preview.untracked_count == 1
            assert any("NOT auto-stage" in w for w in preview.warnings)
            assert preview.blockers == []

            started = gh_svc.publish_project(
                GitHubPublishRequest(
                    project_dir=str(proj_dir),
                    name="published-fw",
                    visibility="private",
                    remote_name="origin",
                    confirm=True,
                )
            )
            assert started.kind == "publish"
            done = _wait_for_op(gh_svc)
            assert done.status == "succeeded", done.error_message

            # Verify bare remote received main commit AND untracked file was NOT auto-committed
            remote_heads = _git_raw(bare_dir, "ls-remote", "--heads", ".")
            assert "refs/heads/main" in remote_heads.stdout
            status_after = git_svc.get_status(str(proj_dir))
            assert status_after.upstream == "origin/main"
            assert any(f.path == "notes_untracked.txt" for f in status_after.untracked_files)


# ---------------------------------------------------------------------------
# 5. Fetch, Pull Safety, Push, Divergence & Explicit Remote Info
# ---------------------------------------------------------------------------


class TestSyncWorkflows:
    def _seed_connected_pair(self, tmp_path: Path):
        app_settings, proj_dir, git_svc, gh_svc = _init_committed_repo(tmp_path)
        bare_dir, bare_uri = _setup_bare_remote(tmp_path, "sync_remote.git")
        assert _git_raw(proj_dir, "remote", "add", "origin", bare_uri).returncode == 0
        assert _git_raw(proj_dir, "push", "-u", "origin", "main").returncode == 0

        peer_dir = tmp_path / "peer_clone"
        res = subprocess.run(
            ["git", "clone", bare_uri, str(peer_dir)],
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0, res.stderr
        assert _git_raw(peer_dir, "config", "user.name", "Peer Dev").returncode == 0
        assert _git_raw(peer_dir, "config", "user.email", "peer@vega.local").returncode == 0
        return app_settings, proj_dir, peer_dir, bare_dir, git_svc, gh_svc

    def test_fetch_updates_tracking_counts_without_touching_working_files(self, tmp_path: Path):
        _, proj_dir, peer_dir, _, git_svc, gh_svc = self._seed_connected_pair(tmp_path)

        # Peer commits and pushes upstream
        (peer_dir / "peer_added.txt").write_text("from peer\n", encoding="utf-8")
        assert _git_raw(peer_dir, "add", "peer_added.txt").returncode == 0
        assert _git_raw(peer_dir, "commit", "-m", "Peer commit").returncode == 0
        assert _git_raw(peer_dir, "push", "origin", "main").returncode == 0

        # Project status does not fetch automatically
        before = git_svc.get_status(str(proj_dir))
        assert before.behind == 0

        gh_svc.start_fetch(GitHubFetchRequest(project_dir=str(proj_dir), remote="origin"))
        done = _wait_for_op(gh_svc)
        assert done.status == "succeeded", done.error_message

        # Working tree unchanged; behind now reflects remote commit
        assert (proj_dir / "peer_added.txt").exists() is False
        after = git_svc.get_status(str(proj_dir))
        assert after.behind == 1

    def test_pull_blocks_dirty_tracked_tree_and_succeeds_when_clean(self, tmp_path: Path):
        _, proj_dir, peer_dir, _, git_svc, gh_svc = self._seed_connected_pair(tmp_path)

        (peer_dir / "remote_update.txt").write_text("remote line\n", encoding="utf-8")
        assert _git_raw(peer_dir, "add", "remote_update.txt").returncode == 0
        assert _git_raw(peer_dir, "commit", "-m", "Upstream change").returncode == 0
        assert _git_raw(peer_dir, "push", "origin", "main").returncode == 0

        # Make a tracked file dirty locally
        target_file = proj_dir / "src" / "main.c"
        if not target_file.exists():
            target_file = proj_dir / "vega-project.json"
        original_bytes = target_file.read_bytes()
        target_file.write_bytes(original_bytes + b"\n// dirty local edit\n")

        precheck_dirty = gh_svc.precheck_pull(str(proj_dir), "origin")
        assert precheck_dirty.ready is False
        assert precheck_dirty.unstaged_count >= 1

        with pytest.raises(GitHubServiceError) as blocked:
            gh_svc.start_pull(GitHubPullRequest(project_dir=str(proj_dir), remote="origin", confirm=True))
        assert blocked.value.status_code == 409

        # Restore file cleanly and pull
        target_file.write_bytes(original_bytes)
        precheck_clean = gh_svc.precheck_pull(str(proj_dir), "origin")
        assert precheck_clean.ready is True

        gh_svc.start_pull(GitHubPullRequest(project_dir=str(proj_dir), remote="origin", confirm=True))
        done = _wait_for_op(gh_svc)
        assert done.status == "succeeded", done.error_message
        assert (proj_dir / "remote_update.txt").exists() is True

    def test_pull_merge_conflict_preserves_state_without_destructive_reset(self, tmp_path: Path):
        _, proj_dir, peer_dir, _, git_svc, gh_svc = self._seed_connected_pair(tmp_path)

        shared = proj_dir / "shared.txt"
        shared.write_text("base\n", encoding="utf-8")
        assert _git_raw(proj_dir, "add", "shared.txt").returncode == 0
        assert _git_raw(proj_dir, "commit", "-m", "Add shared").returncode == 0
        assert _git_raw(proj_dir, "push", "origin", "main").returncode == 0

        assert _git_raw(peer_dir, "pull", "origin", "main").returncode == 0
        (peer_dir / "shared.txt").write_text("peer edit\n", encoding="utf-8")
        assert _git_raw(peer_dir, "commit", "-am", "Peer edit shared").returncode == 0
        assert _git_raw(peer_dir, "push", "origin", "main").returncode == 0

        # Divergent local commit on same line
        shared.write_text("local edit\n", encoding="utf-8")
        assert _git_raw(proj_dir, "commit", "-am", "Local edit shared").returncode == 0

        gh_svc.start_pull(GitHubPullRequest(project_dir=str(proj_dir), remote="origin", confirm=True))
        done = _wait_for_op(gh_svc)
        assert done.status == "failed"
        assert "conflict" in (done.error_message or "").lower()

        status_after = git_svc.get_status(str(proj_dir))
        assert len(status_after.conflicted_files) == 1
        assert "<<<<<<" in shared.read_text(encoding="utf-8")

    def test_push_succeeds_and_rejects_non_fast_forward_without_force_push(self, tmp_path: Path):
        _, proj_dir, peer_dir, bare_dir, git_svc, gh_svc = self._seed_connected_pair(tmp_path)

        # Clean push forward
        (proj_dir / "local_feat.txt").write_text("feat\n", encoding="utf-8")
        assert _git_raw(proj_dir, "add", "local_feat.txt").returncode == 0
        assert _git_raw(proj_dir, "commit", "-m", "Local feature").returncode == 0

        gh_svc.start_push(GitHubPushRequest(project_dir=str(proj_dir), remote="origin", confirm=True))
        done_ok = _wait_for_op(gh_svc)
        assert done_ok.status == "succeeded", done_ok.error_message

        # Now peer advances remote -> local diverges -> push must fail cleanly without --force
        assert _git_raw(peer_dir, "pull", "origin", "main").returncode == 0
        (peer_dir / "peer_ahead.txt").write_text("ahead\n", encoding="utf-8")
        assert _git_raw(peer_dir, "add", "peer_ahead.txt").returncode == 0
        assert _git_raw(peer_dir, "commit", "-m", "Peer ahead").returncode == 0
        assert _git_raw(peer_dir, "push", "origin", "main").returncode == 0

        (proj_dir / "local_div.txt").write_text("div\n", encoding="utf-8")
        assert _git_raw(proj_dir, "add", "local_div.txt").returncode == 0
        assert _git_raw(proj_dir, "commit", "-m", "Local div").returncode == 0

        gh_svc.start_push(GitHubPushRequest(project_dir=str(proj_dir), remote="origin", confirm=True))
        done_rej = _wait_for_op(gh_svc)
        assert done_rej.status == "failed"
        assert "pull" in (done_rej.error_message or "").lower() or "rejected" in (done_rej.error_message or "").lower()

        # Verify remote info explicit endpoint works cleanly against bare remote
        detail = gh_svc.get_remote_repo_info(str(proj_dir), "origin")
        assert "main" in detail.remote_branches

    def test_router_endpoints_end_to_end(self, tmp_path: Path):
        app_settings, proj_dir, _, gh_svc = _init_committed_repo(tmp_path)
        _, bare_uri = _setup_bare_remote(tmp_path, "router_remote.git")
        assert _git_raw(proj_dir, "remote", "add", "origin", bare_uri).returncode == 0

        app.dependency_overrides[get_github_service] = lambda: gh_svc
        try:
            client = TestClient(app)
            st = client.get("/api/github/status", params={"project_dir": str(proj_dir)})
            assert st.status_code == 200
            body = st.json()
            assert body["is_git_repository"] is True
            assert len(body["remotes"]) == 1
            assert body["remotes"][0]["name"] == "origin"

            pre = client.get("/api/github/push/precheck", params={"project_dir": str(proj_dir)})
            assert pre.status_code == 200
            assert pre.json()["ready"] is True
            assert pre.json()["needs_upstream_setup"] is True

            push_res = client.post(
                "/api/github/push",
                json={"project_dir": str(proj_dir), "remote": "origin", "confirm": True},
            )
            assert push_res.status_code == 200
            done = _wait_for_op(gh_svc)
            assert done.status == "succeeded", done.error_message

            info_res = client.get(
                "/api/github/repo",
                params={"project_dir": str(proj_dir), "remote": "origin"},
            )
            assert info_res.status_code == 200
            assert "main" in info_res.json()["remote_branches"]
        finally:
            app.dependency_overrides.clear()
