"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from"react";
import { createPortal } from"react-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Cpu,
  Download,
  FileDiff,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Replace,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  Wifi,
  WifiOff,
  WrapText,
  X,
} from"lucide-react";
import {
  MonacoEditorSurface,
  type MonacoEditorHandle,
} from"@/components/editor/MonacoEditorSurface";
import { BoardManagerView } from"@/components/board/BoardManagerView";
import { FileIcon } from"@/components/explorer/FileIcon";
import { GitDiffView } from"@/components/git/GitDiffView";
import { ExamplesDocsView } from"@/components/learning/ExamplesDocsView";
import { SdkDoctorView } from"@/components/sdk/SdkDoctorView";
import { Tooltip } from"@/components/ui/Tooltip";
import {
  exportDiagnosticsBundle,
  fetchStatus,
  type HealthResponse,
  type StatusResponse,
} from"@/lib/api";
import type {
  EditorCursorPosition,
  EditorRevealTarget,
  EditorSettings,
} from"@/types/editor";
import type { OpenFileTab } from"@/types/explorer";
import type { AIContextAttachment } from"@/types/ai";
import type { WorkspaceSummary } from"@/types/project";
import { formatBoardDisplayLabel } from"@/types/board";
import type { CenterTabId, ShellLayoutState } from"@/types/shell";

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
  examplesDocsProps: ComponentProps<typeof ExamplesDocsView>;
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
  onAskNativeAi?: (
    ctx: AIContextAttachment,
    suggestedPrompt?: string
  ) => void;
  onRegisterEditorHandle?: (handle: MonacoEditorHandle | null) => void;
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
  "examples-docs": { label: "Examples & Docs", icon: BookOpen },
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
  examplesDocsProps,
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
  onAskNativeAi,
  onRegisterEditorHandle,
}: WorkspaceEditorAreaProps) {
  const monacoHandleRef = useRef<MonacoEditorHandle | null>(null);
  const attachMonacoRef = useCallback(
    (inst: MonacoEditorHandle | null) => {
      monacoHandleRef.current = inst;
      onRegisterEditorHandle?.(inst);
    },
    [onRegisterEditorHandle]
  );
  const [tabMenu, setTabMenu] = useState<TabContextMenuState | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<{
    kind: "ok" |"error";
    text: string;
  } | null>(null);
  const [viewsMenuCoords, setViewsMenuCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const viewsMenuRef = useRef<HTMLDivElement | null>(null);
  const viewsDropdownRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!viewsMenuCoords) return;
    const handlePointerDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      if (
        !viewsMenuRef.current?.contains(target) &&
        !viewsDropdownRef.current?.contains(target)
      ) {
        setViewsMenuCoords(null);
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setViewsMenuCoords(null);
    };
    const handleResize = () => setViewsMenuCoords(null);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [viewsMenuCoords]);

  const activeProjectDir = activeProject?.project_dir ?? null;

  const handleExportSafeDiagnostics = useCallback(async () => {
    if (!isConnected || exportingDiagnostics) return;
    setExportingDiagnostics(true);
    setDiagnosticsNotice(null);
    try {
      const bundle = await exportDiagnosticsBundle(activeProjectDir);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g,"-");
      const link = document.createElement("a");
      link.href = url;
      link.download = `vega-studio-diagnostics-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDiagnosticsNotice({
        kind: "ok",
        text: "Redacted diagnostics bundle saved locally (secrets and keys excluded).",
      });
    } catch (err: unknown) {
      setDiagnosticsNotice({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to export safe diagnostics bundle.",
      });
    } finally {
      setExportingDiagnostics(false);
    }
  }, [activeProjectDir, exportingDiagnostics, isConnected]);

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
    const focusKey =
      target.kind === "shell" ? `shell:${target.id}` : `file:${target.path}`;
    if (target.kind === "shell") {
      onSelectTab(target.id);
    } else {
      onSelectFileTab(target.path);
    }
    requestAnimationFrame(() => {
      tabButtonRefs.current[focusKey]?.focus();
    });
  };

  return (
    <div className="vega-view-enter flex min-h-0 min-w-0 flex-1 flex-col bg-[#1F1F1F]">
      {/* Central Workspace Tab Strip */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2B2B2E] bg-[#181818] px-1 select-none">
        <div
          role="tablist"
          aria-label="Workspace and editor tabs"
          className="vega-no-scrollbar flex h-full min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
        >
          {openTabs.map((tabId, idx) => {
            const { label, icon: Icon } = TAB_META[tabId];
            const isSelected = activeFileTab === null && activeTab === tabId;

            return (
              <div
                key={tabId}
                ref={(el) => {
                  tabButtonRefs.current[`shell:${tabId}`] = el;
                }}
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectTab(tabId)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`group relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 border-x px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] ${
                  isSelected
                    ? "border-[#2D2D30]/60 border-t-2 border-t-[#7AA2FF] bg-[#1F1F1F] text-[#F4F4F5]"
                    : "border-transparent border-t-2 border-t-transparent bg-[#181818] text-[#B4B4BC] hover:bg-[#1F1F1F]/75 hover:text-[#F4F4F5]"
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tabId);
                  }}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[#B4B4BC] opacity-75 transition-colors hover:bg-[#2D2D31] hover:text-[#F4F4F5] group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {openTabs.length > 0 && openFileTabs.length > 0 && (
            <div
              aria-hidden="true"
              className="mx-1 my-auto h-4 w-px shrink-0 bg-[#2C2C30]"
            />
          )}

          {openFileTabs.map((fileTab, fileIdx) => {
            const isSelected = activeFileTab?.path === fileTab.path;
            const navIndex = openTabs.length + fileIdx;

            return (
              <div
                key={`file:${fileTab.uid}`}
                ref={(el) => {
                  tabButtonRefs.current[`file:${fileTab.path}`] = el;
                }}
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
                className={`group relative inline-flex h-8 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-x px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] ${
                  isSelected
                    ? "border-[#2D2D30]/60 border-t-2 border-t-[#7AA2FF] bg-[#1F1F1F] text-[#F4F4F5]"
                    : "border-transparent border-t-2 border-t-transparent bg-[#181818] text-[#B4B4BC] hover:bg-[#1F1F1F]/75 hover:text-[#F4F4F5]"
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
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#7AA2FF]" />
                ) : fileTab.isDirty ? (
                  <span
                    aria-label="Unsaved changes"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300"
                  />
                ) : null}

                <button
                  type="button"
                  aria-label={`Close ${fileTab.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFileTab(fileTab.path);
                  }}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[#A1A1AA] opacity-70 transition-colors hover:bg-[#2D2D31] hover:text-[#F4F4F5] group-hover:opacity-100"
                >
                <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1 pl-1.5">
          {dirtyCount > 0 && (
            <Tooltip label="Save all modified files">
              <button
                type="button"
                onClick={onSaveAllFileTabs}
                className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-2 font-mono text-[10.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/22"
              >
              <Save className="h-3 w-3 text-[#7AA2FF]" />
                <span>Save All ({dirtyCount})</span>
              </button>
            </Tooltip>
          )}
          {openFileTabs.length > 1 && (
            <button
              type="button"
              onClick={onCloseAllFileTabs}
              title="Close all editor tabs"
              className="hidden h-6 items-center rounded-[5px] px-2 text-[11px] text-[#B4B4BC] hover:bg-[#252527] hover:text-[#F4F4F5] lg:inline-flex"
            >
              Close All
            </button>
          )}

          {/* Compact View Switcher Dropdown */}
          <div ref={viewsMenuRef} className="relative">
            <Tooltip label="Open IDE View Tab" side="bottom">
              <button
                type="button"
                aria-label="Open IDE View Tab"
                aria-expanded={Boolean(viewsMenuCoords)}
                onClick={(e) => {
                  if (viewsMenuCoords) {
                    setViewsMenuCoords(null);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const menuW = 180;
                  const menuH = 220;
                  const left = Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8));
                  const top = Math.min(rect.bottom + 6, window.innerHeight - menuH - 8);
                  setViewsMenuCoords({ left, top });
                }}
                className={`inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-[11px] transition-colors ${
                  viewsMenuCoords
                    ? "border-[#7AA2FF]/35 bg-[#7AA2FF]/14 text-[#F4F4F5]"
                    : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                }`}
              >
              <Plus className="h-3 w-3 text-[#7AA2FF]" />
              <span className="hidden xl:inline">Views</span>
              </button>
            </Tooltip>

            {viewsMenuCoords &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={viewsDropdownRef}
                  role="menu"
                  aria-label="Workspace views"
                  style={{
                    left: `${viewsMenuCoords.left}px`,
                    top: `${viewsMenuCoords.top}px`,
                  }}
                  className="vega-tweaks-glass fixed z-[110] w-44 rounded-[10px] border border-[#2D2D30] p-1 shadow-2xl"
                >
                  {(Object.keys(TAB_META) as CenterTabId[]).map((id) => {
                    const { label, icon: Icon } = TAB_META[id];
                    const isOpen = openTabs.includes(id);
                    const isActive = activeFileTab === null && activeTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onOpenTab(id);
                          setViewsMenuCoords(null);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                          isActive
                            ? "bg-[#7AA2FF]/20 text-[#F4F4F5]"
                            : "text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
                        }`}
                      >
                      <span className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-[#7AA2FF]" />
                          <span>{label}</span>
                        </span>
                        {isOpen && (
                        <Check className="h-3 w-3 text-[#7AA2FF]" />
                        )}
                      </button>
                    );
                  })}
                </div>,
                document.body
              )}
          </div>
        </div>
      </div>

      {/* Central Workspace Body */}
      {activeFileTab ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1F1F1F]">
          {/* Editor Header & Action Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2D2D30] bg-[#181818] px-3 py-1.5 select-none">
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-[#E4E4E7]">
              <span className="truncate text-[#7AA2FF]">
                {activeProject?.project.name ?? "workspace"}
              </span>
              {activeFileTab.path.split("/").map((segment, index, parts) => (
                <span
                  key={`${segment}-${index}`}
                  className="inline-flex min-w-0 items-center gap-1"
                >
                <ChevronRight className="h-3 w-3 shrink-0 text-[#A1A1AA]" />
                  <span
                    className={`truncate ${
                      index === parts.length - 1
                        ? "font-semibold text-[#F4F4F5]"
                        : "text-[#E4E4E7]"
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
                  className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10.5px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-50"
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
                  className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10.5px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-50"
                >
                <Replace className="h-3 w-3" />
                <span className="hidden xl:inline">Replace</span>
                </button>
              </Tooltip>

              <div className="mx-0.5 h-3.5 w-px bg-[#2C2C30]" />

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
                  className="hidden h-6 items-center rounded px-1.5 font-mono text-[10.5px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-45 sm:inline-flex"
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
                      ? "bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
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
                      ? "bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
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
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                >
                <SlidersHorizontal className="h-3 w-3" />
                </button>
              </Tooltip>

              <div className="mx-0.5 h-3.5 w-px bg-[#2C2C30]" />

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
                      ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/20 text-[#F4F4F5] hover:bg-[#7AA2FF]/30"
                      : "border-[#2D2D30] bg-[#252527] text-[#B4B4BC] disabled:cursor-default"
                  }`}
                >
                  {activeFileTab.isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[#7AA2FF]" />
                  ) : activeFileTab.isDirty ? (
                  <Save className="h-3 w-3 text-[#7AA2FF]" />
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
                  className="inline-flex h-6 items-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
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
                  className="inline-flex h-6 items-center rounded border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] text-[#F4F4F5] hover:bg-[#2D2D31]"
                >
                  Close Tab
                </button>
              </div>
            </div>
          )}

          {/* Live Monaco Viewport or Error/Loading State */}
          {activeFileTab.error ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="vega-glass w-full max-w-md rounded-2xl border border-red-400/25 p-6 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/12 text-red-300">
                <AlertCircle className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-medium text-[#F4F4F5]">
                  {activeFileTab.errorStatus === 415
                    ? "Binary or Unsupported Text File"
                    : activeFileTab.errorStatus === 404
                    ? "File No Longer Exists"
                    : "Unable to Open File"}
                </h2>
                <p className="mt-1.5 font-mono text-xs text-red-200">
                  {activeFileTab.error}
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onReloadFileTab(activeFileTab.uid)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-[#252527] px-3.5 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
                  >
                  <RotateCcw className="h-3.5 w-3.5 text-[#7AA2FF]" />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCloseFileTab(activeFileTab.path)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-transparent px-3.5 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
                  >
                    <span>Close Tab</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
              <MonacoEditorSurface
                ref={attachMonacoRef}
                activeTab={activeFileTab}
                settings={editorSettings}
                pendingReveal={pendingReveal}
                onDirtyChange={onDirtyChange}
                onCursorChange={onCursorChange}
                onSaveShortcut={(uid) => void onSaveFileTab(uid)}
                onConsumeReveal={onConsumeReveal}
                onAskNativeAi={onAskNativeAi}
              />
              {activeFileTab.loading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center gap-2.5 bg-[#1F1F1F]/90 text-xs text-[#F4F4F5] backdrop-blur-sm">
                <Loader2 className="h-4 w-4 animate-spin text-[#7AA2FF]" />
                  <span>Loading {activeFileTab.name}...</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeTab === "git-diff" ? (
        <GitDiffView {...gitDiffProps} />
      ) : activeTab === "examples-docs" ? (
        <ExamplesDocsView {...examplesDocsProps} />
      ) : (
      <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === null ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[8px] border border-[#2D2D30] bg-[#181818] p-6 text-center">
            <Cpu className="mb-2.5 h-6 w-6 text-[#7AA2FF]" />
            <h2 className="text-sm font-medium text-[#F4F4F5]">
              No Editor Tab Open
            </h2>
            <p className="mt-1 max-w-sm text-xs text-[#E4E4E7]">
              Select a file from the Explorer sidebar to edit source code, or open Shell Overview below.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => onOpenTab("overview")}
                className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527]"
              >
              <Layers className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Shell Overview</span>
              </button>
              <button
                type="button"
                onClick={onOpenHome}
                className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-transparent px-3 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
              >
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        ) : activeTab === "overview" ? (
        <div className="flex w-full flex-col gap-4">
            {/* Active Project / Workspace Summary */}
            {activeProject ? (
            <div className="rounded-[10px] border border-[#2D2D30] bg-[#181818] p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-medium tracking-[0.06em] text-[#7AA2FF] uppercase">
                        Active Project
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenTab("board-manager")}
                        className={`rounded-[5px] border px-2 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                          activeProject.project.target.board &&
                          boardManagerProps.projectBoardStatus?.board_supported !== false
                            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18"
                            : "border-amber-400/30 bg-amber-500/12 text-amber-200 hover:bg-amber-500/20"
                        }`}
                      >
                        {formatBoardDisplayLabel(
                          boardManagerProps.projectBoardStatus?.board?.name,
                          activeProject.project.target.board
                        )}
                      </button>
                    </div>
                    <h1 className="mt-1 truncate text-[16px] font-medium tracking-tight text-[#F4F4F5]">
                      {activeProject.project.name}
                    </h1>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[#B4B4BC]">
                      {activeProject.project_dir}
                    </p>
                    {activeProject.project.description && (
                    <p className="mt-1.5 text-xs text-[#E4E4E7]">
                        {activeProject.project.description}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onOpenProject}
                      className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527]"
                    >
                    <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>Switch</span>
                    </button>
                    <button
                      type="button"
                      onClick={onCloseProject}
                      className="inline-flex h-7.5 items-center rounded-[6px] border border-[#2D2D30] bg-transparent px-3 text-xs font-medium text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <dl className="mt-3.5 grid grid-cols-2 gap-3 border-t border-[#2D2D30] pt-3 font-mono text-[11px] sm:grid-cols-4">
                  <div>
                    <dt className="text-[10px] text-[#A1A1AA] uppercase">
                      Architecture
                    </dt>
                    <dd className="mt-0.5 text-[#F4F4F5]">
                      {activeProject.project.target.arch}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#A1A1AA] uppercase">
                      Machine
                    </dt>
                    <dd className="mt-0.5 text-[#F4F4F5]">
                      {activeProject.project.target.machine}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#A1A1AA] uppercase">
                      Manifest
                    </dt>
                    <dd className="mt-0.5 text-[#F4F4F5]">
                      {activeProject.has_metadata === false
                        ? "External Folder"
                        : `vega-project v${activeProject.project.schemaVersion}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#A1A1AA] uppercase">
                      Structure
                    </dt>
                    <dd
                      className={`mt-0.5 ${
                        activeProject.structure_valid
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }`}
                    >
                      {activeProject.structure_valid ? "Valid" : "Incomplete"}
                    </dd>
                  </div>
                </dl>

                {activeProject.warnings.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-[6px] border border-amber-400/25 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="space-y-0.5">
                      {activeProject.warnings.map((w) => (
                        <p key={w}>{w}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
            <div className="flex flex-col justify-between gap-3 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-mono text-[10px] font-medium tracking-[0.06em] text-[#7AA2FF] uppercase">
                    Workspace
                  </p>
                  <h1 className="mt-0.5 text-[16px] font-medium tracking-tight text-[#F4F4F5]">
                    No Active VEGA Project
                  </h1>
                  <p className="mt-1 text-xs text-[#E4E4E7]">
                    Create a portable VEGA ARIES V3 project or open any existing project or firmware directory.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onNewProject}
                    className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] bg-[#7AA2FF] px-3 text-xs font-semibold text-[#0D0D0F] transition-colors hover:bg-[#93B4FF]"
                  >
                  <FolderPlus className="h-3.5 w-3.5" />
                    <span>New Project</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenProject}
                    className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527]"
                  >
                  <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                    <span>Open Project</span>
                  </button>
                </div>
              </div>
            )}

            {/* Full-Width Workspace Region Cards */}
            <div className="overflow-hidden rounded-[10px] border border-[#2D2D30] bg-[#181818]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2D2D30] px-4 py-2.5">
                <span className="font-mono text-[10.5px] font-semibold tracking-[0.06em] text-[#E4E4E7] uppercase">
                  Workspace Regions &amp; Quick Controls
                </span>
                <span className="font-mono text-[10.5px] text-[#B4B4BC]">
                  Drag dividers or double-click handles to reset sizes
                </span>
              </div>
              <div className="grid grid-cols-1 divide-y divide-[#2D2D30] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#F4F4F5]">
                      <PanelLeft className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>Left Sidebar</span>
                      <span className="font-mono text-[11px] text-[#B4B4BC]">
                        {layout.sidebarOpen
                          ? `${layout.sidebarWidth}px · ${layout.activeNav}`
                          : "Collapsed"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#E4E4E7]">
                      Explorer, Source Control, Examples &amp; Docs, SDK Doctor, Board Tools.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleSidebar}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
                  >
                    <span>{layout.sidebarOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#F4F4F5]">
                      <PanelBottom className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>Secondary Panel</span>
                      <span className="font-mono text-[11px] text-[#B4B4BC]">
                        {layout.bottomPanelOpen
                          ? `${layout.bottomPanelHeight}px · ${layout.activeBottomTab}`
                          : "Collapsed"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#E4E4E7]">
                      Build Output, PTY Terminal, Serial Monitor, Upload, Diagnostics, Logs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleBottomPanel}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
                  >
                    <span>{layout.bottomPanelOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#F4F4F5]">
                      <PanelRight className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>Unified AI Workspace</span>
                      <span className="font-mono text-[11px] text-[#B4B4BC]">
                        {layout.rightPanelOpen
                          ? `${layout.rightPanelWidth}px · ${layout.activeRightTab}`
                          : "Hidden"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#E4E4E7]">
                      Native VEGA Assistant powered by Groq, OpenAI, or compatible endpoints.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleRightPanel}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
                  >
                    <span>{layout.rightPanelOpen ? "Hide" : "Show"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Feature Launch Row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => onOpenTab("board-manager")}
                className="flex items-center gap-3 rounded-[10px] border border-[#2D2D30] bg-[#181818] p-3.5 text-left transition-colors hover:border-[#7AA2FF]/45 hover:bg-[#252527]"
              >
              <Cpu className="h-4.5 w-4.5 shrink-0 text-[#7AA2FF]" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F4F4F5]">Board Manager</p>
                <p className="truncate text-[11px] text-[#B4B4BC]">VEGA ARIES V3 specs &amp; target</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab("sdk-doctor")}
                className="flex items-center gap-3 rounded-[10px] border border-[#2D2D30] bg-[#181818] p-3.5 text-left transition-colors hover:border-[#7AA2FF]/45 hover:bg-[#252527]"
              >
              <Stethoscope className="h-4.5 w-4.5 shrink-0 text-[#7AA2FF]" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F4F4F5]">SDK Doctor</p>
                <p className="truncate text-[11px] text-[#B4B4BC]">Check RISC-V GCC &amp; Make</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab("examples-docs")}
                className="flex items-center gap-3 rounded-[10px] border border-[#2D2D30] bg-[#181818] p-3.5 text-left transition-colors hover:border-[#7AA2FF]/45 hover:bg-[#252527]"
              >
              <BookOpen className="h-4.5 w-4.5 shrink-0 text-[#7AA2FF]" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F4F4F5]">Examples &amp; Docs</p>
                <p className="truncate text-[11px] text-[#B4B4BC]">Starters &amp; reference manual</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab("diagnostics")}
                className="flex items-center gap-3 rounded-[10px] border border-[#2D2D30] bg-[#181818] p-3.5 text-left transition-colors hover:border-[#7AA2FF]/45 hover:bg-[#252527]"
              >
              <Activity className="h-4.5 w-4.5 shrink-0 text-[#7AA2FF]" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F4F4F5]">Backend Health</p>
                <p className="truncate text-[11px] text-[#B4B4BC]">Runtime status &amp; diagnostics</p>
                </div>
              </button>
            </div>
          </div>
        ) : activeTab === "sdk-doctor" ? (
          <SdkDoctorView {...sdkDoctorProps} />
        ) : activeTab === "board-manager" ? (
          <BoardManagerView {...boardManagerProps} />
        ) : (
          /* Live Backend Health & Status Tab */
          <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-[6px] border ${
                    isConnected
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                      : "border-red-400/25 bg-red-500/10 text-red-300"
                  }`}
                >
                  {isConnected ? (
                  <Wifi className="h-4.5 w-4.5" />
                  ) : (
                  <WifiOff className="h-4.5 w-4.5" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-medium text-[#F4F4F5]">
                    {isConnected
                      ? "FastAPI Backend Connected"
                      : "FastAPI Backend Unavailable"}
                  </h2>
                  <p className="font-mono text-[11px] text-[#B4B4BC]">
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
                className="inline-flex h-7.5 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527] disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${statusLoading ? "animate-spin" : ""}`}
                />
                <span>Refresh Status</span>
              </button>
            </div>

            {isConnected && statusData ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-[8px] border border-[#2D2D30] bg-[#181818] p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  <span className="font-mono text-[10px] font-medium tracking-[0.06em] text-[#E4E4E7] uppercase">
                      Backend Service
                    </span>
                  </div>
                  <dl className="space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">Service</dt>
                      <dd className="text-[#F4F4F5]">
                        {String(statusData.backend.service ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">Environment</dt>
                      <dd className="text-[#F4F4F5]">
                        {String(statusData.backend.env ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">Bind</dt>
                      <dd className="text-[#F4F4F5]">
                        {String(statusData.backend.host ?? "127.0.0.1")}:
                        {String(statusData.backend.port ?? 8765)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-[8px] border border-[#2D2D30] bg-[#181818] p-3.5">
                  <div className="mb-2 flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-[#7AA2FF]" />
                    <span className="font-mono text-[10px] font-medium tracking-[0.06em] text-[#E4E4E7] uppercase">
                      Runtime Platform
                    </span>
                  </div>
                  <dl className="space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">OS</dt>
                      <dd className="text-[#F4F4F5]">
                        {String(statusData.platform.os ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">Arch</dt>
                      <dd className="text-[#F4F4F5]">
                        {String(statusData.platform.architecture ?? "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#B4B4BC]">Python</dt>
                      <dd className="truncate text-[#F4F4F5]">
                        {String(statusData.platform.python_version ?? "—").split(
                          ""
                        )[0]}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
            <div className="rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4 text-xs text-[#E4E4E7]">
                {statusError
                  ? `Backend status query failed: ${statusError}`
                  : "Start the FastAPI backend (or launch via Electron) to inspect detailed runtime diagnostics."}
              </div>
            )}

            {/* Safe Redacted Diagnostics Bundle Export */}
            <div className="rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    <span className="text-xs font-medium text-[#F4F4F5]">
                      Safe Local Diagnostics Export
                    </span>
                  </div>
                  <p className="max-w-xl text-xs leading-relaxed text-[#E4E4E7]">
                    Exports a redacted JSON snapshot containing app version, OS/arch, SDK/board/Git/AI non-secret readiness, and the redacted backend log tail. Secrets, keys, source files, and transcripts are excluded.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isConnected || exportingDiagnostics}
                  onClick={() => void handleExportSafeDiagnostics()}
                  className="inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/24 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {exportingDiagnostics ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
                  ) : (
                  <Download className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  )}
                  <span>
                    {exportingDiagnostics ? "Exporting..." : "Export Safe Diagnostics"}
                  </span>
                </button>
              </div>
              {diagnosticsNotice && (
                <p
                  role={diagnosticsNotice.kind === "error" ? "alert" : "status"}
                  className={`mt-3 rounded-[6px] border px-3 py-2 text-xs ${
                    diagnosticsNotice.kind === "ok"
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                      : "border-red-400/30 bg-red-500/12 text-red-200"
                  }`}
                >
                  {diagnosticsNotice.text}
                </p>
              )}
            </div>
          </div>
          )}
        </div>
      )}

      {tabMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              left: `${Math.max(8, Math.min(tabMenu.x, window.innerWidth - 190))}px`,
              top: `${Math.max(8, Math.min(tabMenu.y, window.innerHeight - 170))}px`,
            }}
            className="vega-tweaks-glass fixed z-[110] w-44 rounded-xl border border-[#2D2D30] p-1 shadow-2xl"
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
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-[#F4F4F5] hover:bg-[#252527] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>Save</span>
              <span className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+S</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const targetPath = tabMenu.tab.path;
                setTabMenu(null);
                onCloseFileTab(targetPath);
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-[#F4F4F5] hover:bg-[#252527]"
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
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-[#F4F4F5] hover:bg-[#252527] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Close Other Tabs
            </button>
            <button
              type="button"
              onClick={() => {
                setTabMenu(null);
                onCloseAllFileTabs();
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-red-200 hover:bg-red-500/15"
            >
              Close All Tabs
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
