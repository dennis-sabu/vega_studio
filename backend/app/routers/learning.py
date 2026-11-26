"""Phase 16 Examples, Local Documentation & Guided Learning router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.learning import (
    CreateProjectFromExampleRequest,
    DocCatalogResponse,
    DocPageDetailResponse,
    DocSearchResponse,
    ExampleCatalogResponse,
    ExampleDetailResponse,
    ExampleFileContentResponse,
    ExampleValidateRequest,
    ExampleValidationResponse,
)
from app.models.project import WorkspaceSummary
from app.services.learning_service import (
    LearningService,
    LearningServiceError,
    get_learning_service,
)

router = APIRouter(prefix="/api", tags=["learning"])


def _to_http(exc: LearningServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/examples", response_model=ExampleCatalogResponse)
async def list_examples(
    category: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    board_id: Optional[str] = Query(default=None),
    service: LearningService = Depends(get_learning_service),
) -> ExampleCatalogResponse:
    try:
        return service.list_examples(category=category, q=q, board_id=board_id)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/examples/create-project", response_model=WorkspaceSummary)
async def create_project_from_example(
    req: CreateProjectFromExampleRequest,
    service: LearningService = Depends(get_learning_service),
) -> WorkspaceSummary:
    try:
        return service.create_project_from_example(req)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/examples/{example_id}", response_model=ExampleDetailResponse)
async def get_example_detail(
    example_id: str,
    service: LearningService = Depends(get_learning_service),
) -> ExampleDetailResponse:
    try:
        return service.get_example_detail(example_id)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/examples/{example_id}/files", response_model=ExampleFileContentResponse)
async def get_example_file(
    example_id: str,
    path: str = Query(..., min_length=1),
    service: LearningService = Depends(get_learning_service),
) -> ExampleFileContentResponse:
    try:
        return service.get_example_file(example_id, path)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/examples/{example_id}/validate", response_model=ExampleValidationResponse)
async def validate_example(
    example_id: str,
    req: ExampleValidateRequest,
    service: LearningService = Depends(get_learning_service),
) -> ExampleValidationResponse:
    try:
        return service.validate_example(example_id, req)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/docs", response_model=DocCatalogResponse)
async def list_docs(
    category: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    service: LearningService = Depends(get_learning_service),
) -> DocCatalogResponse:
    try:
        return service.list_docs(category=category, q=q)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/docs/search", response_model=DocSearchResponse)
async def search_docs(
    q: str = Query(default=""),
    category: Optional[str] = Query(default=None),
    service: LearningService = Depends(get_learning_service),
) -> DocSearchResponse:
    try:
        return service.search_docs(q, category=category)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/docs/{slug}", response_model=DocPageDetailResponse)
async def get_doc_detail(
    slug: str,
    service: LearningService = Depends(get_learning_service),
) -> DocPageDetailResponse:
    try:
        return service.get_doc_detail(slug)
    except LearningServiceError as exc:
        raise _to_http(exc) from exc
