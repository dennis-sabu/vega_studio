"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Layers,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Server,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { FileIcon } from "@/components/explorer/FileIcon";
import { fetchStatus, type HealthResponse, type StatusResponse } from "@/lib/api";
import type { OpenFileTab } from "@/types/explorer";
import type { WorkspaceSummary } from "@/types/project";
import type { CenterTabId, ShellLayoutState } from "@/types/shell";

interface WorkspaceEditorAreaProps {
  openTabs: CenterTabId[];
  activeTab: CenterTabId | null;
  openFileTabs: OpenFileTab[];
  activeFileTabPath: string | null;
  layout: ShellLayoutState;
  activeProject: WorkspaceSummary | null;
  isConnected: boolean;
  health: HealthResponse | null;
  healthError: string | null;
  lastChecked: Date | null;
  onSelectTab: (tab: CenterTabId) => void;
  onCloseTab: (tab: CenterTabId) => void;
  onOpenTab: (tab: CenterTabId) => void;
  onSelectFileTab: (path: string) => void;
  onCloseFileTab: (path: string) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onCloseProject: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onToggleRightPanel: () => void;
  onOpenHome: () => void;
}

const TAB_META: Record<
  CenterTabId,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  overview: { label: "Shell Overview", icon: Layers },
  diagnostics: { label: "Backend Status", icon: Activity },
};

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });
const FILE_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatModified(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return FILE_DATE_FORMAT.format(parsed);
}

export function WorkspaceEditorArea({
  openTabs,
  activeTab,
  openFileTabs,
  activeFileTabPath,
  layout,
  activeProject,
  isConnected,
  health,
  healthError,
  lastChecked,
  onSelectTab,
  onCloseTab,
  onOpenTab,
  onSelectFileTab,
  onCloseFileTab,
  onNewProject,
  onOpenProject,
  onCloseProject,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleRightPanel,
  onOpenHome,
}: WorkspaceEditorAreaProps) {
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await fetchStatus();
      setStatusData(data);
    } catch (err: unknown) {
      setStatusData(null);
      setStatusError(
        err instanceof Error ? err.message : "Failed to query /api/status"
      );
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "diagnostics" || !isConnected) return;
    const controller = new AbortController();
    fetchStatus(controller.signal)
      .then((data) => {
        setStatusData(data);
        setStatusError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setStatusData(null);
        setStatusError(
          err instanceof Error ? err.message : "Failed to query /api/status"
        );
      });
    return () => controller.abort();
  }, [activeTab, isConnected]);

  const activeFileTab = activeFileTabPath
    ? openFileTabs.find((tab) => tab.path === activeFileTabPath) ?? null
    : null;

  const navTargets: Array<
    | { kind: "shell"; id: CenterTabId }
    | { kind: "file"; path: string }
  > = [
    ...openTabs.map((id) => ({ kind: "shell" as const, id })),
    ...openFileTabs.map((file) => ({ kind: "file" as const, path: file.path })),
  ];

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    navIndex: number
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (navTargets.length <= 1) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (navIndex + delta + navTargets.length) % navTargets.length;
    const target = navTargets[nextIdx];
    if (!target) return;
    if (target.kind === "shell") {
      onSelectTab(target.id);
    } else {
      onSelectFileTab(target.path);
    }
  };

  return (
    <div className="vega-view-enter flex min-h-0 min-w-0 flex-1 flex-col bg-[#06070c]/58 backdrop-blur-[2px]">
      {/* Central Workspace Tab Strip */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#070910]/80 px-2 select-none">
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className="vega-scroll flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {openTabs.map((tabId, idx) => {
            const { label, icon: Icon } = TAB_META[tabId];
            const isSelected = activeFileTab === null && activeTab === tabId;

            return (
              <div
                key={tabId}
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectTab(tabId)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`group inline-flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  isSelected
                    ? "border-white/12 bg-[#0e101a] text-[#e8ebf7]"
                    : "border-transparent bg-transparent text-[#e8ebf7]/50 hover:bg-white/[0.04] hover:text-[#e8ebf7]/80"
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tabId);
                  }}
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-[#e8ebf7]/40 opacity-70 transition-colors hover:bg-white/10 hover:text-[#e8ebf7] group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {openFileTabs.map((fileTab, fileIdx) => {
            const isSelected = activeFileTab?.path === fileTab.path;
            const navIndex = openTabs.length + fileIdx;

            return (
              <div
                key={`file:${fileTab.path}`}
                role="tab"
                title={fileTab.path}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectFileTab(fileTab.path)}
                onKeyDown={(e) => handleTabKeyDown(e, navIndex)}
                className={`group inline-flex h-7 max-w-[190px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  isSelected
                    ? "border-[#7aa2ff]/30 bg-[#0e1222] text-[#e8ebf7]"
                    : "border-transparent bg-transparent text-[#e8ebf7]/60 hover:bg-white/[0.04] hover:text-[#e8ebf7]/85"
                }`}
              >
                <FileIcon
                  name={fileTab.name}
                  kind="file"
                  extension={fileTab.extension}
                />
                <span className="truncate font-mono text-[11px]">
                  {fileTab.name}
                </span>
                <button
                  type="button"
                  aria-label={`Close ${fileTab.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFileTab(fileTab.path);
                  }}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#e8ebf7]/40 opacity-70 transition-colors hover:bg-white/10 hover:text-[#e8ebf7] group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1 pl-2">
          {!openTabs.includes("overview") && (
            <button
              type="button"
              onClick={() => onOpenTab("overview")}
              className="rounded px-2 py-1 text-[11px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            >
              + Overview
            </button>
          )}
          {!openTabs.includes("diagnostics") && (
            <button
              type="button"
              onClick={() => onOpenTab("diagnostics")}
              className="rounded px-2 py-1 text-[11px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            >
              + Status
            </button>
          )}
        </div>
      </div>

      {/* Central Workspace Body */}
      <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-5">
        {activeFileTab ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-5">
            {/* Breadcrumb & File Header */}
            <div className="rounded-2xl border border-white/[0.10] bg-[#090b13]/88 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-[#e8ebf7]/50">
                <span className="text-[#7aa2ff]">
                  {activeProject?.project.name ?? "workspace"}
                </span>
                {activeFileTab.path.split("/").map((segment, index, parts) => (
                  <span key={`${segment}-${index}`} className="inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-[#e8ebf7]/30" />
                    <span
                      className={
                        index === parts.length - 1
                          ? "font-semibold text-[#e8ebf7]/90"
                          : "text-[#e8ebf7]/55"
                      }
                    >
                      {segment}
                    </span>
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                    <FileIcon
                      name={activeFileTab.name}
                      kind="file"
                      extension={activeFileTab.extension}
                      className="h-4.5 w-4.5"
                    />
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate font-mono text-base font-medium text-[#e8ebf7]">
                      {activeFileTab.name}
                    </h1>
                    <p className="truncate font-mono text-[11px] text-[#e8ebf7]/45">
                      {activeFileTab.path}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeFileTab.stat && (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#7aa2ff]">
                        <Code2 className="h-3 w-3" />
                        <span>{activeFileTab.stat.language}</span>
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-[#e8ebf7]/65">
                        {activeFileTab.stat.is_binary ? "Binary" : "Text Source"}
                      </span>
                    </>
                  )}
                  <span className="rounded-full border border-[#7aa2ff]/25 bg-[#7aa2ff]/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-[#7aa2ff]">
                    Phase 5 Boundary
                  </span>
                </div>
              </div>
            </div>

            {activeFileTab.loading ? (
              <div className="vega-glass flex min-h-[200px] items-center justify-center gap-2.5 rounded-2xl bg-[#080a12]/65 p-8 text-xs text-[#e8ebf7]/65">
                <Loader2 className="h-4 w-4 animate-spin text-[#7aa2ff]" />
                <span>Inspecting project-confined file metadata...</span>
              </div>
            ) : activeFileTab.error ? (
              <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-5 text-xs text-red-200">
                <p className="font-medium">Unable to inspect file metadata</p>
                <p className="mt-1 font-mono text-[11px] opacity-85">
                  {activeFileTab.error}
                </p>
              </div>
            ) : (
              activeFileTab.stat && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                        <HardDrive className="h-3.5 w-3.5 text-[#7aa2ff]" />
                        <span>File Size</span>
                      </div>
                      <p className="mt-2 font-mono text-sm font-medium text-[#e8ebf7]">
                        {formatBytes(activeFileTab.stat.size)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[#e8ebf7]/45">
                        {activeFileTab.stat.size.toLocaleString()} bytes
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                        <Code2 className="h-3.5 w-3.5 text-[#7aa2ff]" />
                        <span>Detected Language</span>
                      </div>
                      <p className="mt-2 font-mono text-sm font-medium text-[#e8ebf7]">
                        {activeFileTab.stat.language}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[#e8ebf7]/45">
                        {activeFileTab.stat.extension || "No extension"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                        <Clock className="h-3.5 w-3.5 text-[#7aa2ff]" />
                        <span>Last Modified</span>
                      </div>
                      <p className="mt-2 font-mono text-xs font-medium text-[#e8ebf7]">
                        {formatModified(activeFileTab.stat.modified_at)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[#e8ebf7]/45">
                        {activeFileTab.stat.is_binary ? "Binary format" : "UTF-8 text candidate"}
                      </p>
                    </div>
                  </div>

                  {/* Phase 5 Editor Integration Boundary Slot */}
                  <div className="vega-glass flex min-h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-white/15 bg-[#080a12]/55 p-8 text-center">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[#7aa2ff]/25 bg-[#7aa2ff]/10">
                      <Sparkles className="h-4.5 w-4.5 text-[#7aa2ff]" />
                    </div>
                    <h2 className="text-sm font-medium text-[#e8ebf7]">
                      Monaco Editor Integration Boundary — Phase 5
                    </h2>
                    <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#e8ebf7]/55">
                      Root-confined file path verified via{" "}
                      <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-[#e8ebf7]/80">
                        /api/explorer/stat
                      </code>
                      . Full text loading, Monaco syntax highlighting, dirty-tab tracking, and{" "}
                      <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-[#e8ebf7]/80">
                        Ctrl+S
                      </code>{" "}
                      atomic saving mount cleanly into this editor slot in Phase 5.
                    </p>
                  </div>
                </>
              )
            )}
          </div>
        ) : activeTab === null ? (
          <div className="vega-glass flex h-full min-h-[220px] flex-col items-center justify-center rounded-[20px] bg-[#080a12]/62 p-8 text-center">
            <Cpu className="mb-3 h-7 w-7 text-[#7aa2ff]/70" />
            <h2 className="text-sm font-medium text-[#e8ebf7]">
              No Workspace Tab Open
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[#e8ebf7]/55">
              Select a file from the Explorer sidebar to inspect its metadata, or
              reopen Shell Overview / Home below. Source editing arrives with
              Monaco Editor in Phase 5.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => onOpenTab("overview")}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7] hover:bg-white/10"
              >
                <Layers className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Shell Overview</span>
              </button>
              <button
                type="button"
                onClick={onOpenHome}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-transparent px-3.5 text-xs font-medium text-[#e8ebf7]/70 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
              >
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        ) : activeTab === "overview" ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-5">
            {/* Active Project / Workspace Card */}
            {activeProject ? (
              <div className="rounded-2xl border border-white/[0.10] bg-[#090b13]/88 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#7aa2ff] uppercase">
                        Active Workspace
                      </span>
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                        {activeProject.project.target.board}
                      </span>
                    </div>
                    <h1 className="mt-1 truncate text-lg font-medium tracking-tight text-[#e8ebf7]">
                      {activeProject.project.name}
                    </h1>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[#e8ebf7]/50">
                      {activeProject.project_dir}
                    </p>
                    {activeProject.project.description && (
                      <p className="mt-2 text-xs text-[#e8ebf7]/65">
                        {activeProject.project.description}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenProject}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3 text-xs font-medium text-[#e8ebf7] hover:bg-white/10"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                      <span>Switch</span>
                    </button>
                    <button
                      type="button"
                      onClick={onCloseProject}
                      className="inline-flex h-8 items-center rounded-full border border-white/10 bg-transparent px-3 text-xs font-medium text-[#e8ebf7]/65 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-white/[0.08] pt-3.5 font-mono text-[11px] sm:grid-cols-4">
                  <div>
                    <span className="block text-[10px] text-[#e8ebf7]/40 uppercase">
                      Architecture
                    </span>
                    <span className="text-[#e8ebf7]/85">
                      {activeProject.project.target.arch}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-[#e8ebf7]/40 uppercase">
                      Machine
                    </span>
                    <span className="text-[#e8ebf7]/85">
                      {activeProject.project.target.machine}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-[#e8ebf7]/40 uppercase">
                      Schema
                    </span>
                    <span className="text-[#e8ebf7]/85">
                      vega-project v{activeProject.project.schemaVersion}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-[#e8ebf7]/40 uppercase">
                      Structure
                    </span>
                    <span
                      className={
                        activeProject.structure_valid
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      {activeProject.structure_valid ? "Valid" : "Incomplete"}
                    </span>
                  </div>
                </div>

                {activeProject.warnings.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-0.5">
                      {activeProject.warnings.map((w) => (
                        <p key={w}>{w}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/[0.09] bg-[#090b13]/84 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:flex-row sm:items-center">
                <div>
                  <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#7aa2ff] uppercase">
                    Phase 3 · Workspace &amp; Project Management
                  </p>
                  <h1 className="mt-1 text-lg font-medium tracking-tight text-[#e8ebf7]">
                    No Active VEGA Project
                  </h1>
                  <p className="mt-1 text-xs text-[#e8ebf7]/60">
                    Create a portable VEGA ARIES V3 project or open an existing
                    project directory containing vega-project.json.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={onNewProject}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#e8ebf7] px-3.5 text-xs font-semibold text-[#06070c] transition-colors hover:bg-white"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>New Project</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenProject}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7] transition-colors hover:bg-white/10"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                    <span>Open Project</span>
                  </button>
                </div>
              </div>
            )}

            {/* Interactive Shell Region Inspector Cards */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Left Sidebar
                  </span>
                  <button
                    type="button"
                    onClick={onToggleSidebar}
                    className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[11px] text-[#e8ebf7]/75 hover:bg-white/10"
                  >
                    <PanelLeft className="h-3 w-3" />
                    <span>{layout.sidebarOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>
                <p className="mt-2 font-mono text-sm font-semibold text-[#e8ebf7]">
                  {layout.sidebarOpen
                    ? `${layout.sidebarWidth}px · ${layout.activeNav}`
                    : "Collapsed"}
                </p>
                <p className="mt-1 text-[11px] text-[#e8ebf7]/50">
                  Resizable explorer, Git, SDK examples, and board tools region.
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Secondary Panel
                  </span>
                  <button
                    type="button"
                    onClick={onToggleBottomPanel}
                    className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[11px] text-[#e8ebf7]/75 hover:bg-white/10"
                  >
                    <PanelBottom className="h-3 w-3" />
                    <span>{layout.bottomPanelOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>
                <p className="mt-2 font-mono text-sm font-semibold text-[#e8ebf7]">
                  {layout.bottomPanelOpen
                    ? `${layout.bottomPanelHeight}px · ${layout.activeBottomTab}`
                    : "Collapsed"}
                </p>
                <p className="mt-1 text-[11px] text-[#e8ebf7]/50">
                  Hosts Build Output, Terminal, Serial Monitor, Diagnostics, and
                  Logs.
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Assistant Panel
                  </span>
                  <button
                    type="button"
                    onClick={onToggleRightPanel}
                    className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[11px] text-[#e8ebf7]/75 hover:bg-white/10"
                  >
                    <PanelRight className="h-3 w-3" />
                    <span>{layout.rightPanelOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>
                <p className="mt-2 font-mono text-sm font-semibold text-[#e8ebf7]">
                  {layout.rightPanelOpen
                    ? `${layout.rightPanelWidth}px · ${layout.activeRightTab}`
                    : "Hidden"}
                </p>
                <p className="mt-1 text-[11px] text-[#e8ebf7]/50">
                  Hideable dock reserved for Native AI and OpenCode CLI
                  sessions.
                </p>
              </div>
            </div>

            {/* Editor Slot Placeholder */}
            <div className="rounded-xl border border-dashed border-white/[0.10] bg-[#070910]/72 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                  Central Editor Region (Phase 3 Slot)
                </span>
                <span className="font-mono text-[11px] text-[#e8ebf7]/40">
                  Monaco Editor · C / C++ / ASM / Makefile
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#e8ebf7]/55">
                Resize the sidebar, bottom panel, or right panel dividers using
                pointer drag or keyboard arrows (`Home`/`End` for bounds,
                double-click a divider to reset). Layout preferences persist
                automatically in local storage.
              </p>
            </div>
          </div>
        ) : (
          /* Live Backend Health & Status Tab */
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.09] bg-[#090b13]/84 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                    isConnected
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                      : "border-red-400/25 bg-red-500/10 text-red-300"
                  }`}
                >
                  {isConnected ? (
                    <Wifi className="h-5 w-5" />
                  ) : (
                    <WifiOff className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-medium text-[#e8ebf7]">
                    {isConnected
                      ? "FastAPI Backend Connected"
                      : "FastAPI Backend Unavailable"}
                  </h2>
                  <p className="font-mono text-[11px] text-[#e8ebf7]/50">
                    {isConnected && health
                      ? `${health.service} v${health.version} · Checked ${lastChecked ? TIME_FORMAT.format(lastChecked) : "just now"}`
                      : healthError ??
                        "Waiting for local backend on http://127.0.0.1:8765"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={statusLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7] transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${statusLoading ? "animate-spin" : ""}`}
                />
                <span>Refresh Status</span>
              </button>
            </div>

            {isConnected && statusData ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Server className="h-4 w-4 text-[#7aa2ff]" />
                    <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/50 uppercase">
                      Backend Service
                    </span>
                  </div>
                  <dl className="space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">Service</dt>
                      <dd className="text-[#e8ebf7]">
                        {String(statusData.backend.service ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">Environment</dt>
                      <dd className="text-[#e8ebf7]">
                        {String(statusData.backend.env ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">Bind</dt>
                      <dd className="text-[#e8ebf7]">
                        {String(statusData.backend.host ?? "127.0.0.1")}:
                        {String(statusData.backend.port ?? 8765)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-white/[0.09] bg-[#090b13]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-[#7aa2ff]" />
                    <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/50 uppercase">
                      Runtime Platform
                    </span>
                  </div>
                  <dl className="space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">OS</dt>
                      <dd className="text-[#e8ebf7]">
                        {String(statusData.platform.os ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">Arch</dt>
                      <dd className="text-[#e8ebf7]">
                        {String(statusData.platform.architecture ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#e8ebf7]/45">Python</dt>
                      <dd className="truncate text-[#e8ebf7]">
                        {String(statusData.platform.python_version ?? "—").split(
                          " "
                        )[0]}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 bg-[#0b0d14] p-4 text-xs text-[#e8ebf7]/55">
                {statusError
                  ? `Backend status query failed: ${statusError}`
                  : "Start the FastAPI backend (or launch via Electron) to inspect detailed runtime diagnostics."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
