"""VEGA Studio Backend – Extensible AI provider abstraction for Phase 15."""
from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx

from app.models.ai import (
    AIConnectionTestResponse,
    AIProviderId,
    AIUsageInfo,
    MAX_AI_RESPONSE_CHARS,
    validate_ai_base_url,
    validate_ai_model_name,
)
from app.services.ai_credentials import scrub_ai_secrets


@dataclass(frozen=True)
class ProviderDescriptor:
    id: AIProviderId
    label: str
    description: str
    default_base_url: str
    requires_base_url: bool
    api_key_optional: bool
    supports_streaming: bool
    supports_tools: bool
    recommended_models: Tuple[str, ...]


@dataclass
class AIToolCallDelta:
    index: int
    call_id: Optional[str] = None
    name: Optional[str] = None
    arguments_delta: str = ""


@dataclass
class AIStreamChunk:
    text_delta: str = ""
    tool_deltas: List[AIToolCallDelta] = field(default_factory=list)
    finish_reason: Optional[str] = None
    usage: Optional[AIUsageInfo] = None


class AIProviderError(Exception):
    """Normalized provider failure scrubbed of all credentials."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 502,
        error_code: str = "provider_error",
        retryable: bool = False,
        retry_after_seconds: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds


class AIProviderAdapter(ABC):
    """Provider-independent interface so new LLM backends plug in without touching AIService."""

    descriptor: ProviderDescriptor

    def resolve_base_url(self, configured_base_url: Optional[str]) -> str:
        raw = configured_base_url or self.descriptor.default_base_url
        validated = validate_ai_base_url(raw)
        if not validated:
            raise AIProviderError(
                f"{self.descriptor.label} requires a valid HTTP/HTTPS Base URL.",
                status_code=400,
                error_code="invalid_base_url",
            )
        return validated

    @abstractmethod
    async def test_connection(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        timeout_seconds: float,
    ) -> AIConnectionTestResponse:
        ...

    @abstractmethod
    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        timeout_seconds: float = 45.0,
    ) -> AsyncIterator[AIStreamChunk]:
        ...


class _OpenAIChatCompletionsAdapter(AIProviderAdapter):
    """Shared async SSE Chat Completions adapter for OpenAI, Groq, and OpenAI-compatible APIs."""

    def _build_headers(self, api_key: Optional[str]) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    def _normalize_http_error(
        self,
        status_code: int,
        raw_text: str,
        *,
        api_key: Optional[str],
        retry_after_header: Optional[str] = None,
    ) -> AIProviderError:
        extra = (api_key,) if api_key else ()
        scrubbed = scrub_ai_secrets(raw_text, extra_secrets=extra)
        detail = scrubbed.strip()
        try:
            parsed = json.loads(scrubbed)
            if isinstance(parsed, dict):
                err_obj = parsed.get("error")
                if isinstance(err_obj, dict) and err_obj.get("message"):
                    detail = str(err_obj["message"])
                elif parsed.get("message"):
                    detail = str(parsed["message"])
        except json.JSONDecodeError:
            pass
        detail = scrub_ai_secrets(detail[:400], extra_secrets=extra) or f"HTTP {status_code}"

        retry_after: Optional[int] = None
        if retry_after_header and retry_after_header.strip().isdigit():
            retry_after = min(300, max(1, int(retry_after_header.strip())))

        if status_code in (401, 403):
            return AIProviderError(
                f"{self.descriptor.label} authentication failed ({status_code}): check API key permissions. {detail}",
                status_code=401,
                error_code="auth_failed",
                retryable=False,
            )
        if status_code == 429:
            return AIProviderError(
                f"{self.descriptor.label} rate limit reached (429). {detail}",
                status_code=429,
                error_code="rate_limited",
                retryable=True,
                retry_after_seconds=retry_after,
            )
        if status_code == 404:
            return AIProviderError(
                f"{self.descriptor.label} endpoint or model not found (404): {detail}",
                status_code=400,
                error_code="model_or_endpoint_not_found",
                retryable=False,
            )
        if 400 <= status_code < 500:
            return AIProviderError(
                f"{self.descriptor.label} rejected request ({status_code}): {detail}",
                status_code=400,
                error_code="bad_request",
                retryable=False,
            )
        return AIProviderError(
            f"{self.descriptor.label} upstream failure ({status_code}): {detail}",
            status_code=502,
            error_code="upstream_error",
            retryable=True,
        )

    async def test_connection(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        timeout_seconds: float,
    ) -> AIConnectionTestResponse:
        if not api_key and not self.descriptor.api_key_optional:
            return AIConnectionTestResponse(
                ok=False,
                provider_id=self.descriptor.id,
                endpoint=base_url or self.descriptor.default_base_url,
                model=model,
                latency_ms=0,
                message=f"No API key configured for {self.descriptor.label}.",
                error_code="missing_api_key",
            )

        clean_model = validate_ai_model_name(model)
        if not clean_model:
            raise AIProviderError("Model identifier is invalid.", status_code=400, error_code="invalid_model")

        endpoint = self.resolve_base_url(base_url)
        headers = self._build_headers(api_key)
        started = time.monotonic()

        try:
            resp = await client.get(
                f"{endpoint}/models",
                headers=headers,
                timeout=min(timeout_seconds, 15.0),
            )
            latency_ms = int((time.monotonic() - started) * 1000)

            if 200 <= resp.status_code < 300:
                discovered: List[str] = []
                try:
                    payload = resp.json()
                    items = payload.get("data", []) if isinstance(payload, dict) else []
                    for item in items[:60]:
                        if isinstance(item, dict) and item.get("id"):
                            discovered.append(str(item["id"]))
                except Exception:
                    pass
                return AIConnectionTestResponse(
                    ok=True,
                    provider_id=self.descriptor.id,
                    endpoint=endpoint,
                    model=clean_model,
                    latency_ms=latency_ms,
                    message=f"Connected to {self.descriptor.label} ({len(discovered)} models listed).",
                    discovered_models=discovered,
                )

            # Fallback minimal chat probe when an OpenAI-compatible server omits /models
            if resp.status_code in (404, 405) and self.descriptor.id == "openai_compatible":
                probe = await client.post(
                    f"{endpoint}/chat/completions",
                    headers=headers,
                    json={
                        "model": clean_model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 1,
                        "stream": False,
                    },
                    timeout=min(timeout_seconds, 15.0),
                )
                latency_ms = int((time.monotonic() - started) * 1000)
                if 200 <= probe.status_code < 300:
                    return AIConnectionTestResponse(
                        ok=True,
                        provider_id=self.descriptor.id,
                        endpoint=endpoint,
                        model=clean_model,
                        latency_ms=latency_ms,
                        message=f"Connected to {self.descriptor.label} via chat completions probe.",
                    )
                err = self._normalize_http_error(
                    probe.status_code,
                    probe.text,
                    api_key=api_key,
                    retry_after_header=probe.headers.get("Retry-After"),
                )
                return AIConnectionTestResponse(
                    ok=False,
                    provider_id=self.descriptor.id,
                    endpoint=endpoint,
                    model=clean_model,
                    latency_ms=latency_ms,
                    message=err.message,
                    error_code=err.error_code,
                )

            err = self._normalize_http_error(
                resp.status_code,
                resp.text,
                api_key=api_key,
                retry_after_header=resp.headers.get("Retry-After"),
            )
            return AIConnectionTestResponse(
                ok=False,
                provider_id=self.descriptor.id,
                endpoint=endpoint,
                model=clean_model,
                latency_ms=latency_ms,
                message=err.message,
                error_code=err.error_code,
            )
        except httpx.TimeoutException:
            latency_ms = int((time.monotonic() - started) * 1000)
            return AIConnectionTestResponse(
                ok=False,
                provider_id=self.descriptor.id,
                endpoint=endpoint,
                model=clean_model,
                latency_ms=latency_ms,
                message=f"Connection to {endpoint} timed out.",
                error_code="timeout",
            )
        except (httpx.InvalidURL, UnicodeEncodeError, ValueError) as exc:
            latency_ms = int((time.monotonic() - started) * 1000)
            return AIConnectionTestResponse(
                ok=False,
                provider_id=self.descriptor.id,
                endpoint=endpoint,
                model=clean_model,
                latency_ms=latency_ms,
                message=scrub_ai_secrets(f"Invalid provider endpoint or header characters: {exc}", (api_key,) if api_key else ()),
                error_code="invalid_request",
            )
        except httpx.HTTPError as exc:
            latency_ms = int((time.monotonic() - started) * 1000)
            return AIConnectionTestResponse(
                ok=False,
                provider_id=self.descriptor.id,
                endpoint=endpoint,
                model=clean_model,
                latency_ms=latency_ms,
                message=scrub_ai_secrets(f"Network error contacting {endpoint}: {exc}", (api_key,) if api_key else ()),
                error_code="network_error",
            )

    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        timeout_seconds: float = 45.0,
    ) -> AsyncIterator[AIStreamChunk]:
        if not api_key and not self.descriptor.api_key_optional:
            raise AIProviderError(
                f"No API key configured for {self.descriptor.label}. Add an API key in AI Settings.",
                status_code=400,
                error_code="missing_api_key",
            )

        clean_model = validate_ai_model_name(model)
        if not clean_model:
            raise AIProviderError("Model identifier is invalid.", status_code=400, error_code="invalid_model")

        endpoint = self.resolve_base_url(base_url)
        headers = self._build_headers(api_key)
        payload: Dict[str, Any] = {
            "model": clean_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if self.descriptor.id in ("openai", "groq"):
            payload["stream_options"] = {"include_usage": True}
        if tools and self.descriptor.supports_tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        emitted_chars = 0
        try:
            async with client.stream(
                "POST",
                f"{endpoint}/chat/completions",
                headers=headers,
                json=payload,
                timeout=httpx.Timeout(timeout_seconds, connect=min(10.0, timeout_seconds)),
            ) as resp:
                if resp.status_code < 200 or resp.status_code >= 300:
                    raw_bytes = await resp.aread()
                    raise self._normalize_http_error(
                        resp.status_code,
                        raw_bytes.decode("utf-8", errors="replace"),
                        api_key=api_key,
                        retry_after_header=resp.headers.get("Retry-After"),
                    )

                ctype = (resp.headers.get("content-type") or "").lower()
                if "application/json" in ctype and "text/event-stream" not in ctype:
                    # Handle providers returning non-streaming JSON despite stream=True
                    raw_bytes = await resp.aread()
                    parsed = json.loads(raw_bytes.decode("utf-8", errors="replace"))
                    choices = parsed.get("choices") or []
                    if choices:
                        msg = choices[0].get("message") or {}
                        text = str(msg.get("content") or "")[:MAX_AI_RESPONSE_CHARS]
                        tool_deltas = []
                        for idx, tc in enumerate(msg.get("tool_calls") or []):
                            fn = tc.get("function") or {}
                            tool_deltas.append(
                                AIToolCallDelta(
                                    index=idx,
                                    call_id=tc.get("id"),
                                    name=fn.get("name"),
                                    arguments_delta=str(fn.get("arguments") or ""),
                                )
                            )
                        usage = None
                        if isinstance(parsed.get("usage"), dict):
                            u = parsed["usage"]
                            usage = AIUsageInfo(
                                prompt_tokens=u.get("prompt_tokens"),
                                completion_tokens=u.get("completion_tokens"),
                                total_tokens=u.get("total_tokens"),
                            )
                        yield AIStreamChunk(
                            text_delta=text,
                            tool_deltas=tool_deltas,
                            finish_reason=choices[0].get("finish_reason"),
                            usage=usage,
                        )
                    return

                async for line in resp.aiter_lines():
                    stripped = line.strip()
                    if not stripped or stripped.startswith(":"):
                        continue
                    if not stripped.startswith("data:"):
                        continue
                    data_part = stripped[5:].strip()
                    if data_part == "[DONE]":
                        break
                    try:
                        event_obj = json.loads(data_part)
                    except json.JSONDecodeError:
                        continue

                    usage_info: Optional[AIUsageInfo] = None
                    if isinstance(event_obj.get("usage"), dict):
                        u = event_obj["usage"]
                        usage_info = AIUsageInfo(
                            prompt_tokens=u.get("prompt_tokens"),
                            completion_tokens=u.get("completion_tokens"),
                            total_tokens=u.get("total_tokens"),
                        )

                    choices = event_obj.get("choices") or []
                    if not choices:
                        if usage_info:
                            yield AIStreamChunk(usage=usage_info)
                        continue

                    choice = choices[0] or {}
                    delta = choice.get("delta") or {}
                    finish_reason = choice.get("finish_reason")

                    text_delta = ""
                    raw_content = delta.get("content")
                    if isinstance(raw_content, str) and raw_content:
                        remaining = MAX_AI_RESPONSE_CHARS - emitted_chars
                        if remaining > 0:
                            text_delta = raw_content[:remaining]
                            emitted_chars += len(text_delta)

                    tool_deltas: List[AIToolCallDelta] = []
                    for tc in delta.get("tool_calls") or []:
                        if not isinstance(tc, dict):
                            continue
                        fn = tc.get("function") or {}
                        tool_deltas.append(
                            AIToolCallDelta(
                                index=int(tc.get("index", 0)),
                                call_id=tc.get("id"),
                                name=fn.get("name"),
                                arguments_delta=str(fn.get("arguments") or ""),
                            )
                        )

                    if text_delta or tool_deltas or finish_reason or usage_info:
                        yield AIStreamChunk(
                            text_delta=text_delta,
                            tool_deltas=tool_deltas,
                            finish_reason=finish_reason,
                            usage=usage_info,
                        )
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                f"{self.descriptor.label} request timed out after {timeout_seconds:.0f}s.",
                status_code=504,
                error_code="timeout",
                retryable=True,
            ) from exc
        except (httpx.InvalidURL, UnicodeEncodeError, ValueError) as exc:
            raise AIProviderError(
                scrub_ai_secrets(
                    f"Invalid request configuration for {self.descriptor.label}: {exc}",
                    (api_key,) if api_key else (),
                ),
                status_code=400,
                error_code="invalid_request",
                retryable=False,
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                scrub_ai_secrets(
                    f"Network failure calling {self.descriptor.label}: {exc}",
                    (api_key,) if api_key else (),
                ),
                status_code=502,
                error_code="network_error",
                retryable=True,
            ) from exc


class OpenAIProviderAdapter(_OpenAIChatCompletionsAdapter):
    descriptor = ProviderDescriptor(
        id="openai",
        label="OpenAI",
        description="Official OpenAI Chat Completions API (api.openai.com).",
        default_base_url="https://api.openai.com/v1",
        requires_base_url=False,
        api_key_optional=False,
        supports_streaming=True,
        supports_tools=True,
        recommended_models=("gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"),
    )


def _messages_to_responses_input(
    messages: List[Dict[str, Any]],
) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    """Convert OpenAI chat message history into OpenAI/Groq Responses API (instructions, input) payload."""
    sys_parts: List[str] = []
    items: List[Dict[str, Any]] = []
    for msg in messages:
        role = str(msg.get("role") or "")
        if role == "system":
            text = str(msg.get("content") or "").strip()
            if text:
                sys_parts.append(text)
            continue
        if role == "user":
            items.append(
                {
                    "type": "message",
                    "role": "user",
                    "content": str(msg.get("content") or ""),
                }
            )
            continue
        if role == "assistant":
            text = msg.get("content")
            if isinstance(text, str) and text:
                items.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": text,
                    }
                )
            for tc in msg.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                items.append(
                    {
                        "type": "function_call",
                        "call_id": str(tc.get("id") or ""),
                        "name": str(fn.get("name") or ""),
                        "arguments": str(fn.get("arguments") or "{}"),
                    }
                )
            continue
        if role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": str(msg.get("tool_call_id") or ""),
                    "output": str(msg.get("content") or ""),
                }
            )
    instructions = "\n\n".join(sys_parts) if sys_parts else None
    return instructions, items


def _tools_to_responses_format(
    tools: Optional[List[Dict[str, Any]]],
) -> Optional[List[Dict[str, Any]]]:
    """Convert Chat Completions tool definitions to Responses API flat function definitions."""
    if not tools:
        return None
    out: List[Dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
            fn = tool["function"]
            out.append(
                {
                    "type": "function",
                    "name": fn.get("name"),
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
                }
            )
        else:
            out.append(tool)
    return out or None


def _extract_responses_usage(obj: Any) -> Optional[AIUsageInfo]:
    if not isinstance(obj, dict):
        return None
    prompt_t = obj.get("input_tokens") if obj.get("input_tokens") is not None else obj.get("prompt_tokens")
    comp_t = obj.get("output_tokens") if obj.get("output_tokens") is not None else obj.get("completion_tokens")
    total_t = obj.get("total_tokens")
    if prompt_t is None and comp_t is None and total_t is None:
        return None
    return AIUsageInfo(
        prompt_tokens=prompt_t,
        completion_tokens=comp_t,
        total_tokens=total_t,
    )


def _extract_responses_output(
    parsed: Dict[str, Any],
) -> Tuple[str, List[AIToolCallDelta]]:
    """Extract output text and tool calls from a Responses API object."""
    text_parts: List[str] = []
    tool_deltas: List[AIToolCallDelta] = []
    output_items = parsed.get("output")
    if isinstance(output_items, list):
        tc_idx = 0
        for item in output_items:
            if not isinstance(item, dict):
                continue
            itype = item.get("type")
            if itype == "message":
                for block in item.get("content") or []:
                    if isinstance(block, dict):
                        txt = block.get("text")
                        if isinstance(txt, str) and txt:
                            text_parts.append(txt)
            elif itype == "function_call":
                tool_deltas.append(
                    AIToolCallDelta(
                        index=tc_idx,
                        call_id=item.get("call_id") or item.get("id"),
                        name=item.get("name"),
                        arguments_delta=str(item.get("arguments") or ""),
                    )
                )
                tc_idx += 1

    text = "".join(text_parts)
    if not text and isinstance(parsed.get("output_text"), str):
        text = parsed["output_text"]
    return text[:MAX_AI_RESPONSE_CHARS], tool_deltas


class GroqProviderAdapter(_OpenAIChatCompletionsAdapter):
    """Groq inference adapter built on the OpenAI Responses API (`/openai/v1/responses`)."""

    descriptor = ProviderDescriptor(
        id="groq",
        label="Groq",
        description="Low-latency Groq OpenAI Responses API (api.groq.com/openai/v1).",
        default_base_url="https://api.groq.com/openai/v1",
        requires_base_url=False,
        api_key_optional=False,
        supports_streaming=True,
        supports_tools=True,
        recommended_models=(
            "openai/gpt-oss-20b",
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen/qwen3-32b",
        ),
    )

    async def test_connection(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        timeout_seconds: float,
    ) -> AIConnectionTestResponse:
        res = await super().test_connection(
            client,
            model=model,
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
        )
        if res.ok or res.error_code in ("missing_api_key", "auth_failed", "rate_limited", "timeout", "invalid_model"):
            return res

        # Fall back to minimal POST /responses probe if /models was unavailable
        clean_model = validate_ai_model_name(model) or "openai/gpt-oss-20b"
        endpoint = self.resolve_base_url(base_url)
        headers = self._build_headers(api_key)
        started = time.monotonic()
        try:
            probe = await client.post(
                f"{endpoint}/responses",
                headers=headers,
                json={
                    "model": clean_model,
                    "input": "ping",
                    "max_output_tokens": 16,
                    "stream": False,
                },
                timeout=min(timeout_seconds, 15.0),
            )
            latency_ms = int((time.monotonic() - started) * 1000)
            if 200 <= probe.status_code < 300:
                return AIConnectionTestResponse(
                    ok=True,
                    provider_id=self.descriptor.id,
                    endpoint=endpoint,
                    model=clean_model,
                    latency_ms=latency_ms,
                    message=f"Connected to {self.descriptor.label} Responses API ({clean_model}).",
                )
        except Exception:
            pass
        return res

    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        timeout_seconds: float = 45.0,
    ) -> AsyncIterator[AIStreamChunk]:
        if not api_key and not self.descriptor.api_key_optional:
            raise AIProviderError(
                f"No API key configured for {self.descriptor.label}. Add an API key in AI Settings or set GROQ_API_KEY.",
                status_code=400,
                error_code="missing_api_key",
            )

        clean_model = validate_ai_model_name(model)
        if not clean_model:
            raise AIProviderError("Model identifier is invalid.", status_code=400, error_code="invalid_model")

        endpoint = self.resolve_base_url(base_url)
        headers = self._build_headers(api_key)
        instructions, input_items = _messages_to_responses_input(messages)
        payload: Dict[str, Any] = {
            "model": clean_model,
            "input": input_items,
            "temperature": temperature,
            "max_output_tokens": max_tokens,
            "stream": True,
        }
        if instructions:
            payload["instructions"] = instructions
        converted_tools = _tools_to_responses_format(tools) if self.descriptor.supports_tools else None
        if converted_tools:
            payload["tools"] = converted_tools
            payload["tool_choice"] = "auto"

        emitted_chars = 0
        # Track function_call output items by item_id / output_index for argument streaming
        item_index_by_id: Dict[str, int] = {}
        next_tool_index = 0
        seen_tool_item_args: set[int] = set()

        try:
            async with client.stream(
                "POST",
                f"{endpoint}/responses",
                headers=headers,
                json=payload,
                timeout=httpx.Timeout(timeout_seconds, connect=min(10.0, timeout_seconds)),
            ) as resp:
                if resp.status_code < 200 or resp.status_code >= 300:
                    raw_bytes = await resp.aread()
                    raise self._normalize_http_error(
                        resp.status_code,
                        raw_bytes.decode("utf-8", errors="replace"),
                        api_key=api_key,
                        retry_after_header=resp.headers.get("Retry-After"),
                    )

                ctype = (resp.headers.get("content-type") or "").lower()
                if "application/json" in ctype and "text/event-stream" not in ctype:
                    raw_bytes = await resp.aread()
                    parsed = json.loads(raw_bytes.decode("utf-8", errors="replace"))
                    text, tool_deltas = _extract_responses_output(parsed)
                    usage = _extract_responses_usage(parsed.get("usage"))
                    yield AIStreamChunk(
                        text_delta=text,
                        tool_deltas=tool_deltas,
                        finish_reason="tool_calls" if tool_deltas else "stop",
                        usage=usage,
                    )
                    return

                async for line in resp.aiter_lines():
                    stripped = line.strip()
                    if not stripped or stripped.startswith(":"):
                        continue
                    if not stripped.startswith("data:"):
                        continue
                    data_part = stripped[5:].strip()
                    if data_part == "[DONE]":
                        break
                    try:
                        event_obj = json.loads(data_part)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(event_obj, dict):
                        continue

                    ev_type = str(event_obj.get("type") or "")

                    if ev_type in ("response.failed", "error"):
                        err_obj = event_obj.get("error") or (event_obj.get("response") or {}).get("error")
                        msg = (
                            str(err_obj.get("message"))
                            if isinstance(err_obj, dict) and err_obj.get("message")
                            else "Groq Responses API stream failed."
                        )
                        raise AIProviderError(
                            scrub_ai_secrets(msg, (api_key,) if api_key else ()),
                            status_code=502,
                            error_code="provider_error",
                        )

                    if ev_type == "response.output_text.delta":
                        raw_delta = event_obj.get("delta")
                        if isinstance(raw_delta, str) and raw_delta:
                            remaining = MAX_AI_RESPONSE_CHARS - emitted_chars
                            if remaining > 0:
                                piece = raw_delta[:remaining]
                                emitted_chars += len(piece)
                                yield AIStreamChunk(text_delta=piece)
                        continue

                    if ev_type == "response.output_item.added":
                        item = event_obj.get("item")
                        if isinstance(item, dict) and item.get("type") == "function_call":
                            item_id = str(item.get("id") or "")
                            idx = item_index_by_id.get(item_id)
                            if idx is None:
                                idx = next_tool_index
                                next_tool_index += 1
                                if item_id:
                                    item_index_by_id[item_id] = idx
                            call_id = item.get("call_id") or item_id or None
                            name = item.get("name") or None
                            yield AIStreamChunk(
                                tool_deltas=[
                                    AIToolCallDelta(
                                        index=idx,
                                        call_id=str(call_id) if call_id else None,
                                        name=str(name) if name else None,
                                    )
                                ]
                            )
                        continue

                    if ev_type == "response.function_call_arguments.delta":
                        item_id = str(event_obj.get("item_id") or "")
                        idx = item_index_by_id.get(item_id)
                        if idx is None:
                            raw_idx = event_obj.get("output_index")
                            idx = int(raw_idx) if isinstance(raw_idx, int) else 0
                            if item_id:
                                item_index_by_id[item_id] = idx
                        delta_args = str(event_obj.get("delta") or "")
                        if delta_args:
                            seen_tool_item_args.add(idx)
                            yield AIStreamChunk(
                                tool_deltas=[AIToolCallDelta(index=idx, arguments_delta=delta_args)]
                            )
                        continue

                    if ev_type == "response.output_item.done":
                        item = event_obj.get("item")
                        if isinstance(item, dict) and item.get("type") == "function_call":
                            item_id = str(item.get("id") or "")
                            idx = item_index_by_id.get(item_id)
                            if idx is not None and idx not in seen_tool_item_args:
                                args = str(item.get("arguments") or "")
                                if args:
                                    seen_tool_item_args.add(idx)
                                    yield AIStreamChunk(
                                        tool_deltas=[AIToolCallDelta(index=idx, arguments_delta=args)]
                                    )
                        continue

                    if ev_type in ("response.completed", "response.done"):
                        resp_obj = event_obj.get("response") if isinstance(event_obj.get("response"), dict) else {}
                        usage_info = _extract_responses_usage(resp_obj.get("usage"))
                        fallback_text = ""
                        fallback_tools: List[AIToolCallDelta] = []
                        if emitted_chars == 0 and resp_obj:
                            ext_text, ext_tools = _extract_responses_output(resp_obj)
                            if ext_text:
                                remaining = MAX_AI_RESPONSE_CHARS - emitted_chars
                                fallback_text = ext_text[:max(0, remaining)]
                                emitted_chars += len(fallback_text)
                            if not item_index_by_id and ext_tools:
                                fallback_tools = ext_tools
                        yield AIStreamChunk(
                            text_delta=fallback_text,
                            tool_deltas=fallback_tools,
                            finish_reason="tool_calls" if (item_index_by_id or fallback_tools) else "stop",
                            usage=usage_info,
                        )
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                f"{self.descriptor.label} request timed out after {timeout_seconds:.0f}s.",
                status_code=504,
                error_code="timeout",
                retryable=True,
            ) from exc
        except (httpx.InvalidURL, UnicodeEncodeError, ValueError) as exc:
            raise AIProviderError(
                scrub_ai_secrets(
                    f"Invalid request configuration for {self.descriptor.label}: {exc}",
                    (api_key,) if api_key else (),
                ),
                status_code=400,
                error_code="invalid_request",
                retryable=False,
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                scrub_ai_secrets(
                    f"Network failure calling {self.descriptor.label}: {exc}",
                    (api_key,) if api_key else (),
                ),
                status_code=502,
                error_code="network_error",
                retryable=True,
            ) from exc


class OpenAICompatibleAdapter(_OpenAIChatCompletionsAdapter):
    descriptor = ProviderDescriptor(
        id="openai_compatible",
        label="OpenAI-Compatible",
        description="Custom OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, or self-hosted gateway).",
        default_base_url="http://127.0.0.1:11434/v1",
        requires_base_url=True,
        api_key_optional=True,
        supports_streaming=True,
        supports_tools=True,
        recommended_models=("qwen2.5-coder:7b", "llama3.2:latest", "deepseek-coder-v2"),
    )


_PROVIDER_REGISTRY: Dict[AIProviderId, AIProviderAdapter] = {
    "openai": OpenAIProviderAdapter(),
    "groq": GroqProviderAdapter(),
    "openai_compatible": OpenAICompatibleAdapter(),
}


def get_provider_adapter(provider_id: AIProviderId) -> AIProviderAdapter:
    adapter = _PROVIDER_REGISTRY.get(provider_id)
    if adapter is None:
        raise AIProviderError(f"Unsupported AI provider '{provider_id}'.", status_code=400)
    return adapter


def list_provider_adapters() -> List[AIProviderAdapter]:
    return [
        _PROVIDER_REGISTRY["openai"],
        _PROVIDER_REGISTRY["groq"],
        _PROVIDER_REGISTRY["openai_compatible"],
    ]
