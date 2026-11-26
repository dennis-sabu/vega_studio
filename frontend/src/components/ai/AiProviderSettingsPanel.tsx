"use client";

import { useState, type FormEvent } from"react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from"lucide-react";
import type {
  AIConfig,
  AIConnectionTestResponse,
  AIProviderId,
  AIProviderProfileConfig,
  AIProvidersStateResponse,
} from"@/types/ai";

export interface AiProviderSettingsPanelProps {
  providersState: AIProvidersStateResponse | null;
  isBackendConnected: boolean;
  saving: boolean;
  testing: boolean;
  loading: boolean;
  error?: string | null;
  testResult: AIConnectionTestResponse | null;
  onRefresh: () => void;
  onSaveConfig: (config: AIConfig) => Promise<unknown>;
  onResetConfig: () => Promise<unknown>;
  onSaveCredential: (
    providerId: AIProviderId,
    apiKey: string,
    sessionOnly: boolean
  ) => Promise<boolean>;
  onRemoveCredential: (providerId: AIProviderId) => Promise<boolean>;
  onTestConnection: (payload: {
    provider_id: AIProviderId;
    model?: string | null;
    base_url?: string | null;
    api_key_override?: string | null;
  }) => Promise<unknown>;
}

const DEFAULT_AI_CONFIG: AIConfig = {
  active_provider: "openai",
  providers: {
    openai: { model: "gpt-4o-mini", base_url: null },
    groq: { model: "llama-3.3-70b-versatile", base_url: null },
    openai_compatible: {
      model: "qwen2.5-coder:7b",
      base_url: "http://127.0.0.1:11434/v1",
    },
  },
  temperature: 0.2,
  max_tokens: 2048,
  timeout_seconds: 45,
  allow_context_tools: true,
  auto_include_workspace_summary: true,
};

export function AiProviderSettingsPanel({
  providersState,
  isBackendConnected,
  saving,
  testing,
  loading,
  error,
  testResult,
  onRefresh,
  onSaveConfig,
  onResetConfig,
  onSaveCredential,
  onRemoveCredential,
  onTestConnection,
}: AiProviderSettingsPanelProps) {
  const baseCfg = providersState?.config ?? DEFAULT_AI_CONFIG;
  const [edits, setEdits] = useState<Partial<AIConfig>>({});
  const [providerEdits, setProviderEdits] = useState<
    Partial<Record<AIProviderId, Partial<AIProviderProfileConfig>>>
  >({});
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [sessionOnlyKey, setSessionOnlyKey] = useState(
    () => providersState?.storage.os_storage_available === false
  );
  const [confirmReset, setConfirmReset] = useState(false);

  const draft: AIConfig = {
    ...baseCfg,
    ...edits,
    providers: {
      openai: {
        ...baseCfg.providers.openai,
        ...(providerEdits.openai ?? {}),
      },
      groq: {
        ...baseCfg.providers.groq,
        ...(providerEdits.groq ?? {}),
      },
      openai_compatible: {
        ...baseCfg.providers.openai_compatible,
        ...(providerEdits.openai_compatible ?? {}),
      },
    },
  };

  const hasUnsavedConfig =
    Object.keys(edits).length > 0 || Object.keys(providerEdits).length > 0;
  const activeId = draft.active_provider;
  const activeProfile = draft.providers[activeId];
  const providerList = providersState?.providers ?? [];
  const activeStatus = providerList.find((p) => p.id === activeId) ?? null;
  const storage = providersState?.storage ?? null;

  const updateProviderField = (
    pid: AIProviderId,
    partial: Partial<AIProviderProfileConfig>
  ) => {
    setProviderEdits((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? {}), ...partial },
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const res = await onSaveConfig(draft);
    if (res) {
      setEdits({});
      setProviderEdits({});
    }
  };

  const handleSaveKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    const useSessionOnly =
      sessionOnlyKey || !(storage?.os_storage_available ?? true);
    const ok = await onSaveCredential(activeId, trimmed, useSessionOnly);
    if (ok) setApiKeyInput("");
  };

  return (
  <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/30 bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      {/* OS Credential Store Banner */}
      <div
        className={`rounded-2xl border p-4 ${
          storage?.os_storage_available
            ? "border-emerald-400/25 bg-emerald-500/[0.06]"
            : "border-amber-400/30 bg-amber-500/[0.08]"
        }`}
      >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
            {storage?.os_storage_available ? (
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            ) : (
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            )}
            <span className="text-xs font-medium text-[#F4F4F5]">
              Credential Security:{""}
              <span className="font-mono">
                {storage?.backend_name ?? "Checking OS Keyring..."}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!isBackendConnected || loading}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
          >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#E4E4E7]">
          {storage?.detail ??
            "API keys are never written to SQLite, project files, logs, or API responses."}
        </p>
      </div>

      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        {/* Provider Selector */}
        <div className="space-y-2.5 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
          <span className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
            Active AI Provider
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(providerList.length > 0
              ? providerList
              : [
                  { id: "openai" as AIProviderId, label: "OpenAI", description: "api.openai.com" },
                  { id: "groq" as AIProviderId, label: "Groq", description: "api.groq.com" },
                  { id: "openai_compatible" as AIProviderId, label: "OpenAI-Compatible", description: "Custom / Ollama / LM Studio" },
                ]
            ).map((p) => {
              const selected = activeId === p.id;
              const hasKey =
                "credential" in p ? p.credential.has_api_key : false;
              const isOptional =
                "api_key_optional" in p ? p.api_key_optional : false;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setEdits((prev) => ({ ...prev, active_provider: p.id }))
                  }
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? "border-[#7AA2FF]/55 bg-[#7AA2FF]/12 text-[#F4F4F5]"
                      : "border-[#2D2D30] bg-[#181818] text-[#F4F4F5] hover:bg-[#252527]"
                  }`}
                >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-medium">{p.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                        hasKey
                          ? "bg-emerald-500/20 text-emerald-300"
                          : isOptional
                          ? "bg-[#2C2C30] text-[#E4E4E7]"
                          : "bg-amber-500/20 text-amber-200"
                      }`}
                    >
                      {hasKey ? "KEY SET" : isOptional ? "LOCAL/OPT" : "NO KEY"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10.5px] text-[#B4B4BC]">
                    {p.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Provider Credentials (isolated from JSON config form!) */}
        <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#E4E4E7] uppercase">
                {activeStatus?.label ?? activeId} API Key
              </span>
            </div>

            {activeStatus?.credential.has_api_key ? (
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  {activeStatus.credential.key_hint ?? "Configured"} (
                  {activeStatus.credential.persistence_mode === "session_memory"
                    ? "Session Only"
                    : "OS Keyring"}
                  )
                </span>
                <button
                  type="button"
                  disabled={!isBackendConnected || saving}
                  onClick={() => void onRemoveCredential(activeId)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-red-400/30 bg-red-500/12 px-2 font-mono text-[10px] text-red-200 hover:bg-red-500/22 disabled:opacity-45"
                >
                <Trash2 className="h-2.5 w-2.5" />
                  <span>Remove</span>
                </button>
              </div>
            ) : (
            <span className="font-mono text-[10px] text-[#B4B4BC]">
                {activeStatus?.api_key_optional
                  ? "Optional for local endpoints"
                  : "Not configured"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={
                activeStatus?.credential.has_api_key
                  ? "Enter new API key to replace existing..."
                  : `Paste ${activeStatus?.label ?? activeId} API key...`
              }
              autoComplete="off"
              className="h-8 min-w-[220px] flex-1 rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
            />
            <button
              type="button"
              disabled={!isBackendConnected || saving || !apiKeyInput.trim()}
              onClick={() => void handleSaveKey()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#7AA2FF]/40 bg-[#7AA2FF]/18 px-3 text-xs font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/28 disabled:cursor-not-allowed disabled:opacity-40"
            >
            <Save className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span>Save Key</span>
            </button>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-[#E4E4E7]">
            <input
              type="checkbox"
              checked={
                sessionOnlyKey || !(storage?.os_storage_available ?? true)
              }
              disabled={!(storage?.os_storage_available ?? true)}
              onChange={(e) => setSessionOnlyKey(e.target.checked)}
              className="rounded border-[#2D2D30] bg-[#181818]"
            />
            <span>
              Store in memory for this IDE session only (never saved to OS credential store)
            </span>
          </label>
        </div>

        {/* Endpoint, Model & Parameters */}
        <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
            <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#E4E4E7] uppercase">
              Model &amp; Endpoint Configuration ({activeStatus?.label ?? activeId})
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-[#F4F4F5]">
                Model ID
              </label>
              <input
                type="text"
                value={activeProfile.model}
                onChange={(e) =>
                  updateProviderField(activeId, { model: e.target.value })
                }
                placeholder="e.g. gpt-4o-mini"
                className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
              />
              {activeStatus && activeStatus.recommended_models.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                  {activeStatus.recommended_models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        updateProviderField(activeId, { model: m })
                      }
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors ${
                        activeProfile.model === m
                          ? "border-[#7AA2FF]/50 bg-[#7AA2FF]/20 text-[#F4F4F5]"
                          : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:text-[#F4F4F5]"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-[#F4F4F5]">
                Base URL{""}
                {activeStatus?.requires_base_url ? "(Required)" : "(Optional override)"}
              </label>
              <input
                type="text"
                value={activeProfile.base_url ?? ""}
                onChange={(e) =>
                  updateProviderField(activeId, {
                    base_url: e.target.value.trim() || null,
                  })
                }
                placeholder={activeStatus?.default_base_url ?? "https://..."}
                className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
              />
              <p className="mt-1 font-mono text-[9.5px] text-[#A1A1AA]">
                Default: {activeStatus?.default_base_url ?? "Provider standard"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-[#2D2D30] pt-3 sm:grid-cols-3">
            <div>
              <label
                htmlFor="ai-temp-range"
                className="mb-1 block text-[11px] text-[#F4F4F5]"
              >
                Temperature ({draft.temperature.toFixed(2)})
              </label>
              <input
                id="ai-temp-range"
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={draft.temperature}
                onChange={(e) =>
                  setEdits((prev) => ({
                    ...prev,
                    temperature: parseFloat(e.target.value),
                  }))
                }
                style={{
                  ["--fill" as string]: `${Math.min(100, Math.max(0, (draft.temperature / 1.5) * 100)).toFixed(1)}%`,
                }}
                className="vega-slider"
              />
            </div>

            <div>
              <label
                htmlFor="ai-max-tokens"
                className="mb-1 block text-[11px] text-[#F4F4F5]"
              >
                Max Output Tokens
              </label>
              <input
                id="ai-max-tokens"
                type="number"
                min={128}
                max={16384}
                step={128}
                value={draft.max_tokens}
                onChange={(e) =>
                  setEdits((prev) => ({
                    ...prev,
                    max_tokens: parseInt(e.target.value, 10) || 2048,
                  }))
                }
                className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-[#F4F4F5]">
                Timeout (seconds)
              </label>
              <input
                type="number"
                min={5}
                max={180}
                value={draft.timeout_seconds}
                onChange={(e) =>
                  setEdits((prev) => ({
                    ...prev,
                    timeout_seconds: parseInt(e.target.value, 10) || 45,
                  }))
                }
                className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5]"
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-[#2D2D30] pt-3">
            <label className="flex items-center gap-2 text-xs text-[#F4F4F5]">
              <input
                type="checkbox"
                checked={draft.auto_include_workspace_summary}
                onChange={(e) =>
                  setEdits((prev) => ({
                    ...prev,
                    auto_include_workspace_summary: e.target.checked,
                  }))
                }
              />
              <span>
                Include selective VEGA project, board &amp; SDK summary automatically
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs text-[#F4F4F5]">
              <input
                type="checkbox"
                checked={draft.allow_context_tools}
                onChange={(e) =>
                  setEdits((prev) => ({
                    ...prev,
                    allow_context_tools: e.target.checked,
                  }))
                }
              />
              <span>
                Allow read-only workspace inspection tools (list files, read bounded code, inspect diagnostics)
              </span>
            </label>
          </div>
        </div>

        {/* Connection Test & Discovered Models */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#2D2D30] bg-[#181818] px-4 py-3">
          <button
            type="button"
            disabled={!isBackendConnected || testing}
            onClick={() =>
              void onTestConnection({
                provider_id: activeId,
                model: activeProfile.model,
                base_url: activeProfile.base_url,
                api_key_override: apiKeyInput.trim() || null,
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-[#252527] px-3.5 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
          >
            {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
            ) : (
            <PlugZap className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span>Test Connection</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isBackendConnected || saving}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  return;
                }
                setConfirmReset(false);
                setEdits({});
                setProviderEdits({});
                void onResetConfig();
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[#2D2D30] bg-[#252527] px-3 text-xs text-[#F4F4F5] hover:bg-[#2D2D31]"
            >
            <RotateCcw className="h-3 w-3" />
              <span>{confirmReset ? "Confirm Reset? " : "Reset"}</span>
            </button>

            <button
              type="submit"
              disabled={!isBackendConnected || saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#7AA2FF]/45 bg-[#7AA2FF]/20 px-4 text-xs font-semibold text-[#F4F4F5] hover:bg-[#7AA2FF]/30 disabled:opacity-45"
            >
              {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
              <Save className="h-3.5 w-3.5 text-[#7AA2FF]" />
              )}
              <span>{hasUnsavedConfig ? "Save Changes" : "Saved"}</span>
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              testResult.ok
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : "border-red-400/30 bg-red-500/10 text-red-200"
            }`}
          >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium">
                {testResult.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span>{testResult.message}</span>
              </span>
              <span className="font-mono text-[10px] opacity-80">
                {testResult.latency_ms} ms
              </span>
            </div>
            {testResult.discovered_models.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
                {testResult.discovered_models.slice(0, 12).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateProviderField(activeId, { model: m })}
                    className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-emerald-100 hover:bg-emerald-500/20"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
