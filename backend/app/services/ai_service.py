"""VEGA Studio Backend – Phase 15 Native VEGA AI Assistant service (streaming, persistence, concurrency)."""
from __future__ import annotations

import asyncio
from collections import deque
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Callable, Deque, Dict, Iterator, List, Optional, Tuple

import httpx

from app.config import Settings, settings
from app.models.ai import (
    AICodeApplyValidateRequest,
    AICodeApplyValidateResponse,
    AIConfig,
    AIConfigUpdateRequest,
    AIConnectionTestRequest,
    AIConnectionTestResponse,
    AIContextAttachment,
    AIContextPreviewRequest,
    AIContextPreviewResponse,
    AIConversationCreateRequest,
    AIConversationDetailResponse,
    AIConversationListResponse,
    AIConversationSummary,
    AIConversationUpdateRequest,
    AICredentialStatus,
    AICredentialUpdateRequest,
    AIMessageItem,
    AIProviderId,
    AIProviderProfileConfig,
    AIProviderStatusInfo,
    AIProvidersStateResponse,
    AISendMessageRequest,
    AIToolTraceItem,
    AIUsageInfo,
    MAX_AI_RESPONSE_CHARS,
    validate_ai_conversation_id,
)
from app.services.ai_context import (
    AIContextToolExecutor,
    OPENAI_READONLY_TOOLS,
    build_context_preview,
    build_vega_system_prompt,
    prompt_requests_workspace_or_code,
    sanitize_attachments_and_format,
    validate_code_apply,
)
from app.services.ai_credentials import (
    AICredentialManager,
    CredentialStorageUnavailableError,
    scrub_ai_secrets,
)
from app.services.ai_providers import (
    AIProviderError,
    get_provider_adapter,
    list_provider_adapters,
)
from app.services.persistence import AppPersistence, PersistenceError
from app.services.project_service import (
    ProjectService,
    ProjectServiceError,
    validate_directory_input,
)

_AI_CONFIG_STATE_KEY = "native_ai_config_v1"
_MAX_CONVERSATION_LIST = 60
_MAX_HISTORY_MESSAGES_TO_MODEL = 24
_MAX_TOOL_ROUNDS = 4
MAX_AI_WS_SUBSCRIBER_QUEUE = 1024
_CRITICAL_WS_EVENTS = frozenset(
    {
        "snapshot",
        "generation_started",
        "generation_completed",
        "generation_cancelled",
        "generation_error",
        "conversation_cleared",
        "conversation_deleted",
    }
)


class AIServiceError(Exception):
    """Domain error with HTTP status code for Native AI Assistant."""

    def __init__(self, message: str, status_code: int = 400, error_code: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate_snippet_for_storage(att: AIContextAttachment) -> Dict[str, Any]:
    data = att.model_dump()
    if data.get("snippet") and len(data["snippet"]) > 2000:
        data["snippet"] = data["snippet"][:2000]
        data["truncated"] = True
    return data


def _auto_title_from_prompt(prompt: str) -> str:
    first_line = prompt.strip().splitlines()[0] if prompt.strip() else "New VEGA Chat"
    compact = " ".join(first_line.split())
    if len(compact) <= 48:
        return compact
    return compact[:45].rstrip() + "..."


class AIService:
    """Orchestrates Native VEGA AI providers, secure credentials, SQLite history, context, and SSE->WS streams."""

    def __init__(
        self,
        app_settings: Optional[Settings] = None,
        *,
        credential_manager: Optional[AICredentialManager] = None,
        http_client_factory: Optional[Callable[[], httpx.AsyncClient]] = None,
    ) -> None:
        self._settings = app_settings or settings
        self._projects = ProjectService(self._settings)
        self._persistence: AppPersistence = self._projects.persistence
        self._credentials = credential_manager or AICredentialManager()
        self._http_client_factory = http_client_factory or (lambda: httpx.AsyncClient())

        self._lock = threading.RLock()
        self._active_tasks: Dict[str, asyncio.Task[None]] = {}
        self._streaming_buffers: Dict[str, Tuple[str, List[AIToolTraceItem]]] = {}
        self._subscribers: Dict[str, List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue[Dict[str, Any]]]]] = {}
        self._schema_ready = False

    def _ensure_ai_schema(self) -> None:
        if self._schema_ready and self._persistence.db_path.exists():
            return
        self._persistence.ensure_schema()
        try:
            with closing(sqlite3.connect(self._persistence.db_path, timeout=10.0)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA busy_timeout=5000")
                conn.execute("PRAGMA foreign_keys=ON")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ai_conversations (
                        conversation_id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        project_dir TEXT,
                        project_name TEXT,
                        provider_id TEXT,
                        model TEXT,
                        allow_tools INTEGER NOT NULL DEFAULT 1,
                        status TEXT NOT NULL DEFAULT 'idle',
                        last_error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ai_messages (
                        id TEXT PRIMARY KEY,
                        conversation_id TEXT NOT NULL,
                        seq INTEGER NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        attachments_json TEXT,
                        tool_traces_json TEXT,
                        provider_id TEXT,
                        model TEXT,
                        finish_reason TEXT,
                        usage_json TEXT,
                        error_message TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_seq ON ai_messages (conversation_id, seq)"
                )
                # Reconcile any orphaned streaming status left behind after an unclean restart
                with self._lock:
                    active_ids = [cid for cid, t in self._active_tasks.items() if not t.done()]
                if not active_ids:
                    conn.execute(
                        """
                        UPDATE ai_conversations
                        SET status = 'error',
                            last_error = COALESCE(last_error, 'Previous response was interrupted by backend restart.')
                        WHERE status = 'streaming'
                        """
                    )
                conn.commit()
            self._schema_ready = True
        except (OSError, sqlite3.Error) as exc:
            raise AIServiceError(f"Failed initializing local AI database: {exc}", status_code=503) from exc

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._ensure_ai_schema()
        try:
            conn = sqlite3.connect(self._persistence.db_path, timeout=10.0)
        except sqlite3.Error as exc:
            raise AIServiceError(f"Unable to open local AI database: {exc}", status_code=503) from exc
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
            conn.commit()
        except sqlite3.Error as exc:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            raise AIServiceError(f"AI database operation failed: {exc}", status_code=503) from exc
        finally:
            conn.close()

    # ── Non-Secret Config & Providers ─────────────────────────────────────────

    def _load_config(self) -> Tuple[AIConfig, Optional[str]]:
        rec = self._persistence.get_state_json(_AI_CONFIG_STATE_KEY)
        if rec is None:
            return AIConfig(), None
        raw, updated_at = rec
        try:
            cfg = AIConfig.model_validate(raw)
            # Ensure default entries exist for all providers cleanly
            defaults = AIConfig().providers
            merged = {**defaults, **cfg.providers}
            return cfg.model_copy(update={"providers": merged}), updated_at
        except Exception:
            return AIConfig(), updated_at

    def _build_provider_status(self, cfg: AIConfig, adapter_id: AIProviderId) -> AIProviderStatusInfo:
        adapter = get_provider_adapter(adapter_id)
        desc = adapter.descriptor
        prof = cfg.providers.get(adapter_id) or AIProviderProfileConfig(
            model=desc.recommended_models[0],
            base_url=desc.default_base_url if desc.requires_base_url else None,
        )
        cred = self._credentials.get_status(adapter_id)
        ready = True
        reason: Optional[str] = None
        if not desc.api_key_optional and not cred.has_api_key:
            ready = False
            reason = f"API key not configured for {desc.label}."
        elif desc.requires_base_url and not (prof.base_url or desc.default_base_url):
            ready = False
            reason = f"Base URL required for {desc.label}."

        return AIProviderStatusInfo(
            id=desc.id,
            label=desc.label,
            description=desc.description,
            default_base_url=desc.default_base_url,
            requires_base_url=desc.requires_base_url,
            api_key_optional=desc.api_key_optional,
            supports_streaming=desc.supports_streaming,
            supports_tools=desc.supports_tools,
            recommended_models=list(desc.recommended_models),
            configured_model=prof.model,
            configured_base_url=prof.base_url,
            credential=cred,
            ready=ready,
            status_reason=reason,
        )

    def get_providers_state(self) -> AIProvidersStateResponse:
        cfg, updated_at = self._load_config()
        storage = self._credentials.get_storage_info()
        statuses = [self._build_provider_status(cfg, a.descriptor.id) for a in list_provider_adapters()]
        return AIProvidersStateResponse(
            config=cfg,
            storage=storage,
            providers=statuses,
            updated_at=updated_at,
        )

    def update_config(self, req: AIConfigUpdateRequest) -> AIProvidersStateResponse:
        defaults = AIConfig().providers
        merged = {**defaults, **req.providers}
        cfg = AIConfig(
            active_provider=req.active_provider,
            providers=merged,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            timeout_seconds=req.timeout_seconds,
            allow_context_tools=req.allow_context_tools,
            auto_include_workspace_summary=req.auto_include_workspace_summary,
        )
        self._persistence.set_state_json(_AI_CONFIG_STATE_KEY, cfg.model_dump())
        return self.get_providers_state()

    def reset_config(self) -> AIProvidersStateResponse:
        cfg = AIConfig()
        self._persistence.set_state_json(_AI_CONFIG_STATE_KEY, cfg.model_dump())
        return self.get_providers_state()

    def set_credential(self, provider_id: AIProviderId, req: AICredentialUpdateRequest) -> AICredentialStatus:
        get_provider_adapter(provider_id)
        try:
            return self._credentials.set_secret(
                provider_id,
                req.api_key,
                session_only=req.session_only,
            )
        except CredentialStorageUnavailableError as exc:
            raise AIServiceError(exc.message, status_code=exc.status_code, error_code="credential_store_unavailable") from exc
        except ValueError as exc:
            raise AIServiceError(str(exc), status_code=422) from exc

    def delete_credential(self, provider_id: AIProviderId) -> AICredentialStatus:
        get_provider_adapter(provider_id)
        try:
            return self._credentials.delete_secret(provider_id)
        except CredentialStorageUnavailableError as exc:
            raise AIServiceError(exc.message, status_code=exc.status_code) from exc

    async def test_connection(self, req: AIConnectionTestRequest) -> AIConnectionTestResponse:
        cfg, _ = self._load_config()
        adapter = get_provider_adapter(req.provider_id)
        prof = cfg.providers.get(req.provider_id) or AIProviderProfileConfig(
            model=adapter.descriptor.recommended_models[0],
            base_url=adapter.descriptor.default_base_url if adapter.descriptor.requires_base_url else None,
        )
        model = req.model or prof.model
        base_url = req.base_url if req.base_url is not None else prof.base_url
        api_key = req.api_key_override.strip() if req.api_key_override else self._credentials.get_secret(req.provider_id)

        try:
            async with self._http_client_factory() as client:
                res = await adapter.test_connection(
                    client,
                    model=model,
                    base_url=base_url,
                    api_key=api_key,
                    timeout_seconds=min(cfg.timeout_seconds, 20.0),
                )
            return res
        except AIProviderError as exc:
            raise AIServiceError(exc.message, status_code=exc.status_code, error_code=exc.error_code) from exc

    # ── Conversation Persistence ──────────────────────────────────────────────

    def _row_to_summary(self, row: sqlite3.Row, message_count: int) -> AIConversationSummary:
        cid = str(row["conversation_id"])
        with self._lock:
            is_streaming = cid in self._active_tasks and not self._active_tasks[cid].done()
        status = "streaming" if is_streaming else str(row["status"])
        return AIConversationSummary(
            conversation_id=cid,
            title=str(row["title"]),
            project_dir=row["project_dir"],
            project_name=row["project_name"],
            provider_id=row["provider_id"],
            model=row["model"],
            allow_tools=bool(row["allow_tools"]),
            status=status,  # type: ignore[arg-type]
            message_count=message_count,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            last_error=row["last_error"],
        )

    def _row_to_message(self, row: sqlite3.Row) -> AIMessageItem:
        try:
            atts_raw = json.loads(row["attachments_json"]) if row["attachments_json"] else []
            atts = [AIContextAttachment.model_validate(a) for a in atts_raw] if isinstance(atts_raw, list) else []
        except (ValueError, TypeError):
            atts = []
        try:
            tools_raw = json.loads(row["tool_traces_json"]) if row["tool_traces_json"] else []
            tools = [AIToolTraceItem.model_validate(t) for t in tools_raw] if isinstance(tools_raw, list) else []
        except (ValueError, TypeError):
            tools = []
        usage = None
        if row["usage_json"]:
            try:
                usage_raw = json.loads(row["usage_json"])
                usage = AIUsageInfo.model_validate(usage_raw) if isinstance(usage_raw, dict) else None
            except (ValueError, TypeError):
                usage = None
        return AIMessageItem(
            id=str(row["id"]),
            seq=int(row["seq"]),
            role=str(row["role"]),  # type: ignore[arg-type]
            content=str(row["content"]),
            attachments=atts,
            tool_traces=tools,
            provider_id=row["provider_id"],
            model=row["model"],
            finish_reason=row["finish_reason"],
            usage=usage,
            error_message=row["error_message"],
            created_at=str(row["created_at"]),
            is_streaming=False,
        )

    @staticmethod
    def _normalize_project_dir(raw: Optional[str]) -> Optional[str]:
        if raw is None or not str(raw).strip():
            return None
        try:
            return str(validate_directory_input(str(raw), label="Project directory"))
        except ProjectServiceError as exc:
            raise AIServiceError(exc.message, status_code=exc.status_code) from exc

    def list_conversations(self, project_dir: Optional[str] = None) -> AIConversationListResponse:
        norm = self._normalize_project_dir(project_dir)
        with self._connect() as conn:
            if norm:
                rows = conn.execute(
                    """
                    SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.conversation_id) AS msg_cnt
                    FROM ai_conversations c
                    WHERE c.project_dir = ? OR c.project_dir IS NULL
                    ORDER BY c.updated_at DESC
                    LIMIT ?
                    """,
                    (norm, _MAX_CONVERSATION_LIST),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.conversation_id) AS msg_cnt
                    FROM ai_conversations c
                    ORDER BY c.updated_at DESC
                    LIMIT ?
                    """,
                    (_MAX_CONVERSATION_LIST,),
                ).fetchall()
            items = [self._row_to_summary(r, int(r["msg_cnt"])) for r in rows]
        return AIConversationListResponse(conversations=items)

    def create_conversation(self, req: AIConversationCreateRequest) -> AIConversationDetailResponse:
        cfg, _ = self._load_config()
        active_prof = cfg.providers.get(cfg.active_provider)
        norm_proj = self._normalize_project_dir(req.project_dir)
        proj_name: Optional[str] = None
        if norm_proj:
            try:
                proj_name = self._projects.load_project(norm_proj).project.name
            except Exception:
                proj_name = Path(norm_proj).name

        cid = f"ai_{uuid.uuid4().hex[:14]}"
        now = _utc_now()
        title = (req.title or "").strip()[:120] or (f"{proj_name} Assistant" if proj_name else "VEGA AI Session")

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO ai_conversations (
                    conversation_id, title, project_dir, project_name, provider_id, model,
                    allow_tools, status, last_error, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?)
                """,
                (
                    cid,
                    title,
                    norm_proj,
                    proj_name,
                    cfg.active_provider,
                    active_prof.model if active_prof else None,
                    1 if req.allow_tools else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
        return self.get_conversation(cid)

    def get_conversation(self, conversation_id: str) -> AIConversationDetailResponse:
        try:
            cid = validate_ai_conversation_id(conversation_id)
        except ValueError as exc:
            raise AIServiceError(str(exc), status_code=400) from exc

        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM ai_conversations WHERE conversation_id = ?",
                (cid,),
            ).fetchone()
            if not row:
                raise AIServiceError(f"Conversation '{cid}' not found.", status_code=404)
            msg_rows = conn.execute(
                "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY seq ASC",
                (cid,),
            ).fetchall()

        messages = [self._row_to_message(r) for r in msg_rows]
        # Append transient streaming placeholder if currently generating
        with self._lock:
            buf = self._streaming_buffers.get(cid)
            is_active = cid in self._active_tasks and not self._active_tasks[cid].done()
        if is_active and buf is not None:
            partial_text, traces = buf
            messages.append(
                AIMessageItem(
                    id="streaming_pending",
                    seq=(messages[-1].seq + 1) if messages else 1,
                    role="assistant",
                    content=partial_text,
                    tool_traces=list(traces),
                    provider_id=row["provider_id"],
                    model=row["model"],
                    created_at=_utc_now(),
                    is_streaming=True,
                )
            )
        summary = self._row_to_summary(row, len(msg_rows))
        return AIConversationDetailResponse(conversation=summary, messages=messages)

    def update_conversation(self, conversation_id: str, req: AIConversationUpdateRequest) -> AIConversationDetailResponse:
        detail = self.get_conversation(conversation_id)
        cid = detail.conversation.conversation_id
        now = _utc_now()
        next_title = req.title.strip() if req.title else detail.conversation.title
        next_tools = req.allow_tools if req.allow_tools is not None else detail.conversation.allow_tools
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE ai_conversations
                SET title = ?, allow_tools = ?, updated_at = ?
                WHERE conversation_id = ?
                """,
                (next_title, 1 if next_tools else 0, now, cid),
            )
            conn.commit()
        return self.get_conversation(cid)

    async def clear_conversation(self, conversation_id: str) -> AIConversationDetailResponse:
        detail = self.get_conversation(conversation_id)
        cid = detail.conversation.conversation_id
        await self.cancel_generation(cid)
        now = _utc_now()
        with self._connect() as conn:
            conn.execute("DELETE FROM ai_messages WHERE conversation_id = ?", (cid,))
            conn.execute(
                "UPDATE ai_conversations SET status = 'idle', last_error = NULL, updated_at = ? WHERE conversation_id = ?",
                (now, cid),
            )
            conn.commit()
        self._emit_ws(cid, {"type": "conversation_cleared", "conversation_id": cid})
        return self.get_conversation(cid)

    async def delete_conversation(self, conversation_id: str) -> None:
        detail = self.get_conversation(conversation_id)
        cid = detail.conversation.conversation_id
        await self.cancel_generation(cid)
        with self._connect() as conn:
            conn.execute("DELETE FROM ai_messages WHERE conversation_id = ?", (cid,))
            conn.execute("DELETE FROM ai_conversations WHERE conversation_id = ?", (cid,))
            conn.commit()
        self._emit_ws(cid, {"type": "conversation_deleted", "conversation_id": cid})

    # ── Context Preview & Code Apply Validation ───────────────────────────────

    def preview_context(self, req: AIContextPreviewRequest) -> AIContextPreviewResponse:
        extra = tuple(self._credentials.get_all_known_secrets())
        return build_context_preview(
            app_settings=self._settings,
            project_dir=req.project_dir,
            attachments=req.attachments,
            include_workspace_summary=req.include_workspace_summary,
            extra_secrets=extra,
        )

    def validate_code_apply(self, req: AICodeApplyValidateRequest) -> AICodeApplyValidateResponse:
        return validate_code_apply(req)

    # ── WebSocket Subscription & Backpressure ─────────────────────────────────

    def subscribe(self, conversation_id: str) -> Tuple[AIConversationDetailResponse, asyncio.Queue[Dict[str, Any]]]:
        detail = self.get_conversation(conversation_id)
        cid = detail.conversation.conversation_id
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=MAX_AI_WS_SUBSCRIBER_QUEUE)
        with self._lock:
            self._subscribers.setdefault(cid, []).append((loop, q))
        return detail, q

    def unsubscribe(self, conversation_id: str, q: asyncio.Queue[Dict[str, Any]]) -> None:
        with self._lock:
            subs = self._subscribers.get(conversation_id)
            if not subs:
                return
            self._subscribers[conversation_id] = [(lp, qq) for (lp, qq) in subs if qq is not q]
            if not self._subscribers[conversation_id]:
                self._subscribers.pop(conversation_id, None)

    @staticmethod
    def _enqueue_with_backpressure(q: asyncio.Queue[Dict[str, Any]], event: Dict[str, Any]) -> None:
        is_critical = event.get("type") in _CRITICAL_WS_EVENTS
        if not q.full():
            q.put_nowait(event)
            return
        if not is_critical:
            return
        # Evict oldest non-critical delta chunk to guarantee delivery of terminal lifecycle frames
        drained: Deque[Dict[str, Any]] = deque()
        evicted = False
        while not q.empty():
            try:
                item = q.get_nowait()
            except asyncio.QueueEmpty:
                break
            if not evicted and item.get("type") not in _CRITICAL_WS_EVENTS:
                evicted = True
                continue
            drained.append(item)
        if not evicted and drained:
            drained.popleft()
        for item in drained:
            if not q.full():
                q.put_nowait(item)
        if not q.full():
            q.put_nowait(event)

    def _emit_ws(self, conversation_id: str, event: Dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subscribers.get(conversation_id, []))
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(self._enqueue_with_backpressure, q, event)
            except RuntimeError:
                pass

    # ── Message Sending, Streaming, Retry & Cancellation ──────────────────────

    async def send_message(self, conversation_id: str, req: AISendMessageRequest) -> AIConversationDetailResponse:
        detail = self.get_conversation(conversation_id)
        conv = detail.conversation
        cid = conv.conversation_id

        with self._lock:
            existing = self._active_tasks.get(cid)
            if existing is not None and not existing.done():
                raise AIServiceError(
                    "A response is already generating for this conversation. Stop generation before sending another message.",
                    status_code=409,
                    error_code="concurrent_generation",
                )

        # Workspace confinement check if conversation already bound to a project
        req_norm = self._normalize_project_dir(req.project_dir)
        if conv.project_dir and req_norm:
            if Path(req_norm) != Path(conv.project_dir):
                raise AIServiceError(
                    "Active workspace does not match this conversation's project. Start a new conversation for this project.",
                    status_code=409,
                    error_code="cross_project_conflict",
                )

        effective_project_dir = conv.project_dir or req_norm

        cfg, _ = self._load_config()
        provider_id: AIProviderId = req.provider_id or conv.provider_id or cfg.active_provider
        adapter = get_provider_adapter(provider_id)
        prof = cfg.providers.get(provider_id) or AIProviderProfileConfig(
            model=adapter.descriptor.recommended_models[0],
            base_url=adapter.descriptor.default_base_url if adapter.descriptor.requires_base_url else None,
        )
        model = req.model or prof.model
        base_url = prof.base_url
        api_key = self._credentials.get_secret(provider_id)

        if not api_key and not adapter.descriptor.api_key_optional:
            raise AIServiceError(
                f"No API key configured for {adapter.descriptor.label}. Configure one in Settings -> Native VEGA AI.",
                status_code=400,
                error_code="missing_api_key",
            )

        extra_secrets = tuple(self._credentials.get_all_known_secrets())
        included_atts, _, formatted_att_text, _ = sanitize_attachments_and_format(
            project_dir=effective_project_dir,
            attachments=req.attachments,
            extra_secrets=extra_secrets,
        )
        clean_prompt = scrub_ai_secrets(req.prompt, extra_secrets=extra_secrets)

        allow_tools = (
            req.allow_tools
            if req.allow_tools is not None
            else (conv.allow_tools and cfg.allow_context_tools)
        )
        include_ws = (
            req.include_workspace_summary
            if req.include_workspace_summary is not None
            else cfg.auto_include_workspace_summary
        )

        next_seq = (detail.messages[-1].seq + 1) if detail.messages else 1
        user_msg_id = f"msg_{uuid.uuid4().hex[:12]}"
        now = _utc_now()
        stored_atts = [_truncate_snippet_for_storage(a) for a in included_atts]

        next_title = conv.title
        if next_seq == 1 and (conv.title.endswith("Assistant") or conv.title == "VEGA AI Session" or conv.title == "New Conversation"):
            next_title = _auto_title_from_prompt(clean_prompt)

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO ai_messages (
                    id, conversation_id, seq, role, content, attachments_json,
                    tool_traces_json, provider_id, model, finish_reason, usage_json, error_message, created_at
                )
                VALUES (?, ?, ?, 'user', ?, ?, '[]', ?, ?, NULL, NULL, NULL, ?)
                """,
                (user_msg_id, cid, next_seq, clean_prompt, json.dumps(stored_atts), provider_id, model, now),
            )
            conn.execute(
                """
                UPDATE ai_conversations
                SET title = ?, project_dir = COALESCE(project_dir, ?), provider_id = ?, model = ?,
                    status = 'streaming', last_error = NULL, updated_at = ?
                WHERE conversation_id = ?
                """,
                (next_title, effective_project_dir, provider_id, model, now, cid),
            )
            conn.commit()

        return self._launch_generation_task(
            cid=cid,
            project_dir=effective_project_dir,
            provider_id=provider_id,
            model=model,
            base_url=base_url,
            api_key=api_key,
            cfg=cfg,
            allow_tools=allow_tools,
            include_workspace_summary=include_ws,
            latest_user_prompt=clean_prompt,
            latest_formatted_attachments=formatted_att_text,
        )

    async def retry_last_message(self, conversation_id: str) -> AIConversationDetailResponse:
        detail = self.get_conversation(conversation_id)
        cid = detail.conversation.conversation_id
        with self._lock:
            existing = self._active_tasks.get(cid)
            if existing is not None and not existing.done():
                raise AIServiceError("Generation already in progress.", status_code=409)

        msgs = detail.messages
        if not msgs:
            raise AIServiceError("No user message to retry.", status_code=400)

        # Remove trailing assistant/error message if present so the last user prompt replays cleanly
        if msgs[-1].role == "assistant":
            with self._connect() as conn:
                conn.execute("DELETE FROM ai_messages WHERE id = ?", (msgs[-1].id,))
                conn.commit()
            msgs = msgs[:-1]

        if not msgs or msgs[-1].role != "user":
            raise AIServiceError("No preceding user prompt found to retry.", status_code=400)

        last_user = msgs[-1]
        cfg, _ = self._load_config()
        provider_id: AIProviderId = detail.conversation.provider_id or cfg.active_provider
        adapter = get_provider_adapter(provider_id)
        prof = cfg.providers.get(provider_id) or AIProviderProfileConfig(model=adapter.descriptor.recommended_models[0])
        model = detail.conversation.model or prof.model
        api_key = self._credentials.get_secret(provider_id)
        if not api_key and not adapter.descriptor.api_key_optional:
            raise AIServiceError(
                f"No API key configured for {adapter.descriptor.label}.",
                status_code=400,
                error_code="missing_api_key",
            )

        extra_secrets = tuple(self._credentials.get_all_known_secrets())
        _, _, formatted_atts, _ = sanitize_attachments_and_format(
            project_dir=detail.conversation.project_dir,
            attachments=last_user.attachments,
            extra_secrets=extra_secrets,
        )
        with self._connect() as conn:
            conn.execute(
                "UPDATE ai_conversations SET status = 'streaming', last_error = NULL, updated_at = ? WHERE conversation_id = ?",
                (_utc_now(), cid),
            )
            conn.commit()

        return self._launch_generation_task(
            cid=cid,
            project_dir=detail.conversation.project_dir,
            provider_id=provider_id,
            model=model,
            base_url=prof.base_url,
            api_key=api_key,
            cfg=cfg,
            allow_tools=detail.conversation.allow_tools and cfg.allow_context_tools,
            include_workspace_summary=cfg.auto_include_workspace_summary,
            latest_user_prompt=last_user.content,
            latest_formatted_attachments=formatted_atts,
        )

    def _launch_generation_task(
        self,
        *,
        cid: str,
        project_dir: Optional[str],
        provider_id: AIProviderId,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        cfg: AIConfig,
        allow_tools: bool,
        include_workspace_summary: bool,
        latest_user_prompt: str,
        latest_formatted_attachments: str,
    ) -> AIConversationDetailResponse:
        with self._lock:
            self._streaming_buffers[cid] = ("", [])
            task = asyncio.create_task(
                self._run_generation(
                    cid=cid,
                    project_dir=project_dir,
                    provider_id=provider_id,
                    model=model,
                    base_url=base_url,
                    api_key=api_key,
                    cfg=cfg,
                    allow_tools=allow_tools,
                    include_workspace_summary=include_workspace_summary,
                    latest_user_prompt=latest_user_prompt,
                    latest_formatted_attachments=latest_formatted_attachments,
                )
            )
            self._active_tasks[cid] = task
        self._emit_ws(
            cid,
            {
                "type": "generation_started",
                "conversation_id": cid,
                "provider_id": provider_id,
                "model": model,
            },
        )
        return self.get_conversation(cid)

    async def _run_generation(
        self,
        *,
        cid: str,
        project_dir: Optional[str],
        provider_id: AIProviderId,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        cfg: AIConfig,
        allow_tools: bool,
        include_workspace_summary: bool,
        latest_user_prompt: str,
        latest_formatted_attachments: str,
    ) -> None:
        adapter = get_provider_adapter(provider_id)
        extra_secrets = tuple(self._credentials.get_all_known_secrets())
        wants_workspace = prompt_requests_workspace_or_code(
            latest_user_prompt,
            has_attachments=bool(latest_formatted_attachments.strip()),
        )
        effective_allow_tools = bool(allow_tools and wants_workspace)
        effective_include_ws = bool(include_workspace_summary and wants_workspace)

        sys_prompt, _, _, _ = build_vega_system_prompt(
            app_settings=self._settings,
            project_dir=project_dir,
            include_workspace_summary=effective_include_ws,
            allow_tools=effective_allow_tools,
            extra_secrets=extra_secrets,
        )

        # Build bounded message list from persisted history
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY seq ASC",
                (cid,),
            ).fetchall()
        history = [self._row_to_message(r) for r in rows]
        bounded_history = history[-_MAX_HISTORY_MESSAGES_TO_MODEL:]

        llm_messages: List[Dict[str, Any]] = [{"role": "system", "content": sys_prompt}]
        for idx, msg in enumerate(bounded_history):
            if msg.role == "user":
                if idx == len(bounded_history) - 1:
                    combined = (
                        f"{latest_user_prompt}\n\nAttached IDE Context:\n{latest_formatted_attachments}"
                        if latest_formatted_attachments
                        else latest_user_prompt
                    )
                    llm_messages.append({"role": "user", "content": combined})
                else:
                    att_titles = ", ".join(a.title for a in msg.attachments)
                    content = f"{msg.content}\n[Previous context attached: {att_titles}]" if att_titles else msg.content
                    llm_messages.append({"role": "user", "content": content})
            elif msg.role == "assistant" and msg.content.strip():
                llm_messages.append({"role": "assistant", "content": msg.content[:MAX_AI_RESPONSE_CHARS]})

        tool_executor = AIContextToolExecutor(
            app_settings=self._settings,
            project_dir=project_dir,
            extra_secrets=extra_secrets,
        )
        tools_payload = OPENAI_READONLY_TOOLS if effective_allow_tools else None

        collected_text = ""
        collected_traces: List[AIToolTraceItem] = []
        finish_reason: Optional[str] = None
        usage: Optional[AIUsageInfo] = None

        try:
            async with self._http_client_factory() as client:
                for _round in range(_MAX_TOOL_ROUNDS + 1):
                    round_text = ""
                    tool_acc: Dict[int, Dict[str, str]] = {}

                    # Transient retry on pre-stream 429/503 when safe (before any text emitted)
                    attempts = 0
                    while True:
                        try:
                            async for chunk in adapter.stream_chat(
                                client,
                                model=model,
                                base_url=base_url,
                                api_key=api_key,
                                messages=llm_messages,
                                tools=tools_payload,
                                temperature=cfg.temperature,
                                max_tokens=cfg.max_tokens,
                                timeout_seconds=cfg.timeout_seconds,
                            ):
                                if chunk.text_delta:
                                    remaining = MAX_AI_RESPONSE_CHARS - len(collected_text)
                                    piece = chunk.text_delta[:remaining] if remaining > 0 else ""
                                    if piece:
                                        safe_piece = scrub_ai_secrets(piece, extra_secrets=extra_secrets)
                                        collected_text += safe_piece
                                        round_text += safe_piece
                                        with self._lock:
                                            self._streaming_buffers[cid] = (collected_text, list(collected_traces))
                                        self._emit_ws(
                                            cid,
                                            {"type": "chunk_delta", "conversation_id": cid, "delta": safe_piece},
                                        )
                                for td in chunk.tool_deltas:
                                    entry = tool_acc.setdefault(
                                        td.index,
                                        {"id": td.call_id or f"tc_{uuid.uuid4().hex[:8]}", "name": "", "arguments": ""},
                                    )
                                    if td.call_id:
                                        entry["id"] = td.call_id
                                    if td.name:
                                        entry["name"] += td.name
                                    if td.arguments_delta and len(entry["arguments"]) < 32_000:
                                        entry["arguments"] += td.arguments_delta[: max(0, 32_000 - len(entry["arguments"]))]
                                if chunk.finish_reason:
                                    finish_reason = chunk.finish_reason
                                if chunk.usage:
                                    usage = chunk.usage
                            break
                        except AIProviderError as exc:
                            attempts += 1
                            if (
                                exc.retryable
                                and attempts == 1
                                and not collected_text
                                and (exc.retry_after_seconds is None or exc.retry_after_seconds <= 2)
                            ):
                                await asyncio.sleep(float(exc.retry_after_seconds or 1))
                                continue
                            raise

                    if not tool_acc or not effective_allow_tools or _round >= _MAX_TOOL_ROUNDS:
                        break

                    # Record assistant tool-call turn and execute strictly read-only context tools
                    ordered_calls = [tool_acc[idx] for idx in sorted(tool_acc.keys())]
                    llm_messages.append(
                        {
                            "role": "assistant",
                            "content": round_text or None,
                            "tool_calls": [
                                {
                                    "id": tc["id"],
                                    "type": "function",
                                    "function": {"name": tc["name"], "arguments": tc["arguments"] or "{}"},
                                }
                                for tc in ordered_calls
                            ],
                        }
                    )
                    for tc in ordered_calls:
                        safe_args_prev = scrub_ai_secrets(
                            (tc["arguments"] or "{}")[:240], extra_secrets=extra_secrets
                        )
                        trace = AIToolTraceItem(
                            call_id=tc["id"],
                            name=tc["name"],
                            arguments_preview=safe_args_prev,
                            status="running",
                        )
                        collected_traces.append(trace)
                        with self._lock:
                            self._streaming_buffers[cid] = (collected_text, list(collected_traces))
                        self._emit_ws(
                            cid,
                            {"type": "tool_call", "conversation_id": cid, "tool": trace.model_dump()},
                        )

                        status_str, output_str, truncated = tool_executor.execute(tc["name"], tc["arguments"] or "{}")
                        trace.status = status_str  # type: ignore[assignment]
                        trace.output_preview = output_str[:1200]
                        trace.truncated = truncated
                        self._emit_ws(
                            cid,
                            {"type": "tool_result", "conversation_id": cid, "tool": trace.model_dump()},
                        )
                        llm_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": output_str,
                            }
                        )

            final_text = scrub_ai_secrets(collected_text, extra_secrets=extra_secrets)
            if not final_text and finish_reason:
                final_text = "(Empty response returned by provider.)"
            self._persist_assistant_message(
                cid=cid,
                content=final_text,
                traces=collected_traces,
                provider_id=provider_id,
                model=model,
                finish_reason=finish_reason or "stop",
                usage=usage,
                status="idle",
                error_message=None,
            )
            detail = self.get_conversation(cid)
            self._emit_ws(
                cid,
                {"type": "generation_completed", "conversation_id": cid, "detail": detail.model_dump()},
            )

        except asyncio.CancelledError:
            partial = scrub_ai_secrets(collected_text, extra_secrets=extra_secrets)
            self._persist_assistant_message(
                cid=cid,
                content=partial or "(Generation stopped by user.)",
                traces=collected_traces,
                provider_id=provider_id,
                model=model,
                finish_reason="cancelled",
                usage=usage,
                status="cancelled",
                error_message=None,
            )
            detail = self.get_conversation(cid)
            self._emit_ws(
                cid,
                {"type": "generation_cancelled", "conversation_id": cid, "detail": detail.model_dump()},
            )
            raise
        except AIProviderError as exc:
            err_msg = scrub_ai_secrets(exc.message, extra_secrets=extra_secrets)
            partial = scrub_ai_secrets(collected_text, extra_secrets=extra_secrets)
            self._persist_assistant_message(
                cid=cid,
                content=partial,
                traces=collected_traces,
                provider_id=provider_id,
                model=model,
                finish_reason="error",
                usage=usage,
                status="error",
                error_message=err_msg,
            )
            detail = self.get_conversation(cid)
            self._emit_ws(
                cid,
                {
                    "type": "generation_error",
                    "conversation_id": cid,
                    "error": err_msg,
                    "error_code": exc.error_code,
                    "detail": detail.model_dump(),
                },
            )
        except Exception as exc:
            err_msg = scrub_ai_secrets(f"Unexpected AI service error: {exc}", extra_secrets=extra_secrets)
            partial = scrub_ai_secrets(collected_text, extra_secrets=extra_secrets)
            self._persist_assistant_message(
                cid=cid,
                content=partial,
                traces=collected_traces,
                provider_id=provider_id,
                model=model,
                finish_reason="error",
                usage=usage,
                status="error",
                error_message=err_msg,
            )
            detail = self.get_conversation(cid)
            self._emit_ws(
                cid,
                {"type": "generation_error", "conversation_id": cid, "error": err_msg, "detail": detail.model_dump()},
            )
        finally:
            with self._lock:
                self._streaming_buffers.pop(cid, None)
                self._active_tasks.pop(cid, None)

    def _persist_assistant_message(
        self,
        *,
        cid: str,
        content: str,
        traces: List[AIToolTraceItem],
        provider_id: AIProviderId,
        model: str,
        finish_reason: Optional[str],
        usage: Optional[AIUsageInfo],
        status: str,
        error_message: Optional[str],
    ) -> None:
        now = _utc_now()
        msg_id = f"msg_{uuid.uuid4().hex[:12]}"
        with self._connect() as conn:
            exists_row = conn.execute(
                "SELECT 1 FROM ai_conversations WHERE conversation_id = ?",
                (cid,),
            ).fetchone()
            if exists_row is None:
                return
            row = conn.execute(
                "SELECT MAX(seq) AS max_seq FROM ai_messages WHERE conversation_id = ?",
                (cid,),
            ).fetchone()
            next_seq = (int(row["max_seq"]) + 1) if row and row["max_seq"] is not None else 1
            conn.execute(
                """
                INSERT INTO ai_messages (
                    id, conversation_id, seq, role, content, attachments_json,
                    tool_traces_json, provider_id, model, finish_reason, usage_json, error_message, created_at
                )
                VALUES (?, ?, ?, 'assistant', ?, '[]', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg_id,
                    cid,
                    next_seq,
                    content,
                    json.dumps([t.model_dump() for t in traces]),
                    provider_id,
                    model,
                    finish_reason,
                    json.dumps(usage.model_dump()) if usage else None,
                    error_message,
                    now,
                ),
            )
            conn.execute(
                "UPDATE ai_conversations SET status = ?, last_error = ?, updated_at = ? WHERE conversation_id = ?",
                (status, error_message, now, cid),
            )
            conn.commit()

    async def cancel_generation(self, conversation_id: str) -> AIConversationDetailResponse:
        cid = validate_ai_conversation_id(conversation_id)
        with self._lock:
            task = self._active_tasks.get(cid)
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=3.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
        return self.get_conversation(cid)

    def shutdown(self) -> None:
        with self._lock:
            active_cids = list(self._active_tasks.keys())
            tasks = list(self._active_tasks.values())
            self._active_tasks.clear()
            self._streaming_buffers.clear()
        for task in tasks:
            if not task.done():
                task.cancel()
        if active_cids:
            now = _utc_now()
            try:
                with self._connect() as conn:
                    for cid in active_cids:
                        conn.execute(
                            "UPDATE ai_conversations SET status = 'cancelled', updated_at = ? WHERE conversation_id = ? AND status = 'streaming'",
                            (now, cid),
                        )
            except Exception:
                pass


_ai_service_instance: Optional[AIService] = None


def get_ai_service() -> AIService:
    global _ai_service_instance
    if _ai_service_instance is None:
        _ai_service_instance = AIService(settings)
    return _ai_service_instance
