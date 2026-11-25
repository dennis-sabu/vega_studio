"""Phase 13 Native GitHub Integration router."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.models.git import GitProjectRequest
from app.models.github import (
    GitHubAuthStartRequest,
    GitHubCliInfo,
    GitHubCreateRepoRequest,
    GitHubFetchRequest,
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
)
from app.services.git_service import GitServiceError
from app.services.github_service import (
    GitHubService,
    GitHubServiceError,
    get_github_service,
)

router = APIRouter(prefix="/api/github", tags=["github"])


class GitHubOperationStateResponse(BaseModel):
    active_operation: Optional[GitHubOperationSummary] = None
    latest_operation: Optional[GitHubOperationSummary] = None


class GitHubCreateRepoResponse(BaseModel):
    url: str
    remote_url: str
    remote: Optional[GitRemoteInfo] = None
    operation: GitHubOperationSummary


def _raise_http(exc: Exception) -> None:
    if isinstance(exc, (GitHubServiceError, GitServiceError)):
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    raise exc


@router.get(
    "/info",
    response_model=GitHubCliInfo,
    summary="Detect GitHub CLI (gh) and non-secret authentication state",
)
async def get_github_info(
    service: GitHubService = Depends(get_github_service),
) -> GitHubCliInfo:
    try:
        return service.check_auth_status()
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/status",
    response_model=GitHubStatusResponse,
    summary="Get unified GitHub CLI, authentication, project remotes, and operation state",
)
async def get_github_status(
    project_dir: Optional[str] = Query(default=None),
    service: GitHubService = Depends(get_github_service),
) -> GitHubStatusResponse:
    try:
        return service.get_status(project_dir)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/auth/login",
    response_model=GitHubOperationSummary,
    summary="Launch guided browser authentication via gh auth login --web",
)
async def start_github_auth_login(
    payload: Optional[GitHubAuthStartRequest] = None,
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.start_auth_login(payload or GitHubAuthStartRequest())
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/operations/state",
    response_model=GitHubOperationStateResponse,
    summary="Inspect running or latest GitHub/sync background operation state",
)
async def get_github_operation_state(
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationStateResponse:
    active, latest = service.get_operation_state()
    return GitHubOperationStateResponse(active_operation=active, latest_operation=latest)


@router.post(
    "/operations/cancel",
    response_model=GitHubOperationSummary,
    summary="Cancel a running GitHub auth or Git remote sync operation",
)
async def cancel_github_operation(
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.cancel_operation()
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/remotes",
    response_model=List[GitRemoteInfo],
    summary="List configured Git remotes for the active project",
)
async def list_github_remotes(
    project_dir: Optional[str] = Query(default=None),
    service: GitHubService = Depends(get_github_service),
) -> List[GitRemoteInfo]:
    try:
        return service.list_remotes(project_dir)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/remotes",
    response_model=List[GitRemoteInfo],
    status_code=status.HTTP_201_CREATED,
    summary="Add a validated HTTPS or SSH Git remote",
)
async def add_github_remote(
    payload: GitHubRemoteAddRequest,
    service: GitHubService = Depends(get_github_service),
) -> List[GitRemoteInfo]:
    try:
        return service.add_remote(payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.put(
    "/remotes/{remote_name}",
    response_model=List[GitRemoteInfo],
    summary="Update an existing Git remote URL (requires explicit confirmation)",
)
async def update_github_remote(
    remote_name: str,
    payload: GitHubRemoteUpdateRequest,
    service: GitHubService = Depends(get_github_service),
) -> List[GitRemoteInfo]:
    try:
        return service.update_remote(remote_name, payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.delete(
    "/remotes/{remote_name}",
    response_model=List[GitRemoteInfo],
    summary="Remove a configured Git remote (requires explicit confirmation)",
)
async def remove_github_remote(
    remote_name: str,
    project_dir: Optional[str] = Query(default=None),
    confirm: bool = Query(default=False),
    payload: Optional[GitHubRemoteRemoveRequest] = Body(default=None),
    service: GitHubService = Depends(get_github_service),
) -> List[GitRemoteInfo]:
    effective_req = GitHubRemoteRemoveRequest(
        project_dir=payload.project_dir if payload and payload.project_dir else project_dir,
        confirm=bool(payload.confirm if payload else confirm),
    )
    try:
        return service.remove_remote(remote_name, effective_req)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/repos/create",
    response_model=GitHubCreateRepoResponse,
    summary="Create a new GitHub repository via gh CLI with explicit confirmation",
)
async def create_github_repository(
    payload: GitHubCreateRepoRequest,
    service: GitHubService = Depends(get_github_service),
) -> GitHubCreateRepoResponse:
    try:
        result: Dict[str, Any] = service.create_repository(payload)
        return GitHubCreateRepoResponse(**result)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/publish/preview",
    response_model=GitHubPublishPreviewResponse,
    summary="Preview Publish to GitHub requirements and uncommitted warnings non-destructively",
)
async def preview_github_publish(
    payload: Optional[GitProjectRequest] = None,
    service: GitHubService = Depends(get_github_service),
) -> GitHubPublishPreviewResponse:
    try:
        return service.preview_publish(payload.project_dir if payload else None)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/publish",
    response_model=GitHubOperationSummary,
    summary="Publish local committed project history to a new or existing GitHub remote",
)
async def publish_github_project(
    payload: GitHubPublishRequest,
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.publish_project(payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/repo",
    response_model=GitHubRemoteRepoDetail,
    summary="Explicitly inspect remote repository metadata and remote branches",
)
async def inspect_github_remote_repo(
    project_dir: Optional[str] = Query(default=None),
    remote: Optional[str] = Query(default=None),
    service: GitHubService = Depends(get_github_service),
) -> GitHubRemoteRepoDetail:
    try:
        return service.get_remote_repo_info(project_dir, remote)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/fetch",
    response_model=GitHubOperationSummary,
    summary="Fetch updates from a configured remote without altering working files",
)
async def fetch_github_remote(
    payload: GitHubFetchRequest,
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.start_fetch(payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/pull/precheck",
    response_model=GitHubSyncPrecheckResponse,
    summary="Check whether local repository state is safe for pulling from remote",
)
async def precheck_github_pull(
    project_dir: Optional[str] = Query(default=None),
    remote: Optional[str] = Query(default=None),
    service: GitHubService = Depends(get_github_service),
) -> GitHubSyncPrecheckResponse:
    try:
        return service.precheck_pull(project_dir, remote)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/pull",
    response_model=GitHubOperationSummary,
    summary="Pull updates from remote after safety precheck and explicit confirmation",
)
async def pull_github_remote(
    payload: GitHubPullRequest,
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.start_pull(payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.get(
    "/push/precheck",
    response_model=GitHubSyncPrecheckResponse,
    summary="Check whether local commits and upstream tracking are ready for push",
)
async def precheck_github_push(
    project_dir: Optional[str] = Query(default=None),
    remote: Optional[str] = Query(default=None),
    service: GitHubService = Depends(get_github_service),
) -> GitHubSyncPrecheckResponse:
    try:
        return service.precheck_push(project_dir, remote)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)


@router.post(
    "/push",
    response_model=GitHubOperationSummary,
    summary="Push local committed history to remote (never force-pushes)",
)
async def push_github_remote(
    payload: GitHubPushRequest,
    service: GitHubService = Depends(get_github_service),
) -> GitHubOperationSummary:
    try:
        return service.start_push(payload)
    except (GitHubServiceError, GitServiceError) as exc:
        _raise_http(exc)
