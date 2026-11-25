"use client";

import { useEffect, useState } from "react";
import {
  Circle,
  Cpu,
  FolderOpen,
  GitBranch,
  Hammer,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Stethoscope,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { HealthResponse } from "@/lib/api";
import type { BuildSummary } from "@/types/build";
import type { EditorCursorPosition, EditorSettings } from "@/types/editor";
import type { OpenFileTab } from "@/types/explorer";
import type { DiagnosticStatus } from "@/types/sdk";

interface StatusBarProps {
  isConnected: boolean;
  health: HealthResponse | null;
  error: string | null;
  activeProjectName: string | null;
  activeFileTab: OpenFileTab | null;
  cursorPosition: EditorCursorPosition;
  editorSettings: EditorSettings;
  dirtyCount: number;
  sdkStatus: DiagnosticStatus | null;
  latestBuild: BuildSummary | null;
  sidebarOpen: boolean;
  bottomPanelOpen: boolean;
  rightPanelOpen: boolean;
  onInspectBackend: () => void;
  onOpenSdkDoctor: () => void;
  onOpenBuildOutput: () => void;
  onOpenProject: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onToggleRightPanel: () => void;
}

export function StatusBar({
  isConnected,
  health,
  error,
  activeProjectName,
  activeFileTab,
  cursorPosition,
  editorSettings,
  dirtyCount,
  sdkStatus,
  latestBuild,
  sidebarOpen,
  bottomPanelOpen,
  rightPanelOpen,
  onInspectBackend,
  onOpenSdkDoctor,
  onOpenBuildOutput,
  onOpenProject,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleRightPanel,
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

  return (
    <footer className="vega-chrome-glass relative z-20 flex h-7 shrink-0 items-center justify-between border-t border-white/[0.08] px-2.5 text-[11px] text-[#e8ebf7]/60 select-none">
      {/* Left: Backend + Future Board/SDK/Git Slots */}
      <div className="flex min-w-0 items-center gap-3">
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
            className={`inline-flex h-5 items-center gap-1.5 rounded border px-2 font-mono text-[10.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              isConnected
                ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/20"
                : "border-red-400/30 bg-red-500/12 text-red-300 hover:bg-red-500/20"
            }`}
          >
            <Circle
              className={`h-1.5 w-1.5 ${
                isConnected
                  ? "fill-emerald-400 text-emerald-400"
                  : "fill-red-400 text-red-400"
              }`}
            />
            {isConnected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            <span>
              {isConnected ? "Backend: Connected" : "Backend: Disconnected"}
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
            className="hidden items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-[#e8ebf7]/70 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] sm:inline-flex"
          >
            <FolderOpen className="h-3 w-3 text-[#7aa2ff]" />
            <span className="max-w-[140px] truncate">
              {activeProjectName ?? "No Project"}
            </span>
          </button>
        </Tooltip>

        <span className="hidden items-center gap-1 font-mono text-[11px] text-[#e8ebf7]/45 md:inline-flex">
          <Cpu className="h-3 w-3 text-[#7aa2ff]/75" />
          <span>ARIES V3</span>
        </span>

        <Tooltip
          label="Open VEGA SDK Doctor & environment diagnostics"
          side="top"
        >
          <button
            type="button"
            onClick={onOpenSdkDoctor}
            className={`hidden items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-white/[0.07] md:inline-flex ${
              sdkStatus === "pass"
                ? "text-emerald-300"
                : sdkStatus === "warning"
                ? "text-amber-300"
                : sdkStatus === "fail"
                ? "text-red-300"
                : "text-[#e8ebf7]/50 hover:text-[#e8ebf7]"
            }`}
          >
            <Stethoscope className="h-3 w-3" />
            <span>
              {sdkStatus === "pass"
                ? "SDK: Ready"
                : sdkStatus === "warning"
                ? "SDK: Warnings"
                : sdkStatus === "fail"
                ? "SDK: Issues"
                : "SDK: Unchecked"}
            </span>
          </button>
        </Tooltip>

        <span className="hidden items-center gap-1 font-mono text-[11px] text-[#e8ebf7]/40 lg:inline-flex">
          <GitBranch className="h-3 w-3" />
          <span>No Repo</span>
        </span>

        {latestBuild && (
          <Tooltip
            label={`Latest build: ${latestBuild.operation} (${latestBuild.status}) — click for Build Output`}
            side="top"
          >
            <button
              type="button"
              onClick={onOpenBuildOutput}
              className={`hidden items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-white/[0.07] sm:inline-flex ${
                latestBuild.status === "running"
                  ? "text-[#7aa2ff]"
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
                  ? "Build: Passed"
                  : latestBuild.status === "cancelled"
                  ? "Build: Cancelled"
                  : latestBuild.status === "timed_out"
                  ? "Build: Timeout"
                  : "Build: Failed"}
              </span>
            </button>
          </Tooltip>
        )}

        {dirtyCount > 0 && (
          <span className="hidden items-center gap-1.5 rounded border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-200 md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
            <span>
              {dirtyCount} unsaved {dirtyCount === 1 ? "file" : "files"}
            </span>
          </span>
        )}
      </div>

      {/* Right: Active Editor Telemetry, Panel Quick Toggles & Environment Info */}
      <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-[#e8ebf7]/45">
        {activeFileTab && !activeFileTab.loading && !activeFileTab.error && (
          <div className="hidden items-center gap-2.5 text-[#e8ebf7]/65 md:flex">
            <span>
              Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
              {cursorPosition.selectionLength > 0
                ? ` (${cursorPosition.selectionLength} sel)`
                : ""}
            </span>
            <span className="text-white/15">·</span>
            <span>
              {activeFileTab.monacoLanguage === "makefile"
                ? "Tabs: 4"
                : `${editorSettings.insertSpaces ? "Spaces" : "Tabs"}: ${editorSettings.tabSize}`}
            </span>
            <span className="hidden text-white/15 lg:inline">·</span>
            <span className="hidden lg:inline">{activeFileTab.lineEnding}</span>
            <span className="hidden text-white/15 lg:inline">·</span>
            <span className="hidden text-[#7aa2ff]/85 lg:inline">
              {activeFileTab.language}
            </span>
          </div>
        )}

        <div className="hidden items-center gap-0.5 sm:flex">
          <Tooltip label="Toggle Sidebar" side="top">
            <button
              type="button"
              aria-label="Toggle Sidebar from status bar"
              onClick={onToggleSidebar}
              className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10 ${
                sidebarOpen ? "text-[#e8ebf7]/80" : "text-[#e8ebf7]/35"
              }`}
            >
              <PanelLeft className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip label="Toggle Secondary Panel" side="top">
            <button
              type="button"
              aria-label="Toggle Secondary Panel from status bar"
              onClick={onToggleBottomPanel}
              className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10 ${
                bottomPanelOpen ? "text-[#e8ebf7]/80" : "text-[#e8ebf7]/35"
              }`}
            >
              <PanelBottom className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip label="Toggle Assistant Panel" side="top">
            <button
              type="button"
              aria-label="Toggle Assistant Panel from status bar"
              onClick={onToggleRightPanel}
              className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10 ${
                rightPanelOpen ? "text-[#e8ebf7]/80" : "text-[#e8ebf7]/35"
              }`}
            >
              <PanelRight className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>

        <span className="hidden md:inline">UTF-8</span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#e8ebf7]/50 uppercase">
          {platform}
        </span>
      </div>
    </footer>
  );
}
