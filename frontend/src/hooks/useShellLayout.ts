"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  BottomPanelTab,
  CenterTabId,
  PrimaryNavSection,
  RightPanelTab,
  ShellLayoutState,
  WorkspaceMode,
} from "@/types/shell";

const STORAGE_KEY = "vega-studio:shell-layout:v1";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 460;
export const SIDEBAR_DEFAULT_WIDTH = 260;

export const RIGHT_PANEL_MIN_WIDTH = 240;
export const RIGHT_PANEL_MAX_WIDTH = 440;
export const RIGHT_PANEL_DEFAULT_WIDTH = 300;

export const BOTTOM_PANEL_MIN_HEIGHT = 120;
export const BOTTOM_PANEL_MAX_HEIGHT = 480;
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 200;

const MIN_CENTER_WIDTH = 360;
const MIN_CENTER_HEIGHT = 160;
const NAV_RAIL_WIDTH = 48;
const CHROME_VERTICAL_OVERHEAD = 72; // toolbar + status bar

export const DEFAULT_SHELL_LAYOUT: ShellLayoutState = {
  activeMode: "home",
  activeNav: "explorer",
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  bottomPanelOpen: true,
  bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT,
  bottomPanelMaximized: false,
  activeBottomTab: "build",
  rightPanelOpen: false,
  rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  activeRightTab: "native-ai",
  openCenterTabs: ["overview", "diagnostics"],
  activeCenterTab: "overview",
};

const VALID_MODES = new Set<WorkspaceMode>(["home", "workspace"]);
const VALID_NAVS = new Set<PrimaryNavSection>([
  "explorer",
  "git",
  "examples",
  "sdk",
  "tools",
]);
const VALID_BOTTOM_TABS = new Set<BottomPanelTab>([
  "build",
  "terminal",
  "serial",
  "diagnostics",
  "upload",
  "logs",
]);
const VALID_RIGHT_TABS = new Set<RightPanelTab>(["native-ai", "opencode"]);
const VALID_CENTER_TABS = new Set<CenterTabId>([
  "overview",
  "diagnostics",
  "sdk-doctor",
]);

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeLayout(raw: unknown): ShellLayoutState {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_SHELL_LAYOUT;
  }
  const obj = raw as Record<string, unknown>;

  const activeMode =
    typeof obj.activeMode === "string" &&
    VALID_MODES.has(obj.activeMode as WorkspaceMode)
      ? (obj.activeMode as WorkspaceMode)
      : DEFAULT_SHELL_LAYOUT.activeMode;

  const activeNav =
    typeof obj.activeNav === "string" &&
    VALID_NAVS.has(obj.activeNav as PrimaryNavSection)
      ? (obj.activeNav as PrimaryNavSection)
      : DEFAULT_SHELL_LAYOUT.activeNav;

  const activeBottomTab =
    typeof obj.activeBottomTab === "string" &&
    VALID_BOTTOM_TABS.has(obj.activeBottomTab as BottomPanelTab)
      ? (obj.activeBottomTab as BottomPanelTab)
      : DEFAULT_SHELL_LAYOUT.activeBottomTab;

  const activeRightTab =
    typeof obj.activeRightTab === "string" &&
    VALID_RIGHT_TABS.has(obj.activeRightTab as RightPanelTab)
      ? (obj.activeRightTab as RightPanelTab)
      : DEFAULT_SHELL_LAYOUT.activeRightTab;

  const openCenterTabs = Array.isArray(obj.openCenterTabs)
    ? obj.openCenterTabs.filter(
        (id): id is CenterTabId =>
          typeof id === "string" && VALID_CENTER_TABS.has(id as CenterTabId)
      )
    : DEFAULT_SHELL_LAYOUT.openCenterTabs;

  const uniqueTabs = Array.from(new Set(openCenterTabs));

  const activeCenterTab =
    obj.activeCenterTab === null
      ? null
      : typeof obj.activeCenterTab === "string" &&
          uniqueTabs.includes(obj.activeCenterTab as CenterTabId)
        ? (obj.activeCenterTab as CenterTabId)
        : (uniqueTabs[0] ?? null);

  return {
    activeMode,
    activeNav,
    sidebarOpen:
      typeof obj.sidebarOpen === "boolean"
        ? obj.sidebarOpen
        : DEFAULT_SHELL_LAYOUT.sidebarOpen,
    sidebarWidth:
      typeof obj.sidebarWidth === "number" && Number.isFinite(obj.sidebarWidth)
        ? clamp(obj.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
        : DEFAULT_SHELL_LAYOUT.sidebarWidth,
    bottomPanelOpen:
      typeof obj.bottomPanelOpen === "boolean"
        ? obj.bottomPanelOpen
        : DEFAULT_SHELL_LAYOUT.bottomPanelOpen,
    bottomPanelHeight:
      typeof obj.bottomPanelHeight === "number" &&
      Number.isFinite(obj.bottomPanelHeight)
        ? clamp(
            obj.bottomPanelHeight,
            BOTTOM_PANEL_MIN_HEIGHT,
            BOTTOM_PANEL_MAX_HEIGHT
          )
        : DEFAULT_SHELL_LAYOUT.bottomPanelHeight,
    bottomPanelMaximized:
      typeof obj.bottomPanelMaximized === "boolean"
        ? obj.bottomPanelMaximized
        : DEFAULT_SHELL_LAYOUT.bottomPanelMaximized,
    activeBottomTab,
    rightPanelOpen:
      typeof obj.rightPanelOpen === "boolean"
        ? obj.rightPanelOpen
        : DEFAULT_SHELL_LAYOUT.rightPanelOpen,
    rightPanelWidth:
      typeof obj.rightPanelWidth === "number" &&
      Number.isFinite(obj.rightPanelWidth)
        ? clamp(
            obj.rightPanelWidth,
            RIGHT_PANEL_MIN_WIDTH,
            RIGHT_PANEL_MAX_WIDTH
          )
        : DEFAULT_SHELL_LAYOUT.rightPanelWidth,
    activeRightTab,
    openCenterTabs: uniqueTabs,
    activeCenterTab,
  };
}

function getResponsiveBounds(viewportWidth: number, viewportHeight: number) {
  const availableWidth = Math.max(320, viewportWidth - NAV_RAIL_WIDTH);
  const availableHeight = Math.max(
    240,
    viewportHeight - CHROME_VERTICAL_OVERHEAD
  );

  const maxBottomHeight = Math.max(
    BOTTOM_PANEL_MIN_HEIGHT,
    Math.min(
      BOTTOM_PANEL_MAX_HEIGHT,
      availableHeight - MIN_CENTER_HEIGHT
    )
  );

  return {
    availableWidth,
    maxBottomHeight,
  };
}

const SERVER_VIEWPORT = { width: 1440, height: 900 };
let cachedViewport = SERVER_VIEWPORT;

function getViewportSnapshot() {
  if (typeof window === "undefined") {
    return SERVER_VIEWPORT;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (cachedViewport.width !== width || cachedViewport.height !== height) {
    cachedViewport = { width, height };
  }
  return cachedViewport;
}

function getServerViewportSnapshot() {
  return SERVER_VIEWPORT;
}

function subscribeViewport(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

export function useShellLayout() {
  const [layout, setLayout] = useState<ShellLayoutState>(DEFAULT_SHELL_LAYOUT);
  const [hydrated, setHydrated] = useState(false);
  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getServerViewportSnapshot
  );

  // Hydrate persisted layout asynchronously after mount to avoid SSR hydration mismatches.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          setLayout(sanitizeLayout(parsed));
        }
      } catch {
        // Ignore storage access or malformed JSON errors.
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist layout changes safely.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage quota/blocked errors.
    }
  }, [layout, hydrated]);

  const effectiveDimensions = useMemo(() => {
    const { availableWidth, maxBottomHeight } = getResponsiveBounds(
      viewport.width,
      viewport.height
    );

    const isCompactViewport = viewport.width < 920;
    const isVeryNarrow = viewport.width < 720;

    let showSidebar = layout.sidebarOpen && !isVeryNarrow;
    let showRightPanel = layout.rightPanelOpen && !isCompactViewport;

    let sidebarWidth = layout.sidebarWidth;
    let rightPanelWidth = layout.rightPanelWidth;

    const totalSideRequested =
      (showSidebar ? sidebarWidth : 0) + (showRightPanel ? rightPanelWidth : 0);
    const maxCombinedSides = Math.max(0, availableWidth - MIN_CENTER_WIDTH);

    if (totalSideRequested > maxCombinedSides) {
      if (showSidebar && showRightPanel) {
        const ratio = maxCombinedSides / totalSideRequested;
        sidebarWidth = Math.floor(sidebarWidth * ratio);
        rightPanelWidth = Math.floor(rightPanelWidth * ratio);
        if (rightPanelWidth < RIGHT_PANEL_MIN_WIDTH) {
          showRightPanel = false;
          sidebarWidth = clamp(
            layout.sidebarWidth,
            SIDEBAR_MIN_WIDTH,
            Math.max(SIDEBAR_MIN_WIDTH, maxCombinedSides)
          );
        }
      } else if (showSidebar) {
        sidebarWidth = Math.min(sidebarWidth, maxCombinedSides);
        if (sidebarWidth < SIDEBAR_MIN_WIDTH) {
          showSidebar = false;
        }
      } else if (showRightPanel) {
        rightPanelWidth = Math.min(rightPanelWidth, maxCombinedSides);
        if (rightPanelWidth < RIGHT_PANEL_MIN_WIDTH) {
          showRightPanel = false;
        }
      }
    }

    const bottomPanelHeight = clamp(
      layout.bottomPanelHeight,
      BOTTOM_PANEL_MIN_HEIGHT,
      maxBottomHeight
    );

    return {
      showSidebar,
      showRightPanel,
      sidebarWidth,
      rightPanelWidth,
      bottomPanelHeight,
      maxSidebarWidth: Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          availableWidth -
            MIN_CENTER_WIDTH -
            (showRightPanel ? rightPanelWidth : 0)
        )
      ),
      maxRightPanelWidth: Math.min(
        RIGHT_PANEL_MAX_WIDTH,
        Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          availableWidth -
            MIN_CENTER_WIDTH -
            (showSidebar ? sidebarWidth : 0)
        )
      ),
      maxBottomHeight,
      isCompactViewport,
    };
  }, [layout, viewport]);

  const setMode = useCallback((activeMode: WorkspaceMode) => {
    setLayout((prev) => ({ ...prev, activeMode }));
  }, []);

  const selectNav = useCallback((section: PrimaryNavSection) => {
    setLayout((prev) => {
      if (prev.activeMode === "home") {
        return {
          ...prev,
          activeMode: "workspace",
          activeNav: section,
          sidebarOpen: true,
        };
      }
      if (prev.activeNav === section) {
        return { ...prev, sidebarOpen: !prev.sidebarOpen };
      }
      return { ...prev, activeNav: section, sidebarOpen: true };
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      sidebarOpen: !prev.sidebarOpen,
    }));
  }, []);

  const setSidebarWidth = useCallback(
    (width: number) => {
      setLayout((prev) => ({
        ...prev,
        sidebarWidth: clamp(
          width,
          SIDEBAR_MIN_WIDTH,
          effectiveDimensions.maxSidebarWidth
        ),
      }));
    },
    [effectiveDimensions.maxSidebarWidth]
  );

  const toggleBottomPanel = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      bottomPanelOpen: !prev.bottomPanelOpen,
      bottomPanelMaximized: prev.bottomPanelOpen
        ? false
        : prev.bottomPanelMaximized,
    }));
  }, []);

  const setBottomPanelHeight = useCallback(
    (height: number) => {
      setLayout((prev) => ({
        ...prev,
        bottomPanelMaximized: false,
        bottomPanelHeight: clamp(
          height,
          BOTTOM_PANEL_MIN_HEIGHT,
          effectiveDimensions.maxBottomHeight
        ),
      }));
    },
    [effectiveDimensions.maxBottomHeight]
  );

  const toggleBottomPanelMaximized = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      bottomPanelOpen: true,
      bottomPanelMaximized: !prev.bottomPanelMaximized,
    }));
  }, []);

  const setBottomTab = useCallback((activeBottomTab: BottomPanelTab) => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      bottomPanelOpen: true,
      activeBottomTab,
    }));
  }, []);

  const toggleRightPanel = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      rightPanelOpen: !prev.rightPanelOpen,
    }));
  }, []);

  const setRightPanelWidth = useCallback(
    (width: number) => {
      setLayout((prev) => ({
        ...prev,
        rightPanelWidth: clamp(
          width,
          RIGHT_PANEL_MIN_WIDTH,
          effectiveDimensions.maxRightPanelWidth
        ),
      }));
    },
    [effectiveDimensions.maxRightPanelWidth]
  );

  const setRightTab = useCallback((activeRightTab: RightPanelTab) => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      rightPanelOpen: true,
      activeRightTab,
    }));
  }, []);

  const openCenterTab = useCallback((tabId: CenterTabId) => {
    setLayout((prev) => ({
      ...prev,
      activeMode: "workspace",
      openCenterTabs: prev.openCenterTabs.includes(tabId)
        ? prev.openCenterTabs
        : [...prev.openCenterTabs, tabId],
      activeCenterTab: tabId,
    }));
  }, []);

  const closeCenterTab = useCallback((tabId: CenterTabId) => {
    setLayout((prev) => {
      const nextTabs = prev.openCenterTabs.filter((id) => id !== tabId);
      let nextActive = prev.activeCenterTab;
      if (prev.activeCenterTab === tabId) {
        const closedIdx = prev.openCenterTabs.indexOf(tabId);
        nextActive =
          nextTabs[Math.min(closedIdx, nextTabs.length - 1)] ?? null;
      }
      return {
        ...prev,
        openCenterTabs: nextTabs,
        activeCenterTab: nextActive,
      };
    });
  }, []);

  const setActiveCenterTab = useCallback((tabId: CenterTabId) => {
    setLayout((prev) => ({
      ...prev,
      activeCenterTab: tabId,
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_SHELL_LAYOUT);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const isCustomized = useMemo(() => {
    return (
      layout.activeMode !== DEFAULT_SHELL_LAYOUT.activeMode ||
      layout.activeNav !== DEFAULT_SHELL_LAYOUT.activeNav ||
      layout.sidebarOpen !== DEFAULT_SHELL_LAYOUT.sidebarOpen ||
      layout.sidebarWidth !== DEFAULT_SHELL_LAYOUT.sidebarWidth ||
      layout.bottomPanelOpen !== DEFAULT_SHELL_LAYOUT.bottomPanelOpen ||
      layout.bottomPanelHeight !== DEFAULT_SHELL_LAYOUT.bottomPanelHeight ||
      layout.bottomPanelMaximized !==
        DEFAULT_SHELL_LAYOUT.bottomPanelMaximized ||
      layout.activeBottomTab !== DEFAULT_SHELL_LAYOUT.activeBottomTab ||
      layout.rightPanelOpen !== DEFAULT_SHELL_LAYOUT.rightPanelOpen ||
      layout.rightPanelWidth !== DEFAULT_SHELL_LAYOUT.rightPanelWidth ||
      layout.activeRightTab !== DEFAULT_SHELL_LAYOUT.activeRightTab ||
      layout.activeCenterTab !== DEFAULT_SHELL_LAYOUT.activeCenterTab ||
      layout.openCenterTabs.join(",") !==
        DEFAULT_SHELL_LAYOUT.openCenterTabs.join(",")
    );
  }, [layout]);

  return {
    layout,
    hydrated,
    viewport,
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
  };
}
