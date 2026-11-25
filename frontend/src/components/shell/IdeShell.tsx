"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";
import { OpenProjectDialog } from "@/components/project/OpenProjectDialog";
import { AppToolbar } from "@/components/shell/AppToolbar";
import { BottomPanel } from "@/components/shell/BottomPanel";
import {
  GlyphAnimalsCanvas,
  type GlyphAnimalsCanvasHandle,
} from "@/components/shell/GlyphAnimalsCanvas";
import { HomeWelcomeView } from "@/components/shell/HomeWelcomeView";
import { LiquidGlassFilter } from "@/components/shell/LiquidGlassFilter";
import { PrimaryNav } from "@/components/shell/PrimaryNav";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import { RightPanel } from "@/components/shell/RightPanel";
import { SettingsModal } from "@/components/shell/SettingsModal";
import { SidebarPanel } from "@/components/shell/SidebarPanel";
import { StatusBar } from "@/components/shell/StatusBar";
import { WorkspaceEditorArea } from "@/components/shell/WorkspaceEditorArea";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useFileExplorer } from "@/hooks/useFileExplorer";
import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useShellLayout,
} from "@/hooks/useShellLayout";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fetchFileStat } from "@/lib/api";
import {
  SPECIES_MAP,
  type AtmosphereTweaks,
  type SpeciesKey,
} from "@/lib/glyphAnimalsEngine";
import type { FileNode, OpenFileTab } from "@/types/explorer";
import type { CreateProjectPayload } from "@/types/project";
import type { ShellLogEntry } from "@/types/shell";

const SPECIES_STORAGE_KEY = "vega-studio:ambient-species:v1";
const TWEAKS_STORAGE_PREFIX = "vega-studio:ambient-tweaks:v1:";

const LOG_TIME = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function createLogEntry(
  category: ShellLogEntry["category"],
  level: ShellLogEntry["level"],
  message: string
): ShellLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: LOG_TIME.format(new Date()),
    category,
    level,
    message,
  };
}

function loadSavedTweaks(species: SpeciesKey): AtmosphereTweaks {
  const base = SPECIES_MAP[species].defaults;
  try {
    const raw = window.localStorage.getItem(`${TWEAKS_STORAGE_PREFIX}${species}`);
    if (!raw) return { ...base };
    const parsed = JSON.parse(raw) as Partial<AtmosphereTweaks>;
    return { ...base, ...parsed };
  } catch {
    return { ...base };
  }
}

function pathBasename(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] ?? relativePath;
}

function pathExtension(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : "";
}

function remapPrefixPath(
  candidate: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (candidate === oldPrefix) return newPrefix;
  if (candidate.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${candidate.slice(oldPrefix.length)}`;
  }
  return candidate;
}

function matchesPathOrDescendant(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target}/`);
}

export function IdeShell() {
  const {
    layout,
    effectiveDimensions,
    isCustomized,
    setMode,
    selectNav,
    toggleSidebar,
    setSidebarWidth,
    toggleBottomPanel,
    setBottomPanelHeight,
    toggleBottomPanelMaximized,
    setBottomTab,
    toggleRightPanel,
    setRightPanelWidth,
    setRightTab,
    openCenterTab,
    closeCenterTab,
    setActiveCenterTab,
    resetLayout,
  } = useShellLayout();

  const canvasRef = useRef<GlyphAnimalsCanvasHandle | null>(null);
  const [species, setSpecies] = useState<SpeciesKey>("moths");
  const [tweaks, setTweaks] = useState<AtmosphereTweaks>(
    () => SPECIES_MAP.moths.defaults
  );
  const [atmosphereHydrated, setAtmosphereHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [openProjectOpen, setOpenProjectOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [activeFileTabPath, setActiveFileTabPath] = useState<string | null>(
    null
  );
  const fileStatAbortRef = useRef<Record<string, AbortController>>({});

  const [logs, setLogs] = useState<ShellLogEntry[]>(() => [
    createLogEntry(
      "SHELL",
      "info",
      "VEGA Studio Phase 4 shell, project manager & file explorer initialized."
    ),
  ]);

  const appendLog = useCallback(
    (
      category: ShellLogEntry["category"],
      level: ShellLogEntry["level"],
      message: string
    ) => {
      setLogs((prev) => [
        ...prev.slice(-49),
        createLogEntry(category, level, message),
      ]);
    },
    []
  );

  // Hydrate saved ambient species & tweaks safely after mount
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      let loadedSpecies: SpeciesKey = "moths";
      try {
        const savedSpecies = window.localStorage.getItem(SPECIES_STORAGE_KEY);
        if (savedSpecies && savedSpecies in SPECIES_MAP) {
          loadedSpecies = savedSpecies as SpeciesKey;
        }
      } catch {
        // Ignore storage errors.
      }
      setSpecies(loadedSpecies);
      setTweaks(loadSavedTweaks(loadedSpecies));
      setAtmosphereHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist species & tweaks and apply CSS glass parameters to root
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--blur", `${tweaks.blur}px`);
    root.style.setProperty("--tint", `${tweaks.tint}`);
    root.style.setProperty("--edge", `${tweaks.edge}`);

    if (!atmosphereHydrated) return;
    try {
      window.localStorage.setItem(SPECIES_STORAGE_KEY, species);
      window.localStorage.setItem(
        `${TWEAKS_STORAGE_PREFIX}${species}`,
        JSON.stringify(tweaks)
      );
    } catch {
      // Ignore storage errors.
    }
  }, [species, tweaks, atmosphereHydrated]);

  const { isConnected, health, lastChecked, error } = useBackendHealth({
    onStatusChange: (connected, detail) => {
      appendLog("BACKEND", connected ? "info" : "warn", detail);
    },
  });

  const workspace = useWorkspace({
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  useEffect(() => {
    const aborts = fileStatAbortRef.current;
    return () => {
      Object.values(aborts).forEach((controller) => controller.abort());
    };
  }, []);

  const resetFileTabs = useCallback(() => {
    Object.values(fileStatAbortRef.current).forEach((controller) =>
      controller.abort()
    );
    fileStatAbortRef.current = {};
    setOpenFileTabs([]);
    setActiveFileTabPath(null);
  }, []);

  const loadFileTabStat = useCallback(
    async (projectDir: string, filePath: string) => {
      fileStatAbortRef.current[filePath]?.abort();
      const controller = new AbortController();
      fileStatAbortRef.current[filePath] = controller;

      setOpenFileTabs((prev) =>
        prev.map((tab) =>
          tab.path === filePath ? { ...tab, loading: true, error: null } : tab
        )
      );

      try {
        const stat = await fetchFileStat(projectDir, filePath, controller.signal);
        if (controller.signal.aborted) return;
        setOpenFileTabs((prev) =>
          prev.map((tab) =>
            tab.path === filePath
              ? { ...tab, stat, loading: false, error: null }
              : tab
          )
        );
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : "Failed to inspect file metadata.";
        setOpenFileTabs((prev) =>
          prev.map((tab) =>
            tab.path === filePath
              ? { ...tab, loading: false, error: message }
              : tab
          )
        );
        appendLog("SHELL", "warn", `Failed to inspect ${filePath}: ${message}`);
      }
    },
    [appendLog]
  );

  const handleEntryRenamed = useCallback((oldPath: string, newPath: string) => {
    setOpenFileTabs((prev) =>
      prev.map((tab) => {
        const remapped = remapPrefixPath(tab.path, oldPath, newPath);
        if (remapped === tab.path) return tab;
        const nextName = pathBasename(remapped);
        return {
          ...tab,
          path: remapped,
          name: nextName,
          extension: pathExtension(nextName),
          stat: tab.stat
            ? { ...tab.stat, name: nextName, relative_path: remapped }
            : null,
        };
      })
    );
    setActiveFileTabPath((prev) =>
      prev ? remapPrefixPath(prev, oldPath, newPath) : prev
    );
  }, []);

  const handleEntryDeleted = useCallback((deletedPath: string) => {
    for (const [key, controller] of Object.entries(fileStatAbortRef.current)) {
      if (matchesPathOrDescendant(key, deletedPath)) {
        controller.abort();
        delete fileStatAbortRef.current[key];
      }
    }
    setOpenFileTabs((prev) =>
      prev.filter((tab) => !matchesPathOrDescendant(tab.path, deletedPath))
    );
    setActiveFileTabPath((prev) =>
      prev && matchesPathOrDescendant(prev, deletedPath) ? null : prev
    );
  }, []);

  const explorer = useFileExplorer({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
    onEntryRenamed: handleEntryRenamed,
    onEntryDeleted: handleEntryDeleted,
  });

  const handleOpenFile = useCallback(
    (node: FileNode) => {
      const projectDir = workspace.activeProject?.project_dir;
      if (!projectDir || node.kind !== "file") return;

      setOpenFileTabs((prev) => {
        if (prev.some((tab) => tab.path === node.path)) {
          return prev;
        }
        return [
          ...prev,
          {
            path: node.path,
            name: node.name,
            extension: node.extension,
            stat: null,
            loading: true,
            error: null,
          },
        ];
      });
      setActiveFileTabPath(node.path);
      void loadFileTabStat(projectDir, node.path);
    },
    [loadFileTabStat, workspace.activeProject?.project_dir]
  );

  const handleCloseFileTab = useCallback(
    (filePath: string) => {
      fileStatAbortRef.current[filePath]?.abort();
      delete fileStatAbortRef.current[filePath];

      const idx = openFileTabs.findIndex((tab) => tab.path === filePath);
      const remaining = openFileTabs.filter((tab) => tab.path !== filePath);
      setOpenFileTabs(remaining);
      if (activeFileTabPath === filePath) {
        const fallback =
          remaining[Math.min(idx, remaining.length - 1)] ?? null;
        setActiveFileTabPath(fallback ? fallback.path : null);
      }
    },
    [activeFileTabPath, openFileTabs]
  );

  // Global keyboard shortcuts for shell panel navigation & settings
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTextInput) return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      if (key === "\\" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggleSidebar();
      } else if (key === "j" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggleBottomPanel();
      } else if (key === "a" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggleRightPanel();
      } else if (key === "e" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        selectNav("explorer");
      } else if (key === "g" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        selectNav("git");
      } else if (key === "," && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setSettingsOpen((prev) => !prev);
      } else if (key === "o" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        workspace.clearFeedback();
        setOpenProjectOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectNav,
    toggleBottomPanel,
    toggleRightPanel,
    toggleSidebar,
    workspace,
  ]);

  const handleSpeciesChange = useCallback((nextSpecies: SpeciesKey) => {
    setSpecies(nextSpecies);
    setTweaks(loadSavedTweaks(nextSpecies));
  }, []);

  const handleTweaksChange = useCallback(
    (partial: Partial<AtmosphereTweaks>) => {
      setTweaks((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  const handleResetTweaks = useCallback(() => {
    const defaults = { ...SPECIES_MAP[species].defaults };
    setTweaks(defaults);
    try {
      window.localStorage.removeItem(`${TWEAKS_STORAGE_PREFIX}${species}`);
    } catch {
      // Ignore storage errors.
    }
  }, [species]);

  const handleResetLayout = useCallback(() => {
    resetLayout();
    appendLog("LAYOUT", "info", "Restored default workspace layout.");
  }, [appendLog, resetLayout]);

  const openNewProjectDialog = useCallback(() => {
    setComposerFocused(false);
    workspace.clearFeedback();
    setNewProjectOpen(true);
  }, [workspace]);

  const openOpenProjectDialog = useCallback(() => {
    setComposerFocused(false);
    workspace.clearFeedback();
    setOpenProjectOpen(true);
  }, [workspace]);

  const handleCreateProject = useCallback(
    async (payload: CreateProjectPayload) => {
      resetFileTabs();
      await workspace.createNewProject(payload);
      setActiveFileTabPath(null);
      setMode("workspace");
      openCenterTab("overview");
    },
    [openCenterTab, resetFileTabs, setMode, workspace]
  );

  const handleOpenProjectDir = useCallback(
    async (projectDir: string) => {
      resetFileTabs();
      await workspace.openExistingProject(projectDir);
      setActiveFileTabPath(null);
      setMode("workspace");
      openCenterTab("overview");
    },
    [openCenterTab, resetFileTabs, setMode, workspace]
  );

  const handleCloseProject = useCallback(() => {
    resetFileTabs();
    void workspace.closeActiveWorkspace();
  }, [resetFileTabs, workspace]);

  const activeProjectName = workspace.activeProject?.project.name ?? null;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#06070c] text-[#e8ebf7]">
      <LiquidGlassFilter
        refraction={tweaks.refraction}
        ripple={tweaks.ripple}
      />

      {/* Persistent animated Glyph Animals canvas shared across Home & Workspace */}
      <GlyphAnimalsCanvas
        ref={canvasRef}
        species={species}
        tweaks={tweaks}
        dimmed={
          composerFocused ||
          settingsOpen ||
          newProjectOpen ||
          openProjectOpen
        }
        workspaceMode={layout.activeMode === "workspace"}
      />

      <AppToolbar
        activeMode={layout.activeMode}
        activeProjectName={activeProjectName}
        sidebarOpen={layout.sidebarOpen}
        bottomPanelOpen={layout.bottomPanelOpen}
        rightPanelOpen={layout.rightPanelOpen}
        settingsOpen={settingsOpen}
        isCustomized={isCustomized}
        onModeChange={(nextMode) => {
          setComposerFocused(false);
          setMode(nextMode);
        }}
        onNewProject={openNewProjectDialog}
        onOpenProject={openOpenProjectDialog}
        onCloseProject={handleCloseProject}
        onToggleSidebar={toggleSidebar}
        onToggleBottomPanel={toggleBottomPanel}
        onToggleRightPanel={toggleRightPanel}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
        onResetLayout={handleResetLayout}
      />

      {/* Main Middle Region: Primary Nav + Mode Workspace */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <PrimaryNav
          activeNav={layout.activeNav}
          sidebarOpen={effectiveDimensions.showSidebar}
          isWorkspaceMode={layout.activeMode === "workspace"}
          settingsOpen={settingsOpen}
          onSelectNav={selectNav}
          onToggleSettings={() => setSettingsOpen((prev) => !prev)}
        />

        {layout.activeMode === "home" ? (
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <HomeWelcomeView
              species={species}
              tweaks={tweaks}
              composerFocused={composerFocused}
              activeProject={workspace.activeProject}
              recentProjects={workspace.recentProjects}
              workspaceWarning={workspace.warning}
              isConnected={isConnected}
              health={health}
              error={error}
              onComposerFocusChange={setComposerFocused}
              onCanvasTap={(x, y) => canvasRef.current?.tapAt(x, y)}
              onNewProject={openNewProjectDialog}
              onOpenProject={openOpenProjectDialog}
              onOpenRecentProject={(dir) => void handleOpenProjectDir(dir)}
              onDismissWarning={workspace.clearFeedback}
              onEnterWorkspace={() => {
                setComposerFocused(false);
                setMode("workspace");
              }}
              onOpenDiagnostics={() => {
                setComposerFocused(false);
                setActiveFileTabPath(null);
                openCenterTab("diagnostics");
              }}
              onOpenNavSection={(section) => {
                setComposerFocused(false);
                selectNav(section);
              }}
              onOpenBottomTab={(tab) => {
                setComposerFocused(false);
                setBottomTab(tab);
              }}
            />
          </main>
        ) : (
          <div className="vega-view-enter flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {/* Left Sidebar */}
            {effectiveDimensions.showSidebar && (
              <>
                <SidebarPanel
                  activeNav={layout.activeNav}
                  width={effectiveDimensions.sidebarWidth}
                  activeProject={workspace.activeProject}
                  recentProjects={workspace.recentProjects}
                  actionPending={workspace.actionPending}
                  explorer={{
                    childrenByPath: explorer.childrenByPath,
                    expandedPaths: explorer.expandedPaths,
                    loadingPaths: explorer.loadingPaths,
                    dirErrors: explorer.dirErrors,
                    truncatedDirs: explorer.truncatedDirs,
                    selectedPath: explorer.selectedPath,
                    showHidden: explorer.showHidden,
                    actionPending:
                      explorer.actionPending || workspace.actionPending,
                    feedback: explorer.feedback,
                    onSelectPath: explorer.setSelectedPath,
                    onOpenFile: handleOpenFile,
                    onToggleExpand: explorer.toggleExpand,
                    onExpandDirectory: explorer.expandDirectory,
                    onCollapseDirectory: explorer.collapseDirectory,
                    onRefreshAll: explorer.refreshAll,
                    onRefreshDirectory: explorer.loadDirectory,
                    onToggleHidden: () =>
                      explorer.setShowHidden((prev) => !prev),
                    onCreateEntry: explorer.createEntry,
                    onRenameEntry: explorer.renameEntry,
                    onDeleteEntry: explorer.deleteEntry,
                    onClearFeedback: explorer.clearFeedback,
                  }}
                  onCollapse={toggleSidebar}
                  onOpenHome={() => setMode("home")}
                  onNewProject={openNewProjectDialog}
                  onOpenProject={openOpenProjectDialog}
                  onOpenRecentProject={(dir) => void handleOpenProjectDir(dir)}
                  onCloseProject={handleCloseProject}
                />
                <ResizeHandle
                  orientation="vertical"
                  ariaLabel="Resize sidebar"
                  value={effectiveDimensions.sidebarWidth}
                  min={SIDEBAR_MIN_WIDTH}
                  max={effectiveDimensions.maxSidebarWidth}
                  defaultValue={SIDEBAR_DEFAULT_WIDTH}
                  onResize={setSidebarWidth}
                />
              </>
            )}

            {/* Center Column: Workspace + Secondary Bottom Panel */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {!(layout.bottomPanelOpen && layout.bottomPanelMaximized) && (
                <WorkspaceEditorArea
                  openTabs={layout.openCenterTabs}
                  activeTab={layout.activeCenterTab}
                  openFileTabs={openFileTabs}
                  activeFileTabPath={activeFileTabPath}
                  layout={layout}
                  activeProject={workspace.activeProject}
                  isConnected={isConnected}
                  health={health}
                  healthError={error}
                  lastChecked={lastChecked}
                  onSelectTab={(tab) => {
                    setActiveFileTabPath(null);
                    setActiveCenterTab(tab);
                  }}
                  onCloseTab={closeCenterTab}
                  onOpenTab={(tab) => {
                    setActiveFileTabPath(null);
                    openCenterTab(tab);
                  }}
                  onSelectFileTab={(filePath) => setActiveFileTabPath(filePath)}
                  onCloseFileTab={handleCloseFileTab}
                  onNewProject={openNewProjectDialog}
                  onOpenProject={openOpenProjectDialog}
                  onCloseProject={handleCloseProject}
                  onToggleSidebar={toggleSidebar}
                  onToggleBottomPanel={toggleBottomPanel}
                  onToggleRightPanel={toggleRightPanel}
                  onOpenHome={() => setMode("home")}
                />
              )}

              {layout.bottomPanelOpen && (
                <>
                  {!layout.bottomPanelMaximized && (
                    <ResizeHandle
                      orientation="horizontal"
                      ariaLabel="Resize secondary panel"
                      value={effectiveDimensions.bottomPanelHeight}
                      min={BOTTOM_PANEL_MIN_HEIGHT}
                      max={effectiveDimensions.maxBottomHeight}
                      defaultValue={BOTTOM_PANEL_DEFAULT_HEIGHT}
                      invertDelta
                      onResize={setBottomPanelHeight}
                    />
                  )}
                  <BottomPanel
                    activeTab={layout.activeBottomTab}
                    height={effectiveDimensions.bottomPanelHeight}
                    maximized={layout.bottomPanelMaximized}
                    logs={logs}
                    onSelectTab={setBottomTab}
                    onToggleMaximize={toggleBottomPanelMaximized}
                    onCollapse={toggleBottomPanel}
                    onClearLogs={() => setLogs([])}
                  />
                </>
              )}
            </main>

            {/* Right Hideable Assistant Panel */}
            {effectiveDimensions.showRightPanel && (
              <>
                <ResizeHandle
                  orientation="vertical"
                  ariaLabel="Resize assistant panel"
                  value={effectiveDimensions.rightPanelWidth}
                  min={RIGHT_PANEL_MIN_WIDTH}
                  max={effectiveDimensions.maxRightPanelWidth}
                  defaultValue={RIGHT_PANEL_DEFAULT_WIDTH}
                  invertDelta
                  onResize={setRightPanelWidth}
                />
                <RightPanel
                  activeTab={layout.activeRightTab}
                  width={effectiveDimensions.rightPanelWidth}
                  onSelectTab={setRightTab}
                  onCollapse={toggleRightPanel}
                />
              </>
            )}
          </div>
        )}
      </div>

      <StatusBar
        isConnected={isConnected}
        health={health}
        error={error}
        activeProjectName={activeProjectName}
        sidebarOpen={layout.sidebarOpen}
        bottomPanelOpen={layout.bottomPanelOpen}
        rightPanelOpen={layout.rightPanelOpen}
        onInspectBackend={() => openCenterTab("diagnostics")}
        onOpenProject={openOpenProjectDialog}
        onToggleSidebar={toggleSidebar}
        onToggleBottomPanel={toggleBottomPanel}
        onToggleRightPanel={toggleRightPanel}
      />

      <SettingsModal
        open={settingsOpen}
        species={species}
        tweaks={tweaks}
        onClose={() => setSettingsOpen(false)}
        onSpeciesChange={handleSpeciesChange}
        onTweaksChange={handleTweaksChange}
        onResetTweaks={handleResetTweaks}
      />

      <NewProjectDialog
        open={newProjectOpen}
        defaultParentDir={workspace.defaultProjectsDir}
        isBackendConnected={isConnected}
        isElectronBridge={workspace.isElectronBridge}
        pending={workspace.actionPending}
        serverError={workspace.error}
        onClose={() => {
          workspace.clearFeedback();
          setNewProjectOpen(false);
        }}
        onBrowseParent={(currentPath) =>
          workspace.browseDirectory("Select Project Location", currentPath)
        }
        onSubmit={handleCreateProject}
      />

      <OpenProjectDialog
        open={openProjectOpen}
        recentProjects={workspace.recentProjects}
        defaultProjectsDir={workspace.defaultProjectsDir}
        isBackendConnected={isConnected}
        isElectronBridge={workspace.isElectronBridge}
        pending={workspace.actionPending}
        serverError={workspace.error}
        onClose={() => {
          workspace.clearFeedback();
          setOpenProjectOpen(false);
        }}
        onBrowseProject={(defaultPath) =>
          workspace.browseDirectory("Open VEGA Studio Project", defaultPath)
        }
        onOpenProject={handleOpenProjectDir}
        onForgetRecent={workspace.forgetRecentProject}
      />
    </div>
  );
}
