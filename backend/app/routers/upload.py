"""Phase 9 Firmware Upload System router (REST + WebSocket output streaming)."""
from __future__ import annotations

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.models.upload import (
    DeviceListResponse,
    UploadHistoryResponse,
    UploadPreflightRequest,
    UploadPreflightResponse,
    UploadRequest,
    UploadStateResponse,
    UploadSummary,
)
from app.services.upload_service import (
    UploadService,
    UploadServiceError,
    get_upload_service,
)

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.get(
    "/devices",
    response_model=DeviceListResponse,
    summary="Discover connected serial/USB-UART devices safely without hardcoded ports",
)
async def list_upload_devices(
    service: UploadService = Depends(get_upload_service),
) -> DeviceListResponse:
    return service.discover_devices()


@router.post(
    "/preflight",
    response_model=UploadPreflightResponse,
    summary="Validate upload prerequisites, target board, artifacts, uploader contract, and serial port",
)
async def run_upload_preflight(
    payload: UploadPreflightRequest,
    service: UploadService = Depends(get_upload_service),
) -> UploadPreflightResponse:
    try:
        return service.preflight(payload)
    except UploadServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/start",
    response_model=UploadSummary,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Initiate firmware upload cleanly after preflight validation",
)
async def start_firmware_upload(
    payload: UploadRequest,
    service: UploadService = Depends(get_upload_service),
) -> UploadSummary:
    try:
        return service.start_upload(payload)
    except UploadServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/state",
    response_model=UploadStateResponse,
    summary="Retrieve active or latest upload state and buffered logs",
)
async def get_latest_upload_state(
    service: UploadService = Depends(get_upload_service),
) -> UploadStateResponse:
    return service.get_upload_state()


@router.get(
    "/history",
    response_model=UploadHistoryResponse,
    summary="Retrieve bounded session firmware upload history",
)
async def get_upload_history(
    service: UploadService = Depends(get_upload_service),
) -> UploadHistoryResponse:
    return service.list_history()


@router.delete(
    "/history",
    response_model=UploadHistoryResponse,
    summary="Clear completed upload history from current session",
)
async def clear_upload_history(
    service: UploadService = Depends(get_upload_service),
) -> UploadHistoryResponse:
    return service.clear_history()


@router.post(
    "/output/clear",
    response_model=UploadStateResponse,
    summary="Clear displayed console output for the latest upload",
)
async def clear_upload_output(
    service: UploadService = Depends(get_upload_service),
) -> UploadStateResponse:
    return service.clear_output()


@router.post(
    "/cancel",
    response_model=UploadSummary,
    summary="Cancel the currently active firmware upload process",
)
async def cancel_active_upload(
    service: UploadService = Depends(get_upload_service),
) -> UploadSummary:
    try:
        return service.cancel_upload(None)
    except UploadServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/{upload_id}/cancel",
    response_model=UploadSummary,
    summary="Cancel a specific running firmware upload by ID",
)
async def cancel_upload_by_id(
    upload_id: str,
    service: UploadService = Depends(get_upload_service),
) -> UploadSummary:
    try:
        return service.cancel_upload(upload_id)
    except UploadServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/{upload_id}",
    response_model=UploadStateResponse,
    summary="Retrieve state and logs for a specific upload identifier",
)
async def get_upload_by_id(
    upload_id: str,
    service: UploadService = Depends(get_upload_service),
) -> UploadStateResponse:
    try:
        return service.get_upload_state(upload_id)
    except UploadServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.websocket("/ws/{upload_id}")
async def stream_upload_output(
    websocket: WebSocket,
    upload_id: str,
    service: UploadService = Depends(get_upload_service),
) -> None:
    """Stream real-time upload log lines and progress events over local WebSocket."""
    try:
        record = service.get_upload_record(upload_id)
    except UploadServiceError as exc:
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

    last_seq = snap_logs[-1].seq if snap_logs else 0

    try:
        await websocket.send_json(
            {
                "type": "snapshot",
                "upload": snap_sum.model_dump(),
                "logs": [item.model_dump() for item in snap_logs],
            }
        )

        if snap_sum.status != "running":
            await websocket.send_json(
                {"type": "completed", "upload": snap_sum.model_dump()}
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
        # Disconnecting UI socket never interrupts an active upload process.
        pass
    finally:
        with record.lock:
            record.subscribers.discard(sub_entry)
