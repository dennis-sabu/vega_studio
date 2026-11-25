"use client";

import type { ComponentProps } from "react";
import {
  BookOpen,
  Clock,
  Cpu,
  Files,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Home,
  PanelLeftClose,
  Stethoscope,
} from "lucide-react";
import { FileExplorer } from "@/components/explorer/FileExplorer";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RecentProjectEntry, WorkspaceSummary } from "@/types/project";
import type { PrimaryNavSection } from "@/types/shell";

export type SidebarExplorerBridge = Omit<
  ComponentProps<typeof FileExplorer>,
  "project" | "onSwitchProject" | "onCloseProject"
>;

interface SidebarPanelProps {
  activeNav: PrimaryNavSection;
  width: number;
  activeProject: WorkspaceSummary | null;
  recentProjects: RecentProjectEntry[];
  actionPending: boolean;
  explorer: SidebarExplorerBridge;
  onCollapse: () => void;
  onOpenHome: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (projectDir: string) => void;
  onCloseProject: () => void;
}

interface SectionConfig {
  title: string;
  phase: string;
  heading: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  details: string[];
}

const SECTION_META: Record<PrimaryNavSection, SectionConfig> = {
  explorer: {
    title: "Explorer",
    phase: "Phase 4 · Explorer",
    heading: "No Project Open",
    description:
      "Create a new VEGA ARIES V3 firmware project or open an existing project containing vega-project.json.",
    icon: Files,
    details: [
      "Portable vega-project.json schema v1.0",
      "Root-confined live directory browsing",
      "Safe create, rename & guarded deletion",
    ],
  },
  git: {
    title: "Source Control",
    phase: "Phase 10",
    heading: "Git CLI Integration",
    description:
      "Repository status, staging, diffs, commit workflow, and GitHub CLI sync will appear here.",
    icon: GitBranch,
    details: [
      "Local Git CLI status & diff tracking",
      "Branch management & commit staging",
      "Portable project history across OSes",
    ],
  },
  examples: {
    title: "SDK Examples",
    phase: "Phase 13",
    heading: "VEGA ARIES V3 Examples",
    description:
      "Browse and instantiate verified VEGA SDK examples once the SDK integration layer is active.",
    icon: BookOpen,
    details: [
      "Validated VEGA SDK peripheral samples",
      "UART, GPIO, Timer, Interrupt & ADC demos",
      "Create portable project from example",
    ],
  },
  sdk: {
    title: "SDK & Doctor",
    phase: "Phase 4",
    heading: "Toolchain & SDK Diagnostics",
    description:
      "Detects local VEGA SDK, RISC-V GCC toolchain, Make, Python dependencies, and configuration.",
    icon: Stethoscope,
    details: [
      "VEGA SDK & riscv32-vega-elf-gcc check",
      "THEJAS32 / rv32i_zicsr config validation",
      "Guided fixes without silent edits",
    ],
  },
  tools: {
    title: "Project & Board Tools",
    phase: "Phases 5–7",
    heading: "ARIES V3 Hardware & Build",
    description:
      "Build orchestration, ARIES V3 serial device selection, and XMODEM upload workflows live here.",
    icon: Cpu,
    details: [
      "C-DAC VEGA ARIES V3 board configuration",
      "Serial port detection (/dev/ttyUSB*, COM*)",
      "Explicit-approval XMODEM firmware upload",
    ],
  },
};

export function SidebarPanel({
  activeNav,
  width,
  activeProject,
  recentProjects,
  actionPending,
  explorer,
  onCollapse,
  onOpenHome,
  onNewProject,
  onOpenProject,
  onOpenRecentProject,
  onCloseProject,
}: SidebarPanelProps) {
  const meta = SECTION_META[activeNav];
  const SectionIcon = meta.icon;

  return (
    <aside
      aria-label={`${meta.title} sidebar`}
      style={{ width: `${width}px` }}
      className="vega-panel-glass flex h-full min-h-0 shrink-0 flex-col border-r border-white/[0.08] select-none"
    >
      {/* Sidebar Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#070910]/65 px-3">
        <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/55 uppercase">
          {meta.title}
        </span>

        <div className="flex items-center gap-1">
          <Tooltip label="Open Home View" side="bottom">
            <button
              type="button"
              aria-label="Open Home View"
              onClick={onOpenHome}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/45 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              <Home className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Collapse Sidebar" shortcut="Ctrl+\" side="bottom">
            <button
              type="button"
              aria-label="Collapse Sidebar"
              onClick={onCollapse}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/45 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Sidebar Body */}
      {activeNav === "explorer" && activeProject ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FileExplorer
            project={activeProject}
            onSwitchProject={onOpenProject}
            onCloseProject={onCloseProject}
            {...explorer}
          />
        </div>
      ) : (
        <div className="vega-scroll flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <>
            <div className="rounded-2xl border border-white/[0.09] bg-[#06070c]/65 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                  <SectionIcon className="h-4 w-4" />
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#e8ebf7]/55">
                  {meta.phase}
                </span>
              </div>

              <h2 className="text-[13px] font-medium text-[#e8ebf7]">
                {meta.heading}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#e8ebf7]/55">
                {meta.description}
              </p>

              {activeNav === "explorer" && (
                <div className="mt-3.5 flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={onOpenProject}
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-xs font-medium text-[#e8ebf7] transition-colors hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                    <span>Open Project</span>
                  </button>
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={onNewProject}
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-[#e8ebf7]/80 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
                  >
                    <FolderPlus className="h-3.5 w-3.5 text-[#7aa2ff]" />
                    <span>New Project</span>
                  </button>
                </div>
              )}
            </div>

            {activeNav === "explorer" && recentProjects.length > 0 && (
              <div className="space-y-2 px-1">
                <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                  <Clock className="h-3 w-3" />
                  <span>Recent Projects</span>
                </p>
                <ul className="space-y-1">
                  {recentProjects.slice(0, 5).map((item) => (
                    <li key={item.project_dir}>
                      <button
                        type="button"
                        disabled={!item.exists || actionPending}
                        onClick={() => onOpenRecentProject(item.project_dir)}
                        title={item.project_dir}
                        className="flex w-full flex-col rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-[#e8ebf7]/85">
                            {item.name}
                          </span>
                          {!item.exists && (
                            <span className="font-mono text-[9px] text-red-300">
                              Missing
                            </span>
                          )}
                        </div>
                        <span className="truncate font-mono text-[10px] text-[#e8ebf7]/40">
                          {item.project_dir}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2 px-1">
              <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/40 uppercase">
                Planned Capabilities
              </p>
              <ul className="space-y-1.5">
                {meta.details.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[11px] leading-snug text-[#e8ebf7]/55"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#7aa2ff]/60"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        </div>
      )}
    </aside>
  );
}
