"use client";

import { useEffect, useRef, useState } from"react";
import { createPortal } from"react-dom";
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
} from"lucide-react";
import { AiMarkdownView } from"@/components/ai/AiMarkdownView";
import type { NativeAiWsState } from"@/hooks/useNativeAi";
import type {
  AICodeApplyMode,
  AIContextAttachment,
  AIContextPreviewResponse,
  AIConversationDetailResponse,
  AIConversationSummary,
  AIProviderStatusInfo,
  AIProvidersStateResponse,
  AIToolTraceItem,
} from"@/types/ai";
import type { WorkspaceSummary } from"@/types/project";
import { formatBoardDisplayLabel } from"@/types/board";

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
  "Hi! What can you help me with?",
  "Look into my workspace and summarize this project structure.",
  "Check the latest build diagnostics and suggest fixes.",
];

function ToolTracesBlock({ traces }: { traces: AIToolTraceItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (traces.length === 0) return null;

  return (
  <div className="mb-2 rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 py-1.5 text-[10.5px]">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between gap-2 text-[#F4F4F5] hover:text-[#F4F4F5]"
      >
      <span className="flex items-center gap-1.5 font-mono">
          {expanded ? (
          <ChevronDown className="h-3 w-3 text-[#7AA2FF]" />
          ) : (
          <ChevronRight className="h-3 w-3 text-[#7AA2FF]" />
          )}
          <Wrench className="h-3 w-3 text-[#7AA2FF]" />
          <span>
            Read-Only IDE Tools ({traces.length})
          </span>
        </span>
        <span className="font-mono text-[9.5px] text-[#B4B4BC]">
          {traces.some((t) => t.status === "running") ? "Running..." : "Inspected"}
        </span>
      </button>

      {expanded && (
      <div className="mt-2 space-y-1.5 border-t border-[#2D2D30] pt-1.5">
          {traces.map((t) => (
            <div
              key={t.call_id}
              className="rounded border border-[#2D2D30] bg-[#1F1F1F] p-2 font-mono text-[10px]"
            >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#7AA2FF]">{t.name}</span>
                <span
                  className={
                    t.status === "completed"
                      ? "text-emerald-300"
                      : t.status === "running"
                      ? "text-[#7AA2FF]"
                      : "text-amber-300"
                  }
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[#B4B4BC]">
                args: {t.arguments_preview}
              </p>
              {t.output_preview && (
              <pre className="vega-scroll mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[9.5px] text-[#F4F4F5]">
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
  const attachBtnRef = useRef<HTMLButtonElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [attachMenuCoords, setAttachMenuCoords] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  useEffect(() => {
    if (!attachMenuCoords) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        !attachBtnRef.current?.contains(target) &&
        !attachMenuRef.current?.contains(target)
      ) {
        setAttachMenuCoords(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAttachMenuCoords(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [attachMenuCoords]);

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
      <div className="shrink-0 space-y-2 border-b border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <select
              aria-label="Active AI conversation"
              value={activeConversationId ?? ""}
              onChange={(e) => {
                if (e.target.value) onSelectConversation(e.target.value);
              }}
              className="h-7 max-w-[140px] truncate rounded-[5px] border border-[#2D2D30] bg-[#181818] px-2 font-mono text-[10.5px] text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
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
              aria-label="New VEGA AI conversation"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-45"
            >
            <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowHistory((p) => !p)}
              title="Conversation history"
              aria-label="Toggle conversation history"
              aria-pressed={showHistory}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                showHistory
                  ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                  : "border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#252527]"
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
                  aria-label="Clear messages in this conversation"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-50"
                >
                <Eraser className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteConversation(activeConversationId)}
                  disabled={actionPending}
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-red-500/18 hover:text-red-200 disabled:opacity-50"
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
              aria-label="Refresh AI state"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              title="Configure AI Provider & API Keys"
              aria-label="Configure AI Provider & API Keys"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
            >
            <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Provider / Board / Tools Status Strip */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[10px]">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 transition-colors ${
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
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#7AA2FF]/25 bg-[#7AA2FF]/10 px-1.5 py-0.5 text-[#93c5fd]">
              <Cpu className="h-2.5 w-2.5" />
                <span>{formatBoardDisplayLabel(null, activeBoardId, { short: true })}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleTools(!toolsEnabled)}
              title="Allow read-only workspace inspection when you ask to write, review, or debug code"
              className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 transition-colors ${
                toolsEnabled
                  ? "border-[#7AA2FF]/35 bg-[#7AA2FF]/12 text-[#7AA2FF]"
                  : "border-[#2D2D30] bg-[#252527] text-[#B4B4BC]"
              }`}
            >
            <Wrench className="h-2.5 w-2.5" />
              <span>Tools {toolsEnabled ? "ON" : "OFF"}</span>
            </button>

            <span
              className="inline-flex items-center gap-1 text-[#B4B4BC]"
              title={`Stream WebSocket: ${wsState}`}
            >
              {wsState === "connected" ? (
              <Wifi className="h-3 w-3 text-emerald-300" />
              ) : (
              <WifiOff className="h-3 w-3 text-[#A1A1AA]" />
              )}
            </span>
          </div>
        </div>

        {/* History Drawer */}
        {showHistory && (
        <div className="vega-scroll max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[#2D2D30] bg-[#1F1F1F] p-2">
          <div className="px-1 font-mono text-[9.5px] font-semibold text-[#B4B4BC] uppercase">
              Saved Conversations ({conversations.length})
            </div>
            {conversations.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-[#B4B4BC]">
                No saved conversations yet.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.conversation_id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] ${
                    c.conversation_id === activeConversationId
                      ? "bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "text-[#F4F4F5] hover:bg-[#252527]"
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
                  <span className="font-mono text-[9.5px] text-[#B4B4BC]">
                      {c.message_count} msgs · {c.project_name ?? "General"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(c.conversation_id)}
                    className="rounded p-1 text-[#A1A1AA] hover:bg-red-500/20 hover:text-red-200"
                    title="Delete"
                    aria-label={`Delete conversation ${c.title}`}
                  >
                  <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Feedback & Cross-Project Warnings */}
        {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[8px] border border-red-400/25 bg-[#181818] px-3 py-2.5 shadow-sm"
        >
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-red-400/30 bg-red-500/12 text-red-300">
            <AlertCircle className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-red-300 uppercase">
              AI Error
            </div>
            <span className="block break-words text-[11.5px] leading-relaxed text-[#F4F4F5]">
              {error}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearFeedback}
            aria-label="Dismiss error"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        )}

        {notice && !error && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-[8px] border border-emerald-400/25 bg-[#181818] px-3 py-2.5 shadow-sm"
        >
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-emerald-400/30 bg-emerald-500/12 text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-emerald-300 uppercase">
              Notice
            </div>
            <span className="block break-words text-[11.5px] leading-relaxed text-[#F4F4F5]">
              {notice}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearFeedback}
            aria-label="Dismiss notice"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        )}

        {isCrossProjectConversation && activeProject && activeConversation && (
        <div className="space-y-2 rounded-[8px] border border-amber-400/30 bg-[#181818] p-3 text-[11.5px] shadow-sm">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-amber-400/30 bg-amber-500/12 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-amber-300 uppercase">
                Workspace Isolation
              </div>
              <span className="block leading-relaxed text-[#E4E4E7]">
                This chat is bound to{" "}
                <span className="font-mono font-semibold text-[#F4F4F5]">
                  {activeConversation.project_name}
                </span>
                .
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreateConversation}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/40 bg-[#7AA2FF]/16 px-2.5 font-mono text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/26"
          >
            <Plus className="h-3 w-3 text-[#7AA2FF]" />
            <span>New Chat for {activeProject.project.name}</span>
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
        <div className="space-y-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-amber-400/30 bg-amber-500/12 text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs font-medium text-[#F4F4F5]">
                AI Provider Configuration Required
              </div>
              <p className="text-[11.5px] leading-relaxed text-[#B4B4BC]">
                {activeProviderStatus?.status_reason ||
                  "Configure OpenAI, Groq, or an OpenAI-compatible local endpoint and store your key securely in the OS credential manager."}
              </p>
            </div>
          </div>
          <div className="border-t border-[#2D2D30] pt-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/45 bg-[#7AA2FF]/18 px-3 font-mono text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/28"
            >
              <Settings className="h-3 w-3 text-[#7AA2FF]" />
              <span>Configure AI Provider</span>
            </button>
          </div>
        </div>
        )}

        {messages.length === 0 ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#2D2D30] bg-[#1F1F1F] p-3.5 space-y-1.5">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-[#7AA2FF] uppercase">
                VEGA AI Chat Assistant
              </span>
              <p className="text-[11.5px] leading-relaxed text-[#E4E4E7]">
                Chat normally or ask questions about{""}
                <span className="font-mono text-[#F4F4F5]">
                  VEGA ARIES V3 · ET1031 · rv32i_zicsr
                </span>
                . Your workspace files are inspected only when you ask to write, debug, or review code (or attach context).
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block px-1 font-mono text-[10px] tracking-wider text-[#B4B4BC] uppercase">
                Starter Questions
              </span>
              {STARTER_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onDraftPromptChange(q)}
                  className="w-full rounded-[6px] border border-[#2D2D30] bg-[#1F1F1F] px-3 py-2 text-left text-[11px] text-[#F4F4F5] transition-colors hover:border-[#7AA2FF]/35 hover:bg-[#252527] hover:text-[#F4F4F5]"
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
                className={`rounded-[8px] border p-2.5 ${
                  isUser
                    ? "ml-4 border-[#7AA2FF]/25 bg-[#7AA2FF]/[0.08]"
                    : "mr-1 border-[#2D2D30] bg-[#1F1F1F]"
                }`}
              >
              <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[9.5px] text-[#B4B4BC]">
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
                        className="inline-flex items-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-1.5 py-0.5 font-mono text-[9.5px] text-[#93c5fd]"
                      >
                      <Paperclip className="h-2.5 w-2.5" />
                        <span>{att.title}</span>
                      </span>
                    ))}
                  </div>
                )}

                {!isUser && <ToolTracesBlock traces={msg.tool_traces} />}

                {isUser ? (
                <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#F4F4F5]">
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
                <div className="mt-2 flex items-start gap-2 rounded-[8px] border border-red-400/25 bg-[#181818] px-3 py-2 text-[11px] text-red-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                  <span className="break-words leading-relaxed">{msg.error_message}</span>
                </div>
                )}

                {showRetry && (
                <div className="mt-2 flex justify-end border-t border-[#2D2D30] pt-1.5">
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={onRetryLast}
                      className="inline-flex h-6 items-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-2 font-mono text-[10px] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
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
        <div className="rounded-xl border border-[#7AA2FF]/35 bg-[#1F1F1F] p-3 text-[11px]">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold text-[#7AA2FF] uppercase">
                Outbound Context Inspector (~{contextPreview.estimated_chars} chars)
              </span>
              <button
                type="button"
                onClick={onDismissPreview}
                aria-label="Dismiss context preview"
                className="rounded p-0.5 text-[#B4B4BC] hover:bg-[#2D2D31]"
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
            <ul className="space-y-0.5 font-mono text-[10px] text-[#E4E4E7]">
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
      <div className="shrink-0 space-y-2 border-t border-[#2D2D30] bg-[#181818] p-3">
        {/* Pending Attachments */}
        {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1">
            {pendingAttachments.map((att, idx) => (
              <span
                key={idx}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-2 py-0.5 font-mono text-[10px] text-[#F4F4F5]"
              >
              <span className="truncate max-w-[160px]">{att.title}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  className="rounded-full p-0.5 hover:bg-[#2D2D31]"
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
              ref={attachBtnRef}
              type="button"
              onClick={(e) => {
                if (attachMenuCoords) {
                  setAttachMenuCoords(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const left = Math.max(
                  8,
                  Math.min(rect.left, window.innerWidth - 232)
                );
                const bottom = Math.max(8, window.innerHeight - rect.top + 6);
                setAttachMenuCoords({ left, bottom });
              }}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-[#2D2D30] bg-[#252527] px-2.5 font-mono text-[10px] text-[#F4F4F5] hover:bg-[#2D2D31]"
            >
            <Paperclip className="h-2.5 w-2.5 text-[#7AA2FF]" />
              <span>Attach Context</span>
            </button>

            <button
              type="button"
              onClick={onPreviewContext}
              title="Inspect what context will be sent externally"
              className="inline-flex h-6 items-center gap-1 rounded-full border border-[#2D2D30] bg-[#252527] px-2 font-mono text-[10px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
            >
            <Eye className="h-2.5 w-2.5" />
              <span>Inspect</span>
            </button>
          </div>

          {attachMenuCoords &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={attachMenuRef}
                role="menu"
                aria-label="Attach IDE context"
                style={{
                  left: `${attachMenuCoords.left}px`,
                  bottom: `${attachMenuCoords.bottom}px`,
                }}
                className="vega-tweaks-glass fixed z-[110] w-56 rounded-xl border border-[#2D2D30] p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!activeFilePath}
                  onClick={() => {
                    onAttachActiveFile();
                    setAttachMenuCoords(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-50"
                >
                <FileCode2 className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  <span>Active File</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasSelection}
                  onClick={() => {
                    onAttachSelection();
                    setAttachMenuCoords(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-50"
                >
                <FileCode2 className="h-3.5 w-3.5 text-amber-300" />
                  <span>Selected Code</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasBuildDiagnostics}
                  onClick={() => {
                    onAttachBuildErrors();
                    setAttachMenuCoords(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-50"
                >
                <Hammer className="h-3.5 w-3.5 text-red-300" />
                  <span>Build Errors &amp; Warnings</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!activeProject}
                  onClick={() => {
                    onAttachProjectSummary();
                    setAttachMenuCoords(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-50"
                >
                <Cpu className="h-3.5 w-3.5 text-emerald-300" />
                  <span>Board &amp; Project Summary</span>
                </button>
              </div>,
              document.body
            )}
        </div>

        {/* Prompt Box */}
        <div className="flex items-end gap-2 rounded-[8px] border border-[#2D2D30] bg-[#1F1F1F] p-2 focus-within:border-[#7AA2FF]/45 focus-within:ring-1 focus-within:ring-[#7AA2FF]/25">
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
                ? "Chat with AI, or ask to write code / inspect workspace…"
                : "Configure an AI provider in Settings to start chatting…"
            }
            className="vega-scroll max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-1 text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:outline-none"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStopGeneration}
              title="Stop AI generation"
              aria-label="Stop AI generation"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-red-400/45 bg-red-500/20 text-red-200 hover:bg-red-500/30"
            >
            <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!isBackendConnected || actionPending || !draftPrompt.trim()}
              onClick={onSendPrompt}
              title="Send message"
              aria-label="Send message to VEGA AI"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#7AA2FF] text-[#0D0D0F] transition-colors hover:bg-[#93B4FF] disabled:cursor-not-allowed disabled:bg-[#252527] disabled:text-[#A1A1AA]"
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
