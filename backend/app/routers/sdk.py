"""Phase 6 VEGA SDK configuration, discovery, and SDK Doctor router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.models.sdk import (
    SdkConfigStateResponse,
    SdkConfigUpdateRequest,
    SdkDiagnosticsRunRequest,
    SdkDiscoverRequest,
    SdkDiscoveryResult,
    SdkDoctorReport,
)
from app.services.sdk_service import SdkService, SdkServiceError, get_sdk_service

router = APIRouter(prefix="/api/sdk", tags=["sdk"])


@router.get(
    "/config",
    response_model=SdkConfigStateResponse,
    summary="Get persisted VEGA SDK & toolchain configuration",
)
async def get_sdk_config(
    service: SdkService = Depends(get_sdk_service),
) -> SdkConfigStateResponse:
    return service.get_config_state()


@router.put(
    "/config",
    response_model=SdkConfigStateResponse,
    summary="Update and persist VEGA SDK configuration",
)
async def update_sdk_config(
    payload: SdkConfigUpdateRequest,
    service: SdkService = Depends(get_sdk_service),
) -> SdkConfigStateResponse:
    try:
        return service.update_config(payload)
    except SdkServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post(
    "/config/reset",
    response_model=SdkConfigStateResponse,
    summary="Reset VEGA SDK configuration to discovered defaults",
)
async def reset_sdk_config(
    service: SdkService = Depends(get_sdk_service),
) -> SdkConfigStateResponse:
    return service.reset_config()


@router.post(
    "/discover",
    response_model=SdkDiscoveryResult,
    summary="Discover VEGA SDK, toolchain, compiler, Make, Python, and uploader",
)
async def discover_sdk(
    payload: SdkDiscoverRequest | None = None,
    service: SdkService = Depends(get_sdk_service),
) -> SdkDiscoveryResult:
    apply_cfg = payload.apply_to_config if payload else False
    try:
        return service.discover_environment(apply_to_config=apply_cfg)
    except SdkServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get(
    "/diagnostics",
    response_model=SdkDoctorReport,
    summary="Get latest SDK Doctor diagnostics or baseline unverified checklist",
)
async def get_sdk_diagnostics(
    service: SdkService = Depends(get_sdk_service),
) -> SdkDoctorReport:
    return service.get_diagnostics_state()


@router.post(
    "/diagnostics/run",
    response_model=SdkDoctorReport,
    summary="Run SDK Doctor checks safely across SDK, toolchain, build, and upload prerequisites",
)
async def run_sdk_diagnostics(
    payload: SdkDiagnosticsRunRequest | None = None,
    service: SdkService = Depends(get_sdk_service),
) -> SdkDoctorReport:
    try:
        override = payload.config_override if payload else None
        return service.run_diagnostics(config_override=override)
    except SdkServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
