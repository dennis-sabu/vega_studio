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
  AlertTriangle,
  ArrowUp,
  BookOpen,
  Cpu,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Plus,
  Search,
  Sparkles,
  Stethoscope,
  Terminal,
  X,
} from "lucide-react";
import {
  type AtmosphereTweaks,
  type SpeciesKey,
} from "@/lib/glyphAnimalsEngine";
import type { HealthResponse } from "@/lib/api";
import { formatBoardDisplayLabel } from "@/types/board";
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
  onAskAiPrompt?: (prompt: string) => void;
}

interface QuickJumpItem {
  id: string;
  label: string;
  hint: string;
  action: () => void;
}

function getGreetingForHour(hour: number): string {
  if (hour >= 5 && hour <= 11) return "Good morning, VEGA Studio";
  if (hour >= 12 && hour <= 16) return "Good afternoon, VEGA Studio";
  if (hour >= 17 && hour <= 21) return "Good evening, VEGA Studio";
  return "Still up? VEGA Studio";
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
  onAskAiPrompt,
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

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)")?.matches
    ) {
      textareaRef.current?.focus();
    }
  }, []);

  const isInteracting = composerFocused || query.trim().length > 0;
  const availableRecents = useMemo(
    () => recentProjects.filter((r) => r.exists).slice(0, 3),
    [recentProjects]
  );

  const quickJumps = useMemo<QuickJumpItem[]>(() => {
    const trimmed = query.trim();
    const items: QuickJumpItem[] = [];
    if (trimmed && onAskAiPrompt) {
      items.push({
        id: "ask-vega-ai",
        label: `Ask VEGA Assistant: "${trimmed}"`,
        hint: "Native AI",
        action: () => onAskAiPrompt(trimmed),
      });
    }
    items.push(
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
          : "Open Code Workspace",
        hint: activeProject
          ? formatBoardDisplayLabel(null, activeProject.project.target.board, {
              short: true,
            })
          : "IDE panes",
        action: onEnterWorkspace,
      },
      ...availableRecents.map((r) => ({
        id: `recent-${r.project_dir}`,
        label: `Open ${r.name}`,
        hint: "Recent",
        action: () => onOpenRecentProject(r.project_dir),
      })),
      {
        id: "examples",
        label: "Examples & Offline Docs",
        hint: "VEGA ARIES V3",
        action: () => onOpenNavSection("examples"),
      },
      {
        id: "sdk",
        label: "SDK Doctor",
        hint: "Toolchain checks",
        action: () => onOpenNavSection("sdk"),
      },
      {
        id: "boards",
        label: "Board Manager",
        hint: "Hardware profiles",
        action: () => onOpenNavSection("tools"),
      },
      {
        id: "explorer",
        label: "Project Explorer",
        hint: "Files & tree",
        action: () => onOpenNavSection("explorer"),
      },
      {
        id: "git",
        label: "Source Control",
        hint: "Git changes",
        action: () => onOpenNavSection("git"),
      },
      {
        id: "build",
        label: "Build Output",
        hint: "Compiler & make",
        action: () => onOpenBottomTab("build"),
      },
      {
        id: "terminal",
        label: "Integrated Terminal",
        hint: "Interactive shell",
        action: () => onOpenBottomTab("terminal"),
      },
      {
        id: "status",
        label: "Backend Health & Diagnostics",
        hint: isConnected ? "Connected" : "Offline",
        action: onOpenDiagnostics,
      }
    );
    return items;
  }, [
    activeProject,
    availableRecents,
    isConnected,
    onAskAiPrompt,
    onEnterWorkspace,
    onNewProject,
    onOpenBottomTab,
    onOpenDiagnostics,
    onOpenNavSection,
    onOpenProject,
    onOpenRecentProject,
    query,
  ]);

  const filteredJumps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickJumps.slice(0, 6);
    const matches = quickJumps.filter(
      (item) =>
        item.id === "ask-vega-ai" ||
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q)
    );
    return matches.slice(0, 6);
  }, [query, quickJumps]);

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.dataset.canvasTap === "true") {
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
    const trimmed = query.trim();
    if (!trimmed) return;
    window.dispatchEvent(
      new CustomEvent("chat:submit", { detail: { text: trimmed } })
    );
    const directAction = filteredJumps.find((item) => item.id !== "ask-vega-ai");
    if (directAction && filteredJumps.length <= 2) {
      directAction.action();
    } else if (onAskAiPrompt) {
      onAskAiPrompt(trimmed);
    } else if (filteredJumps[0]) {
      filteredJumps[0].action();
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
  const composerWidthPx = Math.max(320, Math.min(960, tweaks.composerWidth || 720));
  const composerRadiusPx = Math.max(0, Math.min(48, tweaks.composerRadius ?? 24));

  return (
    <div
      data-canvas-tap="true"
      onPointerDown={handleStagePointerDown}
      className="vega-view-enter relative flex h-full w-full flex-col items-center justify-between overflow-y-auto px-4 pt-6 pb-8"
    >
      {/* Centered Stage: Frosted Grey Marble Avatar + High-Contrast Greeting + Liquid-Glass Composer */}
      <div
        data-canvas-tap="true"
        onPointerDown={handleStagePointerDown}
        className="vega-home-stage relative z-20 my-auto flex w-full flex-col items-center py-6"
      >
        <div
          className="flex w-full flex-col items-center"
          style={{ maxWidth: `min(${composerWidthPx}px, calc(100vw - 32px))` }}
        >
          {/* Masthead */}
          <div className="vega-home-masthead pointer-events-none mb-7 flex flex-col items-center gap-4 text-center">
            <div
              aria-hidden="true"
              className="vega-marble vega-home-marble h-[66px] w-[66px] rounded-full"
            />
            <div className="space-y-1.5">
              <h1
                className="vega-home-greeting m-0 whitespace-nowrap text-[clamp(24px,4.2vw,32px)] leading-[1.15] font-medium tracking-[-0.02em] text-[#ffffff]"
                style={{
                  fontFamily: "var(--font-display)",
                  textShadow: "0 0 6px #06070c, 0 0 24px #06070c",
                }}
              >
                {greeting}
              </h1>
              <p
                className="m-0 text-[13px] font-medium text-[#e6edfc]"
                style={{ textShadow: "0 0 8px #06070c, 0 0 18px #06070c" }}
              >
                {activeProject
                  ? `Active project: ${activeProject.project.name} · ${formatBoardDisplayLabel(null, activeProject.project.target.board, { short: true })}`
                  : "C-DAC VEGA ARIES V3 RISC-V Firmware Environment"}
              </p>
            </div>
          </div>

          {workspaceWarning && (
            <div className="mb-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-amber-400/40 bg-black/90 px-4 py-2.5 text-xs text-amber-200 shadow-lg">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{workspaceWarning}</span>
              </span>
              <button
                type="button"
                aria-label="Dismiss workspace warning"
                onClick={onDismissWarning}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Frosted Liquid-Glass Composer Box */}
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
            className="vega-liquid-glass vega-focus-card vega-home-composer flex w-full flex-col gap-[18px] px-[18px] pt-[18px] pr-[12px] pb-[12px]"
            style={{
              borderRadius: `${composerRadiusPx}px`,
              ["--blur" as string]: `${Math.max(7, tweaks.blur)}px`,
              ["--glass-sheen" as string]: "rgba(255, 255, 255, 0.05)",
            }}
          >
            {/* Row 1: Search icon + 17px Auto-growing Composer Input */}
            <div className="flex items-start gap-3">
              <Search
                aria-hidden="true"
                className="mt-1 h-[18px] w-[18px] shrink-0 text-[#e5ecfc]"
              />
              <textarea
                ref={textareaRef}
                rows={1}
                value={query}
                onChange={(e) => handleTextareaChange(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                aria-label="Ask VEGA Assistant or search IDE actions"
                placeholder="Ask anything..."
                className="vega-scroll max-h-[200px] min-h-[27px] w-full resize-none border-0 bg-transparent text-[17px] leading-[1.55] text-[#f5f7ff] placeholder:text-[#b6c3df] focus:outline-none"
                style={{ fontFamily: "var(--font-composer)" }}
              />
            </div>

            {/* Interactive Quick Navigation & AI Launcher Tray */}
            {isInteracting && (
              <div className="rounded-[14px] border border-white/[0.14] bg-black/80 p-2 backdrop-blur-md">
                <div className="mb-1.5 flex items-center justify-between px-2">
                  <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#d4def5] uppercase">
                    Quick Jump &amp; Assistant
                  </span>
                  <span className="font-mono text-[10px] text-[#c4d0ea]">
                    Enter to run · Esc to collapse
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {filteredJumps.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={item.action}
                      className={`flex items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                        idx === 0
                          ? "border border-[#7aa2ff]/35 bg-[#7aa2ff]/18 text-white"
                          : "border border-transparent text-[#f2f5ff] hover:bg-white/[0.08] hover:text-white"
                      }`}
                    >
                      <span className="truncate pr-2 font-medium">
                        {item.label}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[#d4def5]">
                        {item.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 2: Pill Controls & Round Submit Button */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenProject}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/[0.16] bg-white/[0.06] pr-[14px] pl-[11px] text-[14px] font-medium text-[#f2f5ff] transition-colors hover:bg-white/[0.13] hover:text-white max-[520px]:px-[9px]"
                >
                  <Plus className="h-4 w-4 text-[#7aa2ff]" />
                  <span className="max-[520px]:hidden">Open project</span>
                </button>

                <button
                  type="button"
                  onClick={onNewProject}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.04] px-3 text-[13px] font-medium text-[#f2f5ff] transition-colors hover:bg-white/[0.11] hover:text-white"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[#7aa2ff]" />
                  <span>New</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenNavSection("examples")}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.04] px-3 text-[13px] font-medium text-[#f2f5ff] transition-colors hover:bg-white/[0.11] hover:text-white"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                  <span>Examples</span>
                </button>

                <button
                  type="button"
                  onClick={onEnterWorkspace}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.04] px-3 text-[13px] font-medium text-[#f2f5ff] transition-colors hover:bg-white/[0.11] hover:text-white"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-[#7aa2ff]" />
                  <span>{activeProject ? "Resume" : "Workspace"}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenDiagnostics}
                  title={
                    isConnected && health
                      ? `${health.service} (${health.version}) — inspect backend`
                      : `${error ?? "Backend disconnected"} — inspect diagnostics`
                  }
                  className={`inline-flex h-[34px] items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-medium transition-colors ${
                    isConnected
                      ? "border-emerald-400/35 bg-emerald-500/14 text-emerald-200 hover:bg-emerald-500/24"
                      : "border-red-400/40 bg-red-500/18 text-red-200 hover:bg-red-500/28"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isConnected ? "bg-emerald-400" : "bg-red-400"
                    }`}
                  />
                  <span>{isConnected ? "Ready" : "Offline"}</span>
                </button>

                {onAskAiPrompt && (
                  <button
                    type="button"
                    aria-label="Open VEGA AI Assistant"
                    title="Open VEGA AI Assistant"
                    onClick={() => onAskAiPrompt(query.trim() || "")}
                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.05] text-[#e5ecfc] transition-colors hover:bg-white/[0.14] hover:text-white"
                  >
                    <Sparkles className="h-4 w-4 text-[#7aa2ff]" />
                  </button>
                )}

                <button
                  type="submit"
                  disabled={!hasText}
                  aria-label="Submit prompt or open selection"
                  title={hasText ? "Submit" : "Enter a prompt or command"}
                  className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors ${
                    hasText
                      ? "bg-[#f2f2f2] text-[#14161e] hover:bg-white"
                      : "cursor-not-allowed bg-[#333642] text-[#c4d0ea]"
                  }`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </form>

          {/* Compact High-Contrast Workspace & Recents Launch Strip (utilizes horizontal width cleanly) */}
          <div className="mt-5 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {availableRecents.length > 0 ? (
              availableRecents.map((item) => (
                <button
                  key={item.project_dir}
                  type="button"
                  onClick={() => onOpenRecentProject(item.project_dir)}
                  title={item.project_dir}
                  className="vega-tweaks-glass flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:border-[#7aa2ff]/45 hover:bg-white/[0.08]"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-[#7aa2ff]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-[#ffffff]">
                      {item.name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-[#d4def5]">
                      {item.project_dir}
                    </p>
                  </div>
                </button>
              ))
            ) : (
              <button
                type="button"
                onClick={onNewProject}
                className="vega-tweaks-glass flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:border-[#7aa2ff]/45 hover:bg-white/[0.08]"
              >
                <FolderPlus className="h-4 w-4 shrink-0 text-[#7aa2ff]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-[#ffffff]">
                    Create First Project
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#d4def5]">
                    VEGA ARIES V3 starter
                  </p>
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenNavSection("tools")}
              className="vega-tweaks-glass flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:border-[#7aa2ff]/45 hover:bg-white/[0.08]"
            >
              <Cpu className="h-4 w-4 shrink-0 text-[#7aa2ff]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-[#ffffff]">
                  Board Manager
                </p>
                <p className="truncate font-mono text-[10px] text-[#d4def5]">
                  ARIES V3 specs
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenNavSection("sdk")}
              className="vega-tweaks-glass flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:border-[#7aa2ff]/45 hover:bg-white/[0.08]"
            >
              <Stethoscope className="h-4 w-4 shrink-0 text-[#7aa2ff]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-[#ffffff]">
                  SDK Doctor
                </p>
                <p className="truncate font-mono text-[10px] text-[#d4def5]">
                  Toolchain readiness
                </p>
              </div>
            </button>

            {availableRecents.length < 2 && (
              <button
                type="button"
                onClick={() => onOpenBottomTab("terminal")}
                className="vega-tweaks-glass flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:border-[#7aa2ff]/45 hover:bg-white/[0.08]"
              >
                <Terminal className="h-4 w-4 shrink-0 text-[#7aa2ff]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-[#ffffff]">
                    Terminal &amp; Serial
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#d4def5]">
                    PTY console &amp; UART
                  </p>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom-Left Subtle Glyph Hint */}
      <p className="pointer-events-none absolute bottom-3 left-3.5 z-20 m-0 font-mono text-[11px] font-semibold tracking-[0.02em] text-[#d4def5] select-none max-[720px]:bottom-[max(14px,calc(env(safe-area-inset-bottom)+6px))]">
        {species === "turtles" ? "click to feed" : "click to scatter"}
      </p>
    </div>
  );
}
