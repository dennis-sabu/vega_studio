"use client";

import { useEffect, useState } from"react";
import {
  Cpu,
  FolderOpen,
  GitBranch,
  Hammer,
  Loader2,
  Plug,
  Stethoscope,
  Terminal,
  Upload,
  Usb,
} from"lucide-react";
import { Tooltip } from"@/components/ui/Tooltip";
import type { HealthResponse } from"@/lib/api";
import {
  formatBoardDisplayLabel,
  type CompatibilityStatus,
} from"@/types/board";
import type { BuildSummary } from"@/types/build";
import type { EditorCursorPosition, EditorSettings } from"@/types/editor";
import type { OpenFileTab } from"@/types/explorer";
import type { GitStatusResponse } from"@/types/git";
import type { DiagnosticStatus } from"@/types/sdk";
import type { SerialStatus } from"@/types/serial";
import type { UploadSummary } from"@/types/upload";

interface StatusBarProps {
  isConnected: boolean;
  health: HealthResponse | null;
  error: string | null;
  activeProjectName: string | null;
  activeBoardId: string | null;
  activeBoardName: string | null;
  boardSupported: boolean;
  boardCompatibility: CompatibilityStatus | null;
  activeFileTab: OpenFileTab | null;
  cursorPosition: EditorCursorPosition;
  editorSettings: EditorSettings;
  dirtyCount: number;
  sdkStatus: DiagnosticStatus | null;
  gitStatus: GitStatusResponse | null;
  latestBuild: BuildSummary | null;
  latestUpload: UploadSummary | null;
  selectedPort: string;
  serialStatus: SerialStatus;
  serialPort: string | null;
  serialBaudRate: number;
  terminalRunningCount: number;
  onInspectBackend: () => void;
  onOpenSdkDoctor: () => void;
  onOpenSourceControl: () => void;
  onOpenBoardManager: () => void;
  onOpenBuildOutput: () => void;
  onOpenUploadOutput: () => void;
  onOpenSerialMonitor: () => void;
  onOpenTerminal: () => void;
  onOpenProject: () => void;
}

export function StatusBar({
  isConnected,
  health,
  error,
  activeProjectName,
  activeBoardId,
  activeBoardName,
  boardSupported,
  boardCompatibility,
  activeFileTab,
  cursorPosition,
  editorSettings,
  dirtyCount,
  sdkStatus,
  gitStatus,
  latestBuild,
  latestUpload,
  selectedPort,
  serialStatus,
  serialPort,
  serialBaudRate,
  terminalRunningCount,
  onInspectBackend,
  onOpenSdkDoctor,
  onOpenSourceControl,
  onOpenBoardManager,
  onOpenBuildOutput,
  onOpenUploadOutput,
  onOpenSerialMonitor,
  onOpenTerminal,
  onOpenProject,
}: StatusBarProps) {
  const [platform, setPlatform] = useState<string>("web");

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      if (typeof window !== "undefined" && window.vegaStudio?.getPlatform) {
        setPlatform(window.vegaStudio.getPlatform());
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  const boardLabel = activeProjectName
    ? activeBoardId
      ? !boardSupported
        ? `Unsupported: ${formatBoardDisplayLabel(null, activeBoardId)}`
        : formatBoardDisplayLabel(activeBoardName, activeBoardId, { short: true })
      : "No Board"
    : "ARIES V3";

  return (
    <footer className="vega-status-bar relative z-20 flex h-6 shrink-0 items-center justify-between gap-2 border-t border-[#2B2B2E] bg-[#181818] px-2.5 text-[11px] text-[#E4E4E7] select-none">
      {/* Left: Connection, Project, Board, SDK, Git, Build, Serial & Terminal Telemetry */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <Tooltip
          label={
            isConnected
              ? `Connected to ${health?.service ?? "backend"} v${health?.version ?? "0.1.0"} — click for details`
              : `${error ?? "Backend unreachable"} — click for diagnostics`
          }
          side="top"
        >
          <button
            type="button"
            onClick={onInspectBackend}
            className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span className={isConnected ? "text-[#F4F4F5]" : "text-red-300"}>
              {isConnected ? "Connected" : "Offline"}
            </span>
          </button>
        </Tooltip>

        <Tooltip
          label={
            activeProjectName
              ? `Active project: ${activeProjectName} — click to switch`
              : "No active project — click to open"
          }
          side="top"
        >
          <button
            type="button"
            onClick={onOpenProject}
            className="hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] sm:inline-flex"
          >
          <FolderOpen className="h-3 w-3 text-[#7AA2FF]" />
          <span className="max-w-[130px] truncate">
              {activeProjectName ?? "No Project"}
            </span>
          </button>
        </Tooltip>

        <Tooltip
          label={
            !activeProjectName
              ? "Open Board Manager to browse verified VEGA boards"
              : !activeBoardId
                ? "No hardware board assigned — click to select in Board Manager"
                : !boardSupported
                  ? `Unsupported board (${activeBoardId}) — click to resolve in Board Manager`
                  : `Target Board: ${activeBoardName ?? activeBoardId} — click to configure`
          }
          side="top"
        >
          <button
            type="button"
            onClick={onOpenBoardManager}
            className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] md:inline-flex ${
              !activeProjectName
                ? "text-[#B4B4BC] hover:text-[#F4F4F5]"
                : !activeBoardId || !boardSupported
                  ? "text-amber-300"
                  : boardCompatibility === "incompatible"
                    ? "text-red-300"
                    : "text-[#F4F4F5] hover:text-[#F4F4F5]"
            }`}
          >
          <Cpu className="h-3 w-3 text-[#7AA2FF]" />
            <span>{boardLabel}</span>
          </button>
        </Tooltip>

        <Tooltip
          label="Open VEGA SDK Doctor & environment diagnostics"
          side="top"
        >
          <button
            type="button"
            onClick={onOpenSdkDoctor}
            className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] md:inline-flex ${
              sdkStatus === "pass"
                ? "text-emerald-200"
                : sdkStatus === "warning"
                  ? "text-amber-300"
                  : sdkStatus === "fail"
                    ? "text-red-300"
                    : "text-[#B4B4BC] hover:text-[#F4F4F5]"
            }`}
          >
          <Stethoscope className="h-3 w-3" />
            <span>
              {sdkStatus === "pass"
                ? "SDK Ready"
                : sdkStatus === "warning"
                  ? "SDK Warn"
                  : sdkStatus === "fail"
                    ? "SDK Issue"
                    : "SDK"}
            </span>
          </button>
        </Tooltip>

        <Tooltip
          label={
            !activeProjectName
              ? "Open a project to use Git Source Control"
              : !gitStatus?.git_available
                ? "Git CLI not installed — click for instructions"
                : !gitStatus?.is_repository
                  ? "Project is not a Git repository — click to initialize"
                  : `Branch: ${gitStatus.current_branch ?? "Detached HEAD"} — click to open Source Control`
          }
          side="top"
        >
          <button
            type="button"
            onClick={onOpenSourceControl}
            className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] lg:inline-flex ${
              !activeProjectName
                ? "text-[#B4B4BC] hover:text-[#F4F4F5]"
                : !gitStatus?.git_available
                  ? "text-amber-300"
                  : !gitStatus?.is_repository
                    ? "text-[#E4E4E7] hover:text-[#F4F4F5]"
                    : gitStatus.staged_count +
                          gitStatus.unstaged_count +
                          gitStatus.untracked_count >
                        0
                      ? "text-amber-200"
                      : "text-emerald-200"
            }`}
          >
          <GitBranch className="h-3 w-3" />
            <span>
              {!activeProjectName
                ? "No Repo"
                : !gitStatus?.git_available
                  ? "Git Missing"
                  : !gitStatus?.is_repository
                    ? "Init Git"
                    : `${
                        gitStatus.is_detached
                          ? "Detached"
                          : gitStatus.current_branch ?? "main"
                      }${
                        gitStatus.staged_count +
                          gitStatus.unstaged_count +
                          gitStatus.untracked_count >
                        0
                          ? ` (${
                              gitStatus.staged_count +
                              gitStatus.unstaged_count +
                              gitStatus.untracked_count
                            })`
                          : ""
                      }`}
            </span>
          </button>
        </Tooltip>

        {latestBuild && (
          <Tooltip
            label={`Latest build: ${latestBuild.operation} (${latestBuild.status}) — click for Build Output`}
            side="top"
          >
            <button
              type="button"
              onClick={onOpenBuildOutput}
              className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] sm:inline-flex ${
                latestBuild.status === "running"
                  ? "text-[#7AA2FF]"
                  : latestBuild.status === "succeeded"
                    ? "text-emerald-300"
                    : latestBuild.status === "cancelled"
                      ? "text-amber-300"
                      : "text-red-300"
              }`}
            >
              {latestBuild.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
              <Hammer className="h-3 w-3" />
              )}
              <span>
                {latestBuild.status === "running"
                  ? `Building (${latestBuild.operation})...`
                  : latestBuild.status === "succeeded"
                    ? "Build OK"
                    : latestBuild.status === "cancelled"
                      ? "Build Cancelled"
                      : latestBuild.status === "timed_out"
                        ? "Build Timeout"
                        : "Build Failed"}
              </span>
            </button>
          </Tooltip>
        )}

        {(selectedPort || latestUpload) && (
          <Tooltip
            label={
              latestUpload
                ? `Latest upload: ${latestUpload.artifact_path} -> ${latestUpload.port} (${latestUpload.status}) — click for Upload Output`
                : `Selected serial port: ${selectedPort} — click for Upload Output`
            }
            side="top"
          >
            <button
              type="button"
              onClick={onOpenUploadOutput}
              className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] xl:inline-flex ${
                latestUpload?.status === "running"
                  ? "text-[#7AA2FF]"
                  : latestUpload?.status === "succeeded"
                    ? "text-emerald-300"
                    : latestUpload?.status === "cancelled"
                      ? "text-amber-300"
                      : latestUpload?.status === "failed" ||
                          latestUpload?.status === "timed_out"
                        ? "text-red-300"
                        : "text-[#E4E4E7] hover:text-[#F4F4F5]"
              }`}
            >
              {latestUpload?.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
              ) : latestUpload ? (
              <Upload className="h-3 w-3" />
              ) : (
              <Usb className="h-3 w-3 text-[#7AA2FF]" />
              )}
              <span>
                {latestUpload?.status === "running"
                  ? `Uploading (${latestUpload.port})...`
                  : latestUpload?.status === "succeeded"
                    ? `Uploaded (${latestUpload.port})`
                    : latestUpload?.status === "cancelled"
                      ? "Upload Cancelled"
                      : latestUpload?.status === "timed_out"
                        ? "Upload Timeout"
                        : latestUpload
                          ? "Upload Failed"
                          : selectedPort}
              </span>
            </button>
          </Tooltip>
        )}

        <Tooltip
          label={
            serialStatus === "connected"
              ? `Serial Monitor connected to ${serialPort} @ ${serialBaudRate} baud — click to open`
              : serialStatus === "error"
                ? "Serial Monitor connection error — click to inspect"
                : "Open UART Serial Monitor"
          }
          side="top"
        >
          <button
            type="button"
            onClick={onOpenSerialMonitor}
            className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] lg:inline-flex ${
              serialStatus === "connected"
                ? "text-emerald-300"
                : serialStatus === "connecting"
                  ? "text-[#7AA2FF]"
                  : serialStatus === "error"
                    ? "text-red-300"
                    : "text-[#B4B4BC] hover:text-[#F4F4F5]"
            }`}
          >
          <Plug className="h-3 w-3" />
            <span>
              {serialStatus === "connected" && serialPort
                ? `${serialPort} @ ${serialBaudRate}`
                : serialStatus === "connecting"
                  ? "Connecting…"
                  : serialStatus === "error"
                    ? "Serial Error"
                    : "Serial"}
            </span>
          </button>
        </Tooltip>

        <Tooltip
          label={
            terminalRunningCount > 0
              ? `${terminalRunningCount} interactive terminal session(s) running — click to open`
              : "Open Integrated Terminal"
          }
          side="top"
        >
          <button
            type="button"
            onClick={onOpenTerminal}
            className={`hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#252527] md:inline-flex ${
              terminalRunningCount > 0
                ? "text-emerald-300"
                : "text-[#B4B4BC] hover:text-[#F4F4F5]"
            }`}
          >
          <Terminal className="h-3 w-3" />
            <span>
              {terminalRunningCount > 0
                ? `Term: ${terminalRunningCount}`
                : "Terminal"}
            </span>
          </button>
        </Tooltip>

        {dirtyCount > 0 && (
        <span className="hidden h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10px] text-amber-200 md:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
            <span>{dirtyCount} unsaved</span>
          </span>
        )}
      </div>

      {/* Right: Editor Telemetry & Environment */}
      <div className="flex shrink-0 items-center gap-2.5 font-mono text-[10.5px] text-[#B4B4BC]">
        {activeFileTab && !activeFileTab.loading && !activeFileTab.error && (
        <div className="hidden items-center gap-2 text-[#E4E4E7] md:flex">
            <span>
              Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
              {cursorPosition.selectionLength > 0
                ? ` (${cursorPosition.selectionLength} sel)`
                : ""}
            </span>
            <span className="text-white/40">·</span>
            <span>
              {activeFileTab.monacoLanguage === "makefile"
                ? "Tabs: 4"
                : `${editorSettings.insertSpaces ? "Spaces" : "Tabs"}: ${editorSettings.tabSize}`}
            </span>
            <span className="hidden text-white/40 lg:inline">·</span>
            <span className="hidden lg:inline">{activeFileTab.lineEnding}</span>
            <span className="hidden text-white/40 lg:inline">·</span>
            <span className="hidden text-[#7AA2FF] lg:inline">
              {activeFileTab.language}
            </span>
          </div>
        )}

        <span className="hidden md:inline">UTF-8</span>
        <span className="rounded-[4px] bg-[#252527] px-1.5 py-0.5 text-[10px] text-[#B4B4BC] uppercase">
          {platform}
        </span>
      </div>
    </footer>
  );
}
