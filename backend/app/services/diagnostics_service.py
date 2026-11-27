"""VEGA Studio Backend – Rotating redacted logging and safe diagnostics bundle export."""
from __future__ import annotations

import logging
import os
import platform
import re
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.config import Settings, settings
from app.models.health import BackendInfo, DiagnosticsExportResponse, PlatformInfo
from app.services.ai_credentials import scrub_ai_secrets
from app.services.ai_service import get_ai_service
from app.services.board_service import BoardService
from app.services.git_service import get_git_service
from app.services.github_service import get_github_service
from app.services.opencode_service import get_opencode_service
from app.services.project_service import ProjectService
from app.services.sdk_service import SdkService

_MAX_LOG_BYTES = 1_500_000
_LOG_BACKUPS = 3
_MAX_EXPORT_LOG_LINES = 150

_QUERY_OR_ENV_SECRET_RE = re.compile(
    r"(?i)\b(token|access_token|refresh_token|api_key|apikey|secret|password|passwd|client_secret)\s*=\s*([^\s&\"',;]{4,})"
)

_EXCLUDED_DIAGNOSTIC_ITEMS = [
    "API keys and credentials stored in OS Credential Store or session memory",
    "Environment files (.env, .env.*) and private SSH/PEM keys (.pem, .key, id_rsa, id_ed25519)",
    "Source code contents, uncommitted diffs, and project data files",
    "VEGA Assistant chat transcripts, prompts, and attachments",
    "GitHub authentication tokens and embedded URL credentials",
]


def _collect_known_secrets(*, include_os_store: bool = False) -> tuple[str, ...]:
    """Safely retrieve loaded AI secrets for scrubbing without failing or stalling log paths."""
    try:
        creds = get_ai_service()._credentials
        return tuple(
            creds.get_all_known_secrets()
            if include_os_store
            else creds.get_session_secrets()
        )
    except Exception:
        return ()


def redact_diagnostics_text(
    text: str, extra_secrets: Iterable[str] = ()
) -> str:
    """Scrub secret keys, Bearer headers, URL credentials, and query/env tokens."""
    if not text:
        return text
    cleaned = scrub_ai_secrets(text, extra_secrets)
    cleaned = _QUERY_OR_ENV_SECRET_RE.sub(r"\1=[REDACTED]", cleaned)
    return cleaned


class RedactingLogFilter(logging.Filter):
    """Logging filter that scrubs credential shapes and loaded secrets before output."""

    def filter(self, record: logging.LogRecord) -> bool:
        extra = _collect_known_secrets()
        try:
            rendered = record.getMessage()
        except Exception:
            rendered = str(record.msg)
        cleaned = redact_diagnostics_text(rendered, extra)
        record.msg = cleaned
        record.args = ()
        if record.exc_text:
            record.exc_text = redact_diagnostics_text(record.exc_text, extra)
        return True


def configure_backend_logging(
    app_settings: Optional[Settings] = None,
) -> Optional[Path]:
    """Configure console + rotating redacted file logging under `<data_dir>/logs/backend.log`."""
    cfg = app_settings or settings
    level = getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    redact_filter = RedactingLogFilter()

    if not any(
        isinstance(h, logging.StreamHandler)
        and not isinstance(h, logging.FileHandler)
        for h in root.handlers
    ):
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(fmt)
        root.addHandler(stream_handler)

    for handler in root.handlers:
        if not any(isinstance(f, RedactingLogFilter) for f in handler.filters):
            handler.addFilter(redact_filter)

    try:
        log_dir = cfg.get_data_dir() / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = (log_dir / "backend.log").resolve()
    except OSError:
        return None

    for existing in list(root.handlers):
        if getattr(existing, "_vega_backend_rotating", False):
            existing_path = Path(getattr(existing, "baseFilename", "")).resolve()
            if existing_path == log_path:
                return log_path
            root.removeHandler(existing)
            try:
                existing.close()
            except OSError:
                pass

    try:
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=_MAX_LOG_BYTES,
            backupCount=_LOG_BACKUPS,
            encoding="utf-8",
        )
        file_handler._vega_backend_rotating = True  # type: ignore[attr-defined]
        file_handler.setFormatter(fmt)
        file_handler.addFilter(redact_filter)
        root.addHandler(file_handler)
        return log_path
    except OSError:
        return None


def _read_redacted_log_tail(
    cfg: Settings, extra_secrets: tuple[str, ...]
) -> List[str]:
    try:
        log_path = cfg.get_data_dir() / "logs" / "backend.log"
        if not log_path.exists() or not log_path.is_file():
            return []
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [
        redact_diagnostics_text(line, extra_secrets)
        for line in lines[-_MAX_EXPORT_LOG_LINES:]
    ]


def build_safe_diagnostics_bundle(
    raw_project_dir: Optional[str] = None,
    app_settings: Optional[Settings] = None,
) -> DiagnosticsExportResponse:
    """Assemble a strictly non-secret, redacted diagnostics bundle for troubleshooting."""
    cfg = app_settings or settings
    extra_secrets = _collect_known_secrets(include_os_store=True)

    def _safe_err(exc: Exception) -> Dict[str, Any]:
        return {"error": redact_diagnostics_text(str(exc), extra_secrets)}

    # Workspace non-secret summary
    effective_project_dir: Optional[str] = raw_project_dir
    workspace_info: Dict[str, Any] = {"active": False}
    try:
        proj_svc = ProjectService(cfg)
        if effective_project_dir and effective_project_dir.strip():
            summary = proj_svc.load_project(effective_project_dir)
        else:
            summary = proj_svc.get_workspace_state().active_project
        if summary is not None:
            effective_project_dir = summary.project_dir
            workspace_info = {
                "active": True,
                "project_name": summary.project.name,
                "structure_valid": summary.structure_valid,
                "target": summary.project.target.model_dump(),
                "warnings_count": len(summary.warnings),
            }
    except Exception as exc:
        workspace_info = {"active": False, **_safe_err(exc)}

    # SDK non-secret summary
    sdk_info: Dict[str, Any]
    try:
        sdk_svc = SdkService(cfg)
        sdk_cfg = sdk_svc.get_config_state()
        sdk_rep = sdk_svc.get_diagnostics_state()
        sdk_info = {
            "is_customized": sdk_cfg.is_customized,
            "cross_compile_prefix": sdk_cfg.config.cross_compile_prefix,
            "target_arch": sdk_cfg.config.target_arch,
            "target_machine": sdk_cfg.config.target_machine,
            "overall_status": sdk_rep.overall_status,
            "summary": sdk_rep.summary.model_dump(),
            "checks": [
                {
                    "id": c.id,
                    "label": c.label,
                    "category": c.category,
                    "status": c.status,
                }
                for c in sdk_rep.checks
            ],
        }
    except Exception as exc:
        sdk_info = _safe_err(exc)

    # Board registry & active project board status
    boards_info: Dict[str, Any]
    try:
        board_svc = BoardService(cfg)
        board_list = board_svc.list_boards()
        boards_info = {
            "registered_count": len(board_list.boards),
            "default_board_id": board_list.default_board_id,
        }
        if effective_project_dir:
            status = board_svc.get_project_board_status(effective_project_dir)
            boards_info["selected_board_id"] = status.selected_board_id
            boards_info["board_supported"] = status.board_supported
    except Exception as exc:
        boards_info = _safe_err(exc)

    # Git readiness summary (never includes credentials)
    git_info: Dict[str, Any]
    try:
        g_info = get_git_service().get_info(effective_project_dir)
        git_info = {
            "git_available": g_info.git_available,
            "git_version": g_info.git_version,
            "is_repository": g_info.is_repository,
            "has_parent_repo": g_info.has_parent_repo,
        }
    except Exception as exc:
        git_info = _safe_err(exc)

    # GitHub CLI non-secret readiness (never tokens or URLs with embedded creds)
    github_info: Dict[str, Any]
    try:
        gh_status = get_github_service().get_status(effective_project_dir)
        github_info = {
            "gh_available": gh_status.cli.gh_available,
            "gh_version": gh_status.cli.gh_version,
            "authenticated": gh_status.cli.authenticated,
            "remotes_count": len(gh_status.remotes),
        }
    except Exception as exc:
        github_info = _safe_err(exc)

    # VEGA AI (OpenCode CLI) readiness (paths & errors scrubbed)
    opencode_info: Dict[str, Any]
    try:
        oc_cfg = get_opencode_service().get_config_state()
        opencode_info = {
            "available": oc_cfg.info.available,
            "version": oc_cfg.info.version,
            "server_running": oc_cfg.info.server_running,
            "executable_source": oc_cfg.info.executable_source,
            "default_permission_mode": oc_cfg.config.default_permission_mode,
        }
    except Exception as exc:
        opencode_info = _safe_err(exc)

    # AI Assistant non-secret readiness (never raw keys or chat data)
    ai_info: Dict[str, Any]
    try:
        ai_state = get_ai_service().get_providers_state()
        ai_info = {
            "active_provider": ai_state.config.active_provider,
            "storage_backend": ai_state.storage.backend_name,
            "os_storage_available": ai_state.storage.os_storage_available,
            "providers": [
                {
                    "id": p.id,
                    "configured": p.credential.configured,
                    "source": p.credential.source,
                    "key_hint": p.credential.key_hint,
                    "model": p.model,
                    "base_url": redact_diagnostics_text(
                        p.effective_base_url or "", extra_secrets
                    )
                    or None,
                }
                for p in ai_state.providers
            ],
        }
    except Exception as exc:
        ai_info = _safe_err(exc)

    return DiagnosticsExportResponse(
        schema_version="1",
        generated_at=datetime.now(timezone.utc).isoformat(),
        redaction_applied=True,
        excluded_items=list(_EXCLUDED_DIAGNOSTIC_ITEMS),
        backend=BackendInfo(
            service=cfg.APP_NAME,
            version=cfg.APP_VERSION,
            env=cfg.APP_ENV,
            host=cfg.HOST,
            port=cfg.PORT,
        ),
        platform=PlatformInfo(
            python_version=sys.version.split()[0],
            os=platform.system(),
            os_version=platform.version(),
            architecture=platform.machine(),
        ),
        workspace=workspace_info,
        sdk=sdk_info,
        boards=boards_info,
        git=git_info,
        github=github_info,
        opencode=opencode_info,
        ai=ai_info,
        recent_backend_logs=_read_redacted_log_tail(cfg, extra_secrets),
    )
