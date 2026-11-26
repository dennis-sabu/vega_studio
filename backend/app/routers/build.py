"""Phase 7 Firmware Build System router (REST + WebSocket output streaming)."""
from __future__ import annotations

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.config import is_allowed_ws_origin
from app.models.build import (
    BuildHistoryResponse,
    BuildRequest,
    BuildStateResponse,
    BuildSummary,
)
from app.services.build_service import (
    BuildService,
    BuildServiceError,
    get_build_service,
)

router = APIRouter(prefix="/api/build", tags=["build"])


@router.post(
    "/start",
    response_model=BuildSummary,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start a firmware build or rebuild for the active VEGA project",
)
async def start_build(
    payload: BuildRequest,
    service: BuildService = Depends(get_build_service),
) -> BuildSummary:
    try:
        return service.start_build(payload)
    except BuildServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/clean",
    response_model=BuildSummary,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Execute Makefile clean target for the active VEGA project",
)
async def clean_build(
    payload: BuildRequest,
    service: BuildService = Depends(get_build_service),
) -> BuildSummary:
    clean_req = payload.model_copy(update={"operation": "clean"})
    try:
        return service.start_build(clean_req)
    except BuildServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/state",
    response_model=BuildStateResponse,
    summary="Retrieve active or latest build state, logs, and parsed diagnostics",
)
async def get_latest_build_state(
    service: BuildService = Depends(get_build_service),
) -> BuildStateResponse:
    return service.get_build_state()


@router.get(
    "/history",
    response_model=BuildHistoryResponse,
    summary="Retrieve bounded session build history",
)
async def get_build_history(
    service: BuildService = Depends(get_build_service),
) -> BuildHistoryResponse:
    return service.list_history()


@router.delete(
    "/history",
    response_model=BuildHistoryResponse,
    summary="Clear completed build history from current session",
)
async def clear_build_history(
    service: BuildService = Depends(get_build_service),
) -> BuildHistoryResponse:
    return service.clear_history()


@router.post(
    "/output/clear",
    response_model=BuildStateResponse,
    summary="Clear displayed console output and diagnostics for the latest build",
)
async def clear_build_output(
    service: BuildService = Depends(get_build_service),
) -> BuildStateResponse:
    return service.clear_output()


@router.post(
    "/cancel",
    response_model=BuildSummary,
    summary="Cancel the currently active build process",
)
async def cancel_active_build(
    service: BuildService = Depends(get_build_service),
) -> BuildSummary:
    try:
        return service.cancel_build(None)
    except BuildServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/{build_id}/cancel",
    response_model=BuildSummary,
    summary="Cancel a specific running build by ID",
)
async def cancel_build_by_id(
    build_id: str,
    service: BuildService = Depends(get_build_service),
) -> BuildSummary:
    try:
        return service.cancel_build(build_id)
    except BuildServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/{build_id}",
    response_model=BuildStateResponse,
    summary="Retrieve state and logs for a specific build identifier",
)
async def get_build_by_id(
    build_id: str,
    service: BuildService = Depends(get_build_service),
) -> BuildStateResponse:
    try:
        return service.get_build_state(build_id)
    except BuildServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.websocket("/ws/{build_id}")
async def stream_build_output(
    websocket: WebSocket,
    build_id: str,
    service: BuildService = Depends(get_build_service),
) -> None:
    """Stream real-time build log lines and diagnostics over local WebSocket."""
    if not is_allowed_ws_origin(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    try:
        record = service.get_build_record(build_id)
    except BuildServiceError as exc:
        await websocket.close(code=4004, reason=exc.message[:120])
        return

    await websocket.accept()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=10000)
    sub_entry = (queue, loop)

    with record.lock:
        record.subscribers.add(sub_entry)
        snap_sum = record.summary.model_copy(deep=True)
        snap_logs = list(record.logs)
        snap_diags = list(record.diagnostics)

    last_seq = snap_logs[-1].seq if snap_logs else 0

    try:
        await websocket.send_json(
            {
                "type": "snapshot",
                "build": snap_sum.model_dump(),
                "logs": [item.model_dump() for item in snap_logs],
                "diagnostics": [item.model_dump() for item in snap_diags],
            }
        )

        if snap_sum.status != "running":
            await websocket.send_json(
                {"type": "completed", "build": snap_sum.model_dump()}
            )
            await websocket.close()
            return

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue

            if event.get("type") == "log":
                line_obj = event.get("line") or {}
                seq = line_obj.get("seq", 0)
                if seq <= last_seq:
                    continue
                last_seq = seq

            await websocket.send_json(event)

            if event.get("type") == "completed":
                await websocket.close()
                break
    except WebSocketDisconnect:
        # Disconnecting the WebSocket must never cancel or interrupt the build.
        pass
    finally:
        with record.lock:
            record.subscribers.discard(sub_entry)
