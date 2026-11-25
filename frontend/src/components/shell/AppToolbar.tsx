"use client";

import { useEffect, useState } from "react";
import {
  Cpu,
  FolderOpen,
  FolderPlus,
  Hammer,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plug,
  RotateCcw,
  RotateCw,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  Usb,
  X,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  SegmentedPill,
  type SegmentedPillOption,
} from "@/components/shell/SegmentedPill";
import type { BuildOperation } from "@/types/build";
import type { WorkspaceMode } from "@/types/shell";

interface AppToolbarProps {
  activeMode: WorkspaceMode;
  activeProjectName: string | null;
  isBuilding: boolean;
  isUploading: boolean;
  isSerialConnected: boolean;
  serialPort: string | null;
  selectedPort: string;
  isBackendConnected: boolean;
  sidebarOpen: boolean;
  bottomPanelOpen: boolean;
  rightPanelOpen: boolean;
  settingsOpen: boolean;
  isCustomized: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onCloseProject: () => void;
  onBuildAction: (op: BuildOperation) => void;
  onCancelBuild: () => void;
  onUploadAction: () => void;
  onCancelUpload: () => void;
  onOpenUploadPanel: () => void;
  onOpenSerialMonitor: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleSettings: () => void;
  onResetLayout: () => void;
}

const MODE_OPTIONS: SegmentedPillOption<WorkspaceMode>[] = [
  { value: "home", label: "Home", dotColor: "#7aa2ff" },
  { value: "workspace", label: "Workspace", dotColor: "#6ee7b7" },
];

export function AppToolbar({
  activeMode,
  activeProjectName,
  isBuilding,
  isUploading,
  isSerialConnected,
  serialPort,
  selectedPort,
  isBackendConnected,
  sidebarOpen,
  bottomPanelOpen,
  rightPanelOpen,
  settingsOpen,
  isCustomized,
  onModeChange,
  onNewProject,
  onOpenProject,
  onCloseProject,
  onBuildAction,
  onCancelBuild,
  onUploadAction,
  onCancelUpload,
  onOpenUploadPanel,
  onOpenSerialMonitor,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleRightPanel,
  onToggleSettings,
  onResetLayout,
}: AppToolbarProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const handleResetClick = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    onResetLayout();
  };

  return (
    <header className="vega-chrome-glass relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.08] px-3 select-none">
      {/* Left: Identity + Future Build/Board Action Cluster */}
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex items-center gap-2">
          <div className="vega-marble flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-[#e8ebf7] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
            <Cpu className="relative z-10 h-3.5 w-3.5 drop-shadow" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-[#e8ebf7]">
              VEGA Studio
            </span>
            {activeProjectName ? (
              <span className="hidden items-center gap-1 rounded-full border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#e8ebf7] sm:inline-flex">
                <span className="max-w-[130px] truncate">
                  {activeProjectName}
                </span>
                <button
                  type="button"
                  aria-label="Close active project"
                  title="Close active project"
                  onClick={onCloseProject}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[#e8ebf7]/60 hover:bg-white/15 hover:text-[#e8ebf7]"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ) : (
              <span className="hidden rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 sm:inline-block">
                ARIES V3
              </span>
            )}
          </div>
        </div>

        <div className="hidden h-4 w-px bg-white/10 md:block" />

        {/* Project Actions (Phase 3) + Scoped Future IDE Actions */}
        <div
          aria-label="Project and toolchain actions"
          className="hidden items-center gap-1 md:flex"
        >
          <Tooltip label="New VEGA Project">
            <button
              type="button"
              onClick={onNewProject}
              aria-label="New VEGA Project"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#e8ebf7]/75 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              <FolderPlus className="h-3.5 w-3.5 text-[#7aa2ff]" />
              <span className="hidden xl:inline">New</span>
            </button>
          </Tooltip>

          <Tooltip label="Open VEGA Project">
            <button
              type="button"
              onClick={onOpenProject}
              aria-label="Open VEGA Project"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#e8ebf7]/75 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
              <span className="hidden xl:inline">Open</span>
            </button>
          </Tooltip>

          <div className="mx-0.5 h-3.5 w-px bg-white/10" />

          <Tooltip
            label={
              !activeProjectName
                ? "Open a project to build firmware"
                : !isBackendConnected
                ? "Backend disconnected"
                : isBuilding
                ? "Build currently running"
                : "Build Project (Make)"
            }
          >
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              aria-label="Build Project"
              onClick={() => onBuildAction("build")}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#e8ebf7]/80 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBuilding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
              ) : (
                <Hammer className="h-3.5 w-3.5 text-[#7aa2ff]" />
              )}
              <span className="hidden xl:inline">
                {isBuilding ? "Building" : "Build"}
              </span>
            </button>
          </Tooltip>

          <Tooltip label="Clean Build (Make clean)">
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              aria-label="Clean Build"
              onClick={() => onBuildAction("clean")}
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-[#e8ebf7]/70 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Tooltip label="Rebuild Project (Clean + Build)">
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              aria-label="Rebuild Project"
              onClick={() => onBuildAction("rebuild")}
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-[#e8ebf7]/70 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          {isBuilding && (
            <Tooltip label="Cancel Active Build">
              <button
                type="button"
                aria-label="Cancel Active Build"
                onClick={onCancelBuild}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-400/35 bg-red-500/18 px-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/28"
              >
                <Square className="h-3 w-3 fill-current" />
                <span className="hidden xl:inline">Cancel</span>
              </button>
            </Tooltip>
          )}

          <Tooltip
            label={
              !activeProjectName
                ? "Open a project to upload firmware"
                : !isBackendConnected
                ? "Backend disconnected"
                : isUploading
                ? "Firmware upload in progress"
                : "Review preflight & upload compiled firmware"
            }
          >
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding || isUploading}
              aria-label="Upload Firmware"
              onClick={onUploadAction}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#e8ebf7]/80 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
              ) : (
                <Upload className="h-3.5 w-3.5 text-[#7aa2ff]" />
              )}
              <span className="hidden xl:inline">
                {isUploading ? "Uploading" : "Upload"}
              </span>
            </button>
          </Tooltip>

          {isUploading && (
            <Tooltip label="Cancel Active Firmware Upload">
              <button
                type="button"
                aria-label="Cancel Active Firmware Upload"
                onClick={onCancelUpload}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-400/35 bg-red-500/18 px-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/28"
              >
                <Square className="h-3 w-3 fill-current" />
                <span className="hidden xl:inline">Stop</span>
              </button>
            </Tooltip>
          )}

          <Tooltip
            label={
              selectedPort
                ? `Selected serial device: ${selectedPort} — click to configure in Upload Output`
                : "Select or inspect serial port in Upload Output"
            }
          >
            <button
              type="button"
              disabled={!isBackendConnected}
              aria-label="Serial Port Selector"
              onClick={onOpenUploadPanel}
              className={`ml-1 hidden h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors lg:inline-flex disabled:cursor-not-allowed disabled:opacity-45 ${
                selectedPort
                  ? "border-[#7aa2ff]/30 bg-[#7aa2ff]/12 text-[#e8ebf7] hover:bg-[#7aa2ff]/20"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
              }`}
            >
              <Usb className="h-3 w-3 text-[#7aa2ff]" />
              <span className="max-w-[110px] truncate">
                {selectedPort || "No port"}
              </span>
            </button>
          </Tooltip>

          <Tooltip
            label={
              isSerialConnected
                ? `Serial Monitor connected (${serialPort ?? "active"}) — click to open`
                : "Open UART Serial Monitor"
            }
          >
            <button
              type="button"
              disabled={!isBackendConnected}
              aria-label="Open Serial Monitor"
              onClick={onOpenSerialMonitor}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isSerialConnected
                  ? "border-emerald-400/35 bg-emerald-500/14 text-emerald-200 hover:bg-emerald-500/22"
                  : "border-transparent text-[#e8ebf7]/75 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
              }`}
            >
              <Plug
                className={`h-3.5 w-3.5 ${
                  isSerialConnected ? "text-emerald-300" : "text-[#7aa2ff]"
                }`}
              />
              <span className="hidden xl:inline">Serial</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Center: Floating Glass Mode Switcher */}
      <div className="flex items-center justify-center">
        <SegmentedPill
          ariaLabel="Shell View Mode"
          options={MODE_OPTIONS}
          value={activeMode}
          onChange={onModeChange}
        />
      </div>

      {/* Right: Working Shell Panel Controls + Scoped Future Controls */}
      <div className="flex items-center gap-1.5">
        <div
          role="group"
          aria-label="Workspace layout controls"
          className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/[0.03] p-0.5"
        >
          <Tooltip label="Toggle Sidebar" shortcut="Ctrl+\">
            <button
              type="button"
              aria-label="Toggle Sidebar"
              aria-pressed={sidebarOpen}
              onClick={onToggleSidebar}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                sidebarOpen && activeMode === "workspace"
                  ? "bg-white/12 text-[#e8ebf7]"
                  : "text-[#e8ebf7]/45 hover:bg-white/[0.06] hover:text-[#e8ebf7]/80"
              }`}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Tooltip label="Toggle Secondary Panel" shortcut="Ctrl+J">
            <button
              type="button"
              aria-label="Toggle Secondary Panel"
              aria-pressed={bottomPanelOpen}
              onClick={onToggleBottomPanel}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                bottomPanelOpen && activeMode === "workspace"
                  ? "bg-white/12 text-[#e8ebf7]"
                  : "text-[#e8ebf7]/45 hover:bg-white/[0.06] hover:text-[#e8ebf7]/80"
              }`}
            >
              <PanelBottom className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Tooltip label="Toggle Assistant Panel" shortcut="Ctrl+Shift+A">
            <button
              type="button"
              aria-label="Toggle Assistant Panel"
              aria-pressed={rightPanelOpen}
              onClick={onToggleRightPanel}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                rightPanelOpen && activeMode === "workspace"
                  ? "bg-white/12 text-[#e8ebf7]"
                  : "text-[#e8ebf7]/45 hover:bg-white/[0.06] hover:text-[#e8ebf7]/80"
              }`}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        {(isCustomized || confirmReset) && (
          <Tooltip
            label={
              confirmReset
                ? "Click again to restore default layout"
                : "Reset panel layout"
            }
          >
            <button
              type="button"
              onClick={handleResetClick}
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                confirmReset
                  ? "border-red-400/40 bg-red-500/15 text-red-300"
                  : "border-white/10 bg-white/[0.04] text-[#e8ebf7]/70 hover:bg-white/10 hover:text-[#e8ebf7]"
              }`}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{confirmReset ? "Reset?" : "Reset"}</span>
            </button>
          </Tooltip>
        )}

        <div className="hidden h-4 w-px bg-white/10 sm:block" />

        <Tooltip label="OpenCode CLI (Phase 11)">
          <button
            type="button"
            disabled
            aria-label="OpenCode CLI (Phase 11)"
            className="hidden h-7 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 text-xs font-medium text-[#e8ebf7]/40 opacity-50 sm:inline-flex disabled:cursor-not-allowed"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">OpenCode</span>
          </button>
        </Tooltip>

        <Tooltip label="Native AI Assistant (Phase 12)" side="bottom">
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label="Open AI Assistant Shell"
            aria-pressed={rightPanelOpen && activeMode === "workspace"}
            className={`hidden h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              rightPanelOpen && activeMode === "workspace"
                ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#e8ebf7]"
                : "border-white/10 bg-white/[0.04] text-[#e8ebf7]/65 hover:bg-white/10 hover:text-[#e8ebf7]"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-[#7aa2ff]" />
            <span className="hidden lg:inline">AI</span>
          </button>
        </Tooltip>

        <Tooltip label="Appearance & Shell Settings" side="bottom">
          <button
            type="button"
            onClick={onToggleSettings}
            aria-label="Appearance & Shell Settings"
            aria-pressed={settingsOpen}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              settingsOpen
                ? "bg-white/14 text-[#e8ebf7]"
                : "text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7]"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
