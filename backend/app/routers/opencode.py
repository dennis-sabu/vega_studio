"""Phase 14 Native OpenCode CLI Integration router (REST + WebSocket)."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import ValidationError

from app.config import is_allowed_ws_origin
from app.models.opencode import (
    OpenCodeConfigStateResponse,
    OpenCodeConfigUpdateRequest,
    OpenCodeInfoResponse,
    OpenCodePermissionReplyRequest,
    OpenCodeSessionCreateRequest,
    OpenCodeSessionDetailResponse,
    OpenCodeSessionListResponse,
    OpenCodeSessionPromptRequest,
    OpenCodeSessionSummary,
)
from app.services.opencode_service import (
    OpenCodeService,
    OpenCodeServiceError,
    get_opencode_service,
)

router = APIRouter(prefix="/api/opencode", tags=["opencode"])

_MAX_WS_FRAME_CHARS = 65_536


@router.get(
    "/info",
    response_model=OpenCodeInfoResponse,
    summary="Detect OpenCode CLI installation, version, server status, and capabilities",
)
async def get_opencode_info(
    models: bool = Query(default=False),
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeInfoResponse:
    return service.get_info(query_models=models)


@router.get(
    "/config",
    response_model=OpenCodeConfigStateResponse,
    summary="Retrieve persisted non-secret OpenCode CLI configuration",
)
async def get_opencode_config(
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeConfigStateResponse:
    return service.get_config_state()


@router.put(
    "/config",
    response_model=OpenCodeConfigStateResponse,
    summary="Update and validate OpenCode CLI executable and safety preferences",
)
async def update_opencode_config(
    payload: OpenCodeConfigUpdateRequest,
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeConfigStateResponse:
    try:
        return service.update_config(payload)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/config/reset",
    response_model=OpenCodeConfigStateResponse,
    summary="Reset OpenCode CLI configuration to discovered defaults",
)
async def reset_opencode_config(
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeConfigStateResponse:
    return service.reset_config()


@router.get(
    "/sessions",
    response_model=OpenCodeSessionListResponse,
    summary="List OpenCode agent sessions with workspace associations",
)
async def list_opencode_sessions(
    project_dir: Optional[str] = Query(default=None),
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionListResponse:
    return service.list_sessions(project_dir=project_dir)


@router.post(
    "/sessions",
    response_model=OpenCodeSessionDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace-bound OpenCode agent session",
)
async def create_opencode_session(
    payload: OpenCodeSessionCreateRequest,
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionDetailResponse:
    try:
        return service.create_session(payload)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/sessions/{session_id}",
    response_model=OpenCodeSessionDetailResponse,
    summary="Inspect an OpenCode session, messages, and pending permission requests",
)
async def get_opencode_session(
    session_id: str,
    project_dir: Optional[str] = Query(default=None),
    sync: bool = Query(default=True),
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionDetailResponse:
    try:
        return service.get_session_detail(
            session_id,
            expected_project_dir=project_dir,
            sync_from_server=sync,
        )
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/prompt",
    response_model=OpenCodeSessionDetailResponse,
    summary="Send a prompt with optional explicit workspace context to an OpenCode session",
)
async def prompt_opencode_session(
    session_id: str,
    payload: OpenCodeSessionPromptRequest,
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionDetailResponse:
    try:
        return service.send_prompt(session_id, payload)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/interrupt",
    response_model=OpenCodeSessionSummary,
    summary="Interrupt an active OpenCode agent execution",
)
async def interrupt_opencode_session(
    session_id: str,
    project_dir: Optional[str] = Query(default=None),
    payload: Optional[Dict[str, Optional[str]]] = Body(default=None),
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionSummary:
    effective_project = (
        payload.get("project_dir")
        if isinstance(payload, dict) and payload.get("project_dir")
        else project_dir
    )
    try:
        return service.interrupt_session(session_id, project_dir=effective_project)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/permissions/{request_id}",
    response_model=OpenCodeSessionDetailResponse,
    summary="Approve or reject a pending OpenCode tool permission request",
)
async def reply_opencode_permission(
    session_id: str,
    request_id: str,
    payload: OpenCodePermissionReplyRequest,
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionDetailResponse:
    try:
        return service.reply_permission(session_id, request_id, payload)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.delete(
    "/sessions/{session_id}",
    response_model=OpenCodeSessionSummary,
    summary="Terminate and close a workspace-bound OpenCode session",
)
async def terminate_opencode_session(
    session_id: str,
    project_dir: Optional[str] = Query(default=None),
    service: OpenCodeService = Depends(get_opencode_service),
) -> OpenCodeSessionSummary:
    try:
        return service.terminate_session(session_id, project_dir=project_dir)
    except OpenCodeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.websocket("/ws/{session_id}")
async def stream_opencode_session(
    websocket: WebSocket,
    session_id: str,
    project_dir: Optional[str] = Query(default=None),
    service: OpenCodeService = Depends(get_opencode_service),
) -> None:
    """Stream live OpenCode session status, assistant messages, tools, and permission prompts."""
    if not is_allowed_ws_origin(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    try:
        service.get_session_detail(
            session_id,
            expected_project_dir=project_dir,
            sync_from_server=False,
        )
    except OpenCodeServiceError as exc:
        await websocket.close(code=4004, reason=exc.message[:120])
        return

    await websocket.accept()
    loop = asyncio.get_running_loop()
    queue, snapshot = service.register_ws_subscriber(session_id, loop)
    sub_entry = (queue, loop)
    send_lock = asyncio.Lock()

    async def safe_send(payload: Dict[str, Any]) -> None:
        cleaned = {k: v for k, v in payload.items() if k != "_critical"}
        async with send_lock:
            await websocket.send_json(cleaned)

    try:
        await safe_send(snapshot)

        async def _sender_loop() -> None:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    await safe_send({"type": "ping"})
                    continue
                await safe_send(event)

        async def _receiver_loop() -> None:
            while True:
                raw_text = await websocket.receive_text()
                if len(raw_text) > _MAX_WS_FRAME_CHARS:
                    await safe_send(
                        {"type": "error", "message": "WebSocket frame exceeds size limit."}
                    )
                    continue
                try:
                    msg = json.loads(raw_text)
                except json.JSONDecodeError:
                    await safe_send(
                        {"type": "error", "message": "Invalid JSON WebSocket payload."}
                    )
                    continue
                if not isinstance(msg, dict):
                    continue
                mtype = msg.get("type")
                if mtype == "ping":
                    await safe_send({"type": "pong"})
                elif mtype == "interrupt":
                    try:
                        await asyncio.to_thread(
                            service.interrupt_session, session_id, project_dir=project_dir
                        )
                    except OpenCodeServiceError as exc:
                        await safe_send({"type": "error", "message": exc.message})
                elif mtype == "permission_reply":
                    try:
                        req_id = str(msg.get("request_id") or "")
                        parsed = OpenCodePermissionReplyRequest.model_validate(
                            {
                                "project_dir": project_dir,
                                "decision": msg.get("decision"),
                                "message": msg.get("message"),
                            }
                        )
                        await asyncio.to_thread(
                            service.reply_permission, session_id, req_id, parsed
                        )
                    except (ValidationError, OpenCodeServiceError) as exc:
                        err = exc.message if isinstance(exc, OpenCodeServiceError) else str(exc)
                        await safe_send({"type": "error", "message": err})

        sender_task = asyncio.create_task(_sender_loop())
        receiver_task = asyncio.create_task(_receiver_loop())
        try:
            done, pending = await asyncio.wait(
                {sender_task, receiver_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                if task.cancelled():
                    continue
                exc = task.exception()
                if exc is not None and not isinstance(
                    exc, (WebSocketDisconnect, asyncio.CancelledError)
                ):
                    raise exc
        finally:
            for task in (sender_task, receiver_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(sender_task, receiver_task, return_exceptions=True)
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError, OSError):
        pass
    finally:
        service.unregister_ws_subscriber(session_id, sub_entry)
