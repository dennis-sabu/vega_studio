"""Phase 4 File Explorer router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.explorer import (
    CreateEntryRequest,
    DeleteEntryRequest,
    DirectoryListingResponse,
    EntryOperationResponse,
    FileStatResponse,
    RenameEntryRequest,
)
from app.services.explorer_service import (
    ExplorerService,
    ExplorerServiceError,
    get_explorer_service,
)

router = APIRouter(prefix="/api/explorer", tags=["explorer"])


@router.get(
    "/tree",
    response_model=DirectoryListingResponse,
    summary="List entries inside a project directory",
)
async def list_directory(
    project_dir: str = Query(..., description="Absolute path to the active project"),
    path: str = Query("", description="Project-relative directory path"),
    show_hidden: bool = Query(True, description="Include dotfiles"),
    service: ExplorerService = Depends(get_explorer_service),
) -> DirectoryListingResponse:
    try:
        return service.list_directory(project_dir, path, show_hidden=show_hidden)
    except ExplorerServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/stat",
    response_model=FileStatResponse,
    summary="Inspect read-only metadata of a file inside the project",
)
async def stat_file(
    project_dir: str = Query(..., description="Absolute path to the active project"),
    path: str = Query(..., description="Project-relative file path"),
    service: ExplorerService = Depends(get_explorer_service),
) -> FileStatResponse:
    try:
        return service.stat_file(project_dir, path)
    except ExplorerServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/create",
    response_model=EntryOperationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a file or folder inside the active project",
)
async def create_entry(
    payload: CreateEntryRequest,
    service: ExplorerService = Depends(get_explorer_service),
) -> EntryOperationResponse:
    try:
        return service.create_entry(payload)
    except ExplorerServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/rename",
    response_model=EntryOperationResponse,
    summary="Rename a file or folder inside the active project",
)
async def rename_entry(
    payload: RenameEntryRequest,
    service: ExplorerService = Depends(get_explorer_service),
) -> EntryOperationResponse:
    try:
        return service.rename_entry(payload)
    except ExplorerServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/delete",
    response_model=EntryOperationResponse,
    summary="Delete a file or folder inside the active project",
)
async def delete_entry(
    payload: DeleteEntryRequest,
    service: ExplorerService = Depends(get_explorer_service),
) -> EntryOperationResponse:
    try:
        return service.delete_entry(payload)
    except ExplorerServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
