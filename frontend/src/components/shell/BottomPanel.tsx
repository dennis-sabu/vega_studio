"use client";

import { useRef, type ComponentProps, type KeyboardEvent } from"react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
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
} from"lucide-react";
import { BuildOutputPanel } from"@/components/build/BuildOutputPanel";
import { SerialMonitorPanel } from"@/components/serial/SerialMonitorPanel";
import { TerminalPanel } from"@/components/terminal/TerminalPanel";
import { UploadPanel } from"@/components/upload/UploadPanel";
import { Tooltip } from"@/components/ui/Tooltip";
import type { BuildDiagnostic } from"@/types/build";
import type { BottomPanelTab, ShellLogEntry } from"@/types/shell";

interface BottomPanelProps {
  activeTab: BottomPanelTab;
  height: number;
  maximized: boolean;
  logs: ShellLogEntry[];
  buildPanelProps: ComponentProps<typeof BuildOutputPanel>;
  terminalPanelProps: ComponentProps<typeof TerminalPanel>;
  uploadPanelProps: ComponentProps<typeof UploadPanel>;
  serialPanelProps: ComponentProps<typeof SerialMonitorPanel>;
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
  onExplainDiagnostic?: (diag: BuildDiagnostic) => void;
  onOpenSdkDoctor: () => void;
}

interface BottomTabMeta {
  id: BottomPanelTab;
  label: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BOTTOM_TABS: BottomTabMeta[] = [
  {
    id: "build",
    label: "Build Output",
    emptyTitle: "Build Output Ready",
    emptyDescription:
      "Make and riscv32-vega-elf-gcc compilation output and artifact summaries stream here.",
    icon: Hammer,
  },
  {
    id: "terminal",
    label: "Terminal",
    emptyTitle: "Integrated Terminal",
    emptyDescription:
      "Interactive PTY shell anchored to the active project directory.",
    icon: Terminal,
  },
  {
    id: "serial",
    label: "Serial Monitor",
    emptyTitle: "UART Serial Monitor Ready",
    emptyDescription:
      "Real-time USB-UART console for VEGA ARIES V3 telemetry and command transmission.",
    icon: Usb,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    emptyTitle: "No Build Errors or Warnings",
    emptyDescription:
      "Compiler and Make warnings/errors appear here during builds. Run SDK Doctor for environment checks.",
    icon: Activity,
  },
  {
    id: "upload",
    label: "Upload Output",
    emptyTitle: "XMODEM Upload Channel Ready",
    emptyDescription:
      "Firmware flashing logs and transfer progress stream here during uploads.",
    icon: Upload,
  },
  {
    id: "logs",
    label: "Logs",
    emptyTitle: "No Shell Events Recorded",
    emptyDescription:
      "IDE lifecycle and backend connection events appear here during your session.",
    icon: ScrollText,
  },
];

export function BottomPanel({
  activeTab,
  height,
  maximized,
  logs,
  buildPanelProps,
  terminalPanelProps,
  uploadPanelProps,
  serialPanelProps,
  buildDiagnostics,
  onSelectTab,
  onToggleMaximize,
  onCollapse,
  onClearLogs,
  onOpenDiagnosticLocation,
  onExplainDiagnostic,
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
      className={`flex min-h-0 flex-col border-t border-[#2D2D30] bg-[#1F1F1F] ${
        maximized ? "flex-1" : "shrink-0"
      }`}
    >
      {/* Tab Bar Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2D2D30] bg-[#181818] px-2 select-none">
        <div
          role="tablist"
          aria-label="Secondary panel tabs"
          className="vega-no-scrollbar flex h-full min-w-0 items-center gap-0.5 overflow-x-auto"
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
                className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50 ${
                  selected
                    ? "text-[#F4F4F5]"
                    : "text-[#B4B4BC] hover:bg-[#252527] hover:text-[#F4F4F5]"
                }`}
              >
                <span>{label}</span>
                {id === "build" && buildPanelProps.activeBuild?.status === "running" && (
                  <span
                    aria-label="Building"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7AA2FF]"
                  />
                )}
                {id === "terminal" &&
                  terminalPanelProps.sessions.some((s) => s.status === "running") && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 font-mono text-[10px] text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span>
                        {
                          terminalPanelProps.sessions.filter(
                            (s) => s.status === "running"
                          ).length
                        }
                      </span>
                    </span>
                  )}
                {id === "upload" && uploadPanelProps.activeUpload?.status === "running" && (
                  <span
                    aria-label="Uploading"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7AA2FF]"
                  />
                )}
                {id === "serial" && serialPanelProps.status === "connected" && (
                  <span
                    aria-label="Serial Connected"
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                  />
                )}
                {id === "serial" && serialPanelProps.status === "connecting" && (
                  <span
                    aria-label="Serial Connecting"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7AA2FF]"
                  />
                )}
                {id === "serial" && serialPanelProps.status === "error" && (
                  <span
                    aria-label="Serial Error"
                    className="h-1.5 w-1.5 rounded-full bg-red-400"
                  />
                )}
                {id === "diagnostics" && buildDiagnostics.length > 0 && (
                <span className="rounded-full border border-red-400/25 bg-red-500/15 px-1.5 font-mono text-[10px] text-red-200">
                    {buildDiagnostics.length}
                  </span>
                )}
                {id === "logs" && logs.length > 0 && (
                <span className="rounded-full bg-[#2C2C30] px-1.5 font-mono text-[10px] text-[#F4F4F5]">
                    {logs.length}
                  </span>
                )}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-[#7AA2FF]"
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
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
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
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7AA2FF]/50"
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
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7AA2FF]/50"
            >
            <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "build" ? (
        <BuildOutputPanel {...buildPanelProps} />
      ) : activeTab === "terminal" ? (
        <TerminalPanel {...terminalPanelProps} />
      ) : activeTab === "upload" ? (
        <UploadPanel {...uploadPanelProps} />
      ) : activeTab === "serial" ? (
        <SerialMonitorPanel {...serialPanelProps} />
      ) : activeTab === "diagnostics" ? (
      <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#2D2D30] pb-2">
          <span className="text-[11px] text-[#E4E4E7]">
              {buildDiagnostics.length === 0
                ? "No parsed build errors or warnings."
                : `${buildDiagnostics.filter((d) => d.severity === "error").length} error(s), ${buildDiagnostics.filter((d) => d.severity === "warning").length} warning(s)`}
            </span>
            <button
              type="button"
              onClick={onOpenSdkDoctor}
              className="inline-flex h-6 items-center gap-1.5 rounded border border-[#2D2D30] bg-[#252527] px-2.5 font-sans text-[11px] text-[#F4F4F5] hover:bg-[#252527]"
            >
            <Stethoscope className="h-3 w-3 text-[#7AA2FF]" />
              <span>Open SDK Doctor</span>
            </button>
          </div>

          {buildDiagnostics.length === 0 ? (
          <div className="flex h-full min-h-[72px] items-center justify-center font-sans">
            <div className="flex max-w-lg items-start gap-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] px-3.5 py-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
                <ActiveIcon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#F4F4F5]">
                    {activeMeta.emptyTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#B4B4BC]">
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
                    className={`flex items-start justify-between gap-3 rounded-[6px] border px-3 py-2 text-[11px] ${
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
                        <p className="break-words text-[#F4F4F5]">
                          {diag.message}
                        </p>
                        {(diag.file_path || diag.relative_path) && (
                        <p className="mt-0.5 truncate text-[10px] text-[#B4B4BC]">
                            {diag.relative_path ?? diag.file_path}
                            {diag.line ? `:${diag.line}` : ""}
                            {diag.column ? `:${diag.column}` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {onExplainDiagnostic && (
                        <button
                          type="button"
                          onClick={() => onExplainDiagnostic(diag)}
                          className="inline-flex h-6 items-center gap-1 rounded border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-2 font-sans text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/22"
                        >
                        <Bot className="h-3 w-3 text-[#7AA2FF]" />
                          <span>Ask VEGA AI</span>
                        </button>
                      )}
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
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-2 font-sans text-[10.5px] font-medium text-[#7AA2FF] hover:bg-[#2D2D31]"
                        >
                        <FileCode2 className="h-3 w-3" />
                          <span>Open</span>
                        </button>
                      )}
                    </div>
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
                  className="flex items-baseline gap-2.5 rounded px-2 py-0.5 text-[11px] hover:bg-[#252527]"
                >
                <span className="shrink-0 text-[#A1A1AA]">
                    {entry.timestamp}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      entry.level === "error"
                        ? "bg-red-500/15 text-red-300"
                        : entry.level === "warn"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-[#7AA2FF]/12 text-[#7AA2FF]"
                    }`}
                  >
                    {entry.category}
                  </span>
                  <span className="text-[#F4F4F5]">{entry.message}</span>
                </li>
              ))}
            </ul>
          ) : (
          <div className="flex h-full min-h-[72px] items-center justify-center">
            <div className="flex max-w-lg items-start gap-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] px-3.5 py-2.5 font-sans">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
                <ActiveIcon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#F4F4F5]">
                    {activeMeta.emptyTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#B4B4BC]">
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
