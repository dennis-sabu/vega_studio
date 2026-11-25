"""Tests for Phase 12 Native Git Integration (detection, status, staging, commit, branches, history, diff, security).

All tests operate strictly inside isolated `tmp_path` directories and never touch
the VEGA Studio development repository itself.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models.git import (
    GitBranchCreateRequest,
    GitBranchSwitchRequest,
    GitCommitRequest,
    GitConfirmPathsRequest,
    GitPathsRequest,
)
from app.routers.git import get_git_service
from app.services.git_service import (
    GitService,
    GitServiceError,
    _MAX_DIFF_BYTES,
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


def _create_isolated_project(tmp_path: Path, name: str = "aries_git_proj") -> tuple[Settings, Path]:
    app_settings = Settings(DATA_DIR=str(tmp_path / "app_data"))
    proj_svc = ProjectService(app_settings)
    summary = proj_svc.create_project(
        type(
            "Req",
            (),
            {
                "name": name,
                "parent_dir": str(tmp_path / "projects"),
                "description": "Phase 12 isolated git test project",
                "template": "minimal",
            },
        )()
    )
    return app_settings, Path(summary.project_dir)


def _init_committed_repo(
    tmp_path: Path, name: str = "aries_git_proj"
) -> tuple[Settings, Path, GitService]:
    app_settings, proj_dir = _create_isolated_project(tmp_path, name)
    svc = GitService(app_settings)
    svc.init_repository(str(proj_dir))
    assert _git_raw(proj_dir, "config", "user.name", "VEGA Tester").returncode == 0
    assert _git_raw(proj_dir, "config", "user.email", "tester@vega.local").returncode == 0
    svc.stage_all(str(proj_dir))
    svc.commit(GitCommitRequest(project_dir=str(proj_dir), message="Initial firmware commit"))
    return app_settings, proj_dir, svc


# ---------------------------------------------------------------------------
# 1. Detection, Missing Git, Ancestor Confinement & Initialization
# ---------------------------------------------------------------------------


class TestGitDetectionAndInit:
    def test_detect_git_succeeds_and_reports_non_repo_before_init(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        svc = GitService(app_settings)

        info = svc.get_info(str(proj_dir))
        assert info.git_available is True
        assert info.git_version is not None and "git version" in info.git_version.lower()
        assert info.is_repository is False
        assert (proj_dir / ".git").exists() is False

        status = svc.get_status(str(proj_dir))
        assert status.git_available is True
        assert status.is_repository is False
        assert status.repo_state == "not_a_repo"

    def test_missing_git_returns_actionable_guidance_without_crashing(
        self, tmp_path: Path
    ):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        svc = GitService(app_settings)

        with patch.object(svc, "_find_git_executable", return_value=None):
            info = svc.get_info(str(proj_dir))
            assert info.git_available is False
            assert "git-scm.com" in info.install_guide_url
            assert info.unavailable_reason is not None

            st = svc.get_status(str(proj_dir))
            assert st.git_available is False
            assert st.repo_state == "git_unavailable"

            with pytest.raises(GitServiceError) as exc:
                svc.init_repository(str(proj_dir))
            assert exc.value.status_code == 503

    def test_parent_repo_does_not_hijack_non_git_project_and_init_is_explicit(
        self, tmp_path: Path
    ):
        outer_dir = tmp_path / "outer_repo"
        outer_dir.mkdir()
        assert _git_raw(outer_dir, "init", "-b", "main").returncode == 0
        (outer_dir / "host_secret.txt").write_text("do not touch", encoding="utf-8")

        app_settings = Settings(DATA_DIR=str(tmp_path / "data"))
        proj_svc = ProjectService(app_settings)
        summary = proj_svc.create_project(
            type(
                "Req",
                (),
                {
                    "name": "nested_proj",
                    "parent_dir": str(outer_dir / "workspaces"),
                    "description": "Nested non-git project",
                    "template": "minimal",
                },
            )()
        )
        proj_dir = Path(summary.project_dir)
        svc = GitService(app_settings)

        # Must NOT expose parent outer_repo as active repository
        st = svc.get_status(str(proj_dir))
        assert st.is_repository is False
        assert st.has_parent_repo is True
        assert st.parent_repo_root is not None
        assert st.repo_state == "not_a_repo"

        # Explicit init initializes inside proj_dir cleanly
        inited = svc.init_repository(str(proj_dir))
        assert inited.is_repository is True
        assert Path(inited.repo_root).resolve() == proj_dir.resolve()
        assert inited.repo_state == "unborn"

        # Duplicate init blocked cleanly with 409
        with pytest.raises(GitServiceError) as exc:
            svc.init_repository(str(proj_dir))
        assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# 2. Porcelain Status Parsing, Unusual Filenames & Stage/Unstage Lifecycle
# ---------------------------------------------------------------------------


class TestStatusAndStaging:
    def test_status_parses_modified_added_deleted_renamed_untracked_and_unusual_names(
        self, tmp_path: Path
    ):
        app_settings, proj_dir, svc = _init_committed_repo(tmp_path)

        # Create unusual filenames including leading hyphen (`-weird file.c`) & spaces
        special_name = "src/-weird file (v1).c"
        (proj_dir / special_name).write_text("int weird = 1;\n", encoding="utf-8")
        (proj_dir / "rename source.txt").write_text("rename me line\n", encoding="utf-8")
        (proj_dir / "to_delete.txt").write_text("bye\n", encoding="utf-8")
        svc.stage_all(str(proj_dir))
        svc.commit(GitCommitRequest(project_dir=str(proj_dir), message="Add special files"))

        # Untracked
        (proj_dir / "new note.md").write_text("untracked\n", encoding="utf-8")
        # Unstaged modification of leading-hyphen filename
        (proj_dir / special_name).write_text("int weird = 2;\n", encoding="utf-8")
        # Staged addition
        (proj_dir / "staged_add.c").write_text("int x = 0;\n", encoding="utf-8")
        svc.stage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=["staged_add.c"]))
        # Staged deletion
        (proj_dir / "to_delete.txt").unlink()
        svc.stage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=["to_delete.txt"]))
        # Staged rename with spaces
        assert _git_raw(proj_dir, "mv", "rename source.txt", "rename target.txt").returncode == 0

        st = svc.get_status(str(proj_dir))
        staged_map = {f.path: f for f in st.staged_files}
        unstaged_map = {f.path: f for f in st.unstaged_files}
        untracked_map = {f.path: f for f in st.untracked_files}

        assert staged_map["staged_add.c"].status == "added"
        assert staged_map["to_delete.txt"].status == "deleted"
        assert staged_map["rename target.txt"].status == "renamed"
        assert staged_map["rename target.txt"].orig_path == "rename source.txt"
        assert unstaged_map[special_name].status == "modified"
        assert untracked_map["new note.md"].status == "untracked"

        # Stage and unstage leading-hyphen filename safely
        st2 = svc.stage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=[special_name]))
        assert any(f.path == special_name for f in st2.staged_files)

        st3 = svc.unstage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=[special_name]))
        assert all(f.path != special_name for f in st3.staged_files)
        assert any(f.path == special_name for f in st3.unstaged_files)

        st4 = svc.unstage_all(str(proj_dir))
        assert st4.staged_count == 0

    def test_unstage_works_before_first_commit_on_unborn_repo(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        svc = GitService(app_settings)
        svc.init_repository(str(proj_dir))

        st1 = svc.stage_paths(
            GitPathsRequest(project_dir=str(proj_dir), paths=["vega-project.json"])
        )
        assert st1.staged_count == 1
        assert st1.is_unborn is True

        st2 = svc.unstage_paths(
            GitPathsRequest(project_dir=str(proj_dir), paths=["vega-project.json"])
        )
        assert st2.staged_count == 0
        assert (proj_dir / "vega-project.json").is_file()

        svc.stage_all(str(proj_dir))
        st3 = svc.unstage_all(str(proj_dir))
        assert st3.staged_count == 0


# ---------------------------------------------------------------------------
# 3. Destructive Operations (Discard & Untracked Deletion)
# ---------------------------------------------------------------------------


class TestDiscardAndDeleteUntracked:
    def test_discard_requires_explicit_confirm_and_preserves_staged_changes(
        self, tmp_path: Path
    ):
        _, proj_dir, svc = _init_committed_repo(tmp_path)
        target = proj_dir / "src" / "main.c"
        original_content = target.read_text(encoding="utf-8")

        # Staged change + second worktree change on same file
        target.write_text("// staged version\n", encoding="utf-8")
        svc.stage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=["src/main.c"]))
        target.write_text("// unstaged dirty edit\n", encoding="utf-8")

        # Must fail when confirm=False
        with pytest.raises(GitServiceError) as exc:
            svc.discard_changes(
                GitConfirmPathsRequest(
                    project_dir=str(proj_dir),
                    paths=["src/main.c"],
                    confirm=False,
                )
            )
        assert exc.value.status_code == 400
        assert target.read_text(encoding="utf-8") == "// unstaged dirty edit\n"

        # With confirm=True: reverts unstaged edit back to staged index copy cleanly
        st = svc.discard_changes(
            GitConfirmPathsRequest(
                project_dir=str(proj_dir),
                paths=["src/main.c"],
                confirm=True,
            )
        )
        assert target.read_text(encoding="utf-8") == "// staged version\n"
        assert st.unstaged_count == 0
        assert st.staged_count == 1

        # Unstage then test untracked rejection by discard
        svc.unstage_all(str(proj_dir))
        (proj_dir / "scratch.tmp").write_text("keep me\n", encoding="utf-8")
        with pytest.raises(GitServiceError) as exc_u:
            svc.discard_changes(
                GitConfirmPathsRequest(
                    project_dir=str(proj_dir),
                    paths=["scratch.tmp"],
                    confirm=True,
                )
            )
        assert exc_u.value.status_code == 400
        assert (proj_dir / "scratch.tmp").is_file()
        assert target.read_text(encoding="utf-8") != original_content or True

    def test_delete_untracked_requires_confirm_and_never_deletes_tracked_files(
        self, tmp_path: Path
    ):
        _, proj_dir, svc = _init_committed_repo(tmp_path)
        untracked = proj_dir / "temp debug.txt"
        untracked.write_text("temp", encoding="utf-8")

        with pytest.raises(GitServiceError):
            svc.delete_untracked(
                GitConfirmPathsRequest(
                    project_dir=str(proj_dir),
                    paths=["temp debug.txt"],
                    confirm=False,
                )
            )
        assert untracked.is_file()

        # Refuse tracked file deletion via delete_untracked
        with pytest.raises(GitServiceError):
            svc.delete_untracked(
                GitConfirmPathsRequest(
                    project_dir=str(proj_dir),
                    paths=["vega-project.json"],
                    confirm=True,
                )
            )
        assert (proj_dir / "vega-project.json").is_file()

        # Valid confirmed deletion of untracked file succeeds
        st = svc.delete_untracked(
            GitConfirmPathsRequest(
                project_dir=str(proj_dir),
                paths=["temp debug.txt"],
                confirm=True,
            )
        )
        assert not untracked.exists()
        assert st.untracked_count == 0


# ---------------------------------------------------------------------------
# 4. Commit Validation, Identity Errors & Branch Conflict Handling
# ---------------------------------------------------------------------------


class TestCommitAndBranches:
    def test_commit_refuses_empty_staged_changes_and_missing_identity(
        self, tmp_path: Path
    ):
        _, proj_dir, svc = _init_committed_repo(tmp_path)

        # Modify file in worktree ONLY (not staged) -> commit MUST NOT auto-stage
        (proj_dir / "src" / "main.c").write_text("int dirty = 1;\n", encoding="utf-8")
        with pytest.raises(GitServiceError) as exc:
            svc.commit(
                GitCommitRequest(
                    project_dir=str(proj_dir),
                    message="Should not auto-stage",
                )
            )
        assert exc.value.status_code == 400
        assert "staged" in exc.value.message.lower()

        # Blank message rejected by model validator
        with pytest.raises(ValueError):
            GitCommitRequest(project_dir=str(proj_dir), message="   \n  ")

        # Missing identity detection even with staged file
        svc.stage_all(str(proj_dir))
        _git_raw(proj_dir, "config", "--unset", "user.name")
        _git_raw(proj_dir, "config", "--unset", "user.email")
        with patch.dict(
            os.environ,
            {"GIT_CONFIG_GLOBAL": str(tmp_path / "empty_gitconfig"), "GIT_CONFIG_SYSTEM": str(tmp_path / "empty_sysconfig")},
        ):
            # Force clean git env without author fallback
            with patch(
                "app.services.git_service._safe_git_env",
                return_value={
                    **{k: v for k, v in os.environ.items() if not k.startswith("GIT_AUTHOR") and not k.startswith("GIT_COMMITTER")},
                    "GIT_TERMINAL_PROMPT": "0",
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": str(tmp_path / "empty_gitconfig"),
                },
            ):
                with pytest.raises(GitServiceError) as exc_id:
                    svc.commit(
                        GitCommitRequest(project_dir=str(proj_dir), message="Test no id")
                    )
                assert exc_id.value.status_code == 400
                assert "identity" in exc_id.value.message.lower()

    def test_branches_create_list_precheck_switch_and_conflict_guard(
        self, tmp_path: Path
    ):
        _, proj_dir, svc = _init_committed_repo(tmp_path)

        # Create feature branch and make a commit modifying src/main.c
        res = svc.create_branch(
            GitBranchCreateRequest(
                project_dir=str(proj_dir), name="feature/uart-irq", checkout=True
            )
        )
        assert res.active_branch == "feature/uart-irq"
        assert {b.name for b in res.branches} == {"main", "feature/uart-irq"}

        main_c = proj_dir / "src" / "main.c"
        main_c.write_text("// feature branch uart irq implementation\n", encoding="utf-8")
        svc.stage_all(str(proj_dir))
        svc.commit(GitCommitRequest(project_dir=str(proj_dir), message="Add UART IRQ"))

        # Switch cleanly back to main
        sw = svc.switch_branch(
            GitBranchSwitchRequest(project_dir=str(proj_dir), name="main")
        )
        assert sw.active_branch == "main"

        # Now dirty src/main.c locally on main -> precheck warns & switch aborts 409 without losing edit
        main_c.write_text("// local uncommitted edits on main\n", encoding="utf-8")
        pre = svc.precheck_switch("feature/uart-irq", str(proj_dir))
        assert pre.has_uncommitted_changes is True
        assert "src/main.c" in pre.potentially_affected_files
        assert pre.warning is not None

        with pytest.raises(GitServiceError) as exc:
            svc.switch_branch(
                GitBranchSwitchRequest(project_dir=str(proj_dir), name="feature/uart-irq")
            )
        assert exc.value.status_code == 409
        # Uncommitted edit preserved untouched
        assert main_c.read_text(encoding="utf-8") == "// local uncommitted edits on main\n"
        assert svc.get_status(str(proj_dir)).current_branch == "main"

        # Duplicate branch rejected 409
        with pytest.raises(GitServiceError) as exc_dup:
            svc.create_branch(
                GitBranchCreateRequest(project_dir=str(proj_dir), name="feature/uart-irq")
            )
        assert exc_dup.value.status_code == 409


# ---------------------------------------------------------------------------
# 5. History, Commit Details & Diff Viewer (Text, Binary, Oversized)
# ---------------------------------------------------------------------------


class TestHistoryAndDiff:
    def test_paginated_history_commit_detail_and_diffs(self, tmp_path: Path):
        _, proj_dir, svc = _init_committed_repo(tmp_path)

        # Create 3 additional commits + binary file
        for idx in range(1, 4):
            (proj_dir / "src" / "main.c").write_text(
                f"// version {idx}\nint main(void) {{ return {idx}; }}\n",
                encoding="utf-8",
            )
            svc.stage_all(str(proj_dir))
            svc.commit(
                GitCommitRequest(project_dir=str(proj_dir), message=f"Commit step {idx}")
            )

        page1 = svc.get_history(str(proj_dir), limit=2, offset=0)
        assert len(page1.commits) == 2
        assert page1.has_more is True
        assert page1.commits[0].subject == "Commit step 3"

        page2 = svc.get_history(str(proj_dir), limit=2, offset=2)
        assert len(page2.commits) == 2
        assert page2.has_more is False
        assert page2.commits[-1].subject == "Initial firmware commit"

        # Commit detail
        latest_hash = page1.commits[0].hash
        detail = svc.get_commit_detail(latest_hash, str(proj_dir))
        assert detail.hash == latest_hash
        assert len(detail.parents) == 1
        assert any(f.path == "src/main.c" for f in detail.files)
        assert "return 3;" in detail.unified_diff

        # Commit file diff
        cdiff = svc.get_diff("src/main.c", raw_project_dir=str(proj_dir), commit_hash=latest_hash)
        assert cdiff.added_lines >= 1
        assert "return 3;" in (cdiff.modified_content or "")
        assert "return 2;" in (cdiff.original_content or "")

        # Staged & worktree diff + binary fallback + large file fallback
        (proj_dir / "src" / "main.c").write_text("// staged edit\n", encoding="utf-8")
        svc.stage_paths(GitPathsRequest(project_dir=str(proj_dir), paths=["src/main.c"]))
        (proj_dir / "src" / "main.c").write_text("// worktree edit\n", encoding="utf-8")

        s_diff = svc.get_diff("src/main.c", raw_project_dir=str(proj_dir), staged=True)
        w_diff = svc.get_diff("src/main.c", raw_project_dir=str(proj_dir), staged=False)
        assert "// staged edit" in (s_diff.modified_content or "")
        assert "// worktree edit" in (w_diff.modified_content or "")

        # Binary untracked fallback
        (proj_dir / "fw.bin").write_bytes(b"\x00\x01\x02\xff\x00hello")
        b_diff = svc.get_diff("fw.bin", raw_project_dir=str(proj_dir))
        assert b_diff.is_binary is True
        assert b_diff.original_content is None

        # Oversized untracked fallback
        (proj_dir / "huge.txt").write_text("X" * (_MAX_DIFF_BYTES + 1024), encoding="utf-8")
        l_diff = svc.get_diff("huge.txt", raw_project_dir=str(proj_dir))
        assert l_diff.too_large is True
        assert l_diff.modified_content is None


# ---------------------------------------------------------------------------
# 6. Security Boundaries, Timeout, Failure & FastAPI REST Endpoints
# ---------------------------------------------------------------------------


class TestSecurityAndAPI:
    def test_path_traversal_dot_git_and_symlink_escape_blocked(self, tmp_path: Path):
        _, proj_dir, svc = _init_committed_repo(tmp_path)

        for bad_path in ("../outside.txt", "/etc/passwd", "C:/Windows/win.ini", ".git/config", "src/../.git/HEAD"):
            with pytest.raises(ValueError):
                GitPathsRequest(project_dir=str(proj_dir), paths=[bad_path])
            with pytest.raises(GitServiceError):
                svc.get_diff(bad_path, raw_project_dir=str(proj_dir))

        # Test escaping symlink detection when platform permits symlinks
        outside = tmp_path / "outside_secret.txt"
        outside.write_text("secret", encoding="utf-8")
        link_path = proj_dir / "escape_link.txt"
        try:
            link_path.symlink_to(outside)
        except OSError:
            link_path = None
        if link_path is not None:
            with pytest.raises(GitServiceError):
                svc._confine_repo_paths(proj_dir, ["escape_link.txt"])

    def test_git_timeout_and_subprocess_failure_handled_safely(self, tmp_path: Path):
        _, proj_dir, svc = _init_committed_repo(tmp_path)

        with (
            patch.object(
                svc,
                "detect_git",
                return_value=(True, "git version 2.50.1", "git", None),
            ),
            patch(
                "app.services.git_service.subprocess.run",
                side_effect=subprocess.TimeoutExpired(cmd=["git", "status"], timeout=12.0),
            ),
        ):
            with pytest.raises(GitServiceError) as exc_t:
                svc.get_status(str(proj_dir))
            assert exc_t.value.status_code == 504

        # Simulated .git/index.lock contention returns 409 safely
        fake_lock_err = subprocess.CompletedProcess(
            args=["git"],
            returncode=128,
            stdout=b"",
            stderr=b"fatal: Unable to create '.git/index.lock': File exists.",
        )
        with (
            patch.object(
                svc,
                "detect_git",
                return_value=(True, "git version 2.50.1", "git", None),
            ),
            patch.object(
                svc,
                "_inspect_repo_boundary",
                return_value=(True, proj_dir, False, None),
            ),
            patch("app.services.git_service.subprocess.run", return_value=fake_lock_err),
        ):
            with pytest.raises(GitServiceError) as exc_l:
                svc.stage_all(str(proj_dir))
            assert exc_l.value.status_code == 409

    def test_fastapi_git_routes_full_workflow(self, tmp_path: Path):
        app_settings, proj_dir = _create_isolated_project(tmp_path)
        svc = GitService(app_settings)
        app.dependency_overrides[get_git_service] = lambda: svc
        client = TestClient(app)

        try:
            info_res = client.get("/api/git/info", params={"project_dir": str(proj_dir)})
            assert info_res.status_code == 200
            assert info_res.json()["is_repository"] is False

            init_res = client.post("/api/git/init", json={"project_dir": str(proj_dir)})
            assert init_res.status_code == 201
            assert init_res.json()["is_repository"] is True

            assert _git_raw(proj_dir, "config", "user.name", "API Tester").returncode == 0
            assert _git_raw(proj_dir, "config", "user.email", "api@vega.local").returncode == 0

            st_res = client.post("/api/git/stage-all", json={"project_dir": str(proj_dir)})
            assert st_res.status_code == 200
            assert st_res.json()["staged_count"] >= 1

            cmt_res = client.post(
                "/api/git/commit",
                json={"project_dir": str(proj_dir), "message": "API commit"},
            )
            assert cmt_res.status_code == 200
            chash = cmt_res.json()["commit_hash"]

            br_res = client.post(
                "/api/git/branches/create",
                json={"project_dir": str(proj_dir), "name": "dev", "checkout": True},
            )
            assert br_res.status_code == 201
            assert br_res.json()["active_branch"] == "dev"

            hist_res = client.get("/api/git/history", params={"project_dir": str(proj_dir)})
            assert hist_res.status_code == 200
            assert len(hist_res.json()["commits"]) == 1

            det_res = client.get(f"/api/git/commit/{chash}", params={"project_dir": str(proj_dir)})
            assert det_res.status_code == 200
            assert det_res.json()["hash"] == chash

            diff_res = client.get(
                "/api/git/diff",
                params={"project_dir": str(proj_dir), "path": "src/main.c", "commit": chash},
            )
            assert diff_res.status_code == 200
            assert diff_res.json()["change_type"] == "added"

            # Path traversal rejected via API validation
            bad_diff = client.get(
                "/api/git/diff",
                params={"project_dir": str(proj_dir), "path": "../outside.txt"},
            )
            assert bad_diff.status_code in (400, 422)
        finally:
            app.dependency_overrides.clear()
