"""Phase 12 Native Git Integration router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.git import (
    GitBranchActionResponse,
    GitBranchCreateRequest,
    GitBranchesResponse,
    GitBranchSwitchRequest,
    GitCommitDetailResponse,
    GitCommitRequest,
    GitCommitResponse,
    GitConfirmPathsRequest,
    GitDiffResponse,
    GitHistoryResponse,
    GitInfoResponse,
    GitPathsRequest,
    GitProjectRequest,
    GitStatusResponse,
    GitSwitchPrecheckResponse,
)
from app.services.git_service import GitService, GitServiceError, get_git_service

router = APIRouter(prefix="/api/git", tags=["git"])


@router.get(
    "/info",
    response_model=GitInfoResponse,
    summary="Detect Git executable, version, identity, and active project repository status",
)
async def get_git_info(
    project_dir: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitInfoResponse:
    try:
        return service.get_info(project_dir)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/status",
    response_model=GitStatusResponse,
    summary="Retrieve machine-parsed Git status for staged, unstaged, and untracked files",
)
async def get_git_status(
    project_dir: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.get_status(project_dir)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/refresh",
    response_model=GitStatusResponse,
    summary="Explicitly refresh repository status",
)
async def refresh_git_status(
    payload: Optional[GitProjectRequest] = None,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.get_status(payload.project_dir if payload else None)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/init",
    response_model=GitStatusResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Explicitly initialize a Git repository inside the active project directory",
)
async def init_git_repository(
    payload: Optional[GitProjectRequest] = None,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.init_repository(payload.project_dir if payload else None)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/stage",
    response_model=GitStatusResponse,
    summary="Stage one or more validated project-relative files",
)
async def stage_git_paths(
    payload: GitPathsRequest,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.stage_paths(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/stage-all",
    response_model=GitStatusResponse,
    summary="Stage all repository changes",
)
async def stage_all_git_changes(
    payload: Optional[GitProjectRequest] = None,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.stage_all(payload.project_dir if payload else None)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/unstage",
    response_model=GitStatusResponse,
    summary="Unstage one or more staged files safely",
)
async def unstage_git_paths(
    payload: GitPathsRequest,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.unstage_paths(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/unstage-all",
    response_model=GitStatusResponse,
    summary="Unstage all staged repository changes",
)
async def unstage_all_git_changes(
    payload: Optional[GitProjectRequest] = None,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.unstage_all(payload.project_dir if payload else None)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/discard",
    response_model=GitStatusResponse,
    summary="Discard unstaged working-tree changes after explicit confirmation",
)
async def discard_git_changes(
    payload: GitConfirmPathsRequest,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.discard_changes(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/delete-untracked",
    response_model=GitStatusResponse,
    summary="Delete specific untracked files after separate explicit confirmation",
)
async def delete_untracked_git_files(
    payload: GitConfirmPathsRequest,
    service: GitService = Depends(get_git_service),
) -> GitStatusResponse:
    try:
        return service.delete_untracked(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/commit",
    response_model=GitCommitResponse,
    summary="Commit explicitly staged changes with validation (never auto-stages)",
)
async def commit_git_changes(
    payload: GitCommitRequest,
    service: GitService = Depends(get_git_service),
) -> GitCommitResponse:
    try:
        return service.commit(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/branches",
    response_model=GitBranchesResponse,
    summary="List local repository branches (excludes remotes)",
)
async def list_git_branches(
    project_dir: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitBranchesResponse:
    try:
        return service.list_branches(project_dir)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/branches/precheck",
    response_model=GitSwitchPrecheckResponse,
    summary="Check whether uncommitted working-tree changes may be impacted by switching branches",
)
async def precheck_branch_switch(
    name: str = Query(min_length=1),
    project_dir: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitSwitchPrecheckResponse:
    try:
        return service.precheck_switch(name, project_dir)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/branches/switch",
    response_model=GitBranchActionResponse,
    summary="Switch HEAD to an existing local branch safely",
)
async def switch_git_branch(
    payload: GitBranchSwitchRequest,
    service: GitService = Depends(get_git_service),
) -> GitBranchActionResponse:
    try:
        return service.switch_branch(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/branches/create",
    response_model=GitBranchActionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new local branch from HEAD",
)
async def create_git_branch(
    payload: GitBranchCreateRequest,
    service: GitService = Depends(get_git_service),
) -> GitBranchActionResponse:
    try:
        return service.create_branch(payload)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/history",
    response_model=GitHistoryResponse,
    summary="Retrieve bounded paginated local commit history",
)
async def get_git_history(
    project_dir: Optional[str] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: GitService = Depends(get_git_service),
) -> GitHistoryResponse:
    try:
        return service.get_history(project_dir, limit=limit, offset=offset)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/commit/{commit_hash}",
    response_model=GitCommitDetailResponse,
    summary="Inspect single commit metadata, changed files, stats, and bounded patch",
)
async def get_git_commit_detail(
    commit_hash: str,
    project_dir: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitCommitDetailResponse:
    try:
        return service.get_commit_detail(commit_hash, project_dir)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/diff",
    response_model=GitDiffResponse,
    summary="Inspect bounded unified and structured file diff (worktree, staged, commit, or untracked)",
)
async def get_git_diff(
    path: str = Query(min_length=1),
    project_dir: Optional[str] = Query(default=None),
    staged: bool = Query(default=False),
    commit: Optional[str] = Query(default=None),
    service: GitService = Depends(get_git_service),
) -> GitDiffResponse:
    try:
        return service.get_diff(
            path,
            raw_project_dir=project_dir,
            staged=staged,
            commit_hash=commit,
        )
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
