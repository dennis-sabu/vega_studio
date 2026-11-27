"use client";

import { useEffect, useRef, useState } from"react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from"lucide-react";
import type { OpenCodeWsState } from"@/hooks/useOpenCode";
import type {
  OpenCodeContextAttachment,
  OpenCodeInfoResponse,
  OpenCodePermissionDecision,
  OpenCodePermissionRequestInfo,
  OpenCodeSessionDetailResponse,
  OpenCodeSessionSummary,
  OpenCodeToolEvent,
} from"@/types/opencode";
import type { WorkspaceSummary } from"@/types/project";

export interface OpenCodePanelProps {
  activeProject: WorkspaceSummary | null;
  isBackendConnected: boolean;
  info: OpenCodeInfoResponse | null;
  sessions: OpenCodeSessionSummary[];
  activeSessionId: string | null;
  sessionDetail: OpenCodeSessionDetailResponse | null;
  activeSessionSummary: OpenCodeSessionSummary | null;
  isCrossProjectSession: boolean;
  wsState: OpenCodeWsState;
  draftPrompt: string;
  pendingContexts: OpenCodeContextAttachment[];
  selectedModel: string;
  loading: boolean;
  actionPending: boolean;
  error: string | null;
  notice: string | null;
  onDraftPromptChange: (value: string) => void;
  onRemoveContext: (index: number) => void;
  onSelectModel: (model: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onSendPrompt: () => void;
  onInterrupt: () => void;
  onReplyPermission: (
    requestId: string,
    decision: OpenCodePermissionDecision
  ) => void;
  onTerminateSession: (sessionId: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onClearFeedback: () => void;
}

const STARTER_PROMPTS = [
  "Hi! What can you help me with?",
  "Inspect the project structure and summarize how the firmware builds.",
  "Check the Makefile and VEGA board configuration for potential issues.",
];

export function OpenCodePanel({
  activeProject,
  isBackendConnected,
  info,
  sessions,
  activeSessionId,
  sessionDetail,
  activeSessionSummary,
  isCrossProjectSession,
  wsState,
  draftPrompt,
  pendingContexts,
  selectedModel,
  loading,
  actionPending,
  error,
  notice,
  onDraftPromptChange,
  onRemoveContext,
  onSelectModel,
  onSelectSession,
  onCreateSession,
  onSendPrompt,
  onInterrupt,
  onReplyPermission,
  onTerminateSession,
  onRefresh,
  onOpenSettings,
  onClearFeedback,
}: OpenCodePanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  const messages = sessionDetail?.messages ?? [];
  const pendingPermissions = (sessionDetail?.pending_permissions ?? []).filter(
    (p) => p.status === "pending"
  );
  const sessionStatus = activeSessionSummary?.status ?? "idle";
  const isRunning =
    sessionStatus === "running" || sessionStatus === "waiting_permission";
  const cliReady = Boolean(info?.available);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingPermissions.length]);

  const toggleTool = (id: string) =>
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleReasoning = (id: string) =>
    setExpandedReasoning((prev) => ({ ...prev, [id]: !prev[id] }));

  const canSend =
    Boolean(activeProject) &&
    isBackendConnected &&
    cliReady &&
    !actionPending &&
    !isRunning &&
    !isCrossProjectSession &&
    sessionStatus !== "closed" &&
    sessionStatus !== "unavailable" &&
    draftPrompt.trim().length > 0;

  return (
    <div
      data-testid="opencode-panel"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Sub-header: Runtime status + Session Picker + Actions */}
      <div className="shrink-0 space-y-2 border-b border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                !cliReady
                  ? "bg-amber-400"
                  : sessionStatus === "running"
                  ? "animate-pulse bg-[#7AA2FF]"
                  : sessionStatus === "waiting_permission"
                  ? "bg-amber-400"
                  : sessionStatus === "error"
                  ? "bg-red-400"
                  : "bg-emerald-400"
              }`}
            />
            <span className="truncate font-mono text-[10.5px] font-semibold text-[#F4F4F5]">
              {info?.available
                ? `VEGA AI · v${info.version || "?"}`
                : "VEGA AI Unavailable"}
            </span>
            {activeSessionId && (
              <span
                title={`Stream: ${wsState}`}
                className="inline-flex items-center gap-0.5 font-mono text-[9.5px] text-[#B4B4BC]"
              >
                {wsState === "connected" ? (
                <Wifi className="h-2.5 w-2.5 text-emerald-400/80" />
                ) : (
                <WifiOff className="h-2.5 w-2.5 text-[#A1A1AA]" />
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!isBackendConnected || loading}
              onClick={onRefresh}
              title="Refresh VEGA AI status & sessions"
              aria-label="Refresh VEGA AI status and sessions"
              className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              title="VEGA AI Settings"
              aria-label="VEGA AI Settings"
              className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
            >
            <Settings className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Session Selector + New / Close */}
        {cliReady && activeProject && (
        <div className="flex items-center gap-1.5">
            <select
              value={activeSessionId ?? ""}
              aria-label="VEGA AI session"
              onChange={(e) =>
                e.target.value && onSelectSession(e.target.value)
              }
              className="h-7 min-w-0 flex-1 rounded-[6px] border border-[#2D2D30] bg-[#181818] px-2 font-mono text-[10.5px] text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
            >
              <option value="" disabled>
                {sessions.length === 0
                  ? "No sessions yet — start one"
                  : "Select session…"}
              </option>
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  [{s.project_name}] {s.title} · {s.status}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={actionPending || !cliReady}
              onClick={onCreateSession}
              title="New workspace-bound VEGA AI session"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[#7AA2FF]/40 bg-[#7AA2FF]/18 px-2 font-mono text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/28 disabled:opacity-40"
            >
            <Plus className="h-3 w-3 text-[#7AA2FF]" />
              <span>New</span>
            </button>

            {activeSessionId && sessionStatus !== "closed" && (
              <button
                type="button"
                disabled={actionPending}
                onClick={() => onTerminateSession(activeSessionId)}
                title="Close active VEGA AI session"
                aria-label="Close active VEGA AI session"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:border-red-400/35 hover:bg-red-500/15 hover:text-red-200 disabled:opacity-40"
              >
              <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Active session workspace & permission bar */}
        {activeSessionSummary && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[9.5px] text-[#E4E4E7]">
          <span className="inline-flex items-center gap-1 truncate">
            <FolderGit2 className="h-3 w-3 text-[#7AA2FF]" />
            <span className="truncate">
                Bound: {activeSessionSummary.project_name}
              </span>
            </span>
            <span className="rounded border border-[#2D2D30] bg-[#252527] px-1.5 py-0.5 uppercase">
              {activeSessionSummary.permission_mode.replace("_","")} ·{""}
              {sessionStatus}
            </span>
          </div>
        )}
      </div>

      {/* Feedback & Guard Banners (Standard IDE Obsidian Toast Cards) */}
      <div className="shrink-0 space-y-2 px-3 pt-2.5 empty:hidden">
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
              VEGA AI Error
            </div>
            <p className="break-words text-[11.5px] leading-relaxed text-[#F4F4F5]">
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearFeedback}
            aria-label="Dismiss VEGA AI error"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        )}

        {notice && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-[8px] border border-emerald-400/25 bg-[#181818] px-3 py-2.5 shadow-sm"
        >
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-emerald-400/30 bg-emerald-500/12 text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-emerald-300 uppercase">
              VEGA AI Notice
            </div>
            <p className="break-words text-[11.5px] leading-relaxed text-[#F4F4F5]">
              {notice}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearFeedback}
            aria-label="Dismiss VEGA AI notice"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        )}

        {isCrossProjectSession && activeProject && activeSessionSummary && (
        <div className="space-y-2 rounded-[8px] border border-amber-400/30 bg-[#181818] p-3 text-[11.5px] shadow-sm">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-amber-400/30 bg-amber-500/12 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-amber-300 uppercase">
                Workspace Isolation
              </div>
              <p className="leading-relaxed text-[#E4E4E7]">
                Viewing session bound to{" "}
                <span className="font-mono font-semibold text-[#F4F4F5]">
                  {activeSessionSummary.project_name}
                </span>
                . Active workspace{" "}
                <span className="font-mono font-semibold text-[#F4F4F5]">
                  {activeProject.project.name}
                </span>{" "}
                is isolated.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreateSession}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/40 bg-[#7AA2FF]/16 px-2.5 font-mono text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/26"
          >
            <Plus className="h-3 w-3 text-[#7AA2FF]" />
            <span>Start Session in {activeProject.project.name}</span>
          </button>
        </div>
        )}

        {/* Pinned Critical Permission Approval Cards */}
        {pendingPermissions.map((perm) => (
          <PermissionPromptCard
            key={perm.request_id}
            perm={perm}
            pending={actionPending}
            onReply={onReplyPermission}
          />
        ))}
      </div>

      {/* Main Body / Message Stream */}
      <div
        ref={scrollRef}
        className="vega-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {!cliReady ? (
        <div className="space-y-3 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-amber-400/30 bg-amber-500/12 text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs font-medium text-[#F4F4F5]">
                VEGA AI Runtime Not Detected
              </div>
              <p className="text-[11.5px] leading-relaxed text-[#B4B4BC]">
                {info?.unavailable_reason ||
                  "Install the OpenCode CLI runtime or configure a verified binary path in VEGA AI Settings to enable project-aware sessions."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#2D2D30] pt-3">
            <a
              href={info?.install_guide_url || "https://opencode.ai/docs"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 font-mono text-[10.5px] text-[#F4F4F5] hover:bg-[#2D2D31]"
            >
              <span>Install Guide</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/45 bg-[#7AA2FF]/18 px-2.5 font-mono text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/28"
            >
              <Settings className="h-3 w-3 text-[#7AA2FF]" />
              <span>Configure VEGA AI</span>
            </button>
          </div>
        </div>
        ) : !activeProject ? (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4 text-xs text-[#E4E4E7]">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
            <FolderGit2 className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-[#F4F4F5]">No Active Workspace</p>
            <p className="text-[11.5px] leading-relaxed text-[#B4B4BC]">
              Open or create a VEGA ARIES V3 project to start a workspace-bound VEGA AI session.
            </p>
          </div>
        </div>
        ) : messages.length === 0 ? (
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-3.5">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-[#7AA2FF] uppercase">
                VEGA AI Workspace Agent
              </span>
              <p className="text-[11.5px] leading-relaxed text-[#E4E4E7]">
                Chat or ask VEGA AI to explain code, investigate compiler/runtime errors, or assist with changes inside{" "}
                <span className="font-mono text-[#F4F4F5]">
                  {activeProject.project.name}
                </span>
                . Workspace actions follow your permission rules.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block px-1 font-mono text-[10px] tracking-wider text-[#B4B4BC] uppercase">
                Quick Prompts
              </span>
              {STARTER_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    onDraftPromptChange(sample);
                    composerRef.current?.focus();
                  }}
                  className="block w-full rounded-[8px] border border-[#2D2D30] bg-[#181818] px-3 py-2 text-left text-[11.5px] text-[#F4F4F5] transition-colors hover:border-[#7AA2FF]/40 hover:bg-[#252527]"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div
                  key={msg.id}
                  className="ml-4 space-y-1.5 rounded-[8px] border border-[#7AA2FF]/25 bg-[#7AA2FF]/[0.10] p-2.5 text-xs text-[#F4F4F5]"
                >
                  {msg.contexts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                      {msg.contexts.map((ctx, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded border border-[#2D2D30] bg-[#141414] px-1.5 py-0.5 font-mono text-[10px] text-[#9bb8ff]"
                        >
                        <FileCode2 className="h-2.5 w-2.5" />
                          <span>{ctx.title}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.text}
                  </p>
                </div>
              );
            }

            if (msg.role === "error" || msg.role === "system") {
              const isErr = msg.role === "error";
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 rounded-[8px] border bg-[#181818] p-3 text-[11.5px] ${
                    isErr ? "border-red-400/25" : "border-[#2D2D30]"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border ${
                      isErr
                        ? "border-red-400/30 bg-red-500/12 text-red-300"
                        : "border-[#2D2D30] bg-[#252527] text-[#7AA2FF]"
                    }`}
                  >
                    {isErr ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div
                      className={`font-mono text-[9.5px] font-semibold tracking-[0.06em] uppercase ${
                        isErr ? "text-red-300" : "text-[#B4B4BC]"
                      }`}
                    >
                      {isErr ? "VEGA AI Error" : "System"}
                    </div>
                    <p
                      className={`whitespace-pre-wrap break-words leading-relaxed ${
                        isErr ? "text-red-100" : "text-[#E4E4E7]"
                      }`}
                    >
                      {msg.text}
                    </p>
                  </div>
                </div>
              );
            }

            // Assistant message (may contain reasoning + tools + markdown text)
            return (
              <div
                key={msg.id}
                className="space-y-2 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-3 text-xs text-[#F4F4F5]"
              >
                {msg.reasoning && (
                <div className="rounded-lg border border-[#2D2D30] bg-[#252527] px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleReasoning(msg.id)}
                      className="flex w-full items-center gap-1 font-mono text-[10px] text-[#B4B4BC] hover:text-[#F4F4F5]"
                    >
                      {expandedReasoning[msg.id] ? (
                      <ChevronDown className="h-3 w-3" />
                      ) : (
                      <ChevronRight className="h-3 w-3" />
                      )}
                      <span>Reasoning</span>
                    </button>
                    {expandedReasoning[msg.id] && (
                    <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-[#E4E4E7]">
                        {msg.reasoning}
                      </pre>
                    )}
                  </div>
                )}

                {msg.tools.length > 0 && (
                <div className="space-y-1.5">
                    {msg.tools.map((tool) => (
                      <ToolActivityBlock
                        key={tool.tool_id}
                        tool={tool}
                        expanded={Boolean(expandedTools[tool.tool_id])}
                        onToggle={() => toggleTool(tool.tool_id)}
                      />
                    ))}
                  </div>
                )}

                {msg.text && (
                <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#F4F4F5]">
                    {msg.text}
                  </pre>
                )}

                {msg.is_streaming && (
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#7AA2FF]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Agent working…</span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {sessionStatus === "running" &&
          (!messages.length || messages[messages.length - 1]?.role === "user") && (
          <div className="flex items-center gap-2 rounded-[8px] border border-[#7AA2FF]/25 bg-[#181818] px-3 py-2 font-mono text-[11px] text-[#9bb8ff]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              <span>VEGA AI is thinking…</span>
            </div>
          )}
      </div>

      {/* Bottom Docked Composer Box */}
      <div className="shrink-0 p-2.5 pt-1">
        <div className="rounded-[8px] border border-[#2D2D30] bg-[#1F1F1F] p-2 focus-within:border-[#7AA2FF]/45 focus-within:ring-1 focus-within:ring-[#7AA2FF]/25">
          {pendingContexts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingContexts.map((ctx, idx) => (
                <span
                  key={idx}
                  className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-1.5 py-0.5 font-mono text-[10px] text-[#F4F4F5]"
                >
                <FileCode2 className="h-3 w-3 shrink-0 text-[#7AA2FF]" />
                <span className="truncate">{ctx.title}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveContext(idx)}
                    aria-label={`Remove ${ctx.title}`}
                    className="text-[#E4E4E7] hover:text-white"
                  >
                  <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={composerRef}
            rows={2}
            value={draftPrompt}
            disabled={!cliReady || !activeProject || isCrossProjectSession}
            aria-label="Ask VEGA AI prompt"
            placeholder={
              !cliReady
                ? "Install or configure VEGA AI CLI in Settings…"
                : !activeProject
                ? "Open a project to message VEGA AI…"
                : isCrossProjectSession
                ? "Start a session in the current project to send messages…"
                : "Chat with VEGA AI, or ask to inspect, debug, or modify code…"
            }
            onChange={(e) => onDraftPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (canSend) onSendPrompt();
              }
            }}
            className="vega-scroll max-h-36 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed text-[#F4F4F5] placeholder:text-[#8E8E98] focus:outline-none disabled:opacity-50"
          />

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {info && info.available_models.length > 0 ? (
                <select
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  aria-label="VEGA AI model"
                  className="h-6 max-w-[165px] truncate rounded-[5px] border border-[#2D2D30] bg-[#181818] px-2 font-mono text-[10px] text-[#F4F4F5] focus:outline-none"
                >
                  <option value="">Default Model</option>
                  {info.available_models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
              <span className="truncate font-mono text-[10px] text-[#A1A1AA]">
                  {activeProject
                    ? `Workspace: ${activeProject.project.name}`
                    : "No workspace"}
                </span>
              )}
            </div>

            {isRunning ? (
              <button
                type="button"
                onClick={onInterrupt}
                title="Interrupt running agent"
                aria-label="Interrupt running agent"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-red-400/45 bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
              <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={onSendPrompt}
                aria-label="Send prompt to VEGA AI"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#7AA2FF] text-[#0D0D0F] transition-colors hover:bg-[#93B4FF] disabled:bg-[#252527] disabled:text-[#A1A1AA]"
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
    </div>
  );
}

function PermissionPromptCard({
  perm,
  pending,
  onReply,
}: {
  perm: OpenCodePermissionRequestInfo;
  pending: boolean;
  onReply: (requestId: string, decision: OpenCodePermissionDecision) => void;
}) {
  return (
    <div
      data-testid="opencode-permission-card"
      className={`space-y-2 rounded-[8px] border bg-[#181818] p-3 text-[11px] shadow-sm ${
        perm.is_sensitive ? "border-red-400/35" : "border-amber-400/35"
      }`}
    >
    <div className="flex items-start gap-2">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] font-bold uppercase">
              Approval Required · {perm.action}
            </span>
            {perm.is_sensitive && (
            <span className="rounded border border-red-400/40 bg-red-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase">
                Sensitive
              </span>
            )}
          </div>
          {perm.message && <p className="text-xs opacity-90">{perm.message}</p>}
          {perm.resources.length > 0 && (
          <ul className="space-y-0.5 rounded bg-[#141414] p-1.5 font-mono text-[10px]">
              {perm.resources.map((r, i) => (
              <li key={i} className="truncate">
                  {r}
                </li>
              ))}
            </ul>
          )}
          {perm.sensitivity_reasons.length > 0 && (
          <ul className="space-y-0.5 text-[10px] opacity-90">
              {perm.sensitivity_reasons.map((reason, idx) => (
                <li key={idx}>• {reason}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => onReply(perm.request_id,"reject")}
          className="inline-flex h-6 items-center gap-1 rounded border border-red-300/35 bg-red-500/20 px-2 font-mono text-[10px] font-medium hover:bg-red-500/35"
        >
        <X className="h-3 w-3" />
          <span>Reject</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onReply(perm.request_id,"once")}
          className="inline-flex h-6 items-center gap-1 rounded border border-[#2D2D30] bg-[#2C2C30] px-2 font-mono text-[10px] font-medium hover:bg-white/20"
        >
        <Check className="h-3 w-3" />
          <span>Allow Once</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onReply(perm.request_id,"always")}
          className="inline-flex h-6 items-center gap-1 rounded border border-[#7AA2FF]/45 bg-[#7AA2FF]/25 px-2 font-mono text-[10px] font-medium hover:bg-[#7AA2FF]/35"
        >
        <Terminal className="h-3 w-3" />
          <span>Always (Session)</span>
        </button>
      </div>
    </div>
  );
}

function ToolActivityBlock({
  tool,
  expanded,
  onToggle,
}: {
  tool: OpenCodeToolEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
  <div className="rounded-lg border border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-1.5 font-mono text-[10.5px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
      <span className="flex min-w-0 items-center gap-1.5 text-[#F4F4F5]">
          {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[#B4B4BC]" />
          ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[#B4B4BC]" />
          )}
          <Wrench className="h-3 w-3 shrink-0 text-[#7AA2FF]" />
          <span className="truncate font-semibold">{tool.name}</span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase ${
            tool.status === "completed"
              ? "bg-emerald-500/15 text-emerald-300"
              : tool.status === "error"
              ? "bg-red-500/15 text-red-300"
              : "bg-[#7AA2FF]/15 text-[#9bb8ff]"
          }`}
        >
          {tool.status}
        </span>
      </button>
      {expanded && (
      <div className="mt-1.5 space-y-1.5 border-t border-[#2D2D30] pt-1.5 text-[10px] text-[#E4E4E7]">
          {tool.input_preview && (
          <pre className="vega-scroll max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-[#141414] p-1.5">
              Input: {tool.input_preview}
            </pre>
          )}
          {tool.output_preview && (
          <pre className="vega-scroll max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded bg-[#141414] p-1.5 text-emerald-200/80">
              Output: {tool.output_preview}
            </pre>
          )}
          {tool.error_message && (
          <pre className="whitespace-pre-wrap break-all rounded bg-red-500/10 p-1.5 text-red-200">
              Error: {tool.error_message}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
