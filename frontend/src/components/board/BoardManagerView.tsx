"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gauge,
  Hammer,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  XCircle,
} from "lucide-react";
import type {
  BoardCompatibilityReport,
  BoardProfile,
  CompatibilityStatus,
  ProjectBoardStatusResponse,
} from "@/types/board";
import type { WorkspaceSummary } from "@/types/project";

interface BoardManagerViewProps {
  isBackendConnected: boolean;
  activeProject: WorkspaceSummary | null;
  boards: BoardProfile[];
  inspectedBoard: BoardProfile | null;
  inspectedCompatibility: BoardCompatibilityReport | null;
  projectBoardStatus: ProjectBoardStatusResponse | null;
  loadingBoards: boolean;
  loadingStatus: boolean;
  validatingCompatibility: boolean;
  selectingBoard: boolean;
  error: string | null;
  feedback: string | null;
  onInspectBoard: (boardId: string) => void;
  onRefresh: () => Promise<void>;
  onValidateCompatibility: (boardId: string) => Promise<unknown>;
  onSelectBoard: (boardId: string) => Promise<unknown>;
  onOpenSdkDoctor: () => void;
  onClearMessages: () => void;
}

const COMPAT_STYLE: Record<
  CompatibilityStatus,
  {
    label: string;
    badge: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  compatible: {
    label: "COMPATIBLE",
    badge: "border-emerald-400/30 bg-emerald-500/12 text-emerald-300",
    icon: CheckCircle2,
  },
  warning: {
    label: "WARNING",
    badge: "border-amber-400/30 bg-amber-500/12 text-amber-200",
    icon: AlertTriangle,
  },
  incompatible: {
    label: "INCOMPATIBLE",
    badge: "border-red-400/30 bg-red-500/12 text-red-200",
    icon: XCircle,
  },
};

export function BoardManagerView({
  isBackendConnected,
  activeProject,
  boards,
  inspectedBoard,
  inspectedCompatibility,
  projectBoardStatus,
  loadingBoards,
  loadingStatus,
  validatingCompatibility,
  selectingBoard,
  error,
  feedback,
  onInspectBoard,
  onRefresh,
  onValidateCompatibility,
  onSelectBoard,
  onOpenSdkDoctor,
  onClearMessages,
}: BoardManagerViewProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBoards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.vendor.toLowerCase().includes(q) ||
        b.core.toLowerCase().includes(q) ||
        b.machine.toLowerCase().includes(q) ||
        b.isa.toLowerCase().includes(q)
    );
  }, [boards, searchQuery]);

  const activeBoardId = activeProject?.project.target.board ?? null;
  const activeBoardSupported = projectBoardStatus?.board_supported ?? Boolean(activeBoardId && boards.some((b) => b.id === activeBoardId));
  const isInspectedSelectedForProject = Boolean(
    activeProject && inspectedBoard && activeBoardId === inspectedBoard.id
  );

  const compatStyle = inspectedCompatibility
    ? COMPAT_STYLE[inspectedCompatibility.status]
    : null;
  const CompatIcon = compatStyle?.icon ?? HelpCheckFallback;

  return (
    <div className="vega-scroll h-full overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header Card */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#0d0f18]/85 p-5 shadow-[0_14px_38px_rgba(0,0,0,0.38)] backdrop-blur-md">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-[#7aa2ff]">
                  <Cpu className="h-3.5 w-3.5" />
                  <span>VEGA Board Manager</span>
                </span>

                {activeProject ? (
                  activeBoardId ? (
                    activeBoardSupported ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>PROJECT TARGET: {activeBoardId}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/14 px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-amber-200">
                        <AlertTriangle className="h-3 w-3" />
                        <span>UNSUPPORTED: {activeBoardId}</span>
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/14 px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-amber-200">
                      <AlertTriangle className="h-3 w-3" />
                      <span>NO TARGET ASSIGNED</span>
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10.5px] text-[#e8ebf7]/60">
                    NO ACTIVE PROJECT
                  </span>
                )}
              </div>

              <h1 className="text-lg font-medium tracking-tight text-[#e8ebf7]">
                Hardware Target Selection &amp; Profiles
              </h1>
              <p className="max-w-2xl text-xs leading-relaxed text-[#e8ebf7]/60">
                Inspect verified VEGA hardware specifications, validate local SDK compatibility, and assign the active project&apos;s build target in{" "}
                <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-[#e8ebf7]/85">
                  vega-project.json
                </code>
                .
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!isBackendConnected || loadingBoards || loadingStatus}
                onClick={() => void onRefresh()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7] transition-colors hover:bg-white/12 disabled:opacity-45"
              >
                {loadingBoards || loadingStatus ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-[#7aa2ff]" />
                )}
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={onOpenSdkDoctor}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3.5 text-xs font-medium text-[#e8ebf7]/85 transition-colors hover:bg-white/10 hover:text-[#e8ebf7]"
              >
                <Stethoscope className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>SDK Doctor</span>
              </button>
            </div>
          </div>

          {!isBackendConnected && (
            <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              Backend runtime offline. Start or reconnect the local FastAPI engine to query the board registry and compatibility diagnostics.
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-red-400/30 bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200">
              <span>{error}</span>
              <button
                type="button"
                onClick={onClearMessages}
                className="font-mono text-[10px] text-red-200/75 hover:text-red-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {feedback && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
              <span>{feedback}</span>
              <button
                type="button"
                onClick={onClearMessages}
                className="font-mono text-[10px] text-emerald-200/75 hover:text-emerald-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeProject && !activeBoardSupported && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="space-y-1">
                <p className="font-medium text-amber-100">
                  {activeBoardId
                    ? `Active project specifies unsupported board "${activeBoardId}".`
                    : "Active project has no assigned hardware board."}
                </p>
                <p className="text-[11px] leading-relaxed text-amber-200/80">
                  Firmware builds are blocked until a supported board profile from the registry below is explicitly selected and saved to{" "}
                  <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10.5px]">
                    vega-project.json
                  </code>
                  .
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Main 2-column Board Registry + Inspector */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left column: Supported Board Registry */}
          <aside className="space-y-3 lg:col-span-4">
            <div className="rounded-2xl border border-white/[0.08] bg-[#0b0d14]/85 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
                  Registered Boards ({filteredBoards.length})
                </h2>
              </div>

              <div className="relative mb-3">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#e8ebf7]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by board, core, machine..."
                  aria-label="Filter registered boards"
                  className="h-8 w-full rounded-lg border border-white/10 bg-[#06070c]/85 pr-3 pl-8 text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/35 focus:border-[#7aa2ff]/45 focus:outline-none"
                />
              </div>

              {loadingBoards && boards.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-xs text-[#e8ebf7]/55">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
                  <span>Loading board catalogue...</span>
                </div>
              ) : filteredBoards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-[#e8ebf7]/50">
                  No registered boards match &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredBoards.map((board) => {
                    const isInspected = inspectedBoard?.id === board.id;
                    const isProjectActive = activeBoardId === board.id;

                    return (
                      <button
                        key={board.id}
                        type="button"
                        onClick={() => onInspectBoard(board.id)}
                        className={`w-full rounded-xl border p-3 text-left transition-colors ${
                          isInspected
                            ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/12"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[#e8ebf7]">
                              {board.name}
                            </p>
                            <p className="mt-0.5 font-mono text-[10.5px] text-[#e8ebf7]/45">
                              {board.id}
                            </p>
                          </div>
                          {isProjectActive ? (
                            <span className="shrink-0 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 font-mono text-[9.5px] font-semibold text-emerald-300">
                              ACTIVE
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-[#7aa2ff]/30 bg-[#7aa2ff]/10 px-2 py-0.5 font-mono text-[9.5px] text-[#7aa2ff] uppercase">
                              {board.status}
                            </span>
                          )}
                        </div>

                        <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[10px] text-[#e8ebf7]/60">
                          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5">
                            {board.core}
                          </span>
                          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5">
                            {board.cpu_frequency_mhz} MHz
                          </span>
                          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5">
                            {board.machine}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Right column: Selected / Inspected Board Details + Compatibility */}
          <section className="space-y-4 lg:col-span-8">
            {inspectedBoard ? (
              <>
                <div className="rounded-2xl border border-white/[0.08] bg-[#0b0d14]/85 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-medium text-[#e8ebf7]">
                          {inspectedBoard.name}
                        </h2>
                        <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-[#e8ebf7]/70">
                          {inspectedBoard.vendor} · {inspectedBoard.family}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-[#e8ebf7]/65">
                        {inspectedBoard.summary}
                      </p>
                    </div>

                    <div className="shrink-0">
                      <button
                        type="button"
                        disabled={
                          !isBackendConnected ||
                          !activeProject ||
                          selectingBoard ||
                          isInspectedSelectedForProject
                        }
                        onClick={() => void onSelectBoard(inspectedBoard.id)}
                        className={`inline-flex h-8.5 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition-colors disabled:opacity-50 ${
                          isInspectedSelectedForProject
                            ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
                            : "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7] hover:bg-[#7aa2ff]/30"
                        }`}
                      >
                        {selectingBoard ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
                        ) : isInspectedSelectedForProject ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5 text-[#7aa2ff]" />
                        )}
                        <span>
                          {!activeProject
                            ? "Open Project to Select"
                            : isInspectedSelectedForProject
                            ? "Active Project Board"
                            : "Select Target Board"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Hardware & Toolchain Specification Grid */}
                  <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    <SpecCard
                      icon={Cpu}
                      label="Architecture"
                      value={inspectedBoard.architecture}
                    />
                    <SpecCard
                      icon={Activity}
                      label="Core"
                      value={inspectedBoard.core}
                    />
                    <SpecCard
                      icon={Gauge}
                      label="Clock Speed"
                      value={`${inspectedBoard.cpu_frequency_mhz} MHz`}
                    />
                    <SpecCard
                      icon={Hammer}
                      label="ISA"
                      value={inspectedBoard.isa}
                      mono
                    />
                    <SpecCard
                      icon={Cpu}
                      label="Machine"
                      value={inspectedBoard.machine}
                      mono
                    />
                    <SpecCard
                      icon={HardDrive}
                      label="On-Chip SRAM"
                      value={`${inspectedBoard.sram_kb} KB`}
                    />
                  </div>

                  {/* Verified Sensors & Build Profile */}
                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3">
                      <p className="text-[10.5px] font-semibold tracking-wider text-[#e8ebf7]/50 uppercase">
                        On-Board Sensors
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inspectedBoard.sensors.length > 0 ? (
                          inspectedBoard.sensors.map((sensor) => (
                            <span
                              key={sensor}
                              className="rounded-md border border-[#7aa2ff]/25 bg-[#7aa2ff]/10 px-2 py-0.5 font-mono text-[11px] text-[#e8ebf7]/90"
                            >
                              {sensor}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-[#e8ebf7]/45">
                            None declared
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3">
                      <p className="text-[10.5px] font-semibold tracking-wider text-[#e8ebf7]/50 uppercase">
                        Toolchain Build Profile
                      </p>
                      <dl className="mt-2 space-y-1 font-mono text-[11px]">
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#e8ebf7]/50">CROSS_COMPILE:</dt>
                          <dd className="text-[#e8ebf7]/90">
                            {inspectedBoard.build.cross_compile_prefix}-
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#e8ebf7]/50">Build System:</dt>
                          <dd className="text-[#e8ebf7]/90">
                            {inspectedBoard.build.build_system}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>

                {/* SDK Compatibility Report Card */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#0b0d14]/85 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-xs font-semibold tracking-wider text-[#e8ebf7]/70 uppercase">
                        SDK &amp; Toolchain Compatibility
                      </h3>
                      {compatStyle && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold ${compatStyle.badge}`}
                        >
                          <CompatIcon className="h-3 w-3" />
                          <span>{compatStyle.label}</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!isBackendConnected || validatingCompatibility}
                      onClick={() =>
                        void onValidateCompatibility(inspectedBoard.id)
                      }
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3 text-[11px] font-medium text-[#e8ebf7]/85 transition-colors hover:bg-white/10 disabled:opacity-45"
                    >
                      {validatingCompatibility ? (
                        <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
                      ) : (
                        <RefreshCw className="h-3 w-3 text-[#7aa2ff]" />
                      )}
                      <span>Re-check Compatibility</span>
                    </button>
                  </div>

                  {inspectedCompatibility ? (
                    <div className="mt-3.5 space-y-2">
                      {inspectedCompatibility.checks.map((check) => {
                        const style = COMPAT_STYLE[check.status];
                        const Icon = style.icon;
                        return (
                          <div
                            key={check.id}
                            className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3.5 py-2.5"
                          >
                            <div className="flex items-start gap-2.5">
                              <Icon
                                className={`mt-0.5 h-4 w-4 shrink-0 ${
                                  check.status === "compatible"
                                    ? "text-emerald-400"
                                    : check.status === "warning"
                                    ? "text-amber-300"
                                    : "text-red-400"
                                }`}
                              />
                              <div>
                                <p className="text-xs font-medium text-[#e8ebf7]">
                                  {check.label}
                                </p>
                                <p className="mt-0.5 text-[11px] leading-relaxed text-[#e8ebf7]/60">
                                  {check.detail}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold ${style.badge}`}
                            >
                              {style.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/25 px-3.5 py-3 text-xs text-[#e8ebf7]/55">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
                      <span>Evaluating SDK &amp; toolchain compatibility...</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#0b0d14]/60 p-6 text-center">
                <Cpu className="mb-2.5 h-7 w-7 text-[#7aa2ff]/55" />
                <p className="text-sm font-medium text-[#e8ebf7]/85">
                  No Board Profile Loaded
                </p>
                <p className="mt-1 max-w-sm text-xs text-[#e8ebf7]/50">
                  Select a registered hardware profile from the list on the left or refresh the board registry.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SpecCard({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-[#e8ebf7]/50">
        <Icon className="h-3 w-3 text-[#7aa2ff]/80" />
        <span>{label}</span>
      </div>
      <p
        className={`mt-1 truncate text-xs font-medium text-[#e8ebf7] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function HelpCheckFallback({ className }: { className?: string }) {
  return <Activity className={className} />;
}
