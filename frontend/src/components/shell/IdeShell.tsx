"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiCodeApplyModal } from "@/components/ai/AiCodeApplyModal";
import type { MonacoEditorHandle } from "@/components/editor/MonacoEditorSurface";
import { UnsavedChangesDialog } from "@/components/editor/UnsavedChangesDialog";
import { GitConfirmDialog } from "@/components/git/GitConfirmDialog";
import { GitHubConfirmDialog } from "@/components/git/GitHubConfirmDialog";
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
import { useBoardManager } from "@/hooks/useBoardManager";
import { useBuildSystem } from "@/hooks/useBuildSystem";
import { useEditorSettings } from "@/hooks/useEditorSettings";
import { useEditorTabs } from "@/hooks/useEditorTabs";
import { useFileExplorer } from "@/hooks/useFileExplorer";
import { useGitIntegration } from "@/hooks/useGitIntegration";
import { useGitHubIntegration } from "@/hooks/useGitHubIntegration";
import { useNativeAi } from "@/hooks/useNativeAi";
import { useOpenCode } from "@/hooks/useOpenCode";
import { useSdkDoctor } from "@/hooks/useSdkDoctor";
import { useSerialMonitor } from "@/hooks/useSerialMonitor";
import { useTerminalManager } from "@/hooks/useTerminalManager";
import { useUploadSystem } from "@/hooks/useUploadSystem";
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
import type {
  AIContextAttachment,
  PendingCodeApplyProposal,
} from "@/types/ai";
import type { BuildDiagnostic, BuildOperation } from "@/types/build";
import type { OpenCodeContextAttachment } from "@/types/opencode";
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
  const monacoBridgeRef = useRef<MonacoEditorHandle | null>(null);
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
  const [confirmUploadNonce, setConfirmUploadNonce] = useState(0);
  const [pendingCodeApply, setPendingCodeApply] = useState<{
    proposal: PendingCodeApplyProposal;
    selectionText: string | null;
    fileText: string | null;
  } | null>(null);

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
    onLog: (message) => appendLog("SHELL", "info", message),
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

  const sendContextToOpenCode = useCallback(
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
      sendContextToOpenCode(
        {
          kind: "build_error",
          title: `${diag.severity.toUpperCase()} in ${location}`,
          relative_path: diag.relative_path,
          start_line: diag.line,
          end_line: diag.line,
          snippet: diag.raw_line || diag.message,
        },
        `Explain and help fix this ${diag.severity}: ${diag.message}`
      );
    },
    [sendContextToOpenCode]
  );

  const nativeAi = useNativeAi({
    projectDir: workspace.activeProject?.project_dir ?? null,
    isBackendConnected: isConnected,
    onLog: (level, message) => appendLog("SHELL", level, message),
  });

  const registerEditorHandle = useCallback((h: MonacoEditorHandle | null) => {
    monacoBridgeRef.current = h;
  }, []);

  const askNativeAiWithContext = useCallback(
    (ctx: AIContextAttachment, suggestedPrompt?: string) => {
      nativeAi.addAttachment(ctx);
      if (suggestedPrompt && !nativeAi.draftPrompt.trim()) {
        nativeAi.setDraftPrompt(suggestedPrompt);
      }
      setComposerFocused(false);
      setSettingsOpen(false);
      setMode("workspace");
      setRightTab("native-ai");
    },
    [nativeAi, setMode, setRightTab]
  );

  const handleExplainDiagnosticNativeAi = useCallback(
    (diag: BuildDiagnostic) => {
      const location = diag.relative_path
        ? `${diag.relative_path}${diag.line ? `:${diag.line}` : ""}`
        : "Build Diagnostic";
      askNativeAiWithContext(
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
    [askNativeAiWithContext]
  );

  const handleDebugBuildNativeAi = useCallback(() => {
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
    askNativeAiWithContext(
      {
        kind: "build_output",
        title: `Build ${buildSystem.latestBuild?.status ?? "failure"} diagnostics`,
        snippet: snippet || "Build failed with no diagnostic lines captured.",
      },
      "Analyze this VEGA firmware build failure and suggest what to check or fix."
    );
  }, [askNativeAiWithContext, buildSystem.diagnostics, buildSystem.latestBuild, buildSystem.logs]);

  const handleAnalyzeSerialAi = useCallback(
    (recentLinesText: string, portLabel: string) => {
      askNativeAiWithContext(
        {
          kind: "serial_output",
          title: `Serial (${portLabel})`,
          snippet: recentLinesText,
        },
        `Analyze this USB-UART serial output from ${portLabel} on VEGA ARIES V3:`
      );
    },
    [askNativeAiWithContext]
  );

  const handleAnalyzeTerminalAi = useCallback(
    (selectedText: string, sessionLabel: string) => {
      askNativeAiWithContext(
        {
          kind: "terminal_output",
          title: `Terminal: ${sessionLabel}`,
          snippet: selectedText,
        },
        "Analyze this selected terminal output in the context of our VEGA project:"
      );
    },
    [askNativeAiWithContext]
  );

  const attachActiveFileToAi = useCallback(() => {
    const tabPath = editorTabs.activeFileTabPath;
    if (!tabPath) return;
    const tab = editorTabs.openFileTabs.find((t) => t.path === tabPath);
    const content = monacoBridgeRef.current?.getFullText() ?? tab?.savedContent ?? "";
    const truncated = content.length > 6000;
    nativeAi.addAttachment({
      kind: "file",
      title: tab?.name ?? tabPath,
      relative_path: tabPath,
      language: tab?.monacoLanguage || tab?.language || null,
      snippet: truncated ? content.slice(0, 6000) : content,
      truncated,
    });
  }, [editorTabs.activeFileTabPath, editorTabs.openFileTabs, nativeAi]);

  const attachSelectionToAi = useCallback(() => {
    const tabPath = editorTabs.activeFileTabPath;
    const sel = monacoBridgeRef.current?.getSelectionSnippet();
    if (!tabPath || !sel) return;
    const tab = editorTabs.openFileTabs.find((t) => t.path === tabPath);
    const truncated = sel.text.length > 6000;
    nativeAi.addAttachment({
      kind: "selection",
      title: `${tab?.name ?? tabPath}:${sel.startLine}-${sel.endLine}`,
      relative_path: tabPath,
      start_line: sel.startLine,
      end_line: sel.endLine,
      language: tab?.monacoLanguage || tab?.language || null,
      snippet: truncated ? sel.text.slice(0, 6000) : sel.text,
      truncated,
    });
  }, [editorTabs.activeFileTabPath, editorTabs.openFileTabs, nativeAi]);

  const attachBuildErrorsToAi = useCallback(() => {
    const snippet = buildSystem.diagnostics
      .slice(0, 12)
      .map(
        (d) =>
          `[${d.severity}] ${d.relative_path ?? d.file_path ?? "?"}:${d.line ?? "?"} ${d.message}`
      )
      .join("\n");
    if (!snippet) return;
    nativeAi.addAttachment({
      kind: "build_error",
      title: `Build Diagnostics (${buildSystem.diagnostics.length})`,
      snippet,
    });
  }, [buildSystem.diagnostics, nativeAi]);

  const attachProjectSummaryToAi = useCallback(() => {
    const proj = workspace.activeProject;
    if (!proj) return;
    const board = boardManager.projectBoardStatus?.board;
    const summaryText = [
      `Project: ${proj.project.name}`,
      `Target: board=${proj.project.target.board ?? "unset"}, arch=${proj.project.target.arch}, machine=${proj.project.target.machine}`,
      board
        ? `Board Specs: ${board.name} (${board.core}, ${board.cpu_frequency_mhz}MHz, ${board.sram_kb}KB SRAM, sensors: ${board.sensors.join(", ")})`
        : "",
      `SDK Overall: ${sdkDoctor.report?.overall_status ?? "not checked"}`,
    ]
      .filter(Boolean)
      .join("\n");
    nativeAi.addAttachment({
      kind: "project_summary",
      title: `${proj.project.name} Board & SDK`,
      snippet: summaryText,
    });
  }, [boardManager.projectBoardStatus, nativeAi, sdkDoctor.report, workspace.activeProject]);

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

  const handleBuildOperation = useCallback(
    async (operation: BuildOperation) => {
      if (
        (operation === "build" || operation === "rebuild") &&
        editorTabs.dirtyCount > 0
      ) {
        const proceed = await editorTabs.confirmWorkspaceTransition({
          title: "Save modified files before building?",
          description:
            "Open editor tabs contain unsaved modifications. Save them so Make compiles your latest edits?",
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
        onOpenUploadPanel={openUploadPanel}
        onOpenSerialMonitor={openSerialMonitor}
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
                } else {
                  setMode("workspace");
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
                  onSendContextToAI={sendContextToOpenCode}
                  onAskNativeAi={askNativeAiWithContext}
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
                      onDebugWithNativeAi: handleDebugBuildNativeAi,
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
                      error: terminalManager.error,
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
                    onExplainDiagnosticNativeAi={handleExplainDiagnosticNativeAi}
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
                  nativeAiProps={{
                    activeProject: workspace.activeProject,
                    activeBoardId: boardManager.activeProjectBoardId,
                    activeFilePath: editorTabs.activeFileTabPath,
                    hasSelection: editorTabs.cursorPosition.selectionLength > 0,
                    hasBuildDiagnostics: buildSystem.diagnostics.length > 0,
                    isBackendConnected: isConnected,
                    providersState: nativeAi.providersState,
                    activeProviderStatus: nativeAi.activeProviderStatus,
                    conversations: nativeAi.conversations,
                    activeConversationId: nativeAi.activeConversationId,
                    conversationDetail: nativeAi.conversationDetail,
                    activeConversation: nativeAi.activeConversation,
                    isCrossProjectConversation: nativeAi.isCrossProjectConversation,
                    wsState: nativeAi.wsState,
                    draftPrompt: nativeAi.draftPrompt,
                    pendingAttachments: nativeAi.pendingAttachments,
                    contextPreview: nativeAi.contextPreview,
                    loading: nativeAi.loading,
                    actionPending: nativeAi.actionPending,
                    error: nativeAi.error,
                    notice: nativeAi.notice,
                    onDraftPromptChange: nativeAi.setDraftPrompt,
                    onSelectConversation: nativeAi.selectConversation,
                    onCreateConversation: () => {
                      void nativeAi.createNewConversation();
                    },
                    onClearConversation: () => {
                      void nativeAi.clearCurrentConversation();
                    },
                    onDeleteConversation: (id) => {
                      void nativeAi.removeConversation(id);
                    },
                    onToggleTools: (allow) => {
                      void nativeAi.toggleConversationTools(allow);
                    },
                    onSendPrompt: () => {
                      void nativeAi.sendPrompt();
                    },
                    onRetryLast: () => {
                      void nativeAi.retryLastTurn();
                    },
                    onStopGeneration: () => {
                      void nativeAi.stopGeneration();
                    },
                    onRemoveAttachment: nativeAi.removeAttachment,
                    onAttachActiveFile: attachActiveFileToAi,
                    onAttachSelection: attachSelectionToAi,
                    onAttachBuildErrors: attachBuildErrorsToAi,
                    onAttachProjectSummary: attachProjectSummaryToAi,
                    onPreviewContext: () => {
                      void nativeAi.loadContextPreview();
                    },
                    onDismissPreview: () => nativeAi.setContextPreview(null),
                    onProposeCodeApply: (code, language, mode) => {
                      const sel = monacoBridgeRef.current?.getSelectionSnippet();
                      const full = monacoBridgeRef.current?.getFullText() ?? activeFileTab?.savedContent ?? null;
                      setPendingCodeApply({
                        proposal: { code, language, mode },
                        selectionText: sel?.text ?? null,
                        fileText: full,
                      });
                    },
                    onOpenSettings: () => openSettingsCategory("ai"),
                    onRefresh: () => {
                      void nativeAi.refreshState();
                    },
                    onClearFeedback: nativeAi.clearFeedback,
                  }}
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
        sidebarOpen={layout.sidebarOpen}
        bottomPanelOpen={layout.bottomPanelOpen}
        rightPanelOpen={layout.rightPanelOpen}
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
        aiConfigProps={{
          providersState: nativeAi.providersState,
          isBackendConnected: isConnected,
          saving: nativeAi.savingConfig,
          testing: nativeAi.testingConnection,
          loading: nativeAi.loading,
          testResult: nativeAi.testResult,
          onRefresh: () => void nativeAi.refreshState(),
          onSaveConfig: nativeAi.saveConfig,
          onResetConfig: nativeAi.resetConfig,
          onSaveCredential: nativeAi.saveCredential,
          onRemoveCredential: nativeAi.removeCredential,
          onTestConnection: nativeAi.runConnectionTest,
        }}
        opencodeConfigProps={{
          configState: openCodeAgent.configState,
          hasElectronBrowse: sdkDoctor.hasElectronBrowse,
          isBackendConnected: isConnected,
          saving: openCodeAgent.savingConfig,
          loading: openCodeAgent.loading,
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
        onOpenSdkDoctor={openSdkDoctor}
      />

      <UnsavedChangesDialog prompt={editorTabs.unsavedPrompt} />

      <AiCodeApplyModal
        proposal={pendingCodeApply?.proposal ?? null}
        projectDir={workspace.activeProject?.project_dir ?? null}
        activeFilePath={editorTabs.activeFileTabPath}
        activeFileDirty={Boolean(activeFileTab?.isDirty)}
        existingSelectionText={pendingCodeApply?.selectionText ?? null}
        existingFileContent={pendingCodeApply?.fileText ?? null}
        onCancel={() => setPendingCodeApply(null)}
        onConfirmApply={(proposal) => {
          const applied = monacoBridgeRef.current?.applyCodeEdit(
            proposal.mode,
            proposal.code
          );
          if (applied && activeFileTab) {
            appendLog(
              "SHELL",
              "info",
              `Applied Native AI suggestion (${proposal.mode}) to ${activeFileTab.path} buffer (unsaved).`
            );
          }
          setPendingCodeApply(null);
        }}
      />

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
