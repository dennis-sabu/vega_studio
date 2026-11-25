"use client";

import { useRef, type ComponentProps, type KeyboardEvent } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  FileCode2,
  Hammer,
  Maximize2,
  Minimize2,
  ScrollText,
  Stethoscope,
  Terminal,
  Trash2,
  Upload,
  Usb,
} from "lucide-react";
import { BuildOutputPanel } from "@/components/build/BuildOutputPanel";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { Tooltip } from "@/components/ui/Tooltip";
import type { BuildDiagnostic } from "@/types/build";
import type { BottomPanelTab, ShellLogEntry } from "@/types/shell";

interface BottomPanelProps {
  activeTab: BottomPanelTab;
  height: number;
  maximized: boolean;
  logs: ShellLogEntry[];
  buildPanelProps: ComponentProps<typeof BuildOutputPanel>;
  uploadPanelProps: ComponentProps<typeof UploadPanel>;
  buildDiagnostics: BuildDiagnostic[];
  onSelectTab: (tab: BottomPanelTab) => void;
  onToggleMaximize: () => void;
  onCollapse: () => void;
  onClearLogs: () => void;
  onOpenDiagnosticLocation: (
    relativePath: string,
    line: number,
    column?: number
  ) => void;
  onOpenSdkDoctor: () => void;
}

interface BottomTabMeta {
  id: BottomPanelTab;
  label: string;
  phase: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BOTTOM_TABS: BottomTabMeta[] = [
  {
    id: "build",
    label: "Build Output",
    phase: "Phase 7",
    emptyTitle: "Build Output Channel Ready",
    emptyDescription:
      "Make/riscv32-vega-elf-gcc compilation output and artifact summaries stream here.",
    icon: Hammer,
  },
  {
    id: "terminal",
    label: "Terminal",
    phase: "Phase 10",
    emptyTitle: "Interactive PTY Terminal Slot",
    emptyDescription:
      "xterm.js interactive shell sessions anchored to the active project directory will mount here later.",
    icon: Terminal,
  },
  {
    id: "serial",
    label: "Serial Monitor",
    phase: "Phase 9",
    emptyTitle: "UART Serial Monitor Slot",
    emptyDescription:
      "ARIES V3 UART RX/TX console (configurable baud, 115200 default) will stream here in serial phases.",
    icon: Usb,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    phase: "Phases 6–7",
    emptyTitle: "No Build Errors or Warnings",
    emptyDescription:
      "Compiler and Make warnings/errors appear here cleanly during builds. Run SDK Doctor for environment checks.",
    icon: Activity,
  },
  {
    id: "upload",
    label: "Upload Output",
    phase: "Phase 9",
    emptyTitle: "XMODEM Upload Channel Ready",
    emptyDescription:
      "Explicitly initiated firmware flashing logs and progress from vega_xmodem.py stream here.",
    icon: Upload,
  },
  {
    id: "logs",
    label: "Logs",
    phase: "Shell Live",
    emptyTitle: "No Shell Events Recorded",
    emptyDescription:
      "Shell lifecycle and backend connectivity events appear here during your session.",
    icon: ScrollText,
  },
];

export function BottomPanel({
  activeTab,
  height,
  maximized,
  logs,
  buildPanelProps,
  uploadPanelProps,
  buildDiagnostics,
  onSelectTab,
  onToggleMaximize,
  onCollapse,
  onClearLogs,
  onOpenDiagnosticLocation,
  onOpenSdkDoctor,
}: BottomPanelProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeMeta =
    BOTTOM_TABS.find((t) => t.id === activeTab) ?? BOTTOM_TABS[0];
  const ActiveIcon = activeMeta.icon;

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (index + delta + BOTTOM_TABS.length) % BOTTOM_TABS.length;
    const nextTab = BOTTOM_TABS[nextIdx];
    if (!nextTab) return;
    onSelectTab(nextTab.id);
    tabRefs.current[nextIdx]?.focus();
  };

  return (
    <section
      aria-label="Secondary workspace panel"
      style={maximized ? undefined : { height: `${height}px` }}
      className={`vega-panel-glass flex min-h-0 flex-col border-t border-white/[0.08] ${
        maximized ? "flex-1" : "shrink-0"
      }`}
    >
      {/* Tab Bar Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#070910]/70 px-2.5 select-none">
        <div
          role="tablist"
          aria-label="Secondary panel tabs"
          className="vega-scroll flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {BOTTOM_TABS.map(({ id, label }, idx) => {
            const selected = id === activeTab;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectTab(id)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={`relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  selected
                    ? "bg-white/[0.08] text-[#e8ebf7]"
                    : "text-[#e8ebf7]/45 hover:bg-white/[0.04] hover:text-[#e8ebf7]/80"
                }`}
              >
                <span>{label}</span>
                {id === "build" && buildPanelProps.activeBuild?.status === "running" && (
                  <span
                    aria-label="Building"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7aa2ff]"
                  />
                )}
                {id === "upload" && uploadPanelProps.activeUpload?.status === "running" && (
                  <span
                    aria-label="Uploading"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7aa2ff]"
                  />
                )}
                {id === "diagnostics" && buildDiagnostics.length > 0 && (
                  <span className="rounded-full border border-red-400/25 bg-red-500/15 px-1.5 font-mono text-[10px] text-red-200">
                    {buildDiagnostics.length}
                  </span>
                )}
                {id === "logs" && logs.length > 0 && (
                  <span className="rounded-full bg-white/10 px-1.5 font-mono text-[10px] text-[#e8ebf7]/70">
                    {logs.length}
                  </span>
                )}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-[#7aa2ff]"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1 pl-2">
          {activeTab === "logs" && logs.length > 0 && (
            <Tooltip label="Clear Shell Logs" side="top">
              <button
                type="button"
                aria-label="Clear Shell Logs"
                onClick={onClearLogs}
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] text-[#e8ebf7]/50 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7]"
              >
                <Trash2 className="h-3 w-3" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </Tooltip>
          )}

          <Tooltip
            label={maximized ? "Restore Panel Size" : "Maximize Panel"}
            side="top"
          >
            <button
              type="button"
              aria-label={maximized ? "Restore Panel Size" : "Maximize Panel"}
              aria-pressed={maximized}
              onClick={onToggleMaximize}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/45 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              {maximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>

          <Tooltip label="Hide Panel" shortcut="Ctrl+J" side="top">
            <button
              type="button"
              aria-label="Hide Secondary Panel"
              onClick={onCollapse}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/45 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "build" ? (
        <BuildOutputPanel {...buildPanelProps} />
      ) : activeTab === "upload" ? (
        <UploadPanel {...uploadPanelProps} />
      ) : activeTab === "diagnostics" ? (
        <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
            <span className="text-[11px] text-[#e8ebf7]/60">
              {buildDiagnostics.length === 0
                ? "No parsed build errors or warnings."
                : `${buildDiagnostics.filter((d) => d.severity === "error").length} error(s), ${buildDiagnostics.filter((d) => d.severity === "warning").length} warning(s)`}
            </span>
            <button
              type="button"
              onClick={onOpenSdkDoctor}
              className="inline-flex h-6 items-center gap-1.5 rounded border border-white/10 bg-white/[0.04] px-2.5 font-sans text-[11px] text-[#e8ebf7]/80 hover:bg-white/[0.09]"
            >
              <Stethoscope className="h-3 w-3 text-[#7aa2ff]" />
              <span>Open SDK Doctor</span>
            </button>
          </div>

          {buildDiagnostics.length === 0 ? (
            <div className="flex h-full min-h-[72px] items-center justify-center font-sans">
              <div className="flex max-w-lg items-start gap-3 rounded-xl border border-white/8 bg-[#08090f] px-4 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                  <ActiveIcon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#e8ebf7]">
                    {activeMeta.emptyTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#e8ebf7]/50">
                    {activeMeta.emptyDescription}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <ul className="space-y-1">
              {buildDiagnostics.map((diag) => {
                const canNavigate = Boolean(diag.relative_path && diag.line);
                return (
                  <li
                    key={diag.id}
                    className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[11px] ${
                      diag.severity === "error"
                        ? "border-red-400/20 bg-red-500/[0.07]"
                        : "border-amber-400/20 bg-amber-500/[0.06]"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {diag.severity === "error" ? (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                      )}
                      <div className="min-w-0">
                        <p className="break-words text-[#e8ebf7]/90">
                          {diag.message}
                        </p>
                        {(diag.file_path || diag.relative_path) && (
                          <p className="mt-0.5 truncate text-[10px] text-[#e8ebf7]/50">
                            {diag.relative_path ?? diag.file_path}
                            {diag.line ? `:${diag.line}` : ""}
                            {diag.column ? `:${diag.column}` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    {canNavigate && diag.relative_path && diag.line && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDiagnosticLocation(
                            diag.relative_path!,
                            diag.line!,
                            diag.column ?? 1
                          )
                        }
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-white/12 bg-white/[0.05] px-2 font-sans text-[10.5px] font-medium text-[#7aa2ff] hover:bg-white/[0.10]"
                      >
                        <FileCode2 className="h-3 w-3" />
                        <span>Open</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
          {activeTab === "logs" && logs.length > 0 ? (
            <ul className="space-y-1">
              {logs.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline gap-2.5 rounded px-2 py-0.5 text-[11px] hover:bg-white/[0.03]"
                >
                  <span className="shrink-0 text-[#e8ebf7]/35">
                    {entry.timestamp}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      entry.level === "error"
                        ? "bg-red-500/15 text-red-300"
                        : entry.level === "warn"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-[#7aa2ff]/12 text-[#7aa2ff]"
                    }`}
                  >
                    {entry.category}
                  </span>
                  <span className="text-[#e8ebf7]/80">{entry.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full min-h-[72px] items-center justify-center">
              <div className="flex max-w-lg items-start gap-3 rounded-xl border border-white/8 bg-[#08090f] px-4 py-3 font-sans">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                  <ActiveIcon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-[#e8ebf7]">
                      {activeMeta.emptyTitle}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#e8ebf7]/50">
                      {activeMeta.phase}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#e8ebf7]/50">
                    {activeMeta.emptyDescription}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
