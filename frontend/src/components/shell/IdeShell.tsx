"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UnsavedChangesDialog } from "@/components/editor/UnsavedChangesDialog";
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
import {
  SettingsModal,
  type SettingsCategory,
} from "@/components/shell/SettingsModal";
import { SidebarPanel } from "@/components/shell/SidebarPanel";
import { StatusBar } from "@/components/shell/StatusBar";
import { WorkspaceEditorArea } from "@/components/shell/WorkspaceEditorArea";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useEditorSettings } from "@/hooks/useEditorSettings";
import { useEditorTabs } from "@/hooks/useEditorTabs";
import { useFileExplorer } from "@/hooks/useFileExplorer";
import { useSdkDoctor } from "@/hooks/useSdkDoctor";
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
import {
  SPECIES_MAP,
  type AtmosphereTweaks,
  type SpeciesKey,
} from "@/lib/glyphAnimalsEngine";
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
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("appearance");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [openProjectOpen, setOpenProjectOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  const [logs, setLogs] = useState<ShellLogEntry[]>(() => [
    createLogEntry(
      "SHELL",
      "info",
      "VEGA Studio Phase 5 shell, file explorer & Monaco editor initialized."
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

  const editorSettings = useEditorSettings();

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

  const editorTabs = useEditorTabs({
    projectDir: workspace.activeProject?.project_dir ?? null,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const explorer = useFileExplorer({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
    onEntryRenamed: editorTabs.handleEntryRenamed,
    onEntryDeleted: editorTabs.handleEntryDeleted,
  });

  const sdkDoctor = useSdkDoctor({
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const openSettingsCategory = useCallback((cat: SettingsCategory) => {
    setSettingsCategory(cat);
    setSettingsOpen(true);
  }, []);

  const openSdkDoctor = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    editorTabs.setActiveFileTabPath(null);
    setMode("workspace");
    selectNav("sdk");
    openCenterTab("sdk-doctor");
  }, [editorTabs, openCenterTab, selectNav, setMode]);

  // Global keyboard shortcuts for shell panel navigation, save & settings
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "s" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (
          !target?.closest(".monaco-editor") &&
          editorTabs.activeFileTabPath &&
          layout.activeMode === "workspace"
        ) {
          void editorTabs.saveTab(editorTabs.activeFileTabPath);
        }
        return;
      }

      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTextInput) return;

      if (!mod) return;

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
    editorTabs,
    layout.activeMode,
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
      if (workspace.activeProject) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save changes before creating a project?",
          description:
            "Open editor tabs contain unsaved changes. Save them before switching to the new project?",
          confirmSaveLabel: "Save All & Create",
          confirmDiscardLabel: "Discard & Create",
        });
        if (!proceed) {
          throw new Error("Project creation canceled.");
        }
      }
      editorTabs.resetFileTabs();
      await workspace.createNewProject(payload);
      setMode("workspace");
      openCenterTab("overview");
    },
    [editorTabs, openCenterTab, setMode, workspace]
  );

  const handleOpenProjectDir = useCallback(
    async (projectDir: string) => {
      if (
        workspace.activeProject &&
        workspace.activeProject.project_dir !== projectDir
      ) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save changes before switching projects?",
          description:
            "Open editor tabs contain unsaved changes. Save them before switching to another project?",
          confirmSaveLabel: "Save All & Switch",
          confirmDiscardLabel: "Discard & Switch",
        });
        if (!proceed) {
          throw new Error("Project switch canceled.");
        }
      }
      editorTabs.resetFileTabs();
      await workspace.openExistingProject(projectDir);
      setMode("workspace");
      openCenterTab("overview");
    },
    [editorTabs, openCenterTab, setMode, workspace]
  );

  const handleCloseProject = useCallback(async () => {
    const proceed = await editorTabs.confirmWorkspaceTransition({
      title: "Save changes before closing workspace?",
      description:
        "Open editor tabs contain unsaved changes. Save them before closing the active workspace?",
      confirmSaveLabel: "Save All & Close",
      confirmDiscardLabel: "Discard & Close",
    });
    if (!proceed) return;
    editorTabs.resetFileTabs();
    await workspace.closeActiveWorkspace();
  }, [editorTabs, workspace]);

  const activeProjectName = workspace.activeProject?.project.name ?? null;
  const activeFileTab = editorTabs.activeFileTabPath
    ? editorTabs.openFileTabs.find(
        (tab) => tab.path === editorTabs.activeFileTabPath
      ) ?? null
    : null;

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
        onCloseProject={() => void handleCloseProject()}
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
              onOpenRecentProject={(dir) =>
                void handleOpenProjectDir(dir).catch(() => {})
              }
              onDismissWarning={workspace.clearFeedback}
              onEnterWorkspace={() => {
                setComposerFocused(false);
                setMode("workspace");
              }}
              onOpenDiagnostics={() => {
                setComposerFocused(false);
                editorTabs.setActiveFileTabPath(null);
                openCenterTab("diagnostics");
              }}
              onOpenNavSection={(section) => {
                setComposerFocused(false);
                if (section === "sdk") {
                  openSdkDoctor();
                } else {
                  selectNav(section);
                }
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
                    dirtyPaths: editorTabs.dirtyPaths,
                    showHidden: explorer.showHidden,
                    actionPending:
                      explorer.actionPending || workspace.actionPending,
                    feedback: explorer.feedback,
                    onSelectPath: explorer.setSelectedPath,
                    onOpenFile: editorTabs.openFile,
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
                  sdkReport={sdkDoctor.report}
                  sdkRunning={sdkDoctor.runningDiagnostics}
                  onCollapse={toggleSidebar}
                  onOpenHome={() => setMode("home")}
                  onNewProject={openNewProjectDialog}
                  onOpenProject={openOpenProjectDialog}
                  onOpenRecentProject={(dir) =>
                    void handleOpenProjectDir(dir).catch(() => {})
                  }
                  onCloseProject={() => void handleCloseProject()}
                  onOpenSdkDoctor={openSdkDoctor}
                  onRunSdkDiagnostics={() => void sdkDoctor.runDiagnostics()}
                  onOpenSdkSettings={() => openSettingsCategory("sdk")}
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
                  openFileTabs={editorTabs.openFileTabs}
                  activeFileTabPath={editorTabs.activeFileTabPath}
                  editorSettings={editorSettings.settings}
                  dirtyCount={editorTabs.dirtyCount}
                  sdkDoctorProps={{
                    isBackendConnected: isConnected,
                    hasElectronBrowse: sdkDoctor.hasElectronBrowse,
                    configState: sdkDoctor.configState,
                    report: sdkDoctor.report,
                    discovery: sdkDoctor.discovery,
                    loading: sdkDoctor.loading,
                    runningDiagnostics: sdkDoctor.runningDiagnostics,
                    discovering: sdkDoctor.discovering,
                    savingConfig: sdkDoctor.savingConfig,
                    error: sdkDoctor.error,
                    feedback: sdkDoctor.feedback,
                    onBrowseDirectory: sdkDoctor.browseDirectory,
                    onBrowseFile: sdkDoctor.browseFile,
                    onRunDiagnostics: sdkDoctor.runDiagnostics,
                    onDiscover: sdkDoctor.runDiscovery,
                    onSaveConfig: sdkDoctor.saveConfig,
                    onResetConfig: sdkDoctor.resetConfig,
                    onClearFeedback: sdkDoctor.clearFeedback,
                  }}
                  layout={layout}
                  activeProject={workspace.activeProject}
                  isConnected={isConnected}
                  health={health}
                  healthError={error}
                  lastChecked={lastChecked}
                  onSelectTab={(tab) => {
                    editorTabs.setActiveFileTabPath(null);
                    setActiveCenterTab(tab);
                  }}
                  onCloseTab={closeCenterTab}
                  onOpenTab={(tab) => {
                    editorTabs.setActiveFileTabPath(null);
                    openCenterTab(tab);
                  }}
                  onSelectFileTab={(filePath) => {
                    explorer.setSelectedPath(filePath);
                    editorTabs.setActiveFileTabPath(filePath);
                  }}
                  onCloseFileTab={(filePath) =>
                    void editorTabs.requestCloseFileTab(filePath)
                  }
                  onCloseOtherFileTabs={(keepPath) =>
                    void editorTabs.requestCloseOtherTabs(keepPath)
                  }
                  onCloseAllFileTabs={() =>
                    void editorTabs.requestCloseAllTabs()
                  }
                  onSaveFileTab={(uidOrPath, overwriteConflict) =>
                    void editorTabs.saveTab(uidOrPath, { overwriteConflict })
                  }
                  onSaveAllFileTabs={() => void editorTabs.saveAllDirtyTabs()}
                  onReloadFileTab={(uid) =>
                    void editorTabs.reloadTabFromDisk(uid)
                  }
                  onDirtyChange={editorTabs.setTabDirty}
                  onCursorChange={editorTabs.setCursorPosition}
                  onUpdateEditorSettings={editorSettings.updateSettings}
                  onOpenSettings={() => openSettingsCategory("editor")}
                  onNewProject={openNewProjectDialog}
                  onOpenProject={openOpenProjectDialog}
                  onCloseProject={() => void handleCloseProject()}
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
        activeFileTab={activeFileTab}
        cursorPosition={editorTabs.cursorPosition}
        editorSettings={editorSettings.settings}
        dirtyCount={editorTabs.dirtyCount}
        sdkStatus={sdkDoctor.report?.overall_status ?? null}
        sidebarOpen={layout.sidebarOpen}
        bottomPanelOpen={layout.bottomPanelOpen}
        rightPanelOpen={layout.rightPanelOpen}
        onInspectBackend={() => {
          editorTabs.setActiveFileTabPath(null);
          openCenterTab("diagnostics");
        }}
        onOpenSdkDoctor={openSdkDoctor}
        onOpenProject={openOpenProjectDialog}
        onToggleSidebar={toggleSidebar}
        onToggleBottomPanel={toggleBottomPanel}
        onToggleRightPanel={toggleRightPanel}
      />

      <SettingsModal
        open={settingsOpen}
        initialCategory={settingsCategory}
        species={species}
        tweaks={tweaks}
        editorSettings={editorSettings.settings}
        sdkConfigProps={{
          configState: sdkDoctor.configState,
          hasElectronBrowse: sdkDoctor.hasElectronBrowse,
          isBackendConnected: isConnected,
          saving: sdkDoctor.savingConfig,
          discovering: sdkDoctor.discovering,
          onBrowseDirectory: sdkDoctor.browseDirectory,
          onBrowseFile: sdkDoctor.browseFile,
          onDiscover: sdkDoctor.runDiscovery,
          onSave: sdkDoctor.saveConfig,
          onReset: sdkDoctor.resetConfig,
        }}
        onClose={() => setSettingsOpen(false)}
        onSpeciesChange={handleSpeciesChange}
        onTweaksChange={handleTweaksChange}
        onResetTweaks={handleResetTweaks}
        onEditorSettingsChange={editorSettings.updateSettings}
        onResetEditorSettings={editorSettings.resetSettings}
        onOpenSdkDoctor={openSdkDoctor}
      />

      <UnsavedChangesDialog prompt={editorTabs.unsavedPrompt} />

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
