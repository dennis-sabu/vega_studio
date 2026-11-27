"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from"react";
import type { MonacoEditorHandle } from"@/components/editor/MonacoEditorSurface";
import { UnsavedChangesDialog } from"@/components/editor/UnsavedChangesDialog";
import { GitConfirmDialog } from"@/components/git/GitConfirmDialog";
import { GitHubConfirmDialog } from"@/components/git/GitHubConfirmDialog";
import { CreateFromExampleModal } from"@/components/learning/CreateFromExampleModal";
import { NewProjectDialog } from"@/components/project/NewProjectDialog";
import { OpenProjectDialog } from"@/components/project/OpenProjectDialog";
import { AppToolbar } from"@/components/shell/AppToolbar";
import { BottomPanel } from"@/components/shell/BottomPanel";
import {
  CommandPaletteModal,
  type CommandPaletteAction,
} from"@/components/shell/CommandPaletteModal";
import {
  GlyphAnimalsCanvas,
  type GlyphAnimalsCanvasHandle,
} from"@/components/shell/GlyphAnimalsCanvas";
import { HomeWelcomeView } from"@/components/shell/HomeWelcomeView";
import { LiquidGlassFilter } from"@/components/shell/LiquidGlassFilter";
import { PrimaryNav } from"@/components/shell/PrimaryNav";
import { ResizeHandle } from"@/components/shell/ResizeHandle";
import { RightPanel } from"@/components/shell/RightPanel";
import {
  SettingsModal,
  type SettingsCategory,
} from"@/components/shell/SettingsModal";
import { SidebarPanel } from"@/components/shell/SidebarPanel";
import { StatusBar } from"@/components/shell/StatusBar";
import { WorkspaceEditorArea } from"@/components/shell/WorkspaceEditorArea";
import { useBackendHealth } from"@/hooks/useBackendHealth";
import { useBoardManager } from"@/hooks/useBoardManager";
import { useBuildSystem } from"@/hooks/useBuildSystem";
import { useEditorSettings } from"@/hooks/useEditorSettings";
import { useTerminalSettings } from"@/hooks/useTerminalSettings";
import { useEditorTabs } from"@/hooks/useEditorTabs";
import { useFileExplorer } from"@/hooks/useFileExplorer";
import { useGitIntegration } from"@/hooks/useGitIntegration";
import { useGitHubIntegration } from"@/hooks/useGitHubIntegration";
import { useLearning, type LearningSubTab } from"@/hooks/useLearning";
import { useOpenCode } from"@/hooks/useOpenCode";
import { useSdkDoctor } from"@/hooks/useSdkDoctor";
import { useSerialMonitor } from"@/hooks/useSerialMonitor";
import { useTerminalManager } from"@/hooks/useTerminalManager";
import { useUploadSystem } from"@/hooks/useUploadSystem";
import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useShellLayout,
} from"@/hooks/useShellLayout";
import { useWorkspace } from"@/hooks/useWorkspace";
import {
  SPECIES_MAP,
  type AtmosphereTweaks,
  type SpeciesKey,
} from"@/lib/glyphAnimalsEngine";
import type { BuildDiagnostic, BuildOperation } from"@/types/build";
import { formatBoardDisplayLabel } from"@/types/board";
import type {
  CreateProjectFromExamplePayload,
  DocPageDetailResponse,
  ExampleDetailResponse,
  ExampleFileContentResponse,
  IdeActionId,
} from"@/types/learning";
import type { OpenCodeContextAttachment } from"@/types/opencode";
import type { CreateProjectPayload, WorkspaceSummary } from"@/types/project";
import type { ShellLogEntry } from"@/types/shell";

const SPECIES_STORAGE_KEY ="wild-tab:animal";
const TWEAKS_STORAGE_PREFIX ="wild-tab:tweaks: ";
const LEGACY_SPECIES_KEY ="vega-studio:ambient-species:v1";
const LEGACY_TWEAKS_PREFIX ="vega-studio:ambient-tweaks:v1: ";

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
    const raw =
      window.localStorage.getItem(`${TWEAKS_STORAGE_PREFIX}${species}`) ??
      window.localStorage.getItem(`${LEGACY_TWEAKS_PREFIX}${species}`);
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
    openSidebarSection,
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
  const monacoBridgeRef = useRef<MonacoEditorHandle | null>(null);
  const [species, setSpecies] = useState<SpeciesKey>("moths");
  const [tweaks, setTweaks] = useState<AtmosphereTweaks>(
    () => SPECIES_MAP.moths.defaults
  );
  const [atmosphereHydrated, setAtmosphereHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [forcedCount, setForcedCount] = useState<number | null>(null);
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("appearance");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [openProjectOpen, setOpenProjectOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [confirmUploadNonce, setConfirmUploadNonce] = useState(0);

  const [logs, setLogs] = useState<ShellLogEntry[]>(() => [
    createLogEntry(
      "SHELL",
      "info",
      "VEGA Studio workspace, file explorer & Monaco editor initialized."
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
  const terminalSettingsState = useTerminalSettings();
  const terminalAutoAttemptedRef = useRef(false);

  // Hydrate saved ambient species, URL params (?animal=, ?count=), and cross-tab sync
  const speciesRef = useRef<SpeciesKey>(species);
  useEffect(() => {
    speciesRef.current = species;
  }, [species]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      let loadedSpecies: SpeciesKey ="moths";
      let urlCount: number | null = null;
      try {
        const params = new URLSearchParams(window.location.search);
        const paramAnimal = params.get("animal");
        if (paramAnimal && paramAnimal in SPECIES_MAP) {
          loadedSpecies = paramAnimal as SpeciesKey;
        } else {
          const savedSpecies =
            window.localStorage.getItem(SPECIES_STORAGE_KEY) ??
            window.localStorage.getItem(LEGACY_SPECIES_KEY);
          if (savedSpecies && savedSpecies in SPECIES_MAP) {
            loadedSpecies = savedSpecies as SpeciesKey;
          }
        }
        const rawCount = params.get("count");
        if (rawCount !== null) {
          const n = Number(rawCount);
          if (Number.isFinite(n) && n >= 1) urlCount = n;
        }
      } catch {
        // Ignore storage / URL parsing errors.
      }
      setForcedCount(urlCount);
      setSpecies(loadedSpecies);
      setTweaks(loadSavedTweaks(loadedSpecies));
      setAtmosphereHydrated(true);
    });

    const onStorageSync = (e: StorageEvent) => {
      if (e.key === SPECIES_STORAGE_KEY && e.newValue && e.newValue in SPECIES_MAP) {
        const next = e.newValue as SpeciesKey;
        setSpecies(next);
        setTweaks(loadSavedTweaks(next));
      } else if (e.key && e.key.startsWith(TWEAKS_STORAGE_PREFIX)) {
        const keySpecies = e.key.slice(TWEAKS_STORAGE_PREFIX.length);
        if (keySpecies in SPECIES_MAP && keySpecies === speciesRef.current) {
          setTweaks(loadSavedTweaks(keySpecies as SpeciesKey));
        }
      }
    };
    window.addEventListener("storage", onStorageSync);

    return () => {
      active = false;
      window.removeEventListener("storage", onStorageSync);
    };
  }, []);

  // Persist species & tweaks (storing only diffs) and apply CSS glass tokens
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--blur", `${tweaks.blur}px`);
    root.style.setProperty("--tint", `${tweaks.tint}`);
    root.style.setProperty("--edge", `${tweaks.edge}`);

    if (!atmosphereHydrated) return;
    try {
      window.localStorage.setItem(SPECIES_STORAGE_KEY, species);
      const defaults = SPECIES_MAP[species].defaults;
      const diff: Partial<AtmosphereTweaks> = {};
      for (const k of Object.keys(tweaks) as Array<keyof AtmosphereTweaks>) {
        if (tweaks[k] !== defaults[k]) {
          (diff as Record<string, unknown>)[k] = tweaks[k];
        }
      }
      if (Object.keys(diff).length > 0) {
        window.localStorage.setItem(
          `${TWEAKS_STORAGE_PREFIX}${species}`,
          JSON.stringify(diff)
        );
      } else {
        window.localStorage.removeItem(`${TWEAKS_STORAGE_PREFIX}${species}`);
      }
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

  const buildSystem = useBuildSystem({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const boardManager = useBoardManager({
    activeProject: workspace.activeProject,
    isBackendConnected: isConnected,
    sdkConfigUpdatedAt: sdkDoctor.configState?.updated_at ?? null,
    onBoardChanged: async () => {
      await workspace.refreshWorkspace();
    },
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const uploadSystem = useUploadSystem({
    projectDir: workspace.activeProject?.project_dir ?? null,
    boardId: workspace.activeProject?.project.target.board ?? null,
    sdkConfigUpdatedAt: sdkDoctor.configState?.updated_at ?? null,
    latestBuildFinishedAt: buildSystem.latestBuild?.finished_at ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const serialMonitor = useSerialMonitor({
    isBackendConnected: isConnected,
    defaultPortHint: uploadSystem.selectedPort,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const terminalManager = useTerminalManager({
    activeProjectDir: workspace.activeProject?.project_dir ?? null,
    defaultProjectsDir: workspace.defaultProjectsDir || null,
    isBackendConnected: isConnected,
    hasElectronBrowse: workspace.isElectronBridge,
    onBrowseDirectory: async (title, defaultPath) => {
      const outcome = await workspace.browseDirectory(title, defaultPath);
      return outcome.supported && !outcome.canceled ? outcome.path : null;
    },
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  // Direct Terminal launch when entering Terminal tab with zero active sessions
  useEffect(() => {
    const isTerminalVisible =
      layout.activeMode === "workspace" &&
      layout.bottomPanelOpen &&
      layout.activeBottomTab === "terminal";

    if (!isTerminalVisible) {
      terminalAutoAttemptedRef.current = false;
      return;
    }

    if (
      !isConnected ||
      !terminalManager.initialLoaded ||
      !terminalManager.ptySupported ||
      terminalManager.sessions.length > 0 ||
      terminalManager.pendingAction ||
      terminalManager.error ||
      !terminalSettingsState.terminalSettings.autoLaunch ||
      terminalAutoAttemptedRef.current
    ) {
      return;
    }

    terminalAutoAttemptedRef.current = true;
    void terminalManager.createSession();
  }, [
    isConnected,
    layout.activeBottomTab,
    layout.activeMode,
    layout.bottomPanelOpen,
    terminalManager,
    terminalSettingsState.terminalSettings.autoLaunch,
  ]);

  const openGitDiffTab = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    editorTabs.setActiveFileTabPath(null);
    setMode("workspace");
    openCenterTab("git-diff");
  }, [editorTabs, openCenterTab, setMode]);

  const gitIntegration = useGitIntegration({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onOpenDiffTab: openGitDiffTab,
    onAfterWorkingTreeChange: async () => {
      await explorer.refreshAll();
      for (const tab of editorTabs.openFileTabs) {
        if (!tab.isDirty) {
          void editorTabs.reloadTabFromDisk(tab.uid);
        }
      }
    },
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const githubIntegration = useGitHubIntegration({
    projectDir: workspace.activeProject?.project_dir ?? null,
    enabled: isConnected,
    onRefreshGit: () => {
      void gitIntegration.refreshAll();
      void explorer.refreshAll();
      for (const tab of editorTabs.openFileTabs) {
        if (!tab.isDirty) {
          void editorTabs.reloadTabFromDisk(tab.uid);
        }
      }
    },
    onLog: (message) => appendLog("SHELL","info", message),
  });

  const openCodeAgent = useOpenCode({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
    onAfterSessionComplete: () => {
      void explorer.refreshAll();
      void gitIntegration.refreshAll();
      for (const tab of editorTabs.openFileTabs) {
        if (!tab.isDirty) {
          void editorTabs.reloadTabFromDisk(tab.uid);
        }
      }
    },
  });

  const registerEditorHandle = useCallback((h: MonacoEditorHandle | null) => {
    monacoBridgeRef.current = h;
  }, []);

  const sendContextToVegaAi = useCallback(
    (ctx: OpenCodeContextAttachment, suggestedPrompt?: string) => {
      openCodeAgent.addContext(ctx);
      if (suggestedPrompt && !openCodeAgent.draftPrompt.trim()) {
        openCodeAgent.setDraftPrompt(suggestedPrompt);
      }
      setComposerFocused(false);
      setSettingsOpen(false);
      setMode("workspace");
      setRightTab("opencode");
    },
    [openCodeAgent, setMode, setRightTab]
  );

  const handleExplainDiagnostic = useCallback(
    (diag: BuildDiagnostic) => {
      const location = diag.relative_path
        ? `${diag.relative_path}${diag.line ? `:${diag.line}` : ""}`
        : "Build Diagnostic";
      sendContextToVegaAi(
        {
          kind: "build_error",
          title: `${diag.severity.toUpperCase()} in ${location}`,
          relative_path: diag.relative_path,
          start_line: diag.line,
          end_line: diag.line,
          snippet: diag.raw_line || diag.message,
        },
        `Explain and help fix this ${diag.severity} for VEGA firmware: ${diag.message}`
      );
    },
    [sendContextToVegaAi]
  );

  const handleDebugBuildAi = useCallback(() => {
    const diags = buildSystem.diagnostics
      .slice(0, 10)
      .map(
        (d) =>
          `[${d.severity}] ${d.relative_path ?? d.file_path ?? "?"}:${d.line ?? "?"} ${d.message}`
      )
      .join("\n");
    const tailLog = buildSystem.logs
      .slice(-30)
      .map((l) => l.text)
      .join("\n");
    const snippet = [diags, tailLog].filter(Boolean).join("\n\n---\n").slice(0, 6500);
    sendContextToVegaAi(
      {
        kind: "build_error",
        title: `Build ${buildSystem.latestBuild?.status ?? "failure"} diagnostics`,
        snippet: snippet || "Build failed with no diagnostic lines captured.",
      },
      "Analyze this VEGA firmware build failure and suggest what to check or fix."
    );
  }, [sendContextToVegaAi, buildSystem.diagnostics, buildSystem.latestBuild, buildSystem.logs]);

  const handleAnalyzeSerialAi = useCallback(
    (recentLinesText: string, portLabel: string) => {
      sendContextToVegaAi(
        {
          kind: "serial_note",
          title: `Serial (${portLabel})`,
          snippet: recentLinesText,
        },
        `Analyze this USB-UART serial output from ${portLabel} on VEGA ARIES V3:`
      );
    },
    [sendContextToVegaAi]
  );

  const handleAnalyzeTerminalAi = useCallback(
    (selectedText: string, sessionLabel: string) => {
      sendContextToVegaAi(
        {
          kind: "selection",
          title: `Terminal: ${sessionLabel}`,
          snippet: selectedText,
        },
        "Analyze this selected terminal output in the context of our VEGA project: "
      );
    },
    [sendContextToVegaAi]
  );

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

  const openBoardManager = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    editorTabs.setActiveFileTabPath(null);
    setMode("workspace");
    selectNav("tools");
    openCenterTab("board-manager");
  }, [editorTabs, openCenterTab, selectNav, setMode]);

  const openUploadPanel = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    setMode("workspace");
    setBottomTab("upload");
    void uploadSystem.refreshDevicesAndPreflight();
  }, [setBottomTab, setMode, uploadSystem]);

  const openSerialMonitor = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    setMode("workspace");
    setBottomTab("serial");
    void serialMonitor.refreshDevices();
  }, [serialMonitor, setBottomTab, setMode]);

  const openTerminalPanel = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    setMode("workspace");
    setBottomTab("terminal");
  }, [setBottomTab, setMode]);

  const openSourceControl = useCallback(() => {
    setComposerFocused(false);
    setSettingsOpen(false);
    setMode("workspace");
    selectNav("git");
  }, [selectNav, setMode]);

  const triggerUploadPrompt = useCallback(() => {
    openUploadPanel();
    setConfirmUploadNonce((n) => n + 1);
  }, [openUploadPanel]);

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
    appendLog("LAYOUT","info","Restored default workspace layout.");
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

  const handleExampleProjectCreated = useCallback(
    async (summary: WorkspaceSummary) => {
      editorTabs.resetFileTabs();
      await workspace.refreshWorkspace();
      setMode("workspace");
      selectNav("explorer");
      openCenterTab("overview");
      appendLog(
        "SHELL",
        "info",
        `Created & opened project '${summary.project.name}' from firmware example.`
      );
    },
    [appendLog, editorTabs, openCenterTab, selectNav, setMode, workspace]
  );

  const learning = useLearning({
    isBackendConnected: isConnected,
    activeProjectDir: workspace.activeProject?.project_dir ?? null,
    activeBoardId:
      boardManager.activeProjectBoardId ??
      workspace.activeProject?.project.target.board ??
      "VEGA_ARIES_V3",
    sdkConfigUpdatedAt: sdkDoctor.configState?.updated_at ?? null,
    onProjectCreated: handleExampleProjectCreated,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const anyBlockingModalOpen =
    settingsOpen ||
    commandPaletteOpen ||
    newProjectOpen ||
    openProjectOpen ||
    Boolean(editorTabs.unsavedPrompt) ||
    Boolean(gitIntegration.confirmDialog) ||
    Boolean(githubIntegration.confirmDialog) ||
    Boolean(learning.createModalExample);

  const shortcutCtxRef = useRef({
    activeMode: layout.activeMode,
    activeFileTabPath: editorTabs.activeFileTabPath,
    anyBlockingModalOpen,
    settingsOpen,
    hasOtherModal:
      commandPaletteOpen ||
      newProjectOpen ||
      openProjectOpen ||
      Boolean(editorTabs.unsavedPrompt) ||
      Boolean(gitIntegration.confirmDialog) ||
      Boolean(githubIntegration.confirmDialog) ||
      Boolean(learning.createModalExample),
    saveTab: editorTabs.saveTab,
    toggleSidebar,
    toggleBottomPanel,
    toggleRightPanel,
    selectNav,
    clearWorkspaceFeedback: workspace.clearFeedback,
  });

  useEffect(() => {
    shortcutCtxRef.current = {
      activeMode: layout.activeMode,
      activeFileTabPath: editorTabs.activeFileTabPath,
      anyBlockingModalOpen,
      settingsOpen,
      hasOtherModal:
        commandPaletteOpen ||
        newProjectOpen ||
        openProjectOpen ||
        Boolean(editorTabs.unsavedPrompt) ||
        Boolean(gitIntegration.confirmDialog) ||
        Boolean(githubIntegration.confirmDialog) ||
        Boolean(learning.createModalExample),
      saveTab: editorTabs.saveTab,
      toggleSidebar,
      toggleBottomPanel,
      toggleRightPanel,
      selectNav,
      clearWorkspaceFeedback: workspace.clearFeedback,
    };
  });

  // Global keyboard shortcuts for Command Center, shell navigation, save & settings
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctx = shortcutCtxRef.current;
      const target = event.target as HTMLElement | null;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (!mod) return;
      if (target?.closest(".xterm")) return;

      if (key === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      const isMonaco = Boolean(target?.closest(".monaco-editor"));
      const isFormControl =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        Boolean(target?.isContentEditable);

      if (key === "s" && !event.shiftKey && !event.altKey) {
        if (
          !isMonaco &&
          !isFormControl &&
          !ctx.anyBlockingModalOpen &&
          ctx.activeMode === "workspace" &&
          ctx.activeFileTabPath
        ) {
          event.preventDefault();
          void ctx.saveTab(ctx.activeFileTabPath);
        }
        return;
      }

      if (key === "," && !event.shiftKey && !event.altKey) {
        if (!ctx.hasOtherModal) {
          event.preventDefault();
          setSettingsOpen((prev) => !prev);
        }
        return;
      }

      if (ctx.anyBlockingModalOpen) return;
      if (isFormControl && !isMonaco) return;

      if (key === "\\" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.toggleSidebar();
      } else if (key === "j" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.toggleBottomPanel();
      } else if (key === "a" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.toggleRightPanel();
      } else if (key === "e" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.selectNav("explorer");
      } else if (key === "g" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.selectNav("git");
      } else if (key === "o" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        ctx.clearWorkspaceFeedback();
        setOpenProjectOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openExamplesLibrary = useCallback(
    (tab: LearningSubTab ="examples") => {
      setComposerFocused(false);
      setSettingsOpen(false);
      editorTabs.setActiveFileTabPath(null);
      learning.setSubTab(tab);
      setMode("workspace");
      selectNav("examples");
      openCenterTab("examples-docs");
    },
    [editorTabs, learning, openCenterTab, selectNav, setMode]
  );

  const handleSubmitCreateFromExample = useCallback(
    async (payload: CreateProjectFromExamplePayload): Promise<boolean> => {
      if (workspace.activeProject && editorTabs.dirtyCount > 0) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save changes before creating a project? ",
          description:
            "Open editor tabs contain unsaved changes. Save them before switching to the new example project? ",
          confirmSaveLabel: "Save All & Create",
          confirmDiscardLabel: "Discard & Create",
        });
        if (!proceed) {
          return false;
        }
      }
      return learning.submitCreateProject(payload);
    },
    [editorTabs, learning, workspace.activeProject]
  );

  const handleRunIdeAction = useCallback(
    (actionId: IdeActionId) => {
      if (actionId === "new_project") {
        openNewProjectDialog();
      } else if (actionId === "open_project") {
        openOpenProjectDialog();
      } else if (actionId === "open_sdk_doctor") {
        openSdkDoctor();
      } else if (actionId === "open_sdk_settings") {
        openSettingsCategory("sdk");
      } else if (actionId === "open_board_manager") {
        openBoardManager();
      } else if (actionId === "open_build") {
        setMode("workspace");
        setBottomTab("build");
      } else if (actionId === "open_upload") {
        openUploadPanel();
      } else if (actionId === "open_serial") {
        openSerialMonitor();
      } else if (actionId === "open_terminal") {
        openTerminalPanel();
      } else if (actionId === "open_git") {
        openSourceControl();
      } else if (actionId === "open_native_ai" || actionId === "open_opencode") {
        setMode("workspace");
        setRightTab("opencode");
      } else if (actionId === "open_examples") {
        openExamplesLibrary("examples");
      }
    },
    [
      openBoardManager,
      openExamplesLibrary,
      openNewProjectDialog,
      openOpenProjectDialog,
      openSdkDoctor,
      openSerialMonitor,
      openSettingsCategory,
      openSourceControl,
      openTerminalPanel,
      openUploadPanel,
      setBottomTab,
      setMode,
      setRightTab,
    ]
  );

  const handleAskAiAboutExample = useCallback(
    (
      detail: ExampleDetailResponse,
      fileContent: ExampleFileContentResponse | null
    ) => {
      const header = [
        `Example: ${detail.example.title} (${detail.example.id})`,
        `Verification Status: ${detail.example.verification_status}`,
        `Note: ${detail.example.verification_note}`,
        `Boards: ${detail.example.compatible_boards.join(",")}`,
      ].join("\n");
      const body = fileContent
        ? `\n\n--- ${fileContent.relative_path} ---\n${fileContent.content}`
        : detail.readme_content
        ? `\n\n--- README.md ---\n${detail.readme_content}`
        : "";
      const combined = `${header}${body}`;
      const truncated = combined.length > 5800;
      sendContextToVegaAi(
        {
          kind: "file",
          title: fileContent
            ? `Example: ${detail.example.title} (${fileContent.relative_path})`
            : `Example: ${detail.example.title}`,
          relative_path: fileContent?.relative_path ?? null,
          language: fileContent?.language ?? null,
          snippet: truncated ? combined.slice(0, 5800) : combined,
          truncated: truncated || Boolean(fileContent?.truncated),
        },
        `Explain how this VEGA firmware example works and how to adapt it safely for VEGA ARIES V3:`
      );
    },
    [sendContextToVegaAi]
  );

  const handleAskAiAboutDoc = useCallback(
    (detail: DocPageDetailResponse) => {
      const truncated = detail.markdown_content.length > 5800;
      sendContextToVegaAi(
        {
          kind: "file",
          title: `Docs: ${detail.doc.title}`,
          snippet: truncated
            ? detail.markdown_content.slice(0, 5800)
            : detail.markdown_content,
          truncated,
        },
        `Summarize key takeaways from "${detail.doc.title}" and help apply it to my VEGA firmware project:`
      );
    },
    [sendContextToVegaAi]
  );

  const handleAskAiAboutSnippet = useCallback(
    (snippet: string, title: string, language?: string) => {
      const truncated = snippet.length > 5000;
      sendContextToVegaAi(
        {
          kind: "selection",
          title,
          language: language ?? null,
          snippet: truncated ? snippet.slice(0, 5000) : snippet,
          truncated,
        },
        "Explain this code snippet from the VEGA Studio documentation: "
      );
    },
    [sendContextToVegaAi]
  );

  const handleCreateProject = useCallback(
    async (payload: CreateProjectPayload) => {
      if (workspace.activeProject) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save changes before creating a project? ",
          description:
            "Open editor tabs contain unsaved changes. Save them before switching to the new project? ",
          confirmSaveLabel: "Save All & Create",
          confirmDiscardLabel: "Discard & Create",
        });
        if (!proceed) {
          throw new Error("Project creation canceled.");
        }
      }
      await workspace.createNewProject(payload);
      editorTabs.resetFileTabs();
      openSidebarSection("explorer");
      openCenterTab("overview");
    },
    [editorTabs, openCenterTab, openSidebarSection, workspace]
  );

  const handleOpenProjectDir = useCallback(
    async (projectDir: string) => {
      if (
        workspace.activeProject &&
        workspace.activeProject.project_dir !== projectDir
      ) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save changes before switching projects? ",
          description:
            "Open editor tabs contain unsaved changes. Save them before switching to another project? ",
          confirmSaveLabel: "Save All & Switch",
          confirmDiscardLabel: "Discard & Switch",
        });
        if (!proceed) {
          throw new Error("Project switch canceled.");
        }
      }
      await workspace.openExistingProject(projectDir);
      editorTabs.resetFileTabs();
      openSidebarSection("explorer");
      openCenterTab("overview");
    },
    [editorTabs, openCenterTab, openSidebarSection, workspace]
  );

  const handleCloseProject = useCallback(async () => {
    const proceed = await editorTabs.confirmWorkspaceTransition({
      title: "Save changes before closing workspace? ",
      description:
        "Open editor tabs contain unsaved changes. Save them before closing the active workspace? ",
      confirmSaveLabel: "Save All & Close",
      confirmDiscardLabel: "Discard & Close",
    });
    if (!proceed) return;
    editorTabs.resetFileTabs();
    await workspace.closeActiveWorkspace();
  }, [editorTabs, workspace]);

  const handleBuildOperation = useCallback(
    async (operation: BuildOperation) => {
      if (
        (operation === "build" || operation === "rebuild") &&
        editorTabs.dirtyCount > 0
      ) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save modified files before building? ",
          description:
            "Open editor tabs contain unsaved modifications. Save them so Make compiles your latest edits? ",
          confirmSaveLabel: "Save All & Build",
          confirmDiscardLabel: "Build Saved Copy",
        });
        if (!proceed) return;
      }
      setBottomTab("build");
      void buildSystem.runOperation(operation);
    },
    [buildSystem, editorTabs, setBottomTab]
  );

  const handleOpenDiagnosticLocation = useCallback(
    (relativePath: string, line: number, column?: number) => {
      explorer.setSelectedPath(relativePath);
      editorTabs.openFileAtLocation(relativePath, line, column);
      setMode("workspace");
    },
    [editorTabs, explorer, setMode]
  );

  const activeProjectName = workspace.activeProject?.project.name ?? null;
  const activeFileTab = editorTabs.activeFileTabPath
    ? editorTabs.openFileTabs.find(
        (tab) => tab.path === editorTabs.activeFileTabPath
      ) ?? null
    : null;

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => {
    const acts: CommandPaletteAction[] = [
      {
        id: "mode-home",
        category: "View",
        label: "Switch to Home (Glyph Animals & Composer)",
        keywords: "home new tab canvas welcome",
        run: () => setMode("home"),
      },
      {
        id: "mode-workspace",
        category: "View",
        label: "Switch to Code Workspace",
        keywords: "workspace editor ide panes",
        run: () => setMode("workspace"),
      },
      {
        id: "new-project",
        category: "Project",
        label: "New VEGA Project...",
        keywords: "create firmware aries v3",
        run: openNewProjectDialog,
      },
      {
        id: "open-project",
        category: "Project",
        label: "Open VEGA Project...",
        shortcut: "Ctrl+Shift+O",
        keywords: "folder browse directory",
        run: openOpenProjectDialog,
      },
      {
        id: "open-examples",
        category: "Learn",
        label: "Examples & Offline Documentation",
        keywords: "templates guides vega aries v3",
        run: () => openExamplesLibrary("examples"),
      },
      {
        id: "open-boards",
        category: "Hardware",
        label: "Open Board Manager",
        keywords: "aries v3 target specs",
        run: openBoardManager,
      },
      {
        id: "open-sdk-doctor",
        category: "Toolchain",
        label: "Open SDK & Toolchain Doctor",
        keywords: "gcc riscv make python xmodem",
        run: openSdkDoctor,
      },
      {
        id: "open-vega-ai",
        category: "AI",
        label: "Open VEGA AI",
        shortcut: "Ctrl+Shift+A",
        keywords: "ai chat assistant opencode",
        run: () => {
          setMode("workspace");
          setRightTab("opencode");
        },
      },
      {
        id: "open-terminal",
        category: "Panel",
        label: "Open Integrated Terminal",
        keywords: "shell bash powershell pty",
        run: openTerminalPanel,
      },
      {
        id: "open-serial",
        category: "Panel",
        label: "Open UART Serial Monitor",
        keywords: "com ttyUSB baud console",
        run: openSerialMonitor,
      },
      {
        id: "open-git",
        category: "Git",
        label: "Open Source Control",
        shortcut: "Ctrl+Shift+G",
        keywords: "commit branch diff github",
        run: openSourceControl,
      },
      {
        id: "open-diagnostics",
        category: "System",
        label: "Inspect Backend Health & Diagnostics",
        keywords: "status logs health",
        run: () => {
          editorTabs.setActiveFileTabPath(null);
          openCenterTab("diagnostics");
        },
      },
      {
        id: "open-settings",
        category: "Settings",
        label: "Open IDE & Appearance Settings",
        shortcut: "Ctrl+,",
        keywords: "preferences fonts terminal ai sdk",
        run: () => setSettingsOpen(true),
      },
    ];

    if (activeProjectName && isConnected) {
      acts.push(
        {
          id: "build-firmware",
          category: "Build",
          label: `Build ${activeProjectName} (Make)`,
          keywords: "compile firmware elf bin",
          run: () => void handleBuildOperation("build"),
        },
        {
          id: "upload-firmware",
          category: "Upload",
          label: `Flash / Upload Firmware to ${activeProjectName}`,
          keywords: "xmodem flash serial board",
          run: triggerUploadPrompt,
        }
      );
    }

    for (const r of workspace.recentProjects.filter((x) => x.exists).slice(0, 5)) {
      acts.push({
        id: `recent-${r.project_dir}`,
        category: "Recent",
        label: `Open Project: ${r.name}`,
        keywords: r.project_dir,
        run: () => void handleOpenProjectDir(r.project_dir).catch(() => {}),
      });
    }

    return acts;
  }, [
    activeProjectName,
    editorTabs,
    handleBuildOperation,
    handleOpenProjectDir,
    isConnected,
    openBoardManager,
    openCenterTab,
    openExamplesLibrary,
    openNewProjectDialog,
    openOpenProjectDialog,
    openSdkDoctor,
    openSerialMonitor,
    openSourceControl,
    openTerminalPanel,
    setMode,
    setRightTab,
    triggerUploadPrompt,
    workspace.recentProjects,
  ]);

  return (
    <div
      data-mode={layout.activeMode}
      className={`relative flex h-screen w-screen flex-col overflow-hidden text-[#F4F4F5] ${
        layout.activeMode === "workspace" ? "bg-[#181818]" : "bg-[#06070c]"
      }`}
    >
      <LiquidGlassFilter
        refraction={tweaks.refraction}
        ripple={tweaks.ripple}
      />

      {/* Persistent animated Glyph Animals canvas shared across Home & Workspace */}
      <GlyphAnimalsCanvas
        ref={canvasRef}
        species={species}
        tweaks={tweaks}
        forcedCount={forcedCount}
        dimmed={
          composerFocused ||
          commandPaletteOpen ||
          settingsOpen ||
          newProjectOpen ||
          openProjectOpen
        }
        workspaceMode={layout.activeMode === "workspace"}
      />

      <AppToolbar
        activeMode={layout.activeMode}
        activeProjectName={activeProjectName}
        activeBoardLabel={
          activeProjectName
            ? boardManager.activeProjectBoardId
              ? formatBoardDisplayLabel(
                  boardManager.projectBoardStatus?.board?.name,
                  boardManager.activeProjectBoardId,
                  { short: true }
                )
              : "No Board"
            : "ARIES V3"
        }
        boardSupported={
          boardManager.projectBoardStatus?.board_supported ??
          Boolean(
            boardManager.activeProjectBoardId &&
              boardManager.boards.some(
                (b) => b.id === boardManager.activeProjectBoardId
              )
          )
        }
        isBuilding={buildSystem.isBuilding}
        isUploading={uploadSystem.isUploading}
        isSerialConnected={serialMonitor.isConnected}
        serialPort={serialMonitor.activePort}
        selectedPort={uploadSystem.selectedPort}
        isBackendConnected={isConnected}
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
        onBuildAction={(op) => void handleBuildOperation(op)}
        onCancelBuild={() => void buildSystem.cancelActive()}
        onUploadAction={triggerUploadPrompt}
        onCancelUpload={() => void uploadSystem.cancelActive()}
        onOpenBoardManager={openBoardManager}
        onOpenSdkDoctor={openSdkDoctor}
        onOpenExamples={() => openExamplesLibrary("examples")}
        onOpenUploadPanel={openUploadPanel}
        onOpenSerialMonitor={openSerialMonitor}
        onOpenTerminal={openTerminalPanel}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
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
                } else if (section === "tools") {
                  openBoardManager();
                } else if (section === "examples") {
                  openExamplesLibrary("examples");
                } else {
                  setMode("workspace");
                  selectNav(section);
                }
              }}
              onOpenBottomTab={(tab) => {
                setComposerFocused(false);
                setBottomTab(tab);
              }}
              onAskAiPrompt={(prompt) => {
                setComposerFocused(false);
                setMode("workspace");
                setRightTab("opencode");
                if (prompt) {
                  openCodeAgent.setDraftPrompt(prompt);
                }
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
                    onCreateEntry: async (...args) => {
                      const res = await explorer.createEntry(...args);
                      void gitIntegration.refreshAll();
                      return res;
                    },
                    onRenameEntry: async (...args) => {
                      const res = await explorer.renameEntry(...args);
                      void gitIntegration.refreshAll();
                      return res;
                    },
                    onDeleteEntry: async (...args) => {
                      const res = await explorer.deleteEntry(...args);
                      void gitIntegration.refreshAll();
                      return res;
                    },
                    onClearFeedback: explorer.clearFeedback,
                  }}
                  gitPanelProps={{
                    activeProject: workspace.activeProject,
                    isBackendConnected: isConnected,
                    info: gitIntegration.info,
                    status: gitIntegration.status,
                    branches: gitIntegration.branches,
                    commits: gitIntegration.commits,
                    historyHasMore: gitIntegration.historyHasMore,
                    commitMessage: gitIntegration.commitMessage,
                    loading: gitIntegration.loading,
                    loadingMoreHistory: gitIntegration.loadingMoreHistory,
                    actionPending: gitIntegration.actionPending,
                    error: gitIntegration.error,
                    notice: gitIntegration.notice,
                    onRefresh: () => void gitIntegration.refreshAll(),
                    onInitRepo: () => void gitIntegration.initRepository(),
                    onCommitMessageChange: gitIntegration.setCommitMessage,
                    onCommit: () => void gitIntegration.commitStaged(),
                    onStagePaths: (paths) =>
                      void gitIntegration.stagePaths(paths),
                    onStageAll: () => void gitIntegration.stageAll(),
                    onUnstagePaths: (paths) =>
                      void gitIntegration.unstagePaths(paths),
                    onUnstageAll: () => void gitIntegration.unstageAll(),
                    onDiscardPaths: gitIntegration.requestDiscard,
                    onDeleteUntrackedPaths:
                      gitIntegration.requestDeleteUntracked,
                    onSwitchBranch: (name) =>
                      void gitIntegration.requestSwitchBranch(name),
                    onCreateBranch: gitIntegration.createBranch,
                    onOpenFileDiff: (path, staged) =>
                      void gitIntegration.openFileDiff(path, { staged }),
                    onOpenCommitDetail: (hash) =>
                      void gitIntegration.openCommitDetail(hash),
                    onLoadMoreHistory: () =>
                      void gitIntegration.loadMoreHistory(),
                    onClearFeedback: gitIntegration.clearFeedback,
                    onOpenProject: openOpenProjectDialog,
                    githubProps: {
                      status: githubIntegration.status,
                      loading: githubIntegration.loading,
                      actionPending: githubIntegration.actionPending,
                      error: githubIntegration.error,
                      notice: githubIntegration.notice,
                      remoteRepoDetail: githubIntegration.remoteRepoDetail,
                      loadingRemoteRepoDetail:
                        githubIntegration.loadingRemoteRepoDetail,
                      onClearFeedback: githubIntegration.clearFeedback,
                      onRefreshStatus: () =>
                        void githubIntegration.refreshStatus(),
                      onSignInWithGitHub: (proto) =>
                        void githubIntegration.signInWithGitHub(proto),
                      onCancelOperation: () =>
                        void githubIntegration.cancelOperation(),
                      onAddRemote: githubIntegration.addRemote,
                      onRequestUpdateRemote:
                        githubIntegration.requestUpdateRemote,
                      onRequestRemoveRemote:
                        githubIntegration.requestRemoveRemote,
                      onRequestCreateRepo:
                        githubIntegration.requestCreateRepo,
                      onRequestPublish: () =>
                        void githubIntegration.requestPublish(),
                      onFetchRemote: (remote) =>
                        void githubIntegration.fetchRemote(remote),
                      onRequestPull: (remote) =>
                        void githubIntegration.requestPull(remote),
                      onRequestPush: (remote) =>
                        void githubIntegration.requestPush(remote),
                      onInspectRemoteInfo: (remote) =>
                        void githubIntegration.inspectRemoteInfo(remote),
                    },
                  }}
                  examplesSidebarProps={{
                    subTab: learning.subTab,
                    onChangeSubTab: learning.setSubTab,
                    onOpenCenterLibrary: (tab) =>
                      openExamplesLibrary(tab ?? learning.subTab),
                    exampleCatalog: learning.exampleCatalog,
                    filteredExamples: learning.filteredExamples,
                    exampleSearch: learning.exampleSearch,
                    onExampleSearchChange: learning.setExampleSearch,
                    selectedExampleId: learning.selectedExampleId,
                    onSelectExample: (id) => void learning.selectExample(id),
                    onCreateFromExample: learning.openCreateProjectModal,
                    docCatalog: learning.docCatalog,
                    filteredDocs: learning.filteredDocs,
                    docSearch: learning.docSearch,
                    onDocSearchChange: learning.setDocSearch,
                    selectedDocSlug: learning.selectedDocSlug,
                    onSelectDoc: (slug) => void learning.selectDoc(slug),
                    loading: learning.loadingExamples || learning.loadingDocs,
                    error: learning.error,
                    onClearError: learning.clearError,
                    onRefresh: () => void learning.refreshCatalogs(),
                    isBackendConnected: isConnected,
                  }}
                  sdkReport={sdkDoctor.report}
                  sdkRunning={sdkDoctor.runningDiagnostics}
                  boardStatus={boardManager.projectBoardStatus}
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
                  onOpenBoardManager={openBoardManager}
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
                  pendingReveal={editorTabs.pendingReveal}
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
                  boardManagerProps={{
                    isBackendConnected: isConnected,
                    activeProject: workspace.activeProject,
                    boards: boardManager.boards,
                    inspectedBoard: boardManager.inspectedBoard,
                    inspectedCompatibility: boardManager.inspectedCompatibility,
                    projectBoardStatus: boardManager.projectBoardStatus,
                    loadingBoards: boardManager.loadingBoards,
                    loadingStatus: boardManager.loadingStatus,
                    validatingCompatibility:
                      boardManager.validatingCompatibility,
                    selectingBoard: boardManager.selectingBoard,
                    error: boardManager.error,
                    feedback: boardManager.feedback,
                    onInspectBoard: boardManager.inspectBoard,
                    onRefresh: boardManager.refreshAll,
                    onValidateCompatibility:
                      boardManager.checkCompatibilityForBoard,
                    onSelectBoard: boardManager.applyBoardToProject,
                    onOpenSdkDoctor: openSdkDoctor,
                    onClearMessages: boardManager.clearMessages,
                  }}
                  gitDiffProps={{
                    activeDiff: gitIntegration.activeDiff,
                    activeCommit: gitIntegration.activeCommit,
                    inspectLoading: gitIntegration.inspectLoading,
                    inspectError: gitIntegration.inspectError,
                    onSelectCommitFile: (path, commitHash) =>
                      void gitIntegration.openFileDiff(path, {
                        commit: commitHash,
                        keepCommitOpen: true,
                      }),
                    onOpenFileInEditor: (relativePath) => {
                      explorer.setSelectedPath(relativePath);
                      editorTabs.openFileAtLocation(relativePath, 1, 1);
                    },
                  }}
                  examplesDocsProps={{
                    subTab: learning.subTab,
                    onChangeSubTab: learning.setSubTab,
                    activeBoardId: boardManager.activeProjectBoardId,
                    isBackendConnected: isConnected,
                    exampleCatalog: learning.exampleCatalog,
                    filteredExamples: learning.filteredExamples,
                    exampleSearch: learning.exampleSearch,
                    onExampleSearchChange: learning.setExampleSearch,
                    exampleCategory: learning.exampleCategory,
                    onExampleCategoryChange: learning.setExampleCategory,
                    boardFilterOnly: learning.boardFilterOnly,
                    onBoardFilterOnlyChange: learning.setBoardFilterOnly,
                    selectedExampleId: learning.selectedExampleId,
                    selectedExampleDetail: learning.selectedExampleDetail,
                    selectedFileRelPath: learning.selectedFileRelPath,
                    selectedFileContent: learning.selectedFileContent,
                    loadingExampleDetail: learning.loadingExampleDetail,
                    loadingFilePreview: learning.loadingFilePreview,
                    onSelectExample: (id) => void learning.selectExample(id),
                    onPreviewExampleFile: (id, rel) =>
                      void learning.previewExampleFile(id, rel),
                    onOpenCreateModal: learning.openCreateProjectModal,
                    docCatalog: learning.docCatalog,
                    filteredDocs: learning.filteredDocs,
                    docSearch: learning.docSearch,
                    onDocSearchChange: learning.setDocSearch,
                    docCategory: learning.docCategory,
                    onDocCategoryChange: learning.setDocCategory,
                    docSearchResults: learning.docSearchResults,
                    searchingDocs: learning.searchingDocs,
                    selectedDocSlug: learning.selectedDocSlug,
                    selectedDocDetail: learning.selectedDocDetail,
                    loadingDocDetail: learning.loadingDocDetail,
                    onSelectDoc: (slug) => void learning.selectDoc(slug),
                    error: learning.error,
                    onClearError: learning.clearError,
                    onRefresh: () => void learning.refreshCatalogs(),
                    onRunIdeAction: handleRunIdeAction,
                    onAskAiAboutExample: handleAskAiAboutExample,
                    onAskAiAboutDoc: handleAskAiAboutDoc,
                    onAskAiAboutSnippet: handleAskAiAboutSnippet,
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
                    void editorTabs
                      .saveTab(uidOrPath, { overwriteConflict })
                      .then(() => gitIntegration.refreshAll())
                  }
                  onSaveAllFileTabs={() =>
                    void editorTabs
                      .saveAllDirtyTabs()
                      .then(() => gitIntegration.refreshAll())
                  }
                  onReloadFileTab={(uid) =>
                    void editorTabs.reloadTabFromDisk(uid)
                  }
                  onDirtyChange={editorTabs.setTabDirty}
                  onCursorChange={editorTabs.setCursorPosition}
                  onConsumeReveal={editorTabs.consumeReveal}
                  onUpdateEditorSettings={editorSettings.updateSettings}
                  onOpenSettings={() => openSettingsCategory("editor")}
                  onNewProject={openNewProjectDialog}
                  onOpenProject={openOpenProjectDialog}
                  onCloseProject={() => void handleCloseProject()}
                  onToggleSidebar={toggleSidebar}
                  onToggleBottomPanel={toggleBottomPanel}
                  onToggleRightPanel={toggleRightPanel}
                  onOpenHome={() => setMode("home")}
                  onSendContextToAI={sendContextToVegaAi}
                  onRegisterEditorHandle={registerEditorHandle}
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
                    buildPanelProps={{
                      hasActiveProject: Boolean(workspace.activeProject),
                      isBackendConnected: isConnected,
                      activeBuild: buildSystem.activeBuild,
                      latestBuild: buildSystem.latestBuild,
                      logs: buildSystem.logs,
                      history: buildSystem.history,
                      buildMode: buildSystem.buildMode,
                      customTarget: buildSystem.customTarget,
                      pendingAction: buildSystem.pendingAction,
                      error: buildSystem.error,
                      onModeChange: buildSystem.setBuildMode,
                      onTargetChange: buildSystem.setCustomTarget,
                      onRunOperation: (op) => void handleBuildOperation(op),
                      onCancel: () => void buildSystem.cancelActive(),
                      onClearOutput: () => void buildSystem.clearOutput(),
                      onClearHistory: () => void buildSystem.clearHistory(),
                      onClearError: buildSystem.clearError,
                      onOpenDiagnosticsTab: () => setBottomTab("diagnostics"),
                      onOpenSdkDoctor: openSdkDoctor,
                      onOpenBoardManager: openBoardManager,
                      onDebugWithNativeAi: handleDebugBuildAi,
                    }}
                    terminalPanelProps={{
                      isBackendConnected: isConnected,
                      activeProjectDir:
                        workspace.activeProject?.project_dir ?? null,
                      defaultProjectsDir: workspace.defaultProjectsDir,
                      hasElectronBrowse: terminalManager.hasElectronBrowse,
                      shells: terminalManager.shells,
                      selectedShellId: terminalManager.selectedShellId,
                      ptySupported: terminalManager.ptySupported,
                      ptyBackend: terminalManager.ptyBackend,
                      ptyMessage: terminalManager.ptyMessage,
                      maxSessions: terminalManager.maxSessions,
                      sessions: terminalManager.sessions,
                      activeSessionId: terminalManager.activeSessionId,
                      activeSession: terminalManager.activeSession,
                      pendingAction: terminalManager.pendingAction,
                      loading: terminalManager.loading,
                      initialLoaded: terminalManager.initialLoaded,
                      error: terminalManager.error,
                      terminalSettings: terminalSettingsState.terminalSettings,
                      onSelectShell: terminalManager.setSelectedShellId,
                      onSelectSession: terminalManager.setActiveSessionId,
                      onCreateSession: () =>
                        void terminalManager.createSession(),
                      onCreateInFolder: () =>
                        void terminalManager.createSessionWithFolderPicker(),
                      onCloseSession: (id) =>
                        void terminalManager.closeSession(id),
                      onRestartSession: (id) =>
                        void terminalManager.restartSession(id),
                      onClearReplay: (id) =>
                        void terminalManager.clearReplayBuffer(id),
                      onRefreshState: () =>
                        void terminalManager.refreshState(),
                      onSyncSession: terminalManager.syncSessionSummary,
                      onUpdateCwd: terminalManager.updateSessionCwd,
                      onClearError: terminalManager.clearError,
                      onAnalyzeSelectionInAi: handleAnalyzeTerminalAi,
                      onOpenTerminalSettings: () =>
                        openSettingsCategory("terminal"),
                    }}
                    uploadPanelProps={{
                      hasActiveProject: Boolean(workspace.activeProject),
                      isBackendConnected: isConnected,
                      deviceInfo: uploadSystem.deviceInfo,
                      devices: uploadSystem.devices,
                      preflight: uploadSystem.preflight,
                      selectedPort: uploadSystem.selectedPort,
                      selectedArtifactPath: uploadSystem.selectedArtifactPath,
                      invocationMode: uploadSystem.invocationMode,
                      activeUpload: uploadSystem.activeUpload,
                      latestUpload: uploadSystem.latestUpload,
                      logs: uploadSystem.logs,
                      history: uploadSystem.history,
                      refreshingDevices: uploadSystem.refreshingDevices,
                      runningPreflight: uploadSystem.runningPreflight,
                      pendingAction: uploadSystem.pendingAction,
                      error: uploadSystem.error,
                      confirmNonce: confirmUploadNonce,
                      onSelectPort: uploadSystem.updatePort,
                      onSelectArtifact: uploadSystem.updateArtifactPath,
                      onSelectMode: uploadSystem.updateInvocationMode,
                      onRefreshDevices: () =>
                        void uploadSystem.refreshDevicesAndPreflight(),
                      onRunPreflight: () =>
                        void uploadSystem.runPreflightCheck(),
                      onStartUpload: uploadSystem.startUpload,
                      onCancel: () => void uploadSystem.cancelActive(),
                      onClearOutput: () => void uploadSystem.clearOutput(),
                      onClearHistory: () => void uploadSystem.clearHistory(),
                      onClearError: uploadSystem.clearError,
                      onTriggerBuild: () => void handleBuildOperation("build"),
                      onOpenSdkDoctor: openSdkDoctor,
                      onOpenBoardManager: openBoardManager,
                    }}
                    serialPanelProps={{
                      isBackendConnected: isConnected,
                      status: serialMonitor.status,
                      pyserialAvailable: serialMonitor.pyserialAvailable,
                      deviceInfo: serialMonitor.deviceInfo,
                      devices: serialMonitor.devices,
                      selectedPort: serialMonitor.selectedPort,
                      activePort: serialMonitor.activePort,
                      baudRate: serialMonitor.baudRate,
                      dataBits: serialMonitor.dataBits,
                      parity: serialMonitor.parity,
                      stopBits: serialMonitor.stopBits,
                      lineEnding: serialMonitor.lineEnding,
                      showTimestamps: serialMonitor.showTimestamps,
                      autoScroll: serialMonitor.autoScroll,
                      sendText: serialMonitor.sendText,
                      txHistory: serialMonitor.txHistory,
                      logs: serialMonitor.logs,
                      truncatedLogs: serialMonitor.truncatedLogs,
                      rxCount: serialMonitor.rxCount,
                      txCount: serialMonitor.txCount,
                      refreshingDevices: serialMonitor.refreshingDevices,
                      connecting: serialMonitor.connecting,
                      disconnecting: serialMonitor.disconnecting,
                      sending: serialMonitor.sending,
                      error: serialMonitor.error,
                      onSelectPort: serialMonitor.updatePort,
                      onChangeBaudRate: serialMonitor.updateBaudRate,
                      onChangeDataBits: serialMonitor.updateDataBits,
                      onChangeParity: serialMonitor.updateParity,
                      onChangeStopBits: serialMonitor.updateStopBits,
                      onChangeLineEnding: serialMonitor.updateLineEnding,
                      onToggleTimestamps: serialMonitor.toggleTimestamps,
                      onAutoScrollChange: serialMonitor.setAutoScroll,
                      onSendTextChange: serialMonitor.setSendText,
                      onRefreshDevices: () => void serialMonitor.refreshDevices(),
                      onConnect: () => void serialMonitor.connect(),
                      onDisconnect: () => void serialMonitor.disconnect(),
                      onSend: () => void serialMonitor.send(),
                      onClearOutput: () => void serialMonitor.clearOutput(),
                      onClearError: serialMonitor.clearError,
                      onOpenSdkDoctor: openSdkDoctor,
                      onAnalyzeSerialInAi: handleAnalyzeSerialAi,
                    }}
                    buildDiagnostics={buildSystem.diagnostics}
                    onSelectTab={setBottomTab}
                    onToggleMaximize={toggleBottomPanelMaximized}
                    onCollapse={toggleBottomPanel}
                    onClearLogs={() => setLogs([])}
                    onOpenDiagnosticLocation={handleOpenDiagnosticLocation}
                    onExplainDiagnostic={handleExplainDiagnostic}
                    onOpenSdkDoctor={openSdkDoctor}
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
                  opencodeProps={{
                    activeProject: workspace.activeProject,
                    isBackendConnected: isConnected,
                    info: openCodeAgent.info,
                    sessions: openCodeAgent.sessions,
                    activeSessionId: openCodeAgent.activeSessionId,
                    sessionDetail: openCodeAgent.sessionDetail,
                    activeSessionSummary: openCodeAgent.activeSessionSummary,
                    isCrossProjectSession: openCodeAgent.isCrossProjectSession,
                    wsState: openCodeAgent.wsState,
                    draftPrompt: openCodeAgent.draftPrompt,
                    pendingContexts: openCodeAgent.pendingContexts,
                    selectedModel: openCodeAgent.selectedModel,
                    loading: openCodeAgent.loading,
                    actionPending: openCodeAgent.actionPending,
                    error: openCodeAgent.error,
                    notice: openCodeAgent.notice,
                    onDraftPromptChange: openCodeAgent.setDraftPrompt,
                    onRemoveContext: openCodeAgent.removeContext,
                    onSelectModel: openCodeAgent.setSelectedModel,
                    onSelectSession: openCodeAgent.selectSession,
                    onCreateSession: () => { void openCodeAgent.createSession(); },
                    onSendPrompt: () => { void openCodeAgent.sendPrompt(); },
                    onInterrupt: () => { void openCodeAgent.interruptSession(); },
                    onReplyPermission: (reqId, decision) => {
                      void openCodeAgent.replyPermission(reqId, decision);
                    },
                    onTerminateSession: (sessionId) => {
                      void openCodeAgent.terminateSession(sessionId);
                    },
                    onRefresh: () => { void openCodeAgent.refreshInfoAndSessions(); },
                    onOpenSettings: () => openSettingsCategory("opencode"),
                    onClearFeedback: openCodeAgent.clearFeedback,
                  }}
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
        activeBoardId={boardManager.activeProjectBoardId}
        activeBoardName={
          boardManager.projectBoardStatus?.board?.name ??
          boardManager.activeProjectBoardId
        }
        boardSupported={
          boardManager.projectBoardStatus?.board_supported ??
          Boolean(
            boardManager.activeProjectBoardId &&
              boardManager.boards.some(
                (b) => b.id === boardManager.activeProjectBoardId
              )
          )
        }
        boardCompatibility={
          boardManager.projectBoardStatus?.compatibility?.status ?? null
        }
        activeFileTab={activeFileTab}
        cursorPosition={editorTabs.cursorPosition}
        editorSettings={editorSettings.settings}
        dirtyCount={editorTabs.dirtyCount}
        sdkStatus={sdkDoctor.report?.overall_status ?? null}
        gitStatus={gitIntegration.status}
        latestBuild={buildSystem.latestBuild}
        latestUpload={uploadSystem.latestUpload}
        selectedPort={uploadSystem.selectedPort}
        serialStatus={serialMonitor.status}
        serialPort={serialMonitor.activePort}
        serialBaudRate={serialMonitor.baudRate}
        terminalRunningCount={terminalManager.runningCount}
        onInspectBackend={() => {
          editorTabs.setActiveFileTabPath(null);
          openCenterTab("diagnostics");
        }}
        onOpenSdkDoctor={openSdkDoctor}
        onOpenSourceControl={openSourceControl}
        onOpenBoardManager={openBoardManager}
        onOpenBuildOutput={() => setBottomTab("build")}
        onOpenUploadOutput={openUploadPanel}
        onOpenSerialMonitor={openSerialMonitor}
        onOpenTerminal={openTerminalPanel}
        onOpenProject={openOpenProjectDialog}
      />

      <SettingsModal
        open={settingsOpen}
        initialCategory={settingsCategory}
        species={species}
        tweaks={tweaks}
        editorSettings={editorSettings.settings}
        terminalSettings={terminalSettingsState.terminalSettings}
        workspaceConfigProps={{
          defaultProjectsDir: workspace.defaultProjectsDir,
          hasElectronBrowse: workspace.isElectronBridge,
          isBackendConnected: isConnected,
          pending: workspace.actionPending,
          onBrowseDirectory: workspace.browseDirectory,
          onSaveDefaultProjectsDir: workspace.updateDefaultProjectsDir,
        }}
        sdkConfigProps={{
          configState: sdkDoctor.configState,
          hasElectronBrowse: sdkDoctor.hasElectronBrowse,
          isBackendConnected: isConnected,
          saving: sdkDoctor.savingConfig,
          discovering: sdkDoctor.discovering,
          error: sdkDoctor.error,
          onBrowseDirectory: sdkDoctor.browseDirectory,
          onBrowseFile: sdkDoctor.browseFile,
          onDiscover: sdkDoctor.runDiscovery,
          onSave: sdkDoctor.saveConfig,
          onReset: sdkDoctor.resetConfig,
        }}
        opencodeConfigProps={{
          configState: openCodeAgent.configState,
          hasElectronBrowse: sdkDoctor.hasElectronBrowse,
          isBackendConnected: isConnected,
          saving: openCodeAgent.savingConfig,
          loading: openCodeAgent.loading,
          error: openCodeAgent.error,
          onBrowseFile: sdkDoctor.browseFile,
          onRefresh: () => void openCodeAgent.refreshInfoAndSessions(),
          onSave: openCodeAgent.saveConfig,
          onReset: openCodeAgent.resetConfig,
        }}
        onClose={() => setSettingsOpen(false)}
        onSpeciesChange={handleSpeciesChange}
        onTweaksChange={handleTweaksChange}
        onResetTweaks={handleResetTweaks}
        onEditorSettingsChange={editorSettings.updateSettings}
        onResetEditorSettings={editorSettings.resetSettings}
        onTerminalSettingsChange={terminalSettingsState.updateTerminalSettings}
        onResetTerminalSettings={terminalSettingsState.resetTerminalSettings}
        onOpenSdkDoctor={openSdkDoctor}
      />

      <CommandPaletteModal
        open={commandPaletteOpen}
        actions={commandPaletteActions}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <UnsavedChangesDialog prompt={editorTabs.unsavedPrompt} />

      <GitConfirmDialog
        dialog={gitIntegration.confirmDialog}
        pending={gitIntegration.actionPending}
        onCancel={() => gitIntegration.setConfirmDialog(null)}
        onConfirm={() => void gitIntegration.executeConfirmedAction()}
      />

      <GitHubConfirmDialog
        dialog={githubIntegration.confirmDialog}
        pending={githubIntegration.actionPending}
        onCancel={githubIntegration.closeConfirmDialog}
        onConfirmUpdateRemote={(name, url) =>
          void githubIntegration.confirmUpdateRemote(name, url)
        }
        onConfirmRemoveRemote={(name) =>
          void githubIntegration.confirmRemoveRemote(name)
        }
        onConfirmCreateRepo={(payload) =>
          void githubIntegration.confirmCreateRepo(payload)
        }
        onConfirmPublish={(payload) =>
          void githubIntegration.confirmPublish(payload)
        }
        onConfirmPull={(remote) =>
          void githubIntegration.confirmPull(remote)
        }
        onConfirmPush={(remote, setUpstream) =>
          void githubIntegration.confirmPush(remote, setUpstream)
        }
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
        onSaveDefaultParentDir={async (dir) => {
          await workspace.updateDefaultProjectsDir(dir);
        }}
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

      <CreateFromExampleModal
        example={learning.createModalExample}
        boards={boardManager.boards}
        defaultParentDir={workspace.defaultProjectsDir}
        isBackendConnected={isConnected}
        isElectronBridge={workspace.isElectronBridge}
        validating={learning.validatingExample}
        validationReport={learning.validationReport}
        pending={learning.creatingProject}
        serverError={learning.createError}
        collisionPrompted={learning.collisionPrompted}
        onValidateForBoard={(exampleId, boardId) =>
          void learning.runValidation(exampleId, boardId)
        }
        onBrowseParent={(currentPath) =>
          workspace.browseDirectory("Select Project Location", currentPath)
        }
        onClose={learning.closeCreateProjectModal}
        onSubmit={handleSubmitCreateFromExample}
      />
    </div>
  );
}
