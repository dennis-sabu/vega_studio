"use client";

import { useEffect, useRef, useState } from"react";
import { createPortal } from"react-dom";
import {
  BookOpen,
  Command,
  Copy,
  Cpu,
  FolderOpen,
  FolderPlus,
  Hammer,
  LayoutGrid,
  Loader2,
  Minus,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plug,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Stethoscope,
  Terminal,
  Trash2,
  Upload,
  Usb,
  X,
} from"lucide-react";
import { Tooltip } from"@/components/ui/Tooltip";
import {
  SegmentedPill,
  type SegmentedPillOption,
} from"@/components/shell/SegmentedPill";
import type { BuildOperation } from"@/types/build";
import type { WorkspaceMode } from"@/types/shell";

interface AppToolbarProps {
  activeMode: WorkspaceMode;
  activeProjectName: string | null;
  activeBoardLabel: string;
  boardSupported: boolean;
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
  onOpenBoardManager: () => void;
  onOpenSdkDoctor: () => void;
  onOpenExamples: () => void;
  onOpenUploadPanel: () => void;
  onOpenSerialMonitor: () => void;
  onOpenTerminal: () => void;
  onOpenCommandPalette: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleSettings: () => void;
  onResetLayout: () => void;
}

type TitleMenuId ="file" |"view" |"build" |"tools";

const MODE_OPTIONS: SegmentedPillOption<WorkspaceMode>[] = [
  { value: "home", label: "Home" },
  { value: "workspace", label: "Workspace" },
];

export function AppToolbar({
  activeMode,
  activeProjectName,
  activeBoardLabel,
  boardSupported,
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
  onOpenBoardManager,
  onOpenSdkDoctor,
  onOpenExamples,
  onOpenUploadPanel,
  onOpenSerialMonitor,
  onOpenTerminal,
  onOpenCommandPalette,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleRightPanel,
  onToggleSettings,
  onResetLayout,
}: AppToolbarProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [openMenu, setOpenMenu] = useState<{
    id: TitleMenuId;
    left: number;
    top: number;
  } | null>(null);
  const [winControlMode, setWinControlMode] = useState<"none" |"overlay" |"custom">("none");
  const [overlayRightInset, setOverlayRightInset] = useState(138);
  const [isMaximized, setIsMaximized] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const menuDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const inTrigger = menuContainerRef.current?.contains(target);
      const inDropdown = menuDropdownRef.current?.contains(target);
      if (!inTrigger && !inDropdown) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    const onResize = () => setOpenMenu(null);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [openMenu]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const wc = window.vegaStudio?.windowControls;
    if (!wc) return;

    queueMicrotask(() => {
      setWinControlMode(wc.mode);
    });
    void wc.isMaximized().then((maxed) => setIsMaximized(maxed));
    const unsub = wc.onMaximizedChange((maxed) => setIsMaximized(maxed));

    if (wc.mode === "overlay" &&"windowControlsOverlay" in navigator) {
      const wco = (
        navigator as Navigator & {
          windowControlsOverlay?: {
            visible: boolean;
            getTitlebarAreaRect: () => DOMRect;
            addEventListener: (type: string, cb: () => void) => void;
            removeEventListener: (type: string, cb: () => void) => void;
          };
        }
      ).windowControlsOverlay;
      if (wco) {
        const updateInset = () => {
          if (!wco.visible) {
            setOverlayRightInset(8);
            return;
          }
          const rect = wco.getTitlebarAreaRect();
          const right = Math.max(120, Math.round(window.innerWidth - rect.right));
          setOverlayRightInset(right);
        };
        queueMicrotask(updateInset);
        wco.addEventListener("geometrychange", updateInset);
        window.addEventListener("resize", updateInset);
        return () => {
          unsub();
          wco.removeEventListener("geometrychange", updateInset);
          window.removeEventListener("resize", updateInset);
        };
      }
    }

    return unsub;
  }, []);

  // Sync the native Windows Controls Overlay background with the current mode
  // so it matches the app toolbar (workspace = #181818, home = #06070c).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wc = window.vegaStudio?.windowControls;
    if (!wc || wc.mode !== "overlay" || !("setOverlayColor" in wc)) return;
    const color = activeMode === "workspace" ? "#181818" : "#06070c";
    void (wc as typeof wc & { setOverlayColor: (c: string, s: string) => Promise<void> })
      .setOverlayColor(color, "#f3f5fc");
  }, [activeMode]);

  const handleResetClick = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    onResetLayout();
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(".vega-no-drag")) return;
    void window.vegaStudio?.windowControls?.toggleMaximize();
  };

  const renderMenuDropdown = () => {
    if (!openMenu || typeof document === "undefined") return null;

    const itemCls =
      "flex w-full items-center justify-between gap-4 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/20 disabled:cursor-not-allowed disabled:opacity-40";

    const menuElement = (
      <div
        ref={menuDropdownRef}
        role="menu"
        aria-label={`${openMenu.id} menu`}
        style={{ left: `${openMenu.left}px`, top: `${openMenu.top}px` }}
        className="vega-tweaks-glass vega-no-drag fixed z-[110] min-w-[228px] rounded-[10px] border border-[#2D2D30] p-1 shadow-2xl"
      >
        {openMenu.id === "file" && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onNewProject();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <FolderPlus className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>New VEGA Project</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenProject();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Open Project Folder</span>
              </span>
            </button>
            {activeProjectName && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onCloseProject();
                }}
                className={itemCls}
              >
              <span className="flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-[#B4B4BC]" />
                  <span>Close Active Project</span>
                </span>
              </button>
            )}
            <div className="my-1 h-px bg-[#2C2C30]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onToggleSettings();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Settings</span>
              </span>
              <kbd className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+,</kbd>
            </button>
          </>
        )}

        {openMenu.id === "view" && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenCommandPalette();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Command className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Command Center</span>
              </span>
              <kbd className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+K</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onModeChange(activeMode === "home" ? "workspace" : "home");
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <LayoutGrid className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>
                  Switch to {activeMode === "home" ? "Workspace" : "Home"}
                </span>
              </span>
            </button>
            <div className="my-1 h-px bg-[#2C2C30]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onToggleSidebar();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <PanelLeft className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Toggle Sidebar</span>
              </span>
              <kbd className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+\</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onToggleBottomPanel();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <PanelBottom className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Toggle Bottom Panel</span>
              </span>
              <kbd className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+J</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onToggleRightPanel();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Toggle AI Workspace</span>
              </span>
              <kbd className="font-mono text-[10px] text-[#B4B4BC]">Ctrl+Shift+A</kbd>
            </button>
          </>
        )}

        {openMenu.id === "build" && (
          <>
            <button
              type="button"
              role="menuitem"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              onClick={() => {
                setOpenMenu(null);
                onBuildAction("build");
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Hammer className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Build Project (Make)</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              onClick={() => {
                setOpenMenu(null);
                onBuildAction("clean");
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5 text-[#B4B4BC]" />
                <span>Clean Build</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              onClick={() => {
                setOpenMenu(null);
                onBuildAction("rebuild");
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <RotateCw className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Rebuild Project</span>
              </span>
            </button>
            <div className="my-1 h-px bg-[#2C2C30]" />
            <button
              type="button"
              role="menuitem"
              disabled={
                !activeProjectName || !isBackendConnected || isBuilding || isUploading
              }
              onClick={() => {
                setOpenMenu(null);
                onUploadAction();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Upload className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Upload Firmware (XMODEM)</span>
              </span>
            </button>
          </>
        )}

        {openMenu.id === "tools" && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenBoardManager();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Board Manager</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenSdkDoctor();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Stethoscope className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>SDK &amp; Toolchain Doctor</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenExamples();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Examples &amp; Offline Docs</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenSerialMonitor();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>UART Serial Monitor</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onOpenTerminal();
              }}
              className={itemCls}
            >
            <span className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>Integrated Terminal</span>
              </span>
            </button>
          </>
        )}
      </div>
    );

    return createPortal(menuElement, document.body);
  };

  return (
    <header
      onDoubleClick={handleHeaderDoubleClick}
      style={
        winControlMode === "overlay"
          ? { paddingRight: `${overlayRightInset}px` }
          : undefined
      }
      className={`vega-drag-region relative z-40 flex h-[38px] shrink-0 items-center justify-between gap-2 border-b pl-2.5 select-none ${
        activeMode === "workspace"
          ? "border-[#2B2B2E] bg-[#181818]"
          : "vega-chrome-glass border-white/[0.14]"
      } ${
        winControlMode === "overlay" ? "" : winControlMode === "custom" ? "pr-0" : "pr-2.5"
      }`}
    >
      {/* Full-width 1px separator that extends across the native Windows Controls
          Overlay region (─ □ ×) where the header border-b cannot reach. */}
      {winControlMode === "overlay" && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-x-0 top-[38px] z-50 h-px ${
            activeMode === "workspace" ? "bg-[#2B2B2E]" : "bg-white/[0.14]"
          }`}
        />
      )}
      {/* Left: VEGA Brand, Compact VS Code Title Menu, Mode Pill & Project Chip */}
      <div className="flex min-w-0 shrink items-center gap-1.5">
        <div className="flex shrink-0 items-center gap-1.5 pr-0.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/16 text-[#7AA2FF]">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <span className="hidden text-[12px] font-semibold tracking-tight text-[#F4F4F5] 2xl:inline">
            VEGA Studio
          </span>
        </div>

        {/* Integrated Compact Menus anchored per button */}
        <div ref={menuContainerRef} className="vega-no-drag relative hidden items-center gap-0.5 sm:flex">
          {(["file","view","build","tools"] as TitleMenuId[]).map((mId) => (
            <button
              key={mId}
              type="button"
              aria-expanded={openMenu?.id === mId}
              onClick={(e) => {
                if (openMenu?.id === mId) {
                  setOpenMenu(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const left = Math.max(8, Math.min(rect.left, window.innerWidth - 240));
                const top = Math.min(rect.bottom + 4, window.innerHeight - 230);
                setOpenMenu({ id: mId, left, top });
              }}
              className={`inline-flex h-6 items-center rounded-[5px] px-2 text-[11.5px] font-medium capitalize transition-colors ${
                openMenu?.id === mId
                  ? "bg-[#2C2C30] text-white"
                  : "text-[#F4F4F5] hover:bg-[#252527] hover:text-white"
              }`}
            >
              {mId}
            </button>
          ))}
          {renderMenuDropdown()}
        </div>

        <div className="hidden h-4 w-px bg-[#2C2C30] sm:block" />

        <SegmentedPill
          ariaLabel="Shell View Mode"
          options={MODE_OPTIONS}
          value={activeMode}
          onChange={onModeChange}
          className="vega-no-drag"
          liquid={false}
        />

        {activeProjectName ? (
        <div className="vega-no-drag hidden h-[26px] items-center gap-1 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2 text-[11.5px] text-[#F4F4F5] xl:inline-flex">
          <span className="max-w-[96px] truncate font-medium">
              {activeProjectName}
            </span>
            <Tooltip label="Close active project" side="bottom">
              <button
                type="button"
                aria-label="Close active project"
                onClick={onCloseProject}
                className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[#E4E4E7] transition-colors hover:bg-[#2D2D31] hover:text-white"
              >
              <X className="h-2.5 w-2.5" />
              </button>
            </Tooltip>
          </div>
        ) : (
        <div className="vega-no-drag hidden items-center gap-0.5 lg:flex">
            <Tooltip label="New VEGA Project">
              <button
                type="button"
                onClick={onNewProject}
                aria-label="New VEGA Project"
                className="inline-flex h-[26px] items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-white"
              >
              <FolderPlus className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span className="hidden xl:inline">New</span>
              </button>
            </Tooltip>
            <Tooltip label="Open VEGA Project">
              <button
                type="button"
                onClick={onOpenProject}
                aria-label="Open VEGA Project"
                className="inline-flex h-[26px] items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-white"
              >
              <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span className="hidden xl:inline">Open</span>
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Center: VS Code / Antigravity Command Center Bar + Compact Firmware Toolchain */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open VEGA Studio Command Center"
          className="vega-no-drag flex h-[26px] min-w-0 max-w-[340px] flex-1 items-center justify-between gap-2 overflow-hidden rounded-[7px] border border-[#2D2D30] bg-[#252527] px-2.5 text-left text-[11.5px] text-[#F4F4F5] transition-colors hover:border-[#7AA2FF]/55 hover:bg-[#2D2D31] hover:text-white"
        >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Search className="h-3 w-3 shrink-0 text-[#7AA2FF]" />
          <span className="truncate font-medium">
              {activeProjectName
                ? `${activeProjectName} — Search commands, files & docs`
                : "VEGA Studio — Search commands, projects & docs"}
            </span>
          </span>
          <kbd className="hidden shrink-0 rounded border border-[#2D2D30] bg-[#141414] px-1.5 py-0.2 font-mono text-[9.5px] text-[#B4B4BC] lg:inline">
            Ctrl+K
          </kbd>
        </button>

        {/* Compact Firmware Toolchain Strip */}
        <div
          aria-label="Toolchain and board actions"
          className="vega-no-drag hidden h-[26px] shrink-0 items-center gap-0.5 rounded-[7px] border border-[#2D2D30] bg-[#252527] px-0.5 md:flex"
        >
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
              className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBuilding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              ) : (
              <Hammer className="h-3.5 w-3.5 text-[#7AA2FF]" />
              )}
              <span>{isBuilding ? "Building" : "Build"}</span>
            </button>
          </Tooltip>

          <Tooltip label="Clean Build (Make clean)">
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              aria-label="Clean Build"
              onClick={() => onBuildAction("clean")}
              className="hidden h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[#E4E4E7] transition-colors hover:bg-[#2D2D31] hover:text-white xl:inline-flex disabled:cursor-not-allowed disabled:opacity-40"
            >
            <Trash2 className="h-3 w-3" />
            </button>
          </Tooltip>

          <Tooltip label="Rebuild Project (Clean + Build)">
            <button
              type="button"
              disabled={!activeProjectName || !isBackendConnected || isBuilding}
              aria-label="Rebuild Project"
              onClick={() => onBuildAction("rebuild")}
              className="hidden h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[#E4E4E7] transition-colors hover:bg-[#2D2D31] hover:text-white xl:inline-flex disabled:cursor-not-allowed disabled:opacity-40"
            >
            <RotateCw className="h-3 w-3" />
            </button>
          </Tooltip>

          {isBuilding && (
            <Tooltip label="Cancel Active Build">
              <button
                type="button"
                aria-label="Cancel Active Build"
                onClick={onCancelBuild}
                className="inline-flex h-[22px] items-center gap-1 rounded-[5px] border border-red-400/45 bg-red-500/20 px-1.5 text-[10.5px] font-medium text-red-100 hover:bg-red-500/35"
              >
              <Square className="h-2.5 w-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </Tooltip>
          )}

          <div className="mx-0.5 h-3.5 w-px bg-[#2C2C30]" />

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
              disabled={
                !activeProjectName ||
                !isBackendConnected ||
                isBuilding ||
                isUploading
              }
              aria-label="Upload Firmware"
              onClick={onUploadAction}
              className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              ) : (
              <Upload className="h-3.5 w-3.5 text-[#7AA2FF]" />
              )}
              <span>{isUploading ? "Uploading" : "Upload"}</span>
            </button>
          </Tooltip>

          {isUploading && (
            <Tooltip label="Cancel Active Firmware Upload">
              <button
                type="button"
                aria-label="Cancel Active Firmware Upload"
                onClick={onCancelUpload}
                className="inline-flex h-[22px] items-center gap-1 rounded-[5px] border border-red-400/45 bg-red-500/20 px-1.5 text-[10.5px] font-medium text-red-100 hover:bg-red-500/35"
              >
              <Square className="h-2.5 w-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </Tooltip>
          )}

          <div className="mx-0.5 h-3.5 w-px bg-[#2C2C30]" />

          <Tooltip
            label={
              activeProjectName && !boardSupported
                ? `Unsupported target (${activeBoardLabel}) — open Board Manager`
                : `Hardware target: ${activeBoardLabel} — open Board Manager`
            }
          >
            <button
              type="button"
              onClick={onOpenBoardManager}
              aria-label="Open Board Manager"
              className={`inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 font-mono text-[10.5px] transition-colors hover:bg-[#2D2D31] ${
                activeProjectName && !boardSupported
                  ? "text-amber-300"
                  : "text-[#F4F4F5] hover:text-white"
              }`}
            >
            <Cpu className="h-3 w-3 text-[#7AA2FF]" />
            <span className="max-w-[84px] truncate">{activeBoardLabel}</span>
            </button>
          </Tooltip>

          {selectedPort ? (
            <Tooltip
              label={`Selected serial device: ${selectedPort} — click to configure port`}
            >
              <button
                type="button"
                disabled={!isBackendConnected}
                aria-label="Serial Port Selector"
                onClick={onOpenUploadPanel}
                className="hidden h-[22px] items-center gap-1 rounded-[5px] bg-[#7AA2FF]/16 px-1.5 font-mono text-[10.5px] text-[#dce8ff] transition-colors hover:bg-[#7AA2FF]/26 lg:inline-flex disabled:opacity-40"
              >
              <Usb className="h-3 w-3 text-[#7AA2FF]" />
              <span className="max-w-[76px] truncate">{selectedPort}</span>
              </button>
            </Tooltip>
          ) : null}

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
              className={`inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isSerialConnected
                  ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                  : "text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-white"
              }`}
            >
              <Plug
                className={`h-3.5 w-3.5 ${
                  isSerialConnected ? "text-emerald-300" : "text-[#7AA2FF]"
                }`}
              />
              <span className="hidden xl:inline">Serial</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Right: Layout Toggles, Reset, AI Toggle, Settings & Linux Window Controls */}
      <div className="flex shrink-0 items-center gap-1">
        <div
          role="group"
          aria-label="Workspace layout controls"
          className="vega-no-drag flex items-center gap-0.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] p-0.5"
        >
          <Tooltip label="Toggle Sidebar" shortcut="Ctrl+\">
            <button
              type="button"
              aria-label="Toggle Sidebar"
              aria-pressed={sidebarOpen}
              onClick={onToggleSidebar}
              className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] transition-colors ${
                sidebarOpen && activeMode === "workspace"
                  ? "bg-[#2C2C30] text-white"
                  : "text-[#E4E4E7] hover:bg-[#252527] hover:text-white"
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
              className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] transition-colors ${
                bottomPanelOpen && activeMode === "workspace"
                  ? "bg-[#2C2C30] text-white"
                  : "text-[#E4E4E7] hover:bg-[#252527] hover:text-white"
              }`}
            >
            <PanelBottom className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Tooltip label="Toggle Unified AI Workspace" shortcut="Ctrl+Shift+A">
            <button
              type="button"
              aria-label="Toggle Assistant Panel"
              aria-pressed={rightPanelOpen}
              onClick={onToggleRightPanel}
              className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] transition-colors ${
                rightPanelOpen && activeMode === "workspace"
                  ? "bg-[#2C2C30] text-white"
                  : "text-[#E4E4E7] hover:bg-[#252527] hover:text-white"
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
              className={`vega-no-drag inline-flex h-[26px] items-center gap-1 rounded-[5px] border px-2 text-[11px] font-medium transition-colors ${
                confirmReset
                  ? "border-red-400/50 bg-red-500/20 text-red-100"
                  : "border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-white"
              }`}
            >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden xl:inline">
                {confirmReset ? "Reset? " : "Reset"}
              </span>
            </button>
          </Tooltip>
        )}

        <Tooltip label="Toggle VEGA AI" side="bottom">
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label="Toggle VEGA AI Panel"
            aria-pressed={rightPanelOpen && activeMode === "workspace"}
            className={`vega-no-drag inline-flex h-[26px] items-center gap-1 rounded-[6px] border px-2 text-[11.5px] font-medium transition-colors ${
              rightPanelOpen && activeMode === "workspace"
                ? "border-[#7AA2FF]/55 bg-[#7AA2FF]/22 text-white"
                : "border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-white"
            }`}
          >
          <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
          <span className="hidden sm:inline">AI</span>
          </button>
        </Tooltip>

        <Tooltip label="IDE & Shell Settings" side="bottom">
          <button
            type="button"
            onClick={onToggleSettings}
            aria-label="Appearance & Shell Settings"
            aria-pressed={settingsOpen}
            className={`vega-no-drag inline-flex h-[26px] w-[26px] items-center justify-center rounded-[5px] transition-colors ${
              settingsOpen
                ? "bg-[#2C2C30] text-white"
                : "text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-white"
            }`}
          >
          <Settings className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        {winControlMode === "custom" && (
        <div className="vega-no-drag ml-1 flex h-[38px] items-center border-l border-[#2D2D30]">
            <button
              type="button"
              aria-label="Minimize window"
              onClick={() => void window.vegaStudio?.windowControls?.minimize()}
              className="inline-flex h-full w-10 items-center justify-center text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-white"
            >
            <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              onClick={() => void window.vegaStudio?.windowControls?.toggleMaximize()}
              className="inline-flex h-full w-10 items-center justify-center text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-white"
            >
              {isMaximized ? (
              <Copy className="h-3 w-3" />
              ) : (
              <Square className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              aria-label="Close window"
              onClick={() => void window.vegaStudio?.windowControls?.close()}
              className="inline-flex h-full w-10 items-center justify-center text-[#F4F4F5] transition-colors hover:bg-red-600 hover:text-white"
            >
            <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
