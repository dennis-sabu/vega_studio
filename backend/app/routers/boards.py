"""Phase 8 Board Manager router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.board import (
    BoardCompatibilityReport,
    BoardListResponse,
    BoardProfile,
    ProjectBoardStatusResponse,
    SelectProjectBoardRequest,
    SelectProjectBoardResponse,
    ValidateBoardCompatibilityRequest,
)
from app.services.board_service import (
    BoardService,
    BoardServiceError,
    get_board_service,
)

router = APIRouter(prefix="/api/boards", tags=["boards"])


@router.get(
    "",
    response_model=BoardListResponse,
    summary="List all registered VEGA hardware board profiles",
)
async def list_boards(
    service: BoardService = Depends(get_board_service),
) -> BoardListResponse:
    return service.list_boards()


@router.get(
    "/project/status",
    response_model=ProjectBoardStatusResponse,
    summary="Get active project's selected board profile and SDK compatibility",
)
async def get_project_board_status(
    project_dir: str = Query(..., description="Absolute path to active VEGA project"),
    service: BoardService = Depends(get_board_service),
) -> ProjectBoardStatusResponse:
    try:
        return service.get_project_board_status(project_dir)
    except BoardServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/project/select",
    response_model=SelectProjectBoardResponse,
    summary="Select and persist a verified target board into vega-project.json",
)
async def select_project_board(
    payload: SelectProjectBoardRequest,
    service: BoardService = Depends(get_board_service),
) -> SelectProjectBoardResponse:
    try:
        return service.select_project_board(payload.project_dir, payload.board_id)
    except BoardServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/compatibility",
    response_model=BoardCompatibilityReport,
    summary="Validate compatibility of a registered board against configured SDK",
)
async def validate_board_compatibility(
    payload: ValidateBoardCompatibilityRequest,
    service: BoardService = Depends(get_board_service),
) -> BoardCompatibilityReport:
    try:
        board = service.get_board_or_raise(payload.board_id)
        return service.validate_compatibility(board)
    except BoardServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/{board_id}",
    response_model=BoardProfile,
    summary="Retrieve hardware and build profile details by board ID",
)
async def get_board_detail(
    board_id: str,
    service: BoardService = Depends(get_board_service),
) -> BoardProfile:
    try:
        return service.get_board_or_raise(board_id)
    except BoardServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
