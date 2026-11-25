"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eraser,
  Eye,
  FileCode2,
  Hammer,
  History,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import { AiMarkdownView } from "@/components/ai/AiMarkdownView";
import type { NativeAiWsState } from "@/hooks/useNativeAi";
import type {
  AICodeApplyMode,
  AIContextAttachment,
  AIContextPreviewResponse,
  AIConversationDetailResponse,
  AIConversationSummary,
  AIProviderStatusInfo,
  AIProvidersStateResponse,
  AIToolTraceItem,
} from "@/types/ai";
import type { WorkspaceSummary } from "@/types/project";

export interface NativeAiPanelProps {
  activeProject: WorkspaceSummary | null;
  activeBoardId: string | null;
  activeFilePath: string | null;
  hasSelection: boolean;
  hasBuildDiagnostics: boolean;
  isBackendConnected: boolean;
  providersState: AIProvidersStateResponse | null;
  activeProviderStatus: AIProviderStatusInfo | null;
  conversations: AIConversationSummary[];
  activeConversationId: string | null;
  conversationDetail: AIConversationDetailResponse | null;
  activeConversation: AIConversationSummary | null;
  isCrossProjectConversation: boolean;
  wsState: NativeAiWsState;
  draftPrompt: string;
  pendingAttachments: AIContextAttachment[];
  contextPreview: AIContextPreviewResponse | null;
  loading: boolean;
  actionPending: boolean;
  error: string | null;
  notice: string | null;
  onDraftPromptChange: (value: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  onClearConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onToggleTools: (allow: boolean) => void;
  onSendPrompt: () => void;
  onRetryLast: () => void;
  onStopGeneration: () => void;
  onRemoveAttachment: (index: number) => void;
  onAttachActiveFile: () => void;
  onAttachSelection: () => void;
  onAttachBuildErrors: () => void;
  onAttachProjectSummary: () => void;
  onPreviewContext: () => void;
  onDismissPreview: () => void;
  onProposeCodeApply: (
    code: string,
    language: string,
    mode: AICodeApplyMode
  ) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onClearFeedback: () => void;
}

const STARTER_PROMPTS = [
  "Summarize this VEGA ARIES V3 project structure, target config, and Makefile setup.",
  "Review the active file for rv32i_zicsr / ET1031 embedded C safety and memory usage.",
  "Explain the latest build diagnostics and suggest fixes.",
];

function ToolTracesBlock({ traces }: { traces: AIToolTraceItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (traces.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-white/10 bg-[#05070d]/80 px-2.5 py-1.5 text-[10.5px]">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between gap-2 text-[#e8ebf7]/70 hover:text-[#e8ebf7]"
      >
        <span className="flex items-center gap-1.5 font-mono">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-[#7aa2ff]" />
          ) : (
            <ChevronRight className="h-3 w-3 text-[#7aa2ff]" />
          )}
          <Wrench className="h-3 w-3 text-[#7aa2ff]" />
          <span>
            Read-Only IDE Tools ({traces.length})
          </span>
        </span>
        <span className="font-mono text-[9.5px] text-[#e8ebf7]/45">
          {traces.some((t) => t.status === "running") ? "Running..." : "Inspected"}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-1.5">
          {traces.map((t) => (
            <div
              key={t.call_id}
              className="rounded border border-white/[0.07] bg-[#080b14] p-2 font-mono text-[10px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#7aa2ff]">{t.name}</span>
                <span
                  className={
                    t.status === "completed"
                      ? "text-emerald-300"
                      : t.status === "running"
                      ? "text-[#7aa2ff]"
                      : "text-amber-300"
                  }
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[#e8ebf7]/50">
                args: {t.arguments_preview}
              </p>
              {t.output_preview && (
                <pre className="vega-scroll mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[9.5px] text-[#e8ebf7]/70">
                  {t.output_preview}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NativeAiPanel({
  activeProject,
  activeBoardId,
  activeFilePath,
  hasSelection,
  hasBuildDiagnostics,
  isBackendConnected,
  providersState,
  activeProviderStatus,
  conversations,
  activeConversationId,
  conversationDetail,
  activeConversation,
  isCrossProjectConversation,
  wsState,
  draftPrompt,
  pendingAttachments,
  contextPreview,
  loading,
  actionPending,
  error,
  notice,
  onDraftPromptChange,
  onSelectConversation,
  onCreateConversation,
  onClearConversation,
  onDeleteConversation,
  onToggleTools,
  onSendPrompt,
  onRetryLast,
  onStopGeneration,
  onRemoveAttachment,
  onAttachActiveFile,
  onAttachSelection,
  onAttachBuildErrors,
  onAttachProjectSummary,
  onPreviewContext,
  onDismissPreview,
  onProposeCodeApply,
  onOpenSettings,
  onRefresh,
  onClearFeedback,
}: NativeAiPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const messages = conversationDetail?.messages ?? [];
  const isStreaming = activeConversation?.status === "streaming";
  const providerReady = activeProviderStatus?.ready ?? false;
  const toolsEnabled = activeConversation
    ? activeConversation.allow_tools
    : providersState?.config.allow_context_tools ?? true;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isStreaming]);

  const canApplyToEditor = Boolean(
    activeProject && activeFilePath && !isCrossProjectConversation
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top Bar: Conversation Picker & Status Controls */}
      <div className="shrink-0 space-y-2 border-b border-white/[0.08] bg-[#070910]/65 px-3 py-2.5">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <select
              aria-label="Active AI conversation"
              value={activeConversationId ?? ""}
              onChange={(e) => {
                if (e.target.value) onSelectConversation(e.target.value);
              }}
              className="h-7 max-w-[140px] truncate rounded-lg border border-white/12 bg-[#06070c] px-2 font-mono text-[10.5px] text-[#e8ebf7] focus:border-[#7aa2ff]/55 focus:outline-none"
            >
              {conversations.length === 0 ? (
                <option value="">New Chat</option>
              ) : (
                conversations.map((c) => (
                  <option key={c.conversation_id} value={c.conversation_id}>
                    {c.title}
                  </option>
                ))
              )}
            </select>

            <button
              type="button"
              onClick={onCreateConversation}
              disabled={!isBackendConnected || actionPending}
              title="New VEGA AI conversation"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.04] text-[#e8ebf7]/80 hover:bg-white/[0.1] disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowHistory((p) => !p)}
              title="Conversation history"
              aria-pressed={showHistory}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                showHistory
                  ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/18 text-[#e8ebf7]"
                  : "border-white/12 bg-white/[0.04] text-[#e8ebf7]/70 hover:bg-white/[0.1]"
              }`}
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {activeConversationId && (
              <>
                <button
                  type="button"
                  onClick={onClearConversation}
                  disabled={actionPending || messages.length === 0}
                  title="Clear messages in this conversation"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-35"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteConversation(activeConversationId)}
                  disabled={actionPending}
                  title="Delete conversation"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-red-500/18 hover:text-red-200 disabled:opacity-35"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onRefresh}
              disabled={!isBackendConnected || loading}
              title="Refresh AI state"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[#e8ebf7]/65 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              title="Configure AI Provider & API Keys"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Provider / Board / Tools Status Strip */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[10px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
                providerReady
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18"
                  : "border-amber-400/35 bg-amber-500/12 text-amber-200 hover:bg-amber-500/20"
              }`}
            >
              <Sparkles className="h-2.5 w-2.5" />
              <span className="max-w-[130px] truncate">
                {activeProviderStatus
                  ? `${activeProviderStatus.label} · ${activeProviderStatus.configured_model}`
                  : "AI Unconfigured"}
              </span>
            </button>

            {activeBoardId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#7aa2ff]/25 bg-[#7aa2ff]/10 px-2 py-0.5 text-[#93c5fd]">
                <Cpu className="h-2.5 w-2.5" />
                <span>{activeBoardId}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleTools(!toolsEnabled)}
              title="Toggle safe read-only workspace inspection tools"
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
                toolsEnabled
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45"
              }`}
            >
              <Wrench className="h-2.5 w-2.5" />
              <span>Tools {toolsEnabled ? "ON" : "OFF"}</span>
            </button>

            <span
              className="inline-flex items-center gap-1 text-[#e8ebf7]/45"
              title={`Stream WebSocket: ${wsState}`}
            >
              {wsState === "connected" ? (
                <Wifi className="h-3 w-3 text-emerald-300" />
              ) : (
                <WifiOff className="h-3 w-3 text-[#e8ebf7]/35" />
              )}
            </span>
          </div>
        </div>

        {/* History Drawer */}
        {showHistory && (
          <div className="vega-scroll max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-[#06070c]/90 p-2">
            <div className="px-1 font-mono text-[9.5px] font-semibold text-[#e8ebf7]/45 uppercase">
              Saved Conversations ({conversations.length})
            </div>
            {conversations.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-[#e8ebf7]/45">
                No saved conversations yet.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.conversation_id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] ${
                    c.conversation_id === activeConversationId
                      ? "bg-[#7aa2ff]/18 text-[#e8ebf7]"
                      : "text-[#e8ebf7]/70 hover:bg-white/[0.05]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectConversation(c.conversation_id);
                      setShowHistory(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="font-mono text-[9.5px] text-[#e8ebf7]/45">
                      {c.message_count} msgs · {c.project_name ?? "General"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(c.conversation_id)}
                    className="rounded p-1 text-[#e8ebf7]/40 hover:bg-red-500/20 hover:text-red-200"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Feedback / Cross-Project Warnings */}
        {error && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-400/30 bg-red-500/12 px-2.5 py-2 text-[11px] text-red-200">
            <div className="flex min-w-0 items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
            <button
              type="button"
              onClick={onClearFeedback}
              className="rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {notice && !error && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
            <span className="truncate">{notice}</span>
            <button
              type="button"
              onClick={onClearFeedback}
              className="rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {isCrossProjectConversation && activeProject && activeConversation && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[10.5px] text-amber-200">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This chat is bound to{" "}
                <span className="font-mono font-semibold">
                  {activeConversation.project_name}
                </span>
                .
              </span>
            </div>
            <button
              type="button"
              onClick={onCreateConversation}
              className="rounded border border-amber-300/40 bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] font-medium hover:bg-amber-400/30"
            >
              New Chat for {activeProject.project.name}
            </button>
          </div>
        )}
      </div>

      {/* Message Stream */}
      <div
        ref={scrollRef}
        className="vega-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {!providerReady && (
          <div className="rounded-xl border border-amber-400/25 bg-[#080a12] p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#e8ebf7]">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <span>AI Provider Configuration Required</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#e8ebf7]/65">
              {activeProviderStatus?.status_reason ||
                "Configure OpenAI, Groq, or an OpenAI-compatible local endpoint and store your key securely in the OS credential manager."}
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-3 font-mono text-[10.5px] text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
            >
              <Settings className="h-3 w-3 text-[#7aa2ff]" />
              <span>Configure AI Provider</span>
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-[#08090f] p-3.5 space-y-1.5">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-[#7aa2ff] uppercase">
                Native VEGA Firmware Assistant
              </span>
              <p className="text-[11.5px] leading-relaxed text-[#e8ebf7]/65">
                Grounded technical guidance for{" "}
                <span className="font-mono text-[#e8ebf7]">
                  VEGA ARIES V3 · ET1031 · rv32i_zicsr · THEJAS32
                </span>
                . Attach files, selections, compiler errors, serial or terminal output, then review code suggestions before applying.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block px-1 font-mono text-[10px] tracking-wider text-[#e8ebf7]/45 uppercase">
                Starter Questions
              </span>
              {STARTER_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onDraftPromptChange(q)}
                  className="w-full rounded-xl border border-white/[0.08] bg-[#08090f]/80 px-3 py-2 text-left text-[11px] text-[#e8ebf7]/75 transition-colors hover:border-[#7aa2ff]/35 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === "user";
            const isLast = idx === messages.length - 1;
            const showRetry =
              isLast &&
              !isStreaming &&
              (msg.role === "assistant" || activeConversation?.status === "error" || activeConversation?.status === "cancelled");

            return (
              <div
                key={msg.id}
                className={`rounded-2xl border p-3 ${
                  isUser
                    ? "ml-4 border-[#7aa2ff]/25 bg-[#7aa2ff]/[0.09]"
                    : "mr-1 border-white/10 bg-[#080a12]/90"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[9.5px] text-[#e8ebf7]/45">
                  <span className="font-semibold uppercase">
                    {isUser
                      ? "You"
                      : `${msg.model ?? "VEGA AI"}${msg.is_streaming ? " · streaming" : ""}`}
                  </span>
                  {msg.usage?.total_tokens ? (
                    <span>{msg.usage.total_tokens} tok</span>
                  ) : null}
                </div>

                {msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {msg.attachments.map((att, aIdx) => (
                      <span
                        key={aIdx}
                        className="inline-flex items-center gap-1 rounded border border-white/12 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] text-[#93c5fd]"
                      >
                        <Paperclip className="h-2.5 w-2.5" />
                        <span>{att.title}</span>
                      </span>
                    ))}
                  </div>
                )}

                {!isUser && <ToolTracesBlock traces={msg.tool_traces} />}

                {isUser ? (
                  <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#e8ebf7]/90">
                    {msg.content}
                  </p>
                ) : (
                  <AiMarkdownView
                    content={msg.content}
                    canApplyToEditor={canApplyToEditor}
                    hasSelection={hasSelection}
                    onProposeApply={onProposeCodeApply}
                  />
                )}

                {msg.error_message && (
                  <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/12 px-2.5 py-1.5 text-[11px] text-red-200">
                    {msg.error_message}
                  </div>
                )}

                {showRetry && (
                  <div className="mt-2 flex justify-end border-t border-white/[0.06] pt-1.5">
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={onRetryLast}
                      className="inline-flex h-6 items-center gap-1 rounded border border-white/12 bg-white/[0.04] px-2 font-mono text-[10px] text-[#e8ebf7]/75 hover:bg-white/[0.10] hover:text-[#e8ebf7]"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>Retry</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Context Preview Modal Drawer inside stream */}
        {contextPreview && (
          <div className="rounded-xl border border-[#7aa2ff]/35 bg-[#080b14] p-3 text-[11px]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold text-[#7aa2ff] uppercase">
                Outbound Context Inspector (~{contextPreview.estimated_chars} chars)
              </span>
              <button
                type="button"
                onClick={onDismissPreview}
                className="rounded p-0.5 text-[#e8ebf7]/50 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {contextPreview.redacted_secrets_count > 0 && (
              <p className="mb-1 text-[10px] text-amber-300">
                Redacted {contextPreview.redacted_secrets_count} secret token(s).
              </p>
            )}
            {contextPreview.excluded_warnings.map((w, i) => (
              <p key={i} className="mb-1 text-[10px] text-amber-200">
                {w}
              </p>
            ))}
            <ul className="space-y-0.5 font-mono text-[10px] text-[#e8ebf7]/65">
              {contextPreview.summary_sections.map((s, i) => (
                <li key={i} className="truncate">
                  • {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Context Chips + Composer */}
      <div className="shrink-0 space-y-2 border-t border-white/[0.08] bg-[#070910]/80 p-3">
        {/* Pending Attachments */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pendingAttachments.map((att, idx) => (
              <span
                key={idx}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 px-2 py-0.5 font-mono text-[10px] text-[#e8ebf7]"
              >
                <span className="truncate max-w-[160px]">{att.title}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  className="rounded-full p-0.5 hover:bg-white/15"
                  aria-label={`Remove ${att.title}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Quick Context Controls */}
        <div className="relative flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setShowAttachMenu((p) => !p)}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-white/12 bg-white/[0.04] px-2.5 font-mono text-[10px] text-[#e8ebf7]/75 hover:bg-white/[0.1]"
            >
              <Paperclip className="h-2.5 w-2.5 text-[#7aa2ff]" />
              <span>Attach Context</span>
            </button>

            <button
              type="button"
              onClick={onPreviewContext}
              title="Inspect what context will be sent externally"
              className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 font-mono text-[10px] text-[#e8ebf7]/60 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
            >
              <Eye className="h-2.5 w-2.5" />
              <span>Inspect</span>
            </button>
          </div>

          {showAttachMenu && (
            <div className="absolute bottom-8 left-0 z-20 w-56 rounded-xl border border-white/15 bg-[#090b13]/96 p-1.5 shadow-2xl backdrop-blur-md">
              <button
                type="button"
                disabled={!activeFilePath}
                onClick={() => {
                  onAttachActiveFile();
                  setShowAttachMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:opacity-35"
              >
                <FileCode2 className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Active File</span>
              </button>
              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => {
                  onAttachSelection();
                  setShowAttachMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:opacity-35"
              >
                <FileCode2 className="h-3.5 w-3.5 text-amber-300" />
                <span>Selected Code</span>
              </button>
              <button
                type="button"
                disabled={!hasBuildDiagnostics}
                onClick={() => {
                  onAttachBuildErrors();
                  setShowAttachMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:opacity-35"
              >
                <Hammer className="h-3.5 w-3.5 text-red-300" />
                <span>Build Errors &amp; Warnings</span>
              </button>
              <button
                type="button"
                disabled={!activeProject}
                onClick={() => {
                  onAttachProjectSummary();
                  setShowAttachMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:opacity-35"
              >
                <Cpu className="h-3.5 w-3.5 text-emerald-300" />
                <span>Board &amp; Project Summary</span>
              </button>
            </div>
          )}
        </div>

        {/* Prompt Box */}
        <div
          className="vega-glass flex items-end gap-2 rounded-[18px] p-2.5"
          style={{ ["--blur" as string]: "8px", ["--tint" as string]: "0.6" }}
        >
          <textarea
            rows={2}
            value={draftPrompt}
            onChange={(e) => onDraftPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming && draftPrompt.trim()) {
                  onSendPrompt();
                }
              }
            }}
            placeholder={
              providerReady
                ? "Ask about VEGA ARIES V3, C firmware, Make, or errors…"
                : "Configure an AI provider in Settings to start chatting…"
            }
            className="vega-scroll max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-1 text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/40 focus:outline-none"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStopGeneration}
              title="Stop AI generation"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-400/45 bg-red-500/20 text-red-200 hover:bg-red-500/30"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!isBackendConnected || actionPending || !draftPrompt.trim()}
              onClick={onSendPrompt}
              title="Send message"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8ebf7] text-[#06070c] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-[#e8ebf7]/35"
            >
              {actionPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
