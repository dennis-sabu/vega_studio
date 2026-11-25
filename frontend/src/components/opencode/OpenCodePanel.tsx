"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import type { OpenCodeWsState } from "@/hooks/useOpenCode";
import type {
  OpenCodeContextAttachment,
  OpenCodeInfoResponse,
  OpenCodePermissionDecision,
  OpenCodePermissionRequestInfo,
  OpenCodeSessionDetailResponse,
  OpenCodeSessionSummary,
  OpenCodeToolEvent,
} from "@/types/opencode";
import type { WorkspaceSummary } from "@/types/project";

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
  "Inspect the project structure and summarize how the firmware builds.",
  "Review src/main.c for initialization and peripheral setup notes.",
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
      <div className="shrink-0 space-y-2 border-b border-white/[0.08] bg-[#070910]/65 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                !cliReady
                  ? "bg-amber-400"
                  : sessionStatus === "running"
                  ? "animate-pulse bg-[#7aa2ff]"
                  : sessionStatus === "waiting_permission"
                  ? "bg-amber-400"
                  : sessionStatus === "error"
                  ? "bg-red-400"
                  : "bg-emerald-400"
              }`}
            />
            <span className="truncate font-mono text-[10.5px] font-semibold text-[#e8ebf7]/85">
              {info?.available
                ? `OpenCode v${info.version || "?"}`
                : "OpenCode Missing"}
            </span>
            {activeSessionId && (
              <span
                title={`Stream: ${wsState}`}
                className="inline-flex items-center gap-0.5 font-mono text-[9.5px] text-[#e8ebf7]/45"
              >
                {wsState === "connected" ? (
                  <Wifi className="h-2.5 w-2.5 text-emerald-400/80" />
                ) : (
                  <WifiOff className="h-2.5 w-2.5 text-[#e8ebf7]/35" />
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!isBackendConnected || loading}
              onClick={onRefresh}
              title="Refresh OpenCode status & sessions"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/55 hover:bg-white/[0.07] hover:text-[#e8ebf7] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              title="OpenCode Settings"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/55 hover:bg-white/[0.07] hover:text-[#e8ebf7]"
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
              aria-label="OpenCode session"
              onChange={(e) =>
                e.target.value && onSelectSession(e.target.value)
              }
              className="h-7 min-w-0 flex-1 rounded-lg border border-white/12 bg-[#0b0e17] px-2 font-mono text-[10.5px] text-[#e8ebf7] focus:border-[#7aa2ff]/55 focus:outline-none"
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
              title="New workspace-bound OpenCode session"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:opacity-40"
            >
              <Plus className="h-3 w-3 text-[#7aa2ff]" />
              <span>New</span>
            </button>

            {activeSessionId && sessionStatus !== "closed" && (
              <button
                type="button"
                disabled={actionPending}
                onClick={() => onTerminateSession(activeSessionId)}
                title="Terminate & close active OpenCode session"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-red-300/75 hover:bg-red-500/15 hover:text-red-200 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Active session workspace & permission bar */}
        {activeSessionSummary && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[9.5px] text-[#e8ebf7]/55">
            <span className="inline-flex items-center gap-1 truncate">
              <FolderGit2 className="h-3 w-3 text-[#7aa2ff]" />
              <span className="truncate">
                Bound: {activeSessionSummary.project_name}
              </span>
            </span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 uppercase">
              {activeSessionSummary.permission_mode.replace("_", " ")} ·{" "}
              {sessionStatus}
            </span>
          </div>
        )}
      </div>

      {/* Feedback & Guard Banners */}
      <div className="shrink-0 space-y-1.5 px-3 pt-2 empty:hidden">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/12 px-2.5 py-2 text-[11px] text-red-200">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
            <p className="min-w-0 flex-1 break-words">{error}</p>
            <button
              type="button"
              onClick={onClearFeedback}
              aria-label="Dismiss OpenCode error"
              className="text-red-300/75 hover:text-red-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
            <p className="min-w-0 flex-1 break-words">{notice}</p>
            <button
              type="button"
              onClick={onClearFeedback}
              aria-label="Dismiss OpenCode notice"
              className="text-emerald-300/75 hover:text-emerald-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {isCrossProjectSession && activeProject && activeSessionSummary && (
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/12 p-2.5 text-[11px] text-amber-200 space-y-1.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <p>
                Viewing session bound to{" "}
                <span className="font-mono font-semibold">
                  {activeSessionSummary.project_name}
                </span>
                . Active workspace{" "}
                <span className="font-mono font-semibold">
                  {activeProject.project.name}
                </span>{" "}
                is isolated so agents cannot cross projects silently.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateSession}
              className="inline-flex h-6 items-center gap-1 rounded border border-amber-300/40 bg-amber-400/20 px-2 font-mono text-[10px] font-medium text-amber-100 hover:bg-amber-400/30"
            >
              <Plus className="h-3 w-3" />
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
          <div className="rounded-xl border border-white/10 bg-[#08090f] p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#e8ebf7]">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <span>OpenCode CLI Not Available</span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-[#e8ebf7]/65">
              {info?.unavailable_reason ||
                "OpenCode is optional. Install the OpenCode CLI or set a verified binary path in Settings to run project-aware AI sessions."}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={info?.install_guide_url || "https://opencode.ai/docs"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 font-mono text-[10.5px] text-[#e8ebf7] hover:bg-white/[0.1]"
              >
                <span>Install Guide</span>
                <ExternalLink className="h-3 w-3" />
              </a>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 font-mono text-[10.5px] text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
              >
                <Settings className="h-3 w-3" />
                <span>Configure OpenCode</span>
              </button>
            </div>
          </div>
        ) : !activeProject ? (
          <div className="rounded-xl border border-white/10 bg-[#08090f] p-3.5 text-xs text-[#e8ebf7]/60">
            Open or create a VEGA ARIES V3 project to start a workspace-bound OpenCode session.
          </div>
        ) : messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-[#08090f] p-3.5 space-y-1.5">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-[#7aa2ff] uppercase">
                OpenCode CLI Workspace Agent
              </span>
              <p className="text-[11.5px] leading-relaxed text-[#e8ebf7]/65">
                Ask OpenCode to explain code, investigate compiler/runtime errors, or assist with changes inside{" "}
                <span className="font-mono text-[#e8ebf7]">
                  {activeProject.project.name}
                </span>
                . Tool actions follow your permission rules cleanly.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block px-1 font-mono text-[10px] tracking-wider text-[#e8ebf7]/45 uppercase">
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
                  className="block w-full rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left text-[11.5px] text-[#e8ebf7]/75 transition-colors hover:border-[#7aa2ff]/35 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
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
                  className="ml-4 rounded-xl border border-[#7aa2ff]/25 bg-[#7aa2ff]/12 p-2.5 text-xs text-[#e8ebf7] space-y-1.5"
                >
                  {msg.contexts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.contexts.map((ctx, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded border border-white/15 bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-[#9bb8ff]"
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
              return (
                <div
                  key={msg.id}
                  className={`rounded-xl border p-2.5 text-[11px] ${
                    msg.role === "error"
                      ? "border-red-400/30 bg-red-500/10 text-red-200"
                      : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/65"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              );
            }

            // Assistant message (may contain reasoning + tools + markdown text)
            return (
              <div
                key={msg.id}
                className="rounded-xl border border-white/[0.08] bg-[#08090f] p-3 text-xs text-[#e8ebf7]/90 space-y-2"
              >
                {msg.reasoning && (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleReasoning(msg.id)}
                      className="flex w-full items-center gap-1 font-mono text-[10px] text-[#e8ebf7]/50 hover:text-[#e8ebf7]/80"
                    >
                      {expandedReasoning[msg.id] ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <span>Reasoning</span>
                    </button>
                    {expandedReasoning[msg.id] && (
                      <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-[#e8ebf7]/60">
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
                  <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#e8ebf7]/90">
                    {msg.text}
                  </pre>
                )}

                {msg.is_streaming && (
                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#7aa2ff]">
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
            <div className="flex items-center gap-2 rounded-xl border border-[#7aa2ff]/25 bg-[#7aa2ff]/[0.06] px-3 py-2 font-mono text-[11px] text-[#9bb8ff]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
              <span>OpenCode is processing workspace request…</span>
            </div>
          )}
      </div>

      {/* Bottom Floating Glass Composer Card (DESIGN_SYSTEM.md 20px glass surface) */}
      <div className="shrink-0 p-3 pt-1">
        <div
          className="vega-glass rounded-[20px] p-2.5 focus-within:border-[#7aa2ff]/45 focus-within:ring-2 focus-within:ring-[#7aa2ff]/20"
          style={{ ["--blur" as string]: "10px", ["--tint" as string]: "0.65" }}
        >
          {pendingContexts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingContexts.map((ctx, idx) => (
                <span
                  key={idx}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#7aa2ff]/35 bg-[#7aa2ff]/14 px-2 py-0.5 font-mono text-[10px] text-[#e8ebf7]"
                >
                  <FileCode2 className="h-3 w-3 shrink-0 text-[#7aa2ff]" />
                  <span className="truncate">{ctx.title}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveContext(idx)}
                    aria-label={`Remove ${ctx.title}`}
                    className="text-[#e8ebf7]/60 hover:text-white"
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
            aria-label="Ask OpenCode prompt"
            placeholder={
              !cliReady
                ? "Install or configure OpenCode CLI in Settings…"
                : !activeProject
                ? "Open a project to message OpenCode…"
                : isCrossProjectSession
                ? "Start a session in the current project to send messages…"
                : "Ask OpenCode to explain, debug, or modify project code…"
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
            className="vega-scroll max-h-36 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed text-[#e8ebf7] placeholder:text-[#e8ebf7]/35 focus:outline-none disabled:opacity-50"
          />

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {info && info.available_models.length > 0 ? (
                <select
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  aria-label="OpenCode model"
                  className="h-7 max-w-[165px] truncate rounded-full border border-white/12 bg-white/[0.04] px-2.5 font-mono text-[10px] text-[#e8ebf7]/80 focus:outline-none"
                >
                  <option value="">Default Model</option>
                  {info.available_models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="truncate font-mono text-[10px] text-[#e8ebf7]/40">
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
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-400/45 bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={onSendPrompt}
                aria-label="Send prompt to OpenCode"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#7aa2ff]/45 bg-[#7aa2ff]/25 text-[#e8ebf7] transition-colors hover:bg-[#7aa2ff]/40 disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-[#e8ebf7]/35"
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
      className={`rounded-xl border p-2.5 space-y-2 text-[11px] ${
        perm.is_sensitive
          ? "border-red-400/40 bg-red-500/12 text-red-100"
          : "border-amber-400/40 bg-amber-500/12 text-amber-100"
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
            <ul className="space-y-0.5 rounded bg-black/30 p-1.5 font-mono text-[10px]">
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
          onClick={() => onReply(perm.request_id, "reject")}
          className="inline-flex h-6 items-center gap-1 rounded border border-red-300/35 bg-red-500/20 px-2 font-mono text-[10px] font-medium hover:bg-red-500/35"
        >
          <X className="h-3 w-3" />
          <span>Reject</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onReply(perm.request_id, "once")}
          className="inline-flex h-6 items-center gap-1 rounded border border-white/25 bg-white/10 px-2 font-mono text-[10px] font-medium hover:bg-white/20"
        >
          <Check className="h-3 w-3" />
          <span>Allow Once</span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onReply(perm.request_id, "always")}
          className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/45 bg-[#7aa2ff]/25 px-2 font-mono text-[10px] font-medium hover:bg-[#7aa2ff]/35"
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
    <div className="rounded-lg border border-white/[0.08] bg-[#06070c]/85 px-2.5 py-1.5 font-mono text-[10.5px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[#e8ebf7]/85">
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-[#e8ebf7]/45" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-[#e8ebf7]/45" />
          )}
          <Wrench className="h-3 w-3 shrink-0 text-[#7aa2ff]" />
          <span className="truncate font-semibold">{tool.name}</span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase ${
            tool.status === "completed"
              ? "bg-emerald-500/15 text-emerald-300"
              : tool.status === "error"
              ? "bg-red-500/15 text-red-300"
              : "bg-[#7aa2ff]/15 text-[#9bb8ff]"
          }`}
        >
          {tool.status}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-white/[0.06] pt-1.5 text-[10px] text-[#e8ebf7]/65">
          {tool.input_preview && (
            <pre className="vega-scroll max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-black/40 p-1.5">
              Input: {tool.input_preview}
            </pre>
          )}
          {tool.output_preview && (
            <pre className="vega-scroll max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded bg-black/40 p-1.5 text-emerald-200/80">
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
