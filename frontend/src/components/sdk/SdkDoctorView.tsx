"use client";

import { useState } from"react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderCog,
  Hammer,
  HelpCircle,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Stethoscope,
  Upload,
  Wrench,
  XCircle,
} from"lucide-react";
import { SdkConfigForm } from"@/components/sdk/SdkConfigForm";
import type { BrowseOutcome } from"@/hooks/useSdkDoctor";
import type {
  DiagnosticCategory,
  DiagnosticCheckResult,
  DiagnosticStatus,
  SdkConfig,
  SdkConfigStateResponse,
  SdkDiscoveryResult,
  SdkDoctorReport,
} from"@/types/sdk";

interface SdkDoctorViewProps {
  isBackendConnected: boolean;
  hasElectronBrowse: boolean;
  configState: SdkConfigStateResponse | null;
  report: SdkDoctorReport | null;
  discovery: SdkDiscoveryResult | null;
  loading: boolean;
  runningDiagnostics: boolean;
  discovering: boolean;
  savingConfig: boolean;
  error: string | null;
  feedback: string | null;
  onBrowseDirectory: (title: string, defaultPath?: string) => Promise<BrowseOutcome>;
  onBrowseFile: (title: string, defaultPath?: string) => Promise<BrowseOutcome>;
  onRunDiagnostics: () => Promise<SdkDoctorReport | null>;
  onDiscover: (applyToConfig?: boolean) => Promise<SdkDiscoveryResult | null>;
  onSaveConfig: (
    config: SdkConfig,
    options?: { runCheckAfter?: boolean }
  ) => Promise<unknown>;
  onResetConfig: () => Promise<unknown>;
  onClearFeedback: () => void;
}

const STATUS_STYLE: Record<
  DiagnosticStatus,
  {
    label: string;
    badge: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pass: {
    label: "PASS",
    badge: "border-emerald-400/30 bg-emerald-500/12 text-emerald-300",
    icon: CheckCircle2,
  },
  warning: {
    label: "WARNING",
    badge: "border-amber-400/30 bg-amber-500/12 text-amber-200",
    icon: AlertTriangle,
  },
  fail: {
    label: "FAIL",
    badge: "border-red-400/30 bg-red-500/12 text-red-200",
    icon: XCircle,
  },
  not_checked: {
    label: "NOT CHECKED",
    badge: "border-[#2D2D30] bg-[#252527] text-[#E4E4E7]",
    icon: HelpCircle,
  },
};

const CATEGORY_ORDER: Array<{
  id: DiagnosticCategory;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "sdk",
    title: "VEGA SDK Installation",
    subtitle: "SDK root directory and expected reference layout",
    icon: FolderCog,
  },
  {
    id: "toolchain",
    title: "RISC-V Toolchain & Cross-Compiler",
    subtitle: "vega-tools-rv32, riscv32-vega-elf-gcc execution, and target triple",
    icon: Wrench,
  },
  {
    id: "build_prerequisites",
    title: "Build Prerequisites",
    subtitle: "GNU Make and Python 3 runtime availability",
    icon: Hammer,
  },
  {
    id: "vega_config",
    title: "VEGA ARIES V3 Configuration",
    subtitle: "Architecture (rv32i_zicsr), machine (THEJAS32), and prefix alignment",
    icon: Cpu,
  },
  {
    id: "upload_prerequisites",
    title: "Upload Prerequisites",
    subtitle: "VEGA XMODEM script static inspection and Python dependencies",
    icon: Upload,
  },
];

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return"Not run yet";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME_FORMAT.format(d);
}

export function SdkDoctorView({
  isBackendConnected,
  hasElectronBrowse,
  configState,
  report,
  discovery,
  loading,
  runningDiagnostics,
  discovering,
  savingConfig,
  error,
  feedback,
  onBrowseDirectory,
  onBrowseFile,
  onRunDiagnostics,
  onDiscover,
  onSaveConfig,
  onResetConfig,
  onClearFeedback,
}: SdkDoctorViewProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleCheck = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const overallMeta = STATUS_STYLE[report?.overall_status ?? "not_checked"];
  const OverallIcon = overallMeta.icon;

  return (
  <div className="flex w-full flex-col gap-4">
      {/* Header Summary Banner */}
      <div className="rounded-[12px] border border-[#2D2D30] bg-[#181818] p-5 backdrop-blur-md">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#7AA2FF] uppercase">
                <Stethoscope className="h-3.5 w-3.5" />
                <span>VEGA SDK Doctor</span>
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold ${overallMeta.badge}`}
              >
              <OverallIcon className="h-3 w-3" />
                <span>{overallMeta.label}</span>
              </span>
              {report && (
              <span className="rounded-full border border-[#2D2D30] bg-[#252527] px-2 py-0.5 font-mono text-[10px] text-[#E4E4E7] uppercase">
                  Host: {report.platform_os}
                </span>
              )}
            </div>

            <h1 className="text-lg font-medium tracking-tight text-[#F4F4F5]">
              Environment &amp; Toolchain Diagnostics
            </h1>
            <p className="max-w-2xl text-xs leading-relaxed text-[#E4E4E7]">
              Validates local VEGA SDK paths,{""}
              <code className="rounded bg-[#252527] px-1 py-0.5 font-mono text-[11px] text-[#F4F4F5]">
                riscv32-vega-elf-gcc
              </code>
              , GNU Make, Python 3, VEGA ARIES V3 target configuration, and{""}
              <code className="rounded bg-[#252527] px-1 py-0.5 font-mono text-[11px] text-[#F4F4F5]">
                vega_xmodem.py
              </code>{""}
              without modifying global system PATH or installing packages.
            </p>
            <p className="font-mono text-[11px] text-[#B4B4BC]">
              Last diagnostic check: {formatTimestamp(report?.checked_at)}
            </p>
          </div>

          {/* Primary Actions */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isBackendConnected || runningDiagnostics || loading}
              onClick={() => void onRunDiagnostics()}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#7AA2FF]/45 bg-[#7AA2FF]/20 px-4 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/30 disabled:opacity-45"
            >
              {runningDiagnostics ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              ) : (
              <RefreshCw className="h-3.5 w-3.5 text-[#7AA2FF]" />
              )}
              <span>
                {runningDiagnostics ? "Running Checks..." : "Run Diagnostics"}
              </span>
            </button>

            <button
              type="button"
              disabled={!isBackendConnected || discovering || runningDiagnostics}
              onClick={() => void onDiscover(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-[#252527] px-3.5 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] disabled:opacity-45"
            >
              {discovering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              ) : (
              <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
              )}
              <span>Auto-Detect SDK</span>
            </button>

            <button
              type="button"
              onClick={() => setConfigOpen((prev) => !prev)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors ${
                configOpen
                  ? "border-[#7AA2FF]/40 bg-[#7AA2FF]/16 text-[#F4F4F5]"
                  : "border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
              }`}
            >
            <Settings2 className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span>{configOpen ? "Hide Config" : "Configure SDK"}</span>
            </button>
          </div>
        </div>

        {/* KPI Metric Strip */}
        {report && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3 py-2">
            <span className="font-mono text-[10px] text-emerald-300/80 uppercase">
                Passed
              </span>
              <p className="mt-0.5 font-mono text-base font-semibold text-emerald-200">
                {report.summary.passed}
              </p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2">
              <span className="font-mono text-[10px] text-amber-300/80 uppercase">
                Warnings
              </span>
              <p className="mt-0.5 font-mono text-base font-semibold text-amber-200">
                {report.summary.warning}
              </p>
            </div>
            <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] px-3 py-2">
              <span className="font-mono text-[10px] text-red-300/80 uppercase">
                Failed
              </span>
              <p className="mt-0.5 font-mono text-base font-semibold text-red-200">
                {report.summary.failed}
              </p>
            </div>
            <div className="rounded-xl border border-[#2D2D30] bg-[#252527] px-3 py-2">
              <span className="font-mono text-[10px] text-[#B4B4BC] uppercase">
                Not Checked
              </span>
              <p className="mt-0.5 font-mono text-base font-semibold text-[#F4F4F5]">
                {report.summary.not_checked}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Feedback / Error / Windows Dev Banner */}
      {!isBackendConnected && (
      <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-xs text-red-200">
          FastAPI backend is disconnected. Start the backend server to discover
          paths and run SDK Doctor diagnostics.
        </div>
      )}

      {error && (
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={onClearFeedback}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {feedback && !error && (
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#7AA2FF]/25 bg-[#7AA2FF]/10 px-4 py-2.5 text-xs text-[#F4F4F5]">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={onClearFeedback}
            className="text-[11px] text-[#E4E4E7] hover:text-[#F4F4F5]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Collapsible SDK Configuration Drawer */}
      {configOpen && (
      <div className="rounded-2xl border border-[#7AA2FF]/25 bg-[#181818] p-5 shadow-xl">
          <SdkConfigForm
            configState={configState}
            hasElectronBrowse={hasElectronBrowse}
            isBackendConnected={isBackendConnected}
            saving={savingConfig}
            discovering={discovering}
            onBrowseDirectory={onBrowseDirectory}
            onBrowseFile={onBrowseFile}
            onDiscover={onDiscover}
            onSave={onSaveConfig}
            onReset={onResetConfig}
          />
        </div>
      )}

      {/* Discovery Notes if run recently */}
      {discovery && discovery.notes.length > 0 && (
      <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-4 text-xs">
        <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#7AA2FF] uppercase">
            Last Discovery Notes
          </p>
          <ul className="mt-2 space-y-1 text-[#F4F4F5]">
            {discovery.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Categorized Diagnostic Results */}
      {report && (
      <div className="space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const items = report.checks.filter((c) => c.category === cat.id);
            if (items.length === 0) return null;
            const CatIcon = cat.icon;

            return (
              <section
                key={cat.id}
                className="overflow-hidden rounded-2xl border border-[#2D2D30] bg-[#181818]"
              >
              <div className="flex items-center justify-between gap-2 border-b border-[#2D2D30] bg-[#181818] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
                    <CatIcon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h2 className="text-xs font-semibold text-[#F4F4F5]">
                        {cat.title}
                      </h2>
                      <p className="text-[11px] text-[#B4B4BC]">
                        {cat.subtitle}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-[#2D2D30]">
                  {items.map((check: DiagnosticCheckResult) => {
                    const meta = STATUS_STYLE[check.status];
                    const StatusIcon = meta.icon;
                    const expanded = expandedIds.has(check.id);

                    return (
                    <div key={check.id} className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleCheck(check.id)}
                          aria-expanded={expanded}
                          className="flex w-full items-start justify-between gap-3 text-left"
                        >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="mt-0.5 text-[#B4B4BC]">
                              {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-[#F4F4F5]">
                                  {check.title}
                                </span>
                                {check.detected_version && (
                                <span className="rounded bg-[#252527] px-1.5 py-0.5 font-mono text-[10px] text-[#7AA2FF]">
                                    {check.detected_version}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[11px] text-[#E4E4E7]">
                                {check.summary}
                              </p>
                            </div>
                          </div>

                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${meta.badge}`}
                          >
                          <StatusIcon className="h-3 w-3" />
                            <span>{meta.label}</span>
                          </span>
                        </button>

                        {expanded && (
                        <div className="mt-2.5 ml-6 space-y-2 rounded-xl border border-[#2D2D30] bg-[#181818] p-3 text-[11px]">
                            {check.detected_path && (
                              <div>
                                <span className="font-mono text-[10px] text-[#B4B4BC] uppercase">
                                  Path:{""}
                                </span>
                                <code className="break-all font-mono text-[#F4F4F5]">
                                  {check.detected_path}
                                </code>
                              </div>
                            )}
                            {check.command && (
                              <div>
                                <span className="font-mono text-[10px] text-[#B4B4BC] uppercase">
                                  Check Command:{""}
                                </span>
                                <code className="font-mono text-[#7AA2FF]">
                                  {check.command}
                                </code>
                              </div>
                            )}
                            {check.detail && (
                            <p className="leading-relaxed text-[#F4F4F5]">
                                {check.detail}
                              </p>
                            )}
                            {check.output && (
                            <pre className="vega-scroll max-h-32 overflow-auto rounded-lg border border-[#2D2D30] bg-[#181818] p-2 font-mono text-[10.5px] text-[#F4F4F5]">
                                {check.output}
                              </pre>
                            )}
                            {check.remediation && (
                            <div className="rounded-lg border border-[#7AA2FF]/25 bg-[#7AA2FF]/10 px-2.5 py-1.5 text-[#F4F4F5]">
                              <span className="font-semibold text-[#7AA2FF]">
                                  Suggested Action:{""}
                                </span>
                                {check.remediation}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Discovered Companion Tools */}
      {report && report.companion_tools.length > 0 && (
      <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
        <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
            Detected Toolchain Companion Utilities
          </p>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.companion_tools.map((tool) => (
              <div
                key={tool.name}
                className="flex flex-col rounded-lg border border-[#2D2D30] bg-[#181818] px-3 py-2"
              >
              <span className="font-mono text-xs font-medium text-[#7AA2FF]">
                  {tool.name}
                </span>
                <span className="truncate font-mono text-[10.5px] text-[#E4E4E7]">
                  {tool.path}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="px-1 pb-2 font-mono text-[10.5px] text-[#A1A1AA]">
        Note: USB board detection, serial port checks, Make firmware compilation,
        and XMODEM flashing remain disabled until subsequent Board/Build/Upload
        phases.
      </p>
    </div>
  );
}
