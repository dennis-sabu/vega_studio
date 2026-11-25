"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Cpu,
  FileDiff,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Replace,
  RotateCcw,
  Save,
  Search,
  Server,
  SlidersHorizontal,
  Stethoscope,
  Wifi,
  WifiOff,
  WrapText,
  X,
} from "lucide-react";
import {
  MonacoEditorSurface,
  type MonacoEditorHandle,
} from "@/components/editor/MonacoEditorSurface";
import { BoardManagerView } from "@/components/board/BoardManagerView";
import { FileIcon } from "@/components/explorer/FileIcon";
import { GitDiffView } from "@/components/git/GitDiffView";
import { SdkDoctorView } from "@/components/sdk/SdkDoctorView";
import { Tooltip } from "@/components/ui/Tooltip";
import { fetchStatus, type HealthResponse, type StatusResponse } from "@/lib/api";
import type {
  EditorCursorPosition,
  EditorRevealTarget,
  EditorSettings,
} from "@/types/editor";
import type { OpenFileTab } from "@/types/explorer";
import type { WorkspaceSummary } from "@/types/project";
import type { CenterTabId, ShellLayoutState } from "@/types/shell";

interface WorkspaceEditorAreaProps {
  openTabs: CenterTabId[];
  activeTab: CenterTabId | null;
  openFileTabs: OpenFileTab[];
  activeFileTabPath: string | null;
  editorSettings: EditorSettings;
  dirtyCount: number;
  pendingReveal?: EditorRevealTarget | null;
  sdkDoctorProps: ComponentProps<typeof SdkDoctorView>;
  boardManagerProps: ComponentProps<typeof BoardManagerView>;
  gitDiffProps: ComponentProps<typeof GitDiffView>;
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
  onCloseOtherFileTabs: (keepPath: string) => void;
  onCloseAllFileTabs: () => void;
  onSaveFileTab: (uidOrPath: string, overwriteConflict?: boolean) => void;
  onSaveAllFileTabs: () => void;
  onReloadFileTab: (uid: string) => void;
  onDirtyChange: (uid: string, isDirty: boolean) => void;
  onCursorChange: (pos: EditorCursorPosition) => void;
  onConsumeReveal?: (nonce: number) => void;
  onUpdateEditorSettings: (partial: Partial<EditorSettings>) => void;
  onOpenSettings: () => void;
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
  "sdk-doctor": { label: "SDK Doctor", icon: Stethoscope },
  "board-manager": { label: "Board Manager", icon: Cpu },
  "git-diff": { label: "Git Diff", icon: FileDiff },
};

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

interface TabContextMenuState {
  x: number;
  y: number;
  tab: OpenFileTab;
}

export function WorkspaceEditorArea({
  openTabs,
  activeTab,
  openFileTabs,
  activeFileTabPath,
  editorSettings,
  dirtyCount,
  pendingReveal,
  sdkDoctorProps,
  boardManagerProps,
  gitDiffProps,
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
  onCloseOtherFileTabs,
  onCloseAllFileTabs,
  onSaveFileTab,
  onSaveAllFileTabs,
  onReloadFileTab,
  onDirtyChange,
  onCursorChange,
  onConsumeReveal,
  onUpdateEditorSettings,
  onOpenSettings,
  onNewProject,
  onOpenProject,
  onCloseProject,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleRightPanel,
  onOpenHome,
}: WorkspaceEditorAreaProps) {
  const monacoHandleRef = useRef<MonacoEditorHandle | null>(null);
  const [tabMenu, setTabMenu] = useState<TabContextMenuState | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!tabMenu) return;
    const closeMenu = () => setTabMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setTabMenu(null);
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

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
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#070910]/85 px-2 select-none">
        <div
          role="tablist"
          aria-label="Workspace and editor tabs"
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

          {openTabs.length > 0 && openFileTabs.length > 0 && (
            <div
              aria-hidden="true"
              className="mx-1 h-4 w-px shrink-0 bg-white/10"
            />
          )}

          {openFileTabs.map((fileTab, fileIdx) => {
            const isSelected = activeFileTab?.path === fileTab.path;
            const navIndex = openTabs.length + fileIdx;

            return (
              <div
                key={`file:${fileTab.uid}`}
                role="tab"
                title={
                  fileTab.isDirty
                    ? `${fileTab.path} (Unsaved changes)`
                    : fileTab.path
                }
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectFileTab(fileTab.path)}
                onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectFileTab(fileTab.path);
                  setTabMenu({
                    x: e.clientX,
                    y: e.clientY,
                    tab: fileTab,
                  });
                }}
                onKeyDown={(e) => handleTabKeyDown(e, navIndex)}
                className={`group inline-flex h-7 max-w-[210px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  isSelected
                    ? "border-[#7aa2ff]/35 bg-[#0e1222] text-[#e8ebf7]"
                    : "border-transparent bg-transparent text-[#e8ebf7]/60 hover:bg-white/[0.04] hover:text-[#e8ebf7]/90"
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

                {fileTab.isSaving ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#7aa2ff]" />
                ) : fileTab.isDirty ? (
                  <span
                    aria-label="Unsaved changes"
                    className="h-2 w-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.45)]"
                  />
                ) : null}

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
          {dirtyCount > 0 && (
            <Tooltip label="Save all modified files">
              <button
                type="button"
                onClick={onSaveAllFileTabs}
                className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 px-2 font-mono text-[10.5px] font-medium text-[#e8ebf7] transition-colors hover:bg-[#7aa2ff]/22"
              >
                <Save className="h-3 w-3 text-[#7aa2ff]" />
                <span>Save All ({dirtyCount})</span>
              </button>
            </Tooltip>
          )}
          {openFileTabs.length > 1 && (
            <button
              type="button"
              onClick={onCloseAllFileTabs}
              title="Close all editor tabs"
              className="hidden rounded px-2 py-1 text-[11px] text-[#e8ebf7]/50 hover:bg-white/[0.06] hover:text-[#e8ebf7] lg:inline-block"
            >
              Close All
            </button>
          )}
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
          {!openTabs.includes("sdk-doctor") && (
            <button
              type="button"
              onClick={() => onOpenTab("sdk-doctor")}
              className="rounded px-2 py-1 text-[11px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            >
              + SDK Doctor
            </button>
          )}
          {!openTabs.includes("board-manager") && (
            <button
              type="button"
              onClick={() => onOpenTab("board-manager")}
              className="rounded px-2 py-1 text-[11px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            >
              + Board Manager
            </button>
          )}
          {!openTabs.includes("git-diff") && (
            <button
              type="button"
              onClick={() => onOpenTab("git-diff")}
              className="rounded px-2 py-1 text-[11px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            >
              + Git Diff
            </button>
          )}
        </div>
      </div>

      {/* Central Workspace Body */}
      {activeFileTab ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#06070c]">
          {/* Editor Header & Action Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#070910]/90 px-3 py-1.5 select-none">
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-[#e8ebf7]/55">
              <span className="truncate text-[#7aa2ff]">
                {activeProject?.project.name ?? "workspace"}
              </span>
              {activeFileTab.path.split("/").map((segment, index, parts) => (
                <span
                  key={`${segment}-${index}`}
                  className="inline-flex min-w-0 items-center gap-1"
                >
                  <ChevronRight className="h-3 w-3 shrink-0 text-[#e8ebf7]/30" />
                  <span
                    className={`truncate ${
                      index === parts.length - 1
                        ? "font-semibold text-[#e8ebf7]"
                        : "text-[#e8ebf7]/60"
                    }`}
                  >
                    {segment}
                  </span>
                </span>
              ))}
              {activeFileTab.isDirty && (
                <span className="ml-1 rounded-full border border-amber-400/30 bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                  Unsaved
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Tooltip label="Find in file" shortcut="Ctrl+F" side="bottom">
                <button
                  type="button"
                  disabled={activeFileTab.loading || Boolean(activeFileTab.error)}
                  aria-label="Find in file"
                  onClick={() => monacoHandleRef.current?.triggerFind()}
                  className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/65 hover:bg-white/[0.07] hover:text-[#e8ebf7] disabled:opacity-35"
                >
                  <Search className="h-3 w-3" />
                  <span className="hidden xl:inline">Find</span>
                </button>
              </Tooltip>

              <Tooltip label="Find & Replace" shortcut="Ctrl+H" side="bottom">
                <button
                  type="button"
                  disabled={activeFileTab.loading || Boolean(activeFileTab.error)}
                  aria-label="Find and replace in file"
                  onClick={() => monacoHandleRef.current?.triggerReplace()}
                  className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/65 hover:bg-white/[0.07] hover:text-[#e8ebf7] disabled:opacity-35"
                >
                  <Replace className="h-3 w-3" />
                  <span className="hidden xl:inline">Replace</span>
                </button>
              </Tooltip>

              <div className="mx-0.5 h-3.5 w-px bg-white/10" />

              <Tooltip label="Cycle Tab Size (2 / 4 / 8)" side="bottom">
                <button
                  type="button"
                  disabled={activeFileTab.monacoLanguage === "makefile"}
                  onClick={() => {
                    const nextSize =
                      editorSettings.tabSize === 2
                        ? 4
                        : editorSettings.tabSize === 4
                        ? 8
                        : 2;
                    onUpdateEditorSettings({ tabSize: nextSize });
                  }}
                  className="hidden h-6 items-center rounded px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7] disabled:opacity-45 sm:inline-flex"
                >
                  {activeFileTab.monacoLanguage === "makefile"
                    ? "Tabs: 4"
                    : `Tab: ${editorSettings.tabSize}`}
                </button>
              </Tooltip>

              <Tooltip label="Toggle Word Wrap" side="bottom">
                <button
                  type="button"
                  aria-label="Toggle Word Wrap"
                  onClick={() =>
                    onUpdateEditorSettings({
                      wordWrap: editorSettings.wordWrap === "on" ? "off" : "on",
                    })
                  }
                  className={`inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10.5px] transition-colors ${
                    editorSettings.wordWrap === "on"
                      ? "bg-[#7aa2ff]/18 text-[#e8ebf7]"
                      : "text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7]"
                  }`}
                >
                  <WrapText className="h-3 w-3" />
                  <span className="hidden lg:inline">Wrap</span>
                </button>
              </Tooltip>

              <Tooltip label="Toggle Minimap" side="bottom">
                <button
                  type="button"
                  aria-label="Toggle Minimap"
                  onClick={() =>
                    onUpdateEditorSettings({
                      minimap: !editorSettings.minimap,
                    })
                  }
                  className={`hidden h-6 items-center rounded px-1.5 font-mono text-[10.5px] transition-colors md:inline-flex ${
                    editorSettings.minimap
                      ? "bg-[#7aa2ff]/18 text-[#e8ebf7]"
                      : "text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7]"
                  }`}
                >
                  Minimap
                </button>
              </Tooltip>

              <Tooltip label="Editor Settings" side="bottom">
                <button
                  type="button"
                  aria-label="Open Editor Settings"
                  onClick={onOpenSettings}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/55 hover:bg-white/[0.07] hover:text-[#e8ebf7]"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
              </Tooltip>

              <div className="mx-0.5 h-3.5 w-px bg-white/10" />

              <Tooltip label="Save File" shortcut="Ctrl+S" side="bottom">
                <button
                  type="button"
                  disabled={
                    activeFileTab.loading ||
                    Boolean(activeFileTab.error) ||
                    activeFileTab.isSaving ||
                    !activeFileTab.isDirty
                  }
                  onClick={() => void onSaveFileTab(activeFileTab.uid)}
                  className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] font-medium transition-colors ${
                    activeFileTab.isDirty
                      ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7] hover:bg-[#7aa2ff]/30"
                      : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45 disabled:cursor-default"
                  }`}
                >
                  {activeFileTab.isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
                  ) : activeFileTab.isDirty ? (
                    <Save className="h-3 w-3 text-[#7aa2ff]" />
                  ) : (
                    <Check className="h-3 w-3 text-emerald-400/80" />
                  )}
                  <span>
                    {activeFileTab.isSaving
                      ? "Saving..."
                      : activeFileTab.isDirty
                      ? "Save"
                      : "Saved"}
                  </span>
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Conflict / Save Error Alerts */}
          {activeFileTab.conflictError && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/25 bg-amber-500/12 px-3 py-2 text-xs text-amber-200">
              <div className="flex min-w-0 items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="truncate">{activeFileTab.conflictError}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onReloadFileTab(activeFileTab.uid)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-white/15 bg-white/[0.08] px-2.5 text-[11px] font-medium text-[#e8ebf7] hover:bg-white/15"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reload Disk</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSaveFileTab(activeFileTab.uid, true)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-amber-400/40 bg-amber-500/25 px-2.5 text-[11px] font-medium text-amber-100 hover:bg-amber-500/35"
                >
                  <Save className="h-3 w-3" />
                  <span>Overwrite Disk</span>
                </button>
              </div>
            </div>
          )}

          {activeFileTab.saveError && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-400/25 bg-red-500/12 px-3 py-2 text-xs text-red-200">
              <div className="flex min-w-0 items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
                <span className="truncate">{activeFileTab.saveError}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSaveFileTab(activeFileTab.uid)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-red-400/35 bg-red-500/20 px-2.5 text-[11px] font-medium text-red-100 hover:bg-red-500/30"
                >
                  Retry Save
                </button>
                <button
                  type="button"
                  onClick={() => onCloseFileTab(activeFileTab.path)}
                  className="inline-flex h-6 items-center rounded border border-white/12 bg-white/[0.06] px-2.5 text-[11px] text-[#e8ebf7]/80 hover:bg-white/12"
                >
                  Close Tab
                </button>
              </div>
            </div>
          )}

          {/* Live Monaco Viewport or Error/Loading State */}
          {activeFileTab.error ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="vega-glass w-full max-w-md rounded-2xl border border-red-400/25 bg-[#090b13]/92 p-6 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/12 text-red-300">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-medium text-[#e8ebf7]">
                  {activeFileTab.errorStatus === 415
                    ? "Binary or Unsupported Text File"
                    : activeFileTab.errorStatus === 404
                    ? "File No Longer Exists"
                    : "Unable to Open File"}
                </h2>
                <p className="mt-1.5 font-mono text-xs text-red-200/85">
                  {activeFileTab.error}
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onReloadFileTab(activeFileTab.uid)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3.5 text-xs font-medium text-[#e8ebf7] hover:bg-white/12"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-[#7aa2ff]" />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCloseFileTab(activeFileTab.path)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-transparent px-3.5 text-xs font-medium text-[#e8ebf7]/70 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                  >
                    <span>Close Tab</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <MonacoEditorSurface
                ref={monacoHandleRef}
                activeTab={activeFileTab}
                settings={editorSettings}
                pendingReveal={pendingReveal}
                onDirtyChange={onDirtyChange}
                onCursorChange={onCursorChange}
                onSaveShortcut={(uid) => void onSaveFileTab(uid)}
                onConsumeReveal={onConsumeReveal}
              />
              {activeFileTab.loading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center gap-2.5 bg-[#06070c]/88 text-xs text-[#e8ebf7]/70 backdrop-blur-[2px]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#7aa2ff]" />
                  <span>Loading {activeFileTab.name}...</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeTab === "git-diff" ? (
        <GitDiffView {...gitDiffProps} />
      ) : (
        <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-5">
          {activeTab === null ? (
          <div className="vega-glass flex h-full min-h-[220px] flex-col items-center justify-center rounded-[20px] bg-[#080a12]/62 p-8 text-center">
            <Cpu className="mb-3 h-7 w-7 text-[#7aa2ff]/70" />
            <h2 className="text-sm font-medium text-[#e8ebf7]">
              No Workspace Tab Open
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[#e8ebf7]/55">
              Select a file from the Explorer sidebar to open it in Monaco
              Editor, or reopen Shell Overview / Home below.
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
                      <button
                        type="button"
                        onClick={() => onOpenTab("board-manager")}
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                          activeProject.project.target.board &&
                          boardManagerProps.projectBoardStatus?.board_supported !== false
                            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                            : "border-amber-400/30 bg-amber-500/12 text-amber-200 hover:bg-amber-500/22"
                        }`}
                      >
                        {activeProject.project.target.board ?? "No Board Selected"}
                      </button>
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
        ) : activeTab === "sdk-doctor" ? (
          <SdkDoctorView {...sdkDoctorProps} />
        ) : activeTab === "board-manager" ? (
          <BoardManagerView {...boardManagerProps} />
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
      )}

      {tabMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: `${tabMenu.x}px`, top: `${tabMenu.y}px` }}
          className="fixed z-50 w-44 rounded-xl border border-white/14 bg-[#0b0e18]/96 p-1 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            disabled={
              !tabMenu.tab.isDirty ||
              tabMenu.tab.loading ||
              Boolean(tabMenu.tab.error)
            }
            onClick={() => {
              const targetUid = tabMenu.tab.uid;
              setTabMenu(null);
              void onSaveFileTab(targetUid);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>Save</span>
            <span className="font-mono text-[10px] text-[#e8ebf7]/45">Ctrl+S</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const targetPath = tabMenu.tab.path;
              setTabMenu(null);
              onCloseFileTab(targetPath);
            }}
            className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-[#e8ebf7]/85 hover:bg-white/[0.08]"
          >
            Close Tab
          </button>
          <button
            type="button"
            disabled={openFileTabs.length <= 1}
            onClick={() => {
              const keepPath = tabMenu.tab.path;
              setTabMenu(null);
              onCloseOtherFileTabs(keepPath);
            }}
            className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Close Other Tabs
          </button>
          <button
            type="button"
            onClick={() => {
              setTabMenu(null);
              onCloseAllFileTabs();
            }}
            className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-red-200/85 hover:bg-red-500/15"
          >
            Close All Tabs
          </button>
        </div>
      )}
    </div>
  );
}
