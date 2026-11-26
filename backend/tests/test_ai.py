"""Tests for Phase 15 Native VEGA AI Assistant.

Uses controlled in-process `httpx.MockTransport` responders and isolated temporary
persistence / credential backends — zero external AI API keys or network calls required.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import uuid

from fastapi.testclient import TestClient
import httpx
import pytest

from app.config import Settings
from app.main import app
from app.models.ai import (
    AICodeApplyValidateRequest,
    AIConfigUpdateRequest,
    AIConnectionTestRequest,
    AIContextAttachment,
    AIContextPreviewRequest,
    AIConversationCreateRequest,
    AIConversationUpdateRequest,
    AICredentialUpdateRequest,
    AIProviderId,
    AIProviderProfileConfig,
    AISendMessageRequest,
    validate_ai_base_url,
    validate_ai_model_name,
)
from app.models.project import CreateProjectRequest
from app.routers.ai import get_ai_service
from app.services.ai_context import (
    AIContextToolExecutor,
    MAX_TOTAL_CONTEXT_CHARS,
    build_vega_system_prompt,
    is_sensitive_relative_path,
)
from app.services.ai_credentials import (
    AICredentialManager,
    OSCredentialBackend,
    UnavailableOSCredentialBackend,
    WindowsCredentialManagerBackend,
    scrub_ai_secrets,
)
from app.services.ai_providers import list_provider_adapters
from app.services.ai_service import AIService, AIServiceError
from app.services.project_service import ProjectService


class _MemoryCredentialBackend(OSCredentialBackend):
    """Test-only isolated in-memory credential store simulating an OS keyring."""

    def __init__(self, *, available: bool = True, name: str = "Mock OS Keyring") -> None:
        self._available = available
        self._name = name
        self._secrets: Dict[str, str] = {}

    @property
    def backend_name(self) -> str:
        return self._name

    def is_available(self) -> tuple[bool, str]:
        if self._available:
            return True, f"Secured via {self._name}"
        return False, "Mock OS keyring locked or unavailable."

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        return self._secrets.get(provider_id)

    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        self._secrets[provider_id] = secret

    def delete_secret(self, provider_id: AIProviderId) -> None:
        self._secrets.pop(provider_id, None)


def _make_settings(tmp_path: Path) -> Settings:
    return Settings(
        DATA_DIR=str(tmp_path / "app_data"),
        HOST="127.0.0.1",
        PORT=8765,
    )


def _create_project(app_settings: Settings, parent: Path, name: str = "aries_ai_proj") -> str:
    ps = ProjectService(app_settings)
    summary = ps.create_project(
        CreateProjectRequest(
            name=name,
            parent_dir=str(parent),
            description="VEGA ARIES V3 AI test firmware",
            template="minimal",
        )
    )
    return summary.project_dir


def _sse_body(chunks: List[Dict[str, Any]]) -> bytes:
    lines = [f"data: {json.dumps(ch)}\n\n" for ch in chunks]
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode("utf-8")


# ── Validation, Redaction & Credential Abstraction Tests ─────────────────────


def test_model_and_url_validators_and_secret_scrubbing():
    assert validate_ai_model_name("gpt-4o-mini") == "gpt-4o-mini"
    assert validate_ai_model_name("qwen2.5-coder:7b") == "qwen2.5-coder:7b"
    with pytest.raises(ValueError):
        validate_ai_model_name("bad model with spaces")
    with pytest.raises(ValueError):
        validate_ai_model_name("../evil")

    assert validate_ai_base_url("http://127.0.0.1:11434/v1/") == "http://127.0.0.1:11434/v1"
    with pytest.raises(ValueError):
        validate_ai_base_url("ftp://example.com/v1")
    with pytest.raises(ValueError):
        validate_ai_base_url("https://user:secret@api.openai.com/v1")

    raw = "Authorization: Bearer sk-testsecret1234567890 failed with gsk_anothersecretkey12345"
    cleaned = scrub_ai_secrets(raw, extra_secrets=("my-custom-key-xyz",))
    assert "sk-testsecret" not in cleaned
    assert "gsk_anothersecretkey" not in cleaned
    assert "[REDACTED" in cleaned


def test_credential_store_unavailable_never_falls_back_to_plaintext(tmp_path: Path):
    s = _make_settings(tmp_path)
    unavail = AICredentialManager(backend=UnavailableOSCredentialBackend("No keyring daemon."))
    svc = AIService(s, credential_manager=unavail)

    state = svc.get_providers_state()
    assert state.storage.os_storage_available is False
    assert state.storage.backend_name == "unavailable"

    # Persistent save MUST fail clearly rather than writing plaintext to SQLite/disk
    with pytest.raises(AIServiceError) as exc_info:
        svc.set_credential("openai", AICredentialUpdateRequest(api_key="sk-test-1234567890", session_only=False))
    assert exc_info.value.status_code == 503

    # Explicit session-only mode stores in memory only and never in SQLite DB
    st = svc.set_credential("openai", AICredentialUpdateRequest(api_key="sk-session-1234567890abcd", session_only=True))
    assert st.has_api_key is True
    assert st.persistence_mode == "session_memory"
    assert st.key_hint == "••••abcd"

    db_bytes = (Path(s.get_data_dir()) / "vega_studio.db").read_bytes() if (Path(s.get_data_dir()) / "vega_studio.db").exists() else b""
    assert b"sk-session-1234567890abcd" not in db_bytes


@pytest.mark.skipif(sys.platform != "win32", reason="Windows Credential Manager test only runs on Win32")
def test_windows_credential_manager_roundtrip_isolated():
    prefix = f"VEGA_STUDIO_AI_TEST_{uuid.uuid4().hex[:8]}:"
    backend = WindowsCredentialManagerBackend(target_prefix=prefix)
    ok, _ = backend.is_available()
    assert ok is True
    secret = "sk-wincm-roundtrip-secret-9876"
    try:
        assert backend.get_secret("openai") is None
        backend.set_secret("openai", secret)
        assert backend.get_secret("openai") == secret
        backend.delete_secret("openai")
        assert backend.get_secret("openai") is None
    finally:
        backend.delete_secret("openai")


# ── Provider Registry, Connection Testing & Switching ────────────────────────


@pytest.mark.asyncio
async def test_provider_abstraction_connection_test_and_switching(tmp_path: Path):
    s = _make_settings(tmp_path)
    creds = AICredentialManager(backend=_MemoryCredentialBackend())
    seen_urls: List[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        auth = request.headers.get("Authorization", "")
        if request.url.host == "api.openai.com" and request.url.path == "/v1/models":
            if auth != "Bearer sk-valid-openai-9999":
                return httpx.Response(401, json={"error": {"message": f"Invalid key {auth}"}})
            return httpx.Response(200, json={"data": [{"id": "gpt-4o-mini"}, {"id": "gpt-4o"}]})
        if request.url.host == "api.groq.com" and request.url.path == "/openai/v1/models":
            return httpx.Response(429, headers={"Retry-After": "12"}, json={"error": {"message": "Rate limit exceeded"}})
        if request.url.host == "127.0.0.1" and request.url.path == "/v1/models":
            return httpx.Response(404, text="Not Found")
        if request.url.host == "127.0.0.1" and request.url.path == "/v1/chat/completions":
            return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
        return httpx.Response(500, text="Unexpected")

    svc = AIService(
        s,
        credential_manager=creds,
        http_client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    adapters = [a.descriptor.id for a in list_provider_adapters()]
    assert adapters == ["openai", "groq", "openai_compatible"]

    # Missing API key connection test fails cleanly
    missing = await svc.test_connection(AIConnectionTestRequest(provider_id="openai"))
    assert missing.ok is False
    assert missing.error_code == "missing_api_key"

    # Bad key returns 401 normalized & scrubs secret
    creds.set_secret("openai", "sk-bad-key-12345678")
    bad_res = await svc.test_connection(AIConnectionTestRequest(provider_id="openai"))
    assert bad_res.ok is False
    assert bad_res.error_code == "auth_failed"
    assert "sk-bad-key-12345678" not in bad_res.message

    # Valid OpenAI key returns models
    creds.set_secret("openai", "sk-valid-openai-9999")
    ok_res = await svc.test_connection(AIConnectionTestRequest(provider_id="openai"))
    assert ok_res.ok is True
    assert "gpt-4o-mini" in ok_res.discovered_models

    # Groq 429 normalized
    creds.set_secret("groq", "gsk_valid_groq_123456")
    groq_res = await svc.test_connection(AIConnectionTestRequest(provider_id="groq"))
    assert groq_res.ok is False
    assert groq_res.error_code == "rate_limited"

    # OpenAI-compatible local fallback when /models is 404
    compat_res = await svc.test_connection(
        AIConnectionTestRequest(provider_id="openai_compatible", base_url="http://127.0.0.1:11434/v1")
    )
    assert compat_res.ok is True


# ── Context Construction, Sensitive Exclusions, Tools & Code Apply ───────────


def test_context_builder_vega_prompt_exclusions_tools_and_code_apply(tmp_path: Path):
    s = _make_settings(tmp_path)
    proj_dir = _create_project(s, tmp_path / "projects", "vega_test_fw")
    proj_path = Path(proj_dir)

    # Create safe and sensitive files
    (proj_path / "src").mkdir(exist_ok=True)
    (proj_path / "src" / "main.c").write_text("int main(void) {\n  return 0;\n}\n", encoding="utf-8")
    (proj_path / ".env").write_text("API_KEY=sk-topsecret123456", encoding="utf-8")
    (proj_path / "private.pem").write_text("-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----", encoding="utf-8")
    (proj_path / "id_rsa").write_text("secret key", encoding="utf-8")
    (proj_path / "fw.bin").write_bytes(b"\x00\x01\x02\xff")

    assert is_sensitive_relative_path(".env") is not None
    assert is_sensitive_relative_path("private.pem") is not None
    assert is_sensitive_relative_path("src/main.c") is None

    sys_prompt, proj_name, board_id, sections = build_vega_system_prompt(
        app_settings=s,
        project_dir=proj_dir,
        include_workspace_summary=True,
        allow_tools=True,
    )
    assert proj_name == "vega_test_fw"
    assert board_id == "VEGA_ARIES_V3"
    assert "VEGA ARIES V3" in sys_prompt
    assert "VEGA ET1031" in sys_prompt
    assert "rv32i_zicsr" in sys_prompt
    assert "THEJAS32" in sys_prompt
    assert "NEVER invent undocumented VEGA SDK functions" in sys_prompt
    # Sensitive files omitted from tree
    assert ".env" not in sys_prompt
    assert "private.pem" not in sys_prompt
    assert sections

    svc = AIService(s, credential_manager=AICredentialManager(backend=_MemoryCredentialBackend()))
    preview = svc.preview_context(
        AIContextPreviewRequest(
            project_dir=proj_dir,
            attachments=[
                AIContextAttachment(
                    kind="file",
                    title="main.c",
                    relative_path="src/main.c",
                    snippet="int main(void) { /* sk-inline9999999999 */ return 0; }",
                ),
                AIContextAttachment(
                    kind="file",
                    title="secret env",
                    relative_path=".env",
                    snippet="TOP_SECRET=123",
                ),
                AIContextAttachment(
                    kind="file",
                    title="escape",
                    relative_path="../../etc/passwd",
                    snippet="root:x:0:0",
                ),
            ],
            include_workspace_summary=True,
        )
    )
    assert len(preview.included_attachments) == 1
    assert "sk-inline" not in (preview.included_attachments[0].snippet or "")
    assert preview.redacted_secrets_count == 1
    assert len(preview.excluded_warnings) == 2
    assert preview.estimated_chars <= MAX_TOTAL_CONTEXT_CHARS + 6000

    # Read-only Context Tool Executor safety checks
    executor = AIContextToolExecutor(app_settings=s, project_dir=proj_dir)
    st_list, out_list, _ = executor.execute("list_project_files", "{}")
    assert st_list == "completed"
    assert "src/main.c" in out_list
    assert ".env" not in out_list

    st_read, out_read, _ = executor.execute("read_project_file", json.dumps({"relative_path": "src/main.c", "start_line": 1, "end_line": 10}))
    assert st_read == "completed"
    assert "int main(void)" in out_read

    for blocked in (".env", "private.pem", "id_rsa", "fw.bin", "../../outside.txt", "C:\\Windows\\win.ini"):
        st_b, _, _ = executor.execute("read_project_file", json.dumps({"relative_path": blocked}))
        assert st_b == "denied"

    st_board, out_board, _ = executor.execute("get_board_and_sdk_status", "{}")
    assert st_board == "completed"
    assert "VEGA_ARIES_V3" in out_board

    st_build, _, _ = executor.execute("get_recent_build_diagnostics", "{}")
    assert st_build == "completed"
    st_git, _, _ = executor.execute("get_git_status_summary", "{}")
    assert st_git == "completed"
    st_denied, _, _ = executor.execute("run_shell", "{}")
    assert st_denied == "denied"

    # Code apply validation
    ok_apply = svc.validate_code_apply(
        AICodeApplyValidateRequest(
            project_dir=proj_dir,
            relative_path="src/main.c",
            mode="insert_at_cursor",
            code="volatile int x = 0;",
        )
    )
    assert ok_apply.allowed is True
    assert ok_apply.exists is True

    bad_manifest = svc.validate_code_apply(
        AICodeApplyValidateRequest(
            project_dir=proj_dir,
            relative_path="vega-project.json",
            mode="replace_file",
            code="{}",
        )
    )
    assert bad_manifest.allowed is False

    bad_trav = svc.validate_code_apply(
        AICodeApplyValidateRequest(
            project_dir=proj_dir,
            relative_path="../outside.c",
            mode="insert_at_cursor",
            code="int a;",
        )
    )
    assert bad_trav.allowed is False


# ── Streaming, Tool Rounds, Cancellation, Timeout, Retry & Persistence ───────


@pytest.mark.asyncio
async def test_streaming_tool_loop_retry_cancellation_timeout_and_persistence(tmp_path: Path):
    s = _make_settings(tmp_path)
    creds = AICredentialManager(backend=_MemoryCredentialBackend())
    creds.set_secret("openai", "sk-stream-test-999999")
    proj_dir = _create_project(s, tmp_path / "projects", "stream_proj")
    other_dir = _create_project(s, tmp_path / "projects", "other_proj")
    (Path(proj_dir) / "src" / "main.c").write_text("int main(void) { return 42; }\n", encoding="utf-8")

    call_state = {"mode": "normal_tools", "round": 0, "fail_once_429": True}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/chat/completions":
            return httpx.Response(404)
        body = json.loads(request.content.decode("utf-8"))
        assert body["messages"][0]["role"] == "system"

        if call_state["mode"] == "retry_429":
            if call_state["fail_once_429"]:
                call_state["fail_once_429"] = False
                return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": {"message": "Slow down"}})
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=_sse_body([
                    {"choices": [{"delta": {"content": "Recovered after rate limit."}, "finish_reason": "stop"}]},
                ]),
            )

        if call_state["mode"] == "timeout":
            raise httpx.ReadTimeout("Simulated upstream read timeout")

        if call_state["mode"] == "slow_stream":
            class _SlowStream(httpx.AsyncByteStream):
                async def __aiter__(self):
                    yield b'data: {"choices":[{"delta":{"content":"Part 1 "}}]}\n\n'
                    await asyncio.sleep(5.0)
                    yield b"data: [DONE]\n\n"
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=_SlowStream())

        # normal_tools: round 0 requests read_project_file, round 1 replies using result
        call_state["round"] += 1
        if call_state["round"] == 1:
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=_sse_body([
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "call_read_1",
                                            "function": {
                                                "name": "read_project_file",
                                                "arguments": json.dumps({"relative_path": "src/main.c", "start_line": 1, "end_line": 5}),
                                            },
                                        }
                                    ]
                                },
                                "finish_reason": "tool_calls",
                            }
                        ]
                    }
                ]),
            )
        # Round 2 sees tool output message
        assert any(m.get("role") == "tool" and "return 42" in str(m.get("content")) for m in body["messages"])
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=_sse_body([
                {"choices": [{"delta": {"content": "Verified `main.c` "}}]},
                {"choices": [{"delta": {"content": "returns 42."}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 50, "completion_tokens": 8, "total_tokens": 58}},
            ]),
        )

    svc = AIService(
        s,
        credential_manager=creds,
        http_client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    conv = svc.create_conversation(AIConversationCreateRequest(project_dir=proj_dir, title="Bringup"))
    cid = conv.conversation.conversation_id

    # Cross-project guard (409)
    with pytest.raises(AIServiceError) as cross_err:
        await svc.send_message(cid, AISendMessageRequest(project_dir=other_dir, prompt="Wrong workspace"))
    assert cross_err.value.status_code == 409

    # Send message with tool round
    await svc.send_message(cid, AISendMessageRequest(project_dir=proj_dir, prompt="Check main.c return value"))
    for _ in range(50):
        d = svc.get_conversation(cid)
        if d.conversation.status != "streaming":
            break
        await asyncio.sleep(0.05)

    done = svc.get_conversation(cid)
    assert done.conversation.status == "idle"
    assert len(done.messages) == 2
    assert "Verified `main.c` returns 42." in done.messages[1].content
    assert len(done.messages[1].tool_traces) == 1
    assert done.messages[1].tool_traces[0].name == "read_project_file"
    assert done.messages[1].tool_traces[0].status == "completed"
    assert done.messages[1].usage and done.messages[1].usage.total_tokens == 58

    # Transient 429 retry
    call_state["mode"] = "retry_429"
    await svc.send_message(cid, AISendMessageRequest(project_dir=proj_dir, prompt="Retry test"))
    for _ in range(80):
        d = svc.get_conversation(cid)
        if d.conversation.status != "streaming":
            break
        await asyncio.sleep(0.05)
    assert svc.get_conversation(cid).messages[-1].content == "Recovered after rate limit."

    # Timeout handling -> error status + retry capability
    call_state["mode"] = "timeout"
    await svc.send_message(cid, AISendMessageRequest(project_dir=proj_dir, prompt="Trigger timeout"))
    for _ in range(50):
        d = svc.get_conversation(cid)
        if d.conversation.status != "streaming":
            break
        await asyncio.sleep(0.05)
    timed_out = svc.get_conversation(cid)
    assert timed_out.conversation.status == "error"
    assert "timed out" in (timed_out.conversation.last_error or "").lower()

    # Manual retry after error replays last prompt cleanly
    call_state["mode"] = "normal_tools"
    call_state["round"] = 0
    await svc.retry_last_message(cid)
    for _ in range(50):
        d = svc.get_conversation(cid)
        if d.conversation.status != "streaming":
            break
        await asyncio.sleep(0.05)
    retried = svc.get_conversation(cid)
    assert retried.conversation.status == "idle"
    assert "Verified `main.c` returns 42." in retried.messages[-1].content

    # Slow stream cancellation + concurrent generation rejection (409)
    call_state["mode"] = "slow_stream"
    await svc.send_message(cid, AISendMessageRequest(project_dir=proj_dir, prompt="Slow stream"))
    await asyncio.sleep(0.08)
    with pytest.raises(AIServiceError) as conc_err:
        await svc.send_message(cid, AISendMessageRequest(project_dir=proj_dir, prompt="Duplicate concurrent"))
    assert conc_err.value.status_code == 409

    cancelled = await svc.cancel_generation(cid)
    assert cancelled.conversation.status == "cancelled"

    # Persistence recovery across fresh AIService instance
    svc2 = AIService(s, credential_manager=creds)
    listed = svc2.list_conversations(project_dir=proj_dir)
    assert any(c.conversation_id == cid for c in listed.conversations)
    reloaded = svc2.get_conversation(cid)
    assert len(reloaded.messages) == len(cancelled.messages)

    cleared = await svc2.clear_conversation(cid)
    assert cleared.conversation.status == "idle"
    assert len(cleared.messages) == 0

    # Delete conversation clears DB rows
    await svc2.delete_conversation(cid)
    with pytest.raises(AIServiceError) as not_found:
        svc2.get_conversation(cid)
    assert not_found.value.status_code == 404


# ── FastAPI Routes & WebSocket Integration ───────────────────────────────────


def test_ai_fastapi_routes_and_websocket_streaming(tmp_path: Path):
    s = _make_settings(tmp_path)
    creds = AICredentialManager(backend=_MemoryCredentialBackend())
    proj_dir = _create_project(s, tmp_path / "projects", "api_ws_proj")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "gpt-4o-mini"}]})
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=_sse_body([
                    {"choices": [{"delta": {"content": "ARIES V3 "}}]},
                    {"choices": [{"delta": {"content": "uses rv32i_zicsr."}, "finish_reason": "stop"}]},
                ]),
            )
        return httpx.Response(404)

    svc = AIService(
        s,
        credential_manager=creds,
        http_client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    app.dependency_overrides[get_ai_service] = lambda: svc
    try:
        with TestClient(app) as client:
            prov_res = client.get("/api/ai/providers")
            assert prov_res.status_code == 200
            assert len(prov_res.json()["providers"]) == 3

            # Configure provider & save credential (masked in response!)
            cfg_res = client.put(
                "/api/ai/config",
                json={
                    "active_provider": "openai",
                    "providers": {
                        "openai": {"model": "gpt-4o-mini", "base_url": None},
                        "groq": {"model": "llama-3.3-70b-versatile", "base_url": None},
                        "openai_compatible": {"model": "qwen2.5-coder:7b", "base_url": "http://127.0.0.1:11434/v1"},
                    },
                    "temperature": 0.2,
                    "max_tokens": 1024,
                    "timeout_seconds": 30.0,
                    "allow_context_tools": True,
                    "auto_include_workspace_summary": True,
                },
            )
            assert cfg_res.status_code == 200

            cred_put = client.put(
                "/api/ai/credentials/openai",
                json={"api_key": "sk-api-route-secret-4321", "session_only": False},
            )
            assert cred_put.status_code == 200
            assert cred_put.json()["has_api_key"] is True
            assert "sk-api-route-secret" not in cred_put.text

            test_res = client.post("/api/ai/test-connection", json={"provider_id": "openai"})
            assert test_res.status_code == 200
            assert test_res.json()["ok"] is True

            conv_res = client.post("/api/ai/conversations", json={"project_dir": proj_dir})
            assert conv_res.status_code == 201
            cid = conv_res.json()["conversation"]["conversation_id"]

            # WebSocket snapshot + live streamed generation frames
            with client.websocket_connect(f"/api/ai/ws/{cid}") as ws:
                snap = json.loads(ws.receive_text())
                assert snap["type"] == "snapshot"

                msg_res = client.post(
                    f"/api/ai/conversations/{cid}/messages",
                    json={"project_dir": proj_dir, "prompt": "What ISA does ARIES V3 use?"},
                )
                assert msg_res.status_code == 200

                events: List[Dict[str, Any]] = []
                for _ in range(15):
                    frame = json.loads(ws.receive_text())
                    events.append(frame)
                    if frame.get("type") == "generation_completed":
                        break
                types = [e.get("type") for e in events]
                assert "generation_started" in types
                assert "generation_completed" in types
                completed = next(e for e in events if e.get("type") == "generation_completed")
                assert "rv32i_zicsr" in completed["detail"]["messages"][-1]["content"]

            # Remove credential
            del_cred = client.delete("/api/ai/credentials/openai")
            assert del_cred.status_code == 200
            assert del_cred.json()["has_api_key"] is False

            # Delete conversation
            del_conv = client.delete(f"/api/ai/conversations/{cid}")
            assert del_conv.status_code == 200
            assert del_conv.json()["deleted"] is True
    finally:
        svc.shutdown()
        app.dependency_overrides.pop(get_ai_service, None)


@pytest.mark.asyncio
async def test_groq_responses_api_streaming_tools_and_env_key(
    tmp_path: Path, monkeypatch
):
    s = _make_settings(tmp_path)
    proj_dir = _create_project(s, tmp_path / "projects", "groq_fw")
    (Path(proj_dir) / "src" / "main.c").write_text("int groq_sensor = 7;\n", encoding="utf-8")

    monkeypatch.setenv("GROQ_API_KEY", "gsk_env_test_secret_987654")
    creds = AICredentialManager(backend=UnavailableOSCredentialBackend("No keyring"))
    recorded_bodies: List[Dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.groq.com" and request.url.path == "/openai/v1/models":
            assert request.headers.get("Authorization") == "Bearer gsk_env_test_secret_987654"
            return httpx.Response(404, json={"error": {"message": "Not implemented"}})
        if request.url.host == "api.groq.com" and request.url.path == "/openai/v1/responses":
            assert request.headers.get("Authorization") == "Bearer gsk_env_test_secret_987654"
            body = json.loads(request.content.decode("utf-8"))
            recorded_bodies.append(body)
            if body.get("stream") is False:
                return httpx.Response(200, json={"id": "resp_probe", "output_text": "pong"})
            if len([b for b in recorded_bodies if b.get("stream")]) == 1:
                return httpx.Response(
                    200,
                    headers={"Content-Type": "text/event-stream"},
                    content=_sse_body([
                        {
                            "type": "response.output_item.added",
                            "output_index": 0,
                            "item": {
                                "id": "fc_item_1",
                                "type": "function_call",
                                "call_id": "call_groq_1",
                                "name": "read_project_file",
                            },
                        },
                        {
                            "type": "response.function_call_arguments.delta",
                            "item_id": "fc_item_1",
                            "output_index": 0,
                            "delta": '{"relative_path": "src/main.c"}',
                        },
                        {
                            "type": "response.completed",
                            "response": {"id": "resp_1", "usage": {"input_tokens": 12, "output_tokens": 6, "total_tokens": 18}},
                        },
                    ]),
                )
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=_sse_body([
                    {"type": "response.output_text.delta", "delta": "Fast models explain "},
                    {"type": "response.output_text.delta", "delta": "groq_sensor=7 clearly."},
                    {
                        "type": "response.completed",
                        "response": {"id": "resp_2", "usage": {"input_tokens": 25, "output_tokens": 9, "total_tokens": 34}},
                    },
                ]),
            )
        return httpx.Response(404)

    svc = AIService(
        s,
        credential_manager=creds,
        http_client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    try:
        state = svc.get_providers_state()
        assert state.config.providers["groq"].model == "openai/gpt-oss-20b"
        groq_info = next(p for p in state.providers if p.id == "groq")
        assert groq_info.default_base_url == "https://api.groq.com/openai/v1"
        assert groq_info.recommended_models[0] == "openai/gpt-oss-20b"
        assert groq_info.credential.has_api_key is True
        assert groq_info.credential.persistence_mode == "environment"

        probe = await svc.test_connection(AIConnectionTestRequest(provider_id="groq"))
        assert probe.ok is True
        assert probe.model == "openai/gpt-oss-20b"

        new_cfg = state.config.model_copy(update={"active_provider": "groq"})
        svc.update_config(AIConfigUpdateRequest(**new_cfg.model_dump()))

        conv = svc.create_conversation(AIConversationCreateRequest(project_dir=proj_dir))
        await svc.send_message(
            conv.conversation.conversation_id,
            AISendMessageRequest(project_dir=proj_dir, prompt="Explain src/main.c"),
        )
        for _ in range(40):
            detail = svc.get_conversation(conv.conversation.conversation_id)
            if detail.conversation.status != "streaming":
                break
            await asyncio.sleep(0.05)

        detail = svc.get_conversation(conv.conversation.conversation_id)
        assert detail.conversation.status == "idle"
        assistant_msg = detail.messages[-1]
        assert assistant_msg.content == "Fast models explain groq_sensor=7 clearly."
        assert assistant_msg.provider_id == "groq"
        assert assistant_msg.model == "openai/gpt-oss-20b"
        assert len(assistant_msg.tool_traces) == 1
        assert assistant_msg.tool_traces[0].name == "read_project_file"
        assert "gsk_env_test_secret_987654" not in assistant_msg.content

        stream_calls = [b for b in recorded_bodies if b.get("stream")]
        assert len(stream_calls) == 2
        assert stream_calls[0]["model"] == "openai/gpt-oss-20b"
        assert "instructions" in stream_calls[0]
        assert any(item.get("type") == "function_call_output" and item.get("call_id") == "call_groq_1" for item in stream_calls[1]["input"])
    finally:
        svc.shutdown()
