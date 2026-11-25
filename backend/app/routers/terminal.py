"""Phase 11 Integrated Terminal router (REST + bidirectional WebSocket PTY stream)."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.models.terminal import (
    TerminalCloseResponse,
    TerminalResizeRequest,
    TerminalSessionCreateRequest,
    TerminalSessionListResponse,
    TerminalSessionStateResponse,
    TerminalSessionSummary,
    TerminalShellsResponse,
)
from app.services.terminal_service import (
    MAX_WS_SUBSCRIBER_QUEUE,
    TerminalService,
    TerminalServiceError,
    get_terminal_service,
)

router = APIRouter(prefix="/api/terminal", tags=["terminal"])

_MAX_WS_FRAME_CHARS = 262_144


@router.get(
    "/shells",
    response_model=TerminalShellsResponse,
    summary="Detect supported system shells and PTY capabilities",
)
async def list_terminal_shells(
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalShellsResponse:
    return service.discover_shells()


@router.get(
    "/sessions",
    response_model=TerminalSessionListResponse,
    summary="List active and retained IDE terminal sessions",
)
async def list_terminal_sessions(
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionListResponse:
    return service.list_sessions()


@router.post(
    "/sessions",
    response_model=TerminalSessionStateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Explicitly launch a new interactive PTY terminal session",
)
async def create_terminal_session(
    payload: TerminalSessionCreateRequest,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionStateResponse:
    try:
        return service.create_session(payload)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/sessions/{session_id}",
    response_model=TerminalSessionStateResponse,
    summary="Retrieve terminal session state and bounded buffered replay",
)
async def get_terminal_session(
    session_id: str,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionStateResponse:
    try:
        return service.get_session_state(session_id)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/resize",
    response_model=TerminalSessionSummary,
    summary="Resize active PTY rows and columns",
)
async def resize_terminal_session(
    session_id: str,
    payload: TerminalResizeRequest,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionSummary:
    try:
        return service.resize_session(session_id, payload)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/restart",
    response_model=TerminalSessionStateResponse,
    summary="Terminate current PTY (if running) and restart the shell session",
)
async def restart_terminal_session(
    session_id: str,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionStateResponse:
    try:
        return service.restart_session(session_id)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/sessions/{session_id}/clear",
    response_model=TerminalSessionSummary,
    summary="Clear buffered server replay output for a terminal session",
)
async def clear_terminal_replay(
    session_id: str,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalSessionSummary:
    try:
        return service.clear_replay(session_id)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.delete(
    "/sessions/{session_id}",
    response_model=TerminalCloseResponse,
    summary="Terminate and remove a managed terminal session",
)
async def close_terminal_session(
    session_id: str,
    service: TerminalService = Depends(get_terminal_service),
) -> TerminalCloseResponse:
    try:
        return service.close_session(session_id)
    except TerminalServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.websocket("/ws/{session_id}")
async def stream_terminal_session(
    websocket: WebSocket,
    session_id: str,
    service: TerminalService = Depends(get_terminal_service),
) -> None:
    """Bidirectional WebSocket channel carrying PTY output, input, resize, and lifecycle events."""
    try:
        record = service.get_session_record(session_id)
    except TerminalServiceError as exc:
        await websocket.close(code=4004, reason=exc.message[:120])
        return

    await websocket.accept()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(
        maxsize=MAX_WS_SUBSCRIBER_QUEUE
    )
    sub_entry = (queue, loop)

    with record.lock:
        record.subscribers.add(sub_entry)
        snap_session = record.summary.model_copy(deep=True)
        replay_text = record.get_replay_text()
        last_seq = record.seq_counter

    send_lock = asyncio.Lock()

    async def safe_send(payload: Dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    try:
        await safe_send(
            {
                "type": "snapshot",
                "session": snap_session.model_dump(),
                "replay": replay_text,
            }
        )

        async def _sender_loop() -> None:
            nonlocal last_seq
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    await safe_send({"type": "ping"})
                    continue

                ev_type = event.get("type")
                if ev_type == "output":
                    seq = int(event.get("seq") or 0)
                    if seq <= last_seq:
                        continue
                    last_seq = seq
                elif ev_type == "state" and event.get("reset"):
                    last_seq = 0

                await safe_send(event)

        async def _receiver_loop() -> None:
            while True:
                raw_text = await websocket.receive_text()
                if len(raw_text) > _MAX_WS_FRAME_CHARS:
                    await safe_send(
                        {
                            "type": "error",
                            "message": "Terminal WebSocket frame exceeds size limit.",
                        }
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
                    await safe_send(
                        {"type": "error", "message": "WebSocket payload must be a JSON object."}
                    )
                    continue

                msg_type = msg.get("type")
                if msg_type == "input":
                    data = msg.get("data")
                    if not isinstance(data, str):
                        await safe_send(
                            {"type": "error", "message": "Input event requires string 'data'."}
                        )
                        continue
                    try:
                        service.send_input(session_id, data)
                    except TerminalServiceError as exc:
                        await safe_send({"type": "error", "message": exc.message})

                elif msg_type == "resize":
                    try:
                        req = TerminalResizeRequest.model_validate(
                            {"cols": msg.get("cols"), "rows": msg.get("rows")}
                        )
                        service.resize_session(session_id, req)
                    except (ValidationError, TerminalServiceError) as exc:
                        err_msg = (
                            exc.message
                            if isinstance(exc, TerminalServiceError)
                            else "Invalid terminal dimensions."
                        )
                        await safe_send({"type": "error", "message": err_msg})

                elif msg_type == "ping":
                    await safe_send({"type": "pong"})

                else:
                    await safe_send(
                        {
                            "type": "error",
                            "message": f"Unsupported terminal WebSocket event '{msg_type}'.",
                        }
                    )

        sender_task = asyncio.create_task(_sender_loop())
        receiver_task = asyncio.create_task(_receiver_loop())
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
            if exc is not None and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                raise exc

    except (WebSocketDisconnect, asyncio.CancelledError):
        # WebSocket disconnection NEVER terminates a running PTY session.
        pass
    except Exception:
        pass
    finally:
        with record.lock:
            record.subscribers.discard(sub_entry)
