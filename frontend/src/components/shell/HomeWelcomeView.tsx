"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Cpu,
  FolderOpen,
  LayoutGrid,
  Plus,
  Search,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { AtmosphereTweaks, SpeciesKey } from "@/lib/glyphAnimalsEngine";
import type { HealthResponse } from "@/lib/api";
import type { RecentProjectEntry, WorkspaceSummary } from "@/types/project";
import type { BottomPanelTab, PrimaryNavSection } from "@/types/shell";

interface HomeWelcomeViewProps {
  species: SpeciesKey;
  tweaks: AtmosphereTweaks;
  composerFocused: boolean;
  activeProject: WorkspaceSummary | null;
  recentProjects: RecentProjectEntry[];
  workspaceWarning: string | null;
  isConnected: boolean;
  health: HealthResponse | null;
  error: string | null;
  onComposerFocusChange: (focused: boolean) => void;
  onCanvasTap: (clientX: number, clientY: number) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (projectDir: string) => void;
  onDismissWarning: () => void;
  onEnterWorkspace: () => void;
  onOpenDiagnostics: () => void;
  onOpenNavSection: (section: PrimaryNavSection) => void;
  onOpenBottomTab: (tab: BottomPanelTab) => void;
}

interface QuickJumpItem {
  id: string;
  label: string;
  hint: string;
  action: () => void;
}

function getGreetingForHour(hour: number): string {
  if (hour >= 5 && hour <= 11) return "Good morning";
  if (hour >= 12 && hour <= 16) return "Good afternoon";
  if (hour >= 17 && hour <= 21) return "Good evening";
  return "Late-night build?";
}

export function HomeWelcomeView({
  species,
  tweaks,
  composerFocused,
  activeProject,
  recentProjects,
  workspaceWarning,
  isConnected,
  health,
  error,
  onComposerFocusChange,
  onCanvasTap,
  onNewProject,
  onOpenProject,
  onOpenRecentProject,
  onDismissWarning,
  onEnterWorkspace,
  onOpenDiagnostics,
  onOpenNavSection,
  onOpenBottomTab,
}: HomeWelcomeViewProps) {
  const [query, setQuery] = useState("");
  const [greeting, setGreeting] = useState("VEGA Studio");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const refreshGreeting = () => {
      setGreeting(getGreetingForHour(new Date().getHours()));
    };
    queueMicrotask(refreshGreeting);
    const interval = setInterval(refreshGreeting, 60000);
    return () => clearInterval(interval);
  }, []);

  const isInteracting = composerFocused || query.trim().length > 0;

  const quickJumps = useMemo<QuickJumpItem[]>(() => {
    const items: QuickJumpItem[] = [
      {
        id: "new-project",
        label: "New VEGA Project...",
        hint: "Create firmware",
        action: onNewProject,
      },
      {
        id: "open-project",
        label: "Open VEGA Project...",
        hint: "Browse folder",
        action: onOpenProject,
      },
      {
        id: "workspace",
        label: activeProject
          ? `Resume ${activeProject.project.name}`
          : "Open Workspace Shell",
        hint: activeProject ? activeProject.project.target.board : "IDE layout",
        action: onEnterWorkspace,
      },
      ...recentProjects
        .filter((r) => r.exists)
        .slice(0, 3)
        .map((r) => ({
          id: `recent-${r.project_dir}`,
          label: `Open ${r.name}`,
          hint: "Recent",
          action: () => onOpenRecentProject(r.project_dir),
        })),
      {
        id: "status",
        label: "Backend Health & Status",
        hint: isConnected ? "Connected" : "Offline",
        action: onOpenDiagnostics,
      },
      {
        id: "explorer",
        label: "Explorer Sidebar",
        hint: "Workspace nav",
        action: () => onOpenNavSection("explorer"),
      },
      {
        id: "sdk",
        label: "SDK & Doctor",
        hint: "Phase 4 slot",
        action: () => onOpenNavSection("sdk"),
      },
      {
        id: "git",
        label: "Source Control",
        hint: "Phase 10 slot",
        action: () => onOpenNavSection("git"),
      },
      {
        id: "build",
        label: "Build Output Panel",
        hint: "Phase 5 slot",
        action: () => onOpenBottomTab("build"),
      },
      {
        id: "logs",
        label: "Shell & Backend Logs",
        hint: "Live session",
        action: () => onOpenBottomTab("logs"),
      },
    ];
    return items;
  }, [
    activeProject,
    isConnected,
    onEnterWorkspace,
    onNewProject,
    onOpenBottomTab,
    onOpenDiagnostics,
    onOpenNavSection,
    onOpenProject,
    onOpenRecentProject,
    recentProjects,
  ]);

  const filteredJumps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickJumps.slice(0, 6);
    return quickJumps
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.hint.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, quickJumps]);

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCanvasTap(event.clientX, event.clientY);
    }
  };

  const handleTextareaChange = (val: string) => {
    setQuery(val);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(200, el.scrollHeight)}px`;
    }
  };

  const handleSubmit = () => {
    const target = filteredJumps[0];
    if (target) {
      target.action();
    } else {
      onEnterWorkspace();
    }
    setQuery("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    onComposerFocusChange(false);
  };

  const handleTextareaKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.blur();
      }
      onComposerFocusChange(false);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const hasText = query.trim().length > 0;

  return (
    <div
      onPointerDown={handleStagePointerDown}
      className="vega-view-enter relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-4"
    >
      {/* Center Stage: Masthead + Glassmorphic Black Composer */}
      <div
        onPointerDown={handleStagePointerDown}
        className="relative z-10 flex w-full max-w-[720px] flex-col items-center"
      >
        {/* Masthead */}
        <div
          className={`pointer-events-none mb-7 flex flex-col items-center gap-3.5 text-center transition-all duration-300 ${
            isInteracting ? "-translate-y-1 opacity-85" : "translate-y-0 opacity-100"
          }`}
        >
          <div
            className="vega-glass vega-glass-liquid vega-marble flex h-[66px] w-[66px] items-center justify-center rounded-full shadow-2xl"
            style={{ ["--blur" as string]: "6px" }}
          >
            <Cpu className="relative z-10 h-6 w-6 text-[#e8ebf7]/90 drop-shadow" />
          </div>

          <div className="space-y-1">
            <h1
              className="m-0 text-[clamp(24px,4.5vw,32px)] leading-[1.15] font-medium tracking-[-0.02em] text-[#e8e8e8]"
              style={{
                fontFamily: "var(--font-display)",
                textShadow: "0 0 6px #06070c, 0 0 24px #06070c",
              }}
            >
              {greeting}
            </h1>
            <p
              className="text-xs font-medium tracking-tight text-[#e8ebf7]/65"
              style={{ textShadow: "0 0 8px #06070c, 0 0 18px #06070c" }}
            >
              {activeProject
                ? `VEGA Studio · Active: ${activeProject.project.name}`
                : "VEGA Studio · C-DAC VEGA ARIES V3 Workspace"}
            </p>
          </div>
        </div>

        {workspaceWarning && (
          <div className="mb-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-amber-400/25 bg-[#0d0f17]/90 px-4 py-2 text-xs text-amber-200 backdrop-blur-md">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{workspaceWarning}</span>
            </span>
            <button
              type="button"
              aria-label="Dismiss workspace warning"
              onClick={onDismissWarning}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Glassmorphic Black Composer Box */}
        <form
          ref={composerRef}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          onFocus={() => onComposerFocusChange(true)}
          onBlur={(e) => {
            if (!composerRef.current?.contains(e.relatedTarget as Node | null)) {
              onComposerFocusChange(false);
            }
          }}
          className={`vega-glass vega-glass-liquid vega-focus-card flex w-full flex-col gap-4 rounded-[24px] px-[18px] pt-[18px] pr-3 pb-3 transition-all duration-300 ${
            isInteracting
              ? "scale-[1.01] bg-[#070910]/90"
              : "bg-[#080a12]/72"
          }`}
          style={{
            ["--blur" as string]: `${Math.max(7, tweaks.blur)}px`,
            ["--glass-rim" as string]: `rgba(255, 255, 255, ${0.14 * tweaks.edge})`,
            ["--glass-sheen" as string]: "rgba(255, 255, 255, 0.04)",
          }}
        >
          {/* Row 1: Search icon + auto-growing input */}
          <div className="flex items-start gap-3">
            <Search
              aria-hidden="true"
              className="mt-1.5 h-[18px] w-[18px] shrink-0 text-[#8d8d8d]"
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={query}
              onChange={(e) => handleTextareaChange(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              aria-label="Search VEGA Studio project actions or workspace views"
              placeholder="Create project, open workspace, or inspect backend..."
              className="vega-scroll max-h-[200px] min-h-[26px] w-full resize-none border-0 bg-transparent text-[17px] leading-[1.55] text-[#ececec] placeholder:text-[#8d8d8d] focus:outline-none"
              style={{ fontFamily: "var(--font-composer)" }}
            />
          </div>

          {/* Focused Quick-Jump Tray */}
          {isInteracting && (
            <div className="rounded-2xl border border-white/8 bg-[#06070c]/75 p-2">
              <div className="mb-1.5 flex items-center justify-between px-2">
                <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                  Project &amp; Workspace Actions
                </span>
                <span className="font-mono text-[10px] text-[#e8ebf7]/35">
                  Enter to run · Esc to unfocus
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {filteredJumps.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={item.action}
                    className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                      idx === 0
                        ? "bg-white/10 text-[#e8ebf7]"
                        : "text-[#e8ebf7]/75 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                    }`}
                  >
                    <span className="truncate pr-2 font-medium">
                      {item.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[#e8ebf7]/45">
                      {item.hint}
                    </span>
                  </button>
                ))}
                {filteredJumps.length === 0 && (
                  <p className="col-span-2 px-2 py-2 text-xs text-[#e8ebf7]/45">
                    No matching action. Press Enter to open Workspace.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Row 2: Action pills + circular submit */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onNewProject}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 pl-3 text-[13px] font-medium text-[#e0e4f2] transition-colors hover:bg-white/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
              >
                <Plus className="h-4 w-4 text-[#7aa2ff]" />
                <span>New project</span>
              </button>

              <button
                type="button"
                onClick={onOpenProject}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3.5 pl-3 text-[13px] font-medium text-[#e0e4f2] transition-colors hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Open project</span>
              </button>

              <button
                type="button"
                onClick={onEnterWorkspace}
                className="hidden h-[34px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 text-[13px] font-medium text-[#c4c4c4] transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>
                  {activeProject ? "Resume" : "Workspace"}
                </span>
              </button>

              <button
                type="button"
                onClick={onOpenDiagnostics}
                title={
                  isConnected && health
                    ? `${health.service} (${health.version}) — inspect backend`
                    : `${error ?? "Backend disconnected"} — inspect diagnostics`
                }
                className={`inline-flex h-[34px] items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  isConnected
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                }`}
              >
                {isConnected ? (
                  <Wifi className="h-3.5 w-3.5" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isConnected ? "Connected" : "Offline"}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDiagnostics}
                aria-label="Inspect Backend Status"
                title="Inspect Backend Status"
                className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full text-[#8d8d8d] transition-colors hover:bg-white/[0.06] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
              >
                <Activity className="h-4 w-4" />
              </button>

              <button
                type="submit"
                aria-label={hasText ? "Run matching action" : "Open Workspace"}
                title={hasText ? "Run matching action" : "Open Workspace"}
                className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff] ${
                  hasText || isInteracting
                    ? "bg-[#f2f2f2] text-[#1c1c1c] hover:bg-white"
                    : "bg-[#3a3a3a] text-[#e6e6e6] hover:bg-[#4a4a4a]"
                }`}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Bottom-Left Subtle Glyph Hint */}
      <p className="pointer-events-none absolute bottom-3 left-3.5 z-10 m-0 font-mono text-[11px] font-semibold tracking-[0.02em] text-[#e8ebf7]/40 select-none">
        {species === "turtles" ? "click to feed" : "click to scatter"}
      </p>
    </div>
  );
}
