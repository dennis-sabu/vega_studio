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
  RefreshCw,
  ShieldAlert,
  Square,
  Stethoscope,
  Trash2,
  Upload,
  Usb,
  X,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  DeviceListResponse,
  SerialDeviceInfo,
  UploadInvocationMode,
  UploadLogLine,
  UploadPreflightResponse,
  UploadStatus,
  UploadSummary,
} from "@/types/upload";

interface UploadPanelProps {
  hasActiveProject: boolean;
  isBackendConnected: boolean;
  deviceInfo: DeviceListResponse | null;
  devices: SerialDeviceInfo[];
  preflight: UploadPreflightResponse | null;
  selectedPort: string;
  selectedArtifactPath: string;
  invocationMode: UploadInvocationMode;
  activeUpload: UploadSummary | null;
  latestUpload: UploadSummary | null;
  logs: UploadLogLine[];
  history: UploadSummary[];
  refreshingDevices: boolean;
  runningPreflight: boolean;
  pendingAction: boolean;
  error: string | null;
  confirmNonce: number;
  onSelectPort: (port: string) => void;
  onSelectArtifact: (path: string) => void;
  onSelectMode: (mode: UploadInvocationMode) => void;
  onRefreshDevices: () => void;
  onRunPreflight: () => void;
  onStartUpload: (options?: {
    allowStaleArtifact?: boolean;
    strictPortCheck?: boolean;
  }) => Promise<unknown>;
  onCancel: () => void;
  onClearOutput: () => void;
  onClearHistory: () => void;
  onClearError: () => void;
  onTriggerBuild: () => void;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_BADGE: Record<UploadStatus, { label: string; cls: string }> = {
  idle: {
    label: "READY",
    cls: "border-white/15 bg-white/[0.04] text-[#e8ebf7]/60",
  },
  running: {
    label: "UPLOADING",
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

export function UploadPanel({
  hasActiveProject,
  isBackendConnected,
  deviceInfo,
  devices,
  preflight,
  selectedPort,
  selectedArtifactPath,
  invocationMode,
  activeUpload,
  latestUpload,
  logs,
  history,
  refreshingDevices,
  runningPreflight,
  pendingAction,
  error,
  confirmNonce,
  onSelectPort,
  onSelectArtifact,
  onSelectMode,
  onRefreshDevices,
  onRunPreflight,
  onStartUpload,
  onCancel,
  onClearOutput,
  onClearHistory,
  onClearError,
  onTriggerBuild,
  onOpenSdkDoctor,
  onOpenBoardManager,
}: UploadPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [followOutput, setFollowOutput] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const isRunning = activeUpload?.status === "running";
  const currentStatus: UploadStatus = latestUpload?.status ?? "idle";
  const badge = STATUS_BADGE[currentStatus];

  // Auto-open explicit confirmation bar when Toolbar Upload button is clicked
  useEffect(() => {
    if (confirmNonce <= 0) return;
    queueMicrotask(() => {
      if (hasActiveProject && isBackendConnected && !isRunning) {
        setAwaitingConfirm(true);
      }
    });
  }, [confirmNonce, hasActiveProject, isBackendConnected, isRunning]);

  // Auto-scroll output when followOutput is enabled
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

  const preflightReady = Boolean(preflight?.ready);
  const canInitiateUpload =
    hasActiveProject &&
    isBackendConnected &&
    !isRunning &&
    !pendingAction &&
    preflightReady;

  const artifacts = preflight?.artifacts ?? [];
  const selectedArtifact = preflight?.selected_artifact ?? null;

  const progressPct =
    isRunning &&
    activeUpload &&
    !activeUpload.progress_indeterminate &&
    activeUpload.progress_percent !== null
      ? activeUpload.progress_percent
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top Upload Controls Bar */}
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

          {/* Board Badge */}
          <button
            type="button"
            onClick={onOpenBoardManager}
            title="Inspect or change project board in Board Manager"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
              !hasActiveProject
                ? "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45"
                : preflight?.board_supported
                ? "border-white/12 bg-white/[0.04] text-[#e8ebf7]/80 hover:bg-white/[0.08]"
                : "border-amber-400/35 bg-amber-500/12 text-amber-200"
            }`}
          >
            <Cpu className="h-3 w-3 text-[#7aa2ff]" />
            <span>
              {preflight?.board_name ?? preflight?.board_id ?? "No Board"}
            </span>
          </button>

          {/* Latest upload metrics */}
          {latestUpload && (
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-[#e8ebf7]/60">
              <span className="truncate max-w-[140px]">
                {latestUpload.port}
              </span>
              {latestUpload.duration_ms !== null && (
                <span className="inline-flex items-center gap-1 text-[#e8ebf7]/50">
                  <Clock className="h-3 w-3" />
                  {formatDuration(latestUpload.duration_ms)}
                </span>
              )}
              {latestUpload.exit_code !== null && (
                <span
                  className={
                    latestUpload.exit_code === 0
                      ? "text-emerald-300"
                      : "text-red-300"
                  }
                >
                  exit {latestUpload.exit_code}
                </span>
              )}
              {progressPct !== null && (
                <span className="text-[#7aa2ff]">{progressPct}%</span>
              )}
            </div>
          )}
        </div>

        {/* Right Controls Cluster */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Artifact Selector / Indicator */}
          {hasActiveProject && (
            <div className="flex items-center gap-1">
              {artifacts.length > 1 ? (
                <select
                  aria-label="Firmware artifact"
                  value={selectedArtifactPath}
                  disabled={isRunning}
                  onChange={(e) => {
                    setAwaitingConfirm(false);
                    onSelectArtifact(e.target.value);
                  }}
                  className={`h-6 max-w-[190px] rounded border bg-[#0b0e17] px-2 font-mono text-[10.5px] focus:outline-none ${
                    !selectedArtifactPath
                      ? "border-amber-400/40 text-amber-200"
                      : "border-white/10 text-[#e8ebf7]/85"
                  }`}
                >
                  <option value="">Choose artifact...</option>
                  {artifacts.map((art) => (
                    <option key={art.relative_path} value={art.relative_path}>
                      {art.relative_path} ({formatBytes(art.size_bytes)})
                    </option>
                  ))}
                </select>
              ) : selectedArtifact ? (
                <span
                  title={`${selectedArtifact.relative_path} (${formatBytes(selectedArtifact.size_bytes)})`}
                  className={`inline-flex h-6 items-center gap-1.5 rounded border px-2 font-mono text-[10.5px] ${
                    selectedArtifact.stale
                      ? "border-amber-400/35 bg-amber-500/10 text-amber-200"
                      : "border-white/10 bg-[#0b0e17] text-[#e8ebf7]/80"
                  }`}
                >
                  <span className="max-w-[140px] truncate">
                    {selectedArtifact.relative_path}
                  </span>
                  <span className="text-[#e8ebf7]/45">
                    {formatBytes(selectedArtifact.size_bytes)}
                  </span>
                  {selectedArtifact.stale && (
                    <span className="text-amber-300 uppercase">stale</span>
                  )}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onTriggerBuild}
                  className="inline-flex h-6 items-center gap-1 rounded border border-amber-400/35 bg-amber-500/12 px-2 font-mono text-[10.5px] text-amber-200 hover:bg-amber-500/20"
                >
                  <Hammer className="h-3 w-3" />
                  <span>Build Required</span>
                </button>
              )}
            </div>
          )}

          {/* Serial Device / Port Selector + Manual Entry */}
          <div className="flex items-center gap-1">
            {devices.length > 0 && (
              <select
                aria-label="Discovered serial port"
                value={
                  devices.some((d) => d.port === selectedPort)
                    ? selectedPort
                    : ""
                }
                disabled={isRunning}
                onChange={(e) => {
                  if (e.target.value) {
                    setAwaitingConfirm(false);
                    onSelectPort(e.target.value);
                  }
                }}
                className="h-6 max-w-[145px] rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/85 focus:outline-none"
              >
                <option value="">Detected ports ({devices.length})</option>
                {devices.map((d) => (
                  <option key={d.port} value={d.port}>
                    {d.display_name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative flex items-center">
              <Usb className="pointer-events-none absolute left-1.5 h-3 w-3 text-[#7aa2ff]/70" />
              <input
                type="text"
                aria-label="Serial port path"
                value={selectedPort}
                disabled={isRunning}
                onChange={(e) => {
                  setAwaitingConfirm(false);
                  onSelectPort(e.target.value);
                }}
                placeholder="/dev/ttyUSB0 or COM3"
                className="h-6 w-36 rounded border border-white/10 bg-[#0b0e17] pr-2 pl-6 font-mono text-[10.5px] text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/45 focus:outline-none"
              />
            </div>

            <Tooltip label="Refresh serial devices & preflight" side="top">
              <button
                type="button"
                aria-label="Refresh serial devices"
                disabled={!isBackendConnected || refreshingDevices}
                onClick={onRefreshDevices}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshingDevices ? "animate-spin text-[#7aa2ff]" : ""}`}
                />
              </button>
            </Tooltip>
          </div>

          {/* Adaptable Invocation Mode */}
          <Tooltip
            label="Uploader CLI argument format adapter"
            side="top"
          >
            <select
              aria-label="Uploader invocation mode"
              value={invocationMode}
              disabled={isRunning}
              onChange={(e) => {
                setAwaitingConfirm(false);
                onSelectMode(e.target.value as UploadInvocationMode);
              }}
              className="hidden h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10px] text-[#e8ebf7]/75 focus:outline-none xl:block"
            >
              <option value="auto">CLI: Auto (AST)</option>
              <option value="positional_port_file">CLI: &lt;port&gt; &lt;file&gt;</option>
              <option value="positional_file_port">CLI: &lt;file&gt; &lt;port&gt;</option>
              <option value="flagged_port_file">CLI: --port --file</option>
            </select>
          </Tooltip>

          {/* Upload Button (opens explicit confirmation strip) */}
          <button
            type="button"
            disabled={!canInitiateUpload}
            onClick={() => {
              onRunPreflight();
              setAwaitingConfirm(true);
            }}
            className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
            ) : (
              <Upload className="h-3 w-3 text-[#7aa2ff]" />
            )}
            <span>Upload</span>
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

          {/* Preflight Checks Toggle */}
          <Tooltip label="Toggle upload preflight checks" side="top">
            <button
              type="button"
              onClick={() => setShowChecks((prev) => !prev)}
              className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] transition-colors ${
                showChecks
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/15 text-[#e8ebf7]"
                  : preflight && !preflight.ready
                  ? "border-amber-400/35 bg-amber-500/12 text-amber-200"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:text-[#e8ebf7]"
              }`}
            >
              <span>Checks</span>
              {preflight && (
                <span>
                  ({preflight.checks.filter((c) => c.status === "pass").length}/
                  {preflight.checks.length})
                </span>
              )}
            </button>
          </Tooltip>

          {/* Follow Output Lock */}
          <Tooltip
            label={
              followOutput ? "Following latest upload output" : "Follow output"
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

          {/* Upload History Toggle */}
          <Tooltip label="Toggle Upload History" side="top">
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
              title="Clear upload console"
              className="inline-flex h-6 items-center rounded border border-white/10 bg-white/[0.03] px-2 font-mono text-[10px] text-[#e8ebf7]/55 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar (Determinate only when uploader reports explicit %, otherwise indeterminate) */}
      {isRunning && (
        <div
          aria-label="Firmware upload progress"
          className="h-0.5 w-full overflow-hidden bg-white/[0.05]"
        >
          {progressPct !== null ? (
            <div
              className="h-full bg-[#7aa2ff] transition-[width] duration-150"
              style={{ width: `${Math.min(100, Math.max(2, progressPct))}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[#7aa2ff]" />
          )}
        </div>
      )}

      {/* Explicit Hardware Upload Confirmation Strip */}
      {awaitingConfirm && preflight && !isRunning && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#7aa2ff]/25 bg-[#7aa2ff]/[0.08] px-3 py-2 text-xs">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-[#e8ebf7]">
              Confirm Firmware Upload to{" "}
              <span className="font-mono text-[#7aa2ff]">
                {preflight.board_name ?? preflight.board_id ?? "Board"}
              </span>
              {preflight.selected_port && (
                <>
                  {" "}
                  on{" "}
                  <span className="font-mono text-[#7aa2ff]">
                    {preflight.selected_port}
                  </span>
                </>
              )}
            </p>
            <p className="truncate font-mono text-[10.5px] text-[#e8ebf7]/65">
              {preflight.command_preview.join(" ") ||
                "Complete preflight blockers below before uploading."}
            </p>
            {selectedArtifact?.stale && (
              <p className="text-[11px] text-amber-200">
                Warning: Selected firmware is older than modified source files. Rebuild recommended before flashing.
              </p>
            )}
            {!preflight.command_convention_verified && preflight.ready && (
              <p className="text-[11px] text-amber-200/85">
                Note: Downstream vega_xmodem.py CLI flags use an adaptable convention; verify preview arguments match your SDK script.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {selectedArtifact?.stale && (
              <button
                type="button"
                onClick={() => {
                  setAwaitingConfirm(false);
                  onTriggerBuild();
                }}
                className="inline-flex h-7 items-center gap-1 rounded border border-white/15 bg-white/[0.06] px-2.5 text-[11px] font-medium text-[#e8ebf7] hover:bg-white/12"
              >
                <Hammer className="h-3 w-3 text-[#7aa2ff]" />
                <span>Rebuild First</span>
              </button>
            )}
            <button
              type="button"
              disabled={!canInitiateUpload}
              onClick={() => {
                setAwaitingConfirm(false);
                void onStartUpload({ allowStaleArtifact: true });
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-[#7aa2ff]/50 bg-[#7aa2ff]/25 px-3 text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/35 disabled:opacity-40"
            >
              <Upload className="h-3 w-3 text-[#7aa2ff]" />
              <span>Confirm &amp; Upload</span>
            </button>
            <button
              type="button"
              onClick={() => setAwaitingConfirm(false)}
              className="inline-flex h-7 items-center rounded border border-white/10 bg-transparent px-2.5 text-[11px] text-[#e8ebf7]/70 hover:bg-white/[0.06]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Blocking Error / Preflight Remediation Strip */}
      {(error || (hasActiveProject && preflight && !preflight.ready)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <div className="flex min-w-0 items-center gap-2">
            {error ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
            ) : (
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" />
            )}
            <span className="truncate font-sans">
              {error ??
                preflight?.blocking_issues[0] ??
                "Upload prerequisites incomplete."}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {preflight?.needs_build && (
              <button
                type="button"
                onClick={onTriggerBuild}
                className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/35 bg-[#7aa2ff]/18 px-2 font-sans text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
              >
                <Hammer className="h-3 w-3 text-[#7aa2ff]" />
                <span>Build Project</span>
              </button>
            )}
            {preflight?.needs_board_manager && (
              <button
                type="button"
                onClick={onOpenBoardManager}
                className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/35 bg-[#7aa2ff]/18 px-2 font-sans text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
              >
                <Cpu className="h-3 w-3 text-[#7aa2ff]" />
                <span>Open Board Manager</span>
              </button>
            )}
            {preflight?.needs_sdk_doctor && (
              <button
                type="button"
                onClick={onOpenSdkDoctor}
                className="inline-flex h-6 items-center gap-1 rounded border border-white/15 bg-white/[0.08] px-2 font-sans text-[11px] font-medium text-[#e8ebf7] hover:bg-white/15"
              >
                <Stethoscope className="h-3 w-3 text-[#7aa2ff]" />
                <span>Open SDK Doctor</span>
              </button>
            )}
            {error && (
              <button
                type="button"
                aria-label="Dismiss upload error"
                onClick={onClearError}
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Optional Preflight Checks Breakdown Drawer */}
      {showChecks && preflight && (
        <div className="border-b border-white/[0.08] bg-[#070910]/90 px-3 py-2 text-[11px]">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-[#e8ebf7]/55 uppercase">
            <span>
              Upload Preflight ({preflight.contract_source} ·{" "}
              {runningPreflight ? "refreshing..." : preflight.resolved_invocation_mode})
            </span>
            {deviceInfo && (
              <span>
                Discovery: {deviceInfo.discovery_method} ({deviceInfo.devices.length} port(s))
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {preflight.checks.map((chk) => (
              <div
                key={chk.id}
                className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5"
              >
                {chk.status === "pass" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : chk.status === "warning" ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-[#e8ebf7]/90">{chk.label}</p>
                  <p className="text-[10.5px] text-[#e8ebf7]/60">{chk.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body: Live Upload Stream + Optional Bounded History Drawer */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed"
        >
          {logs.length === 0 ? (
            <div className="flex h-full min-h-[72px] items-center justify-center font-sans">
              <div className="flex max-w-xl items-start gap-3 rounded-xl border border-white/8 bg-[#08090f] px-4 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                  <Upload className="h-3.5 w-3.5" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#e8ebf7]">
                    {hasActiveProject
                      ? preflightReady
                        ? "Ready for Explicit Firmware Upload"
                        : "Upload Prerequisites Need Attention"
                      : "No Active VEGA Project"}
                  </p>
                  <p className="text-[11px] leading-relaxed text-[#e8ebf7]/55">
                    {hasActiveProject
                      ? preflightReady
                        ? `Select or confirm the serial device (${preflight?.selected_port}) and click Upload to flash ${preflight?.selected_artifact?.relative_path} to ${preflight?.board_name}.`
                        : "Resolve any missing build artifact, serial port, board target, or vega_xmodem.py configuration shown above."
                      : "Create or open a VEGA project and build firmware before uploading to hardware."}
                  </p>
                  {deviceInfo && deviceInfo.notes.length > 0 && (
                    <p className="text-[10.5px] text-[#e8ebf7]/45">
                      {deviceInfo.notes[0]}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line) => (
                <div
                  key={line.seq}
                  className={`flex items-baseline gap-2.5 rounded px-1.5 py-0.5 hover:bg-white/[0.03] ${
                    line.stream === "stderr"
                      ? "text-red-300"
                      : line.stream === "system"
                      ? "text-[#7aa2ff]"
                      : "text-[#e8ebf7]/88"
                  }`}
                >
                  <span className="shrink-0 text-[10px] text-[#e8ebf7]/30 select-none">
                    {formatTime(line.timestamp)}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-all">
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bounded Upload History Drawer */}
        {showHistory && (
          <aside className="vega-scroll w-68 shrink-0 overflow-y-auto border-l border-white/[0.08] bg-[#070910]/85 p-2.5 font-mono text-[11px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-[#e8ebf7]/50 uppercase">
                Upload History ({history.length})
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#e8ebf7]/45 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="py-4 text-center font-sans text-[11px] text-[#e8ebf7]/40">
                No firmware uploads recorded this session.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((item) => {
                  const st = STATUS_BADGE[item.status];
                  return (
                    <li
                      key={item.upload_id}
                      className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium text-[#e8ebf7]/90">
                          {item.board_id}
                        </span>
                        <span
                          className={`rounded-full border px-1.5 py-0.2 text-[9px] font-semibold ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-[#e8ebf7]/60">
                        {item.artifact_path} → {item.port}
                      </p>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-[#e8ebf7]/45">
                        <span>{formatTime(item.started_at)}</span>
                        <span>{formatDuration(item.duration_ms)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
