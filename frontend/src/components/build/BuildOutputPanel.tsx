"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Cpu,
  Hammer,
  History,
  Loader2,
  RotateCw,
  Square,
  Stethoscope,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  BuildLogLine,
  BuildMode,
  BuildOperation,
  BuildStatus,
  BuildSummary,
} from "@/types/build";

interface BuildOutputPanelProps {
  hasActiveProject: boolean;
  isBackendConnected: boolean;
  activeBuild: BuildSummary | null;
  latestBuild: BuildSummary | null;
  logs: BuildLogLine[];
  history: BuildSummary[];
  buildMode: BuildMode;
  customTarget: string;
  pendingAction: boolean;
  error: string | null;
  onModeChange: (mode: BuildMode) => void;
  onTargetChange: (target: string) => void;
  onRunOperation: (op: BuildOperation) => void;
  onCancel: () => void;
  onClearOutput: () => void;
  onClearHistory: () => void;
  onClearError: () => void;
  onOpenDiagnosticsTab: () => void;
  onOpenSdkDoctor: () => void;
  onOpenBoardManager: () => void;
}

const LOG_TIME = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : LOG_TIME.format(d);
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const STATUS_BADGE: Record<BuildStatus, { label: string; cls: string }> = {
  idle: {
    label: "IDLE",
    cls: "border-white/15 bg-white/[0.04] text-[#e8ebf7]/60",
  },
  running: {
    label: "BUILDING",
    cls: "border-[#7aa2ff]/40 bg-[#7aa2ff]/18 text-[#7aa2ff]",
  },
  succeeded: {
    label: "SUCCEEDED",
    cls: "border-emerald-400/35 bg-emerald-500/12 text-emerald-300",
  },
  failed: {
    label: "FAILED",
    cls: "border-red-400/35 bg-red-500/12 text-red-200",
  },
  cancelled: {
    label: "CANCELLED",
    cls: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  },
  timed_out: {
    label: "TIMED OUT",
    cls: "border-red-400/35 bg-red-500/15 text-red-200",
  },
};

export function BuildOutputPanel({
  hasActiveProject,
  isBackendConnected,
  activeBuild,
  latestBuild,
  logs,
  history,
  buildMode,
  customTarget,
  pendingAction,
  error,
  onModeChange,
  onTargetChange,
  onRunOperation,
  onCancel,
  onClearOutput,
  onClearHistory,
  onClearError,
  onOpenDiagnosticsTab,
  onOpenSdkDoctor,
  onOpenBoardManager,
}: BuildOutputPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [followOutput, setFollowOutput] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const isRunning = activeBuild?.status === "running";
  const currentStatus: BuildStatus = latestBuild?.status ?? "idle";
  const badge = STATUS_BADGE[currentStatus];

  // Auto-scroll strictly when followOutput is active
  useEffect(() => {
    if (!followOutput) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length, followOutput, isRunning]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 24;
    if (atBottom !== followOutput) {
      setFollowOutput(atBottom);
    }
  };

  const canStart = hasActiveProject && isBackendConnected && !isRunning && !pendingAction;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Build Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#06070c]/55 px-3 py-1.5 select-none">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${badge.cls}`}
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : currentStatus === "succeeded" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : currentStatus === "failed" || currentStatus === "timed_out" ? (
              <XCircle className="h-3 w-3" />
            ) : currentStatus === "cancelled" ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            <span>{badge.label}</span>
          </span>

          {latestBuild && (
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-[#e8ebf7]/60">
              <span>{latestBuild.operation.toUpperCase()}</span>
              {latestBuild.duration_ms !== null && (
                <span className="inline-flex items-center gap-1 text-[#e8ebf7]/50">
                  <Clock className="h-3 w-3" />
                  {formatDuration(latestBuild.duration_ms)}
                </span>
              )}
              {latestBuild.exit_code !== null && (
                <span>exit {latestBuild.exit_code}</span>
              )}
              {(latestBuild.error_count > 0 || latestBuild.warning_count > 0) && (
                <button
                  type="button"
                  onClick={onOpenDiagnosticsTab}
                  className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 hover:bg-white/[0.09]"
                >
                  {latestBuild.error_count > 0 && (
                    <span className="text-red-300">
                      {latestBuild.error_count} err
                    </span>
                  )}
                  {latestBuild.warning_count > 0 && (
                    <span className="text-amber-200">
                      {latestBuild.warning_count} warn
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Build mode"
            value={buildMode}
            disabled={isRunning}
            onChange={(e) => onModeChange(e.target.value as BuildMode)}
            className="h-6 rounded border border-white/10 bg-[#070910] px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/80 focus:border-[#7aa2ff]/55 focus:outline-none disabled:opacity-45"
          >
            <option value="default">Default</option>
            <option value="debug">Debug</option>
            <option value="release">Release</option>
          </select>

          <input
            type="text"
            aria-label="Make build target"
            value={customTarget}
            disabled={isRunning}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="Target (default)"
            className="h-6 w-28 rounded border border-white/10 bg-[#070910] px-2 font-mono text-[10.5px] text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/55 focus:outline-none disabled:opacity-45"
          />

          <button
            type="button"
            disabled={!canStart}
            onClick={() => onRunOperation("build")}
            className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Hammer className="h-3 w-3 text-[#7aa2ff]" />
            <span>Build</span>
          </button>

          <button
            type="button"
            disabled={!canStart}
            onClick={() => onRunOperation("clean")}
            className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 font-mono text-[10.5px] text-[#e8ebf7]/80 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clean</span>
          </button>

          <button
            type="button"
            disabled={!canStart}
            onClick={() => onRunOperation("rebuild")}
            className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 font-mono text-[10.5px] text-[#e8ebf7]/80 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCw className="h-3 w-3" />
            <span>Rebuild</span>
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-6 items-center gap-1 rounded border border-red-400/45 bg-red-500/20 px-2.5 font-mono text-[10.5px] font-medium text-red-100 hover:bg-red-500/30"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              <span>Cancel</span>
            </button>
          )}

          <Tooltip
            label={
              followOutput
                ? "Following latest build output"
                : "Follow latest output"
            }
            side="top"
          >
            <button
              type="button"
              onClick={() => {
                setFollowOutput(true);
                const el = scrollContainerRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                followOutput
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/15 text-[#7aa2ff]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45 hover:text-[#e8ebf7]"
              }`}
            >
              <ArrowDownToLine className="h-3 w-3" />
            </button>
          </Tooltip>

          <Tooltip label="Toggle Build History" side="top">
            <button
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] transition-colors ${
                showHistory
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/15 text-[#e8ebf7]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/55 hover:text-[#e8ebf7]"
              }`}
            >
              <History className="h-3 w-3" />
              <span>{history.length}</span>
            </button>
          </Tooltip>

          {logs.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={onClearOutput}
              title="Clear build console"
              className="inline-flex h-6 items-center rounded border border-white/10 bg-white/[0.03] px-2 font-mono text-[10px] text-[#e8ebf7]/55 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Indeterminate progress indicator while active build runs */}
      {isRunning && (
        <div
          aria-label="Build in progress"
          className="h-0.5 w-full overflow-hidden bg-white/[0.05]"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[#7aa2ff]" />
        </div>
      )}

      {/* Pre-flight Error Strip (e.g. missing SDK / Makefile) */}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-200">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
            <span className="truncate font-sans">{error}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(error.toLowerCase().includes("board") ||
              error.toLowerCase().includes("compatibility")) && (
              <button
                type="button"
                onClick={onOpenBoardManager}
                className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/35 bg-[#7aa2ff]/18 px-2 font-sans text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
              >
                <Cpu className="h-3 w-3 text-[#7aa2ff]" />
                <span>Open Board Manager</span>
              </button>
            )}
            {(error.toLowerCase().includes("sdk") ||
              error.toLowerCase().includes("compiler") ||
              error.toLowerCase().includes("make")) && (
              <button
                type="button"
                onClick={onOpenSdkDoctor}
                className="inline-flex h-6 items-center gap-1 rounded border border-white/15 bg-white/[0.08] px-2 font-sans text-[11px] font-medium text-[#e8ebf7] hover:bg-white/15"
              >
                <Stethoscope className="h-3 w-3 text-[#7aa2ff]" />
                <span>Open SDK Doctor</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss build error"
              onClick={onClearError}
              className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Body: Console Output + Optional History Drawer */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed"
        >
          {logs.length === 0 ? (
            <div className="flex h-full min-h-[72px] items-center justify-center font-sans">
              <div className="flex max-w-lg items-start gap-3 rounded-xl border border-white/8 bg-[#08090f] px-4 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                  <Hammer className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#e8ebf7]">
                    {hasActiveProject
                      ? "Ready to Build VEGA Firmware"
                      : "No Active VEGA Project"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#e8ebf7]/55">
                    {hasActiveProject
                      ? "Click Build, Clean, or Rebuild to invoke your project's Makefile using the configured Phase 6 SDK environment."
                      : "Create or open a VEGA ARIES V3 project to enable firmware builds."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {latestBuild?.truncated_logs && (
                <div className="mb-2 rounded border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10.5px] text-amber-200">
                  Showing newest {logs.length.toLocaleString()} output lines (earlier lines trimmed to bound memory).
                </div>
              )}
              {logs.map((line) => (
                <div
                  key={line.seq}
                  className={`flex items-baseline gap-2.5 rounded px-1.5 py-0.5 break-all ${
                    line.stream === "stderr"
                      ? "bg-red-500/[0.05] text-red-200"
                      : line.stream === "system"
                      ? "text-[#7aa2ff]/90"
                      : "text-[#e8ebf7]/88"
                  }`}
                >
                  <span className="shrink-0 text-[10px] text-[#e8ebf7]/30 select-none">
                    {formatTime(line.timestamp)}
                  </span>
                  <span className="whitespace-pre-wrap">{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showHistory && (
          <aside className="vega-scroll w-64 shrink-0 overflow-y-auto border-l border-white/[0.08] bg-[#070910]/70 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/50 uppercase">
                Session History ({history.length})
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-[10px] text-[#e8ebf7]/45 hover:text-[#e8ebf7]"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-[#e8ebf7]/40">
                No builds recorded in this session yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((item) => (
                  <li
                    key={item.build_id}
                    className="rounded-lg border border-white/[0.07] bg-[#090b13]/85 p-2 font-mono text-[10.5px]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[#e8ebf7]">
                        {item.operation.toUpperCase()}
                      </span>
                      <span
                        className={
                          item.status === "succeeded"
                            ? "text-emerald-300"
                            : item.status === "running"
                            ? "text-[#7aa2ff]"
                            : item.status === "cancelled"
                            ? "text-amber-300"
                            : "text-red-300"
                        }
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[#e8ebf7]/55">
                      {item.project_name}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-[#e8ebf7]/40">
                      <span>{formatDuration(item.duration_ms)}</span>
                      <span>
                        {item.error_count}e / {item.warning_count}w
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
