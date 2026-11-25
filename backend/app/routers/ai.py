"""Phase 15 Native VEGA AI Assistant router (REST + WebSocket streaming)."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import ValidationError

from app.models.ai import (
    AICodeApplyValidateRequest,
    AICodeApplyValidateResponse,
    AIConfigUpdateRequest,
    AIConnectionTestRequest,
    AIConnectionTestResponse,
    AIContextPreviewRequest,
    AIContextPreviewResponse,
    AIConversationCreateRequest,
    AIConversationDetailResponse,
    AIConversationListResponse,
    AIConversationUpdateRequest,
    AICredentialStatus,
    AICredentialUpdateRequest,
    AIProviderId,
    AIProvidersStateResponse,
    AISendMessageRequest,
)
from app.services.ai_service import AIService, AIServiceError, get_ai_service

router = APIRouter(prefix="/api/ai", tags=["ai"])

_MAX_WS_FRAME_CHARS = 65_536


def _to_http(exc: AIServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
    )


@router.get("/providers", response_model=AIProvidersStateResponse)
async def get_ai_providers(
    service: AIService = Depends(get_ai_service),
) -> AIProvidersStateResponse:
    return service.get_providers_state()


@router.put("/config", response_model=AIProvidersStateResponse)
async def update_ai_config(
    req: AIConfigUpdateRequest,
    service: AIService = Depends(get_ai_service),
) -> AIProvidersStateResponse:
    try:
        return service.update_config(req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/config/reset", response_model=AIProvidersStateResponse)
async def reset_ai_config(
    service: AIService = Depends(get_ai_service),
) -> AIProvidersStateResponse:
    return service.reset_config()


@router.put("/credentials/{provider_id}", response_model=AICredentialStatus)
async def set_ai_credential(
    provider_id: AIProviderId,
    req: AICredentialUpdateRequest,
    service: AIService = Depends(get_ai_service),
) -> AICredentialStatus:
    try:
        return service.set_credential(provider_id, req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.delete("/credentials/{provider_id}", response_model=AICredentialStatus)
async def delete_ai_credential(
    provider_id: AIProviderId,
    service: AIService = Depends(get_ai_service),
) -> AICredentialStatus:
    try:
        return service.delete_credential(provider_id)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/test-connection", response_model=AIConnectionTestResponse)
async def test_ai_connection(
    req: AIConnectionTestRequest,
    service: AIService = Depends(get_ai_service),
) -> AIConnectionTestResponse:
    try:
        return await service.test_connection(req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/conversations", response_model=AIConversationListResponse)
async def list_ai_conversations(
    project_dir: Optional[str] = Query(default=None),
    service: AIService = Depends(get_ai_service),
) -> AIConversationListResponse:
    return service.list_conversations(project_dir=project_dir)


@router.post(
    "/conversations",
    response_model=AIConversationDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_ai_conversation(
    req: AIConversationCreateRequest,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return service.create_conversation(req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.get("/conversations/{conversation_id}", response_model=AIConversationDetailResponse)
async def get_ai_conversation(
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return service.get_conversation(conversation_id)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.patch("/conversations/{conversation_id}", response_model=AIConversationDetailResponse)
async def update_ai_conversation(
    conversation_id: str,
    req: AIConversationUpdateRequest,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return service.update_conversation(conversation_id, req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/conversations/{conversation_id}/clear", response_model=AIConversationDetailResponse)
async def clear_ai_conversation(
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return await service.clear_conversation(conversation_id)
    except AIServiceError as exc:
        raise _to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/conversations/{conversation_id}")
async def delete_ai_conversation(
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> Dict[str, Any]:
    try:
        await service.delete_conversation(conversation_id)
        return {"deleted": True, "conversation_id": conversation_id}
    except AIServiceError as exc:
        raise _to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/conversations/{conversation_id}/messages", response_model=AIConversationDetailResponse)
async def send_ai_message(
    conversation_id: str,
    req: AISendMessageRequest,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return await service.send_message(conversation_id, req)
    except AIServiceError as exc:
        raise _to_http(exc) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/conversations/{conversation_id}/retry", response_model=AIConversationDetailResponse)
async def retry_ai_message(
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return await service.retry_last_message(conversation_id)
    except AIServiceError as exc:
        raise _to_http(exc) from exc


@router.post("/conversations/{conversation_id}/cancel", response_model=AIConversationDetailResponse)
async def cancel_ai_generation(
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> AIConversationDetailResponse:
    try:
        return await service.cancel_generation(conversation_id)
    except AIServiceError as exc:
        raise _to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/context/preview", response_model=AIContextPreviewResponse)
async def preview_ai_context(
    req: AIContextPreviewRequest,
    service: AIService = Depends(get_ai_service),
) -> AIContextPreviewResponse:
    return service.preview_context(req)


@router.post("/code/validate-apply", response_model=AICodeApplyValidateResponse)
async def validate_ai_code_apply(
    req: AICodeApplyValidateRequest,
    service: AIService = Depends(get_ai_service),
) -> AICodeApplyValidateResponse:
    return service.validate_code_apply(req)


@router.websocket("/ws/{conversation_id}")
async def ai_conversation_websocket(
    websocket: WebSocket,
    conversation_id: str,
    service: AIService = Depends(get_ai_service),
) -> None:
    try:
        detail, q = service.subscribe(conversation_id)
    except AIServiceError as exc:
        await websocket.close(code=4404 if exc.status_code == 404 else 4400)
        return

    await websocket.accept()
    try:
        snapshot = json.dumps({"type": "snapshot", "detail": detail.model_dump()})
        await websocket.send_text(snapshot)

        while True:
            try:
                evt = await asyncio.wait_for(q.get(), timeout=20.0)
                encoded = json.dumps(evt)
                if len(encoded) > _MAX_WS_FRAME_CHARS:
                    encoded = json.dumps(
                        {
                            "type": evt.get("type", "info"),
                            "conversation_id": conversation_id,
                            "truncated": True,
                        }
                    )
                await websocket.send_text(encoded)
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        pass
    finally:
        service.unsubscribe(conversation_id, q)
