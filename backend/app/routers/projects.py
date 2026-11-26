"""Project and workspace management router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.project import (
    CreateProjectRequest,
    OpenProjectRequest,
    RemoveRecentRequest,
    UpdateWorkspaceConfigRequest,
    WorkspaceStateResponse,
    WorkspaceSummary,
)
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    get_project_service,
)

router = APIRouter(prefix="/api", tags=["projects"])


@router.get(
    "/workspace",
    response_model=WorkspaceStateResponse,
    summary="Get active workspace and recent projects",
)
async def get_workspace_state(
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceStateResponse:
    return service.get_workspace_state()


@router.post(
    "/workspace/close",
    response_model=WorkspaceStateResponse,
    summary="Close active workspace",
)
async def close_workspace(
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceStateResponse:
    service.close_workspace()
    return service.get_workspace_state()


@router.put(
    "/workspace/config",
    response_model=WorkspaceStateResponse,
    summary="Update workspace configuration such as default projects directory",
)
async def update_workspace_config(
    payload: UpdateWorkspaceConfigRequest,
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceStateResponse:
    try:
        return service.update_default_projects_dir(payload.default_projects_dir)
    except ProjectServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/projects",
    response_model=WorkspaceSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new portable VEGA Studio project",
)
async def create_project(
    payload: CreateProjectRequest,
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceSummary:
    try:
        return service.create_project(payload)
    except ProjectServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/projects/open",
    response_model=WorkspaceSummary,
    summary="Open and validate an existing VEGA Studio project",
)
async def open_project(
    payload: OpenProjectRequest,
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceSummary:
    try:
        return service.open_project(payload.project_dir)
    except ProjectServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/projects/recent/remove",
    response_model=WorkspaceStateResponse,
    summary="Remove an entry from recent project history",
)
async def remove_recent_project(
    payload: RemoveRecentRequest,
    service: ProjectService = Depends(get_project_service),
) -> WorkspaceStateResponse:
    service.remove_recent_project(payload.project_dir)
    return service.get_workspace_state()
