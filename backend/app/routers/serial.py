"""Phase 10 Serial Monitor router (REST + WebSocket streaming)."""
from __future__ import annotations

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.config import is_allowed_ws_origin
from app.models.serial import (
    SerialConnectRequest,
    SerialSendRequest,
    SerialStateResponse,
)
from app.models.upload import DeviceListResponse
from app.services.serial_service import (
    SerialService,
    SerialServiceError,
    get_serial_service,
)

router = APIRouter(prefix="/api/serial", tags=["serial"])


@router.get(
    "/devices",
    response_model=DeviceListResponse,
    summary="Discover connected serial/USB-UART devices",
)
async def list_serial_devices(
    service: SerialService = Depends(get_serial_service),
) -> DeviceListResponse:
    return service.discover_devices()


@router.get(
    "/state",
    response_model=SerialStateResponse,
    summary="Retrieve current serial monitor state and buffered logs",
)
async def get_serial_state(
    service: SerialService = Depends(get_serial_service),
) -> SerialStateResponse:
    return service.get_state()


@router.post(
    "/connect",
    response_model=SerialStateResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Open a serial port and begin streaming",
)
async def connect_serial(
    payload: SerialConnectRequest,
    service: SerialService = Depends(get_serial_service),
) -> SerialStateResponse:
    try:
        return service.connect(payload)
    except SerialServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/disconnect",
    response_model=SerialStateResponse,
    summary="Close the active serial port",
)
async def disconnect_serial(
    service: SerialService = Depends(get_serial_service),
) -> SerialStateResponse:
    try:
        return service.disconnect()
    except SerialServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/send",
    response_model=SerialStateResponse,
    summary="Transmit data over the open serial port",
)
async def send_serial_data(
    payload: SerialSendRequest,
    service: SerialService = Depends(get_serial_service),
) -> SerialStateResponse:
    try:
        return service.send(payload)
    except SerialServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/output/clear",
    response_model=SerialStateResponse,
    summary="Clear buffered serial log output",
)
async def clear_serial_output(
    service: SerialService = Depends(get_serial_service),
) -> SerialStateResponse:
    return service.clear_output()


@router.websocket("/ws")
async def stream_serial_output(
    websocket: WebSocket,
    service: SerialService = Depends(get_serial_service),
) -> None:
    """Stream real-time serial log lines and status events over WebSocket."""
    if not is_allowed_ws_origin(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=10000)

    service.add_subscriber(queue, loop)

    # Send snapshot of current state + buffered logs
    state = service.get_state(include_logs=True)
    snap_logs = list(state.logs)
    last_seq = snap_logs[-1].seq if snap_logs else 0
    state_summary = state.model_copy(update={"logs": []})

    try:
        await websocket.send_json(
            {
                "type": "snapshot",
                "state": state_summary.model_dump(),
                "logs": [line.model_dump() for line in snap_logs],
            }
        )
    except Exception:
        service.remove_subscriber(queue, loop)
        return

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue

            ev_type = event.get("type")
            if ev_type == "log":
                line_obj = event.get("line") or {}
                seq = line_obj.get("seq", 0)
                if seq <= last_seq:
                    continue
                last_seq = seq
            elif ev_type == "cleared":
                last_seq = 0

            await websocket.send_json(event)

    except WebSocketDisconnect:
        # Disconnecting the UI socket must NOT close the serial port.
        pass
    except Exception:
        pass
    finally:
        service.remove_subscriber(queue, loop)
