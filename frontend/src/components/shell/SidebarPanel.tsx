"use client";

import type { ComponentProps } from"react";
import {
  BookOpen,
  Clock,
  Cpu,
  Files,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Home,
  Loader2,
  PanelLeftClose,
  RefreshCw,
  Settings2,
  Stethoscope,
} from"lucide-react";
import { FileExplorer } from"@/components/explorer/FileExplorer";
import { GitSidebarPanel } from"@/components/git/GitSidebarPanel";
import { ExamplesSidebarSection } from"@/components/learning/ExamplesSidebarSection";
import { Tooltip } from"@/components/ui/Tooltip";
import {
  formatBoardDisplayLabel,
  type ProjectBoardStatusResponse,
} from"@/types/board";
import type { RecentProjectEntry, WorkspaceSummary } from"@/types/project";
import type { SdkDoctorReport } from"@/types/sdk";
import type { PrimaryNavSection } from"@/types/shell";

export type SidebarExplorerBridge = Omit<
  ComponentProps<typeof FileExplorer>,
  "project" |"onSwitchProject" |"onCloseProject"
>;

interface SidebarPanelProps {
  activeNav: PrimaryNavSection;
  width: number;
  activeProject: WorkspaceSummary | null;
  recentProjects: RecentProjectEntry[];
  actionPending: boolean;
  explorer: SidebarExplorerBridge;
  gitPanelProps: ComponentProps<typeof GitSidebarPanel>;
  examplesSidebarProps: ComponentProps<typeof ExamplesSidebarSection>;
  sdkReport: SdkDoctorReport | null;
  sdkRunning: boolean;
  boardStatus: ProjectBoardStatusResponse | null;
  onCollapse: () => void;
  onOpenHome: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (projectDir: string) => void;
  onCloseProject: () => void;
  onOpenSdkDoctor: () => void;
  onRunSdkDiagnostics: () => void;
  onOpenSdkSettings: () => void;
  onOpenBoardManager: () => void;
}

interface SectionConfig {
  title: string;
  heading: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTION_META: Record<PrimaryNavSection, SectionConfig> = {
  explorer: {
    title: "Explorer",
    heading: "No Project Open",
    description:
      "Create a VEGA ARIES V3 firmware project or open an existing directory containing vega-project.json.",
    icon: Files,
  },
  git: {
    title: "Source Control",
    heading: "Git Source Control",
    description:
      "Inspect file changes, stage edits, commit revisions, switch branches, and review diffs.",
    icon: GitBranch,
  },
  examples: {
    title: "Examples & Docs",
    heading: "VEGA ARIES V3 Examples & Docs",
    description:
      "Browse verified firmware templates, local SDK examples, and offline reference documentation.",
    icon: BookOpen,
  },
  sdk: {
    title: "SDK & Doctor",
    heading: "SDK & Toolchain Diagnostics",
    description:
      "Validate local VEGA SDK paths, RISC-V GCC toolchain, Make, and Python environment dependencies.",
    icon: Stethoscope,
  },
  tools: {
    title: "Board & Tools",
    heading: "Hardware Target & Toolchain",
    description:
      "Configure target board profiles in vega-project.json, verify compatibility, and inspect hardware settings.",
    icon: Cpu,
  },
};

export function SidebarPanel({
  activeNav,
  width,
  activeProject,
  recentProjects,
  actionPending,
  explorer,
  gitPanelProps,
  examplesSidebarProps,
  sdkReport,
  sdkRunning,
  boardStatus,
  onCollapse,
  onOpenHome,
  onNewProject,
  onOpenProject,
  onOpenRecentProject,
  onCloseProject,
  onOpenSdkDoctor,
  onRunSdkDiagnostics,
  onOpenSdkSettings,
  onOpenBoardManager,
}: SidebarPanelProps) {
  const meta = SECTION_META[activeNav];
  const SectionIcon = meta.icon;

  return (
    <aside
      aria-label={`${meta.title} sidebar`}
      style={{ width: `${width}px` }}
      className="vega-panel-glass flex h-full min-h-0 shrink-0 flex-col border-r border-[#2D2D30] select-none"
    >
      {/* Sidebar Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2D2D30] bg-[#181818] px-3">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-[#E4E4E7] uppercase">
          {meta.title}
        </span>

        <div className="flex items-center gap-0.5">
          <Tooltip label="Open Home View" side="bottom">
            <button
              type="button"
              aria-label="Open Home View"
              onClick={onOpenHome}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
            >
            <Home className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Collapse Sidebar" shortcut="Ctrl+\" side="bottom">
            <button
              type="button"
              aria-label="Collapse Sidebar"
              onClick={onCollapse}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
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
      ) : activeNav === "git" ? (
        <GitSidebarPanel {...gitPanelProps} />
      ) : activeNav === "examples" ? (
        <ExamplesSidebarSection {...examplesSidebarProps} />
      ) : (
      <div className="vega-scroll flex flex-1 flex-col divide-y divide-[#2D2D30] overflow-y-auto px-3 py-3">
        <div className="pb-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
              <SectionIcon className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-[12.5px] font-medium text-[#F4F4F5]">
                {meta.heading}
              </h2>
            </div>

            <p className="text-[11.5px] leading-relaxed text-[#E4E4E7]">
              {meta.description}
            </p>

            {activeNav === "explorer" && (
            <div className="mt-3 flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={onOpenProject}
                  className="inline-flex h-7.5 items-center justify-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
                >
                <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  <span>Open Project</span>
                </button>
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={onNewProject}
                  className="inline-flex h-7.5 items-center justify-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
                >
                <FolderPlus className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  <span>New Project</span>
                </button>
              </div>
            )}

            {activeNav === "sdk" && (
            <div className="mt-3 space-y-2.5">
                {sdkReport && (
                <div className="rounded-[6px] border border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-2 font-mono text-[10.5px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#B4B4BC]">Status</span>
                      <span
                        className={`font-semibold uppercase ${
                          sdkReport.overall_status === "pass"
                            ? "text-emerald-300"
                            : sdkReport.overall_status === "warning"
                              ? "text-amber-300"
                              : sdkReport.overall_status === "fail"
                                ? "text-red-300"
                                : "text-[#E4E4E7]"
                        }`}
                      >
                        {sdkReport.overall_status.replace("_","")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-[#B4B4BC]">
                      <span>{sdkReport.summary.passed} pass</span>
                      <span>{sdkReport.summary.warning} warn</span>
                      <span>{sdkReport.summary.failed} fail</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={onOpenSdkDoctor}
                    className="inline-flex h-7.5 items-center justify-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/22"
                  >
                  <Stethoscope className="h-3.5 w-3.5 text-[#7AA2FF]" />
                    <span>Open SDK Doctor</span>
                  </button>
                  <button
                    type="button"
                    disabled={sdkRunning}
                    onClick={onRunSdkDiagnostics}
                    className="inline-flex h-7.5 items-center justify-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#252527] disabled:opacity-45"
                  >
                    {sdkRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
                    ) : (
                    <RefreshCw className="h-3.5 w-3.5 text-[#7AA2FF]" />
                    )}
                    <span>{sdkRunning ? "Running..." : "Run Diagnostics"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSdkSettings}
                    className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-transparent px-3 text-[11px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                  >
                  <Settings2 className="h-3 w-3 text-[#7AA2FF]" />
                    <span>Configure SDK Paths</span>
                  </button>
                </div>
              </div>
            )}

            {activeNav === "tools" && (
            <div className="mt-3 space-y-2.5">
              <div className="rounded-[6px] border border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-2 font-mono text-[10.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#B4B4BC]">Active Target</span>
                    <span
                      className={`truncate font-semibold ${
                        !activeProject
                          ? "text-[#B4B4BC]"
                          : !boardStatus?.selected_board_id ||
                              !boardStatus?.board_supported
                            ? "text-amber-300"
                            : boardStatus.compatibility?.status ===
                                "incompatible"
                              ? "text-red-300"
                              : "text-emerald-300"
                      }`}
                    >
                      {!activeProject
                        ? "No Project"
                        : formatBoardDisplayLabel(
                            boardStatus?.board?.name,
                            boardStatus?.selected_board_id
                          )}
                    </span>
                  </div>
                  {activeProject && boardStatus?.board && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[#B4B4BC]">
                      <span>{boardStatus.board.isa}</span>
                      <span>{boardStatus.board.machine}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onOpenBoardManager}
                  className="inline-flex h-7.5 w-full items-center justify-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-3 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/22"
                >
                <Cpu className="h-3.5 w-3.5 text-[#7AA2FF]" />
                  <span>Open Board Manager</span>
                </button>
              </div>
            )}
          </div>

          {activeNav === "explorer" && recentProjects.length > 0 && (
          <div className="space-y-2 pt-3">
            <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-[#B4B4BC] uppercase">
              <Clock className="h-3 w-3" />
                <span>Recent Projects</span>
              </p>
              <ul className="space-y-1">
                {recentProjects.slice(0, 6).map((item) => (
                  <li key={item.project_dir}>
                    <button
                      type="button"
                      disabled={!item.exists || actionPending}
                      onClick={() => onOpenRecentProject(item.project_dir)}
                      title={item.project_dir}
                      className="flex w-full flex-col rounded-[6px] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[#2D2D30] hover:bg-[#252527] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-[#F4F4F5]">
                          {item.name}
                        </span>
                        {!item.exists && (
                        <span className="font-mono text-[9.5px] text-red-300">
                            Missing
                          </span>
                        )}
                      </div>
                      <span className="truncate font-mono text-[10px] text-[#A1A1AA]">
                        {item.project_dir}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
