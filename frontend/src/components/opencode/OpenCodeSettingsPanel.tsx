"use client";

import { useState, type FormEvent } from"react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  TerminalSquare,
} from"lucide-react";
import type { BrowseOutcome } from"@/hooks/useSdkDoctor";
import type {
  OpenCodeConfig,
  OpenCodeConfigStateResponse,
  OpenCodePermissionMode,
} from"@/types/opencode";

export interface OpenCodeSettingsPanelProps {
  configState: OpenCodeConfigStateResponse | null;
  hasElectronBrowse: boolean;
  isBackendConnected: boolean;
  saving: boolean;
  loading: boolean;
  error?: string | null;
  onBrowseFile: (title: string, defaultPath?: string) => Promise<BrowseOutcome>;
  onRefresh: () => void;
  onSave: (config: OpenCodeConfig) => Promise<unknown>;
  onReset: () => Promise<unknown>;
}

const DEFAULT_CFG: OpenCodeConfig = {
  executable_path: null,
  default_permission_mode: "ask_all",
  default_model: null,
  startup_timeout_seconds: 20,
};

const PERMISSION_OPTIONS: {
  id: OpenCodePermissionMode;
  title: string;
  desc: string;
}[] = [
  {
    id: "ask_all",
    title: "Ask Before Actions (Recommended)",
    desc: "Prompts for explicit approval before tools, file edits, shell commands, or external network requests.",
  },
  {
    id: "workspace_assisted",
    title: "Read Workspace · Ask Edits & Shell",
    desc: "Allows reading files inside the active project automatically; asks before any edits, deletes, or commands.",
  },
  {
    id: "read_only",
    title: "Read-Only Analysis",
    desc: "Blocks file writes and shell execution completely; permits reading workspace files for explanation only.",
  },
];

export function OpenCodeSettingsPanel({
  configState,
  hasElectronBrowse,
  isBackendConnected,
  saving,
  loading,
  error,
  onBrowseFile,
  onRefresh,
  onSave,
  onReset,
}: OpenCodeSettingsPanelProps) {
  const baseConfig = configState?.config ?? DEFAULT_CFG;
  const [edits, setEdits] = useState<Partial<OpenCodeConfig>>({});
  const [browseNote, setBrowseNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const draft: OpenCodeConfig = { ...baseConfig, ...edits };
  const hasUnsaved = Object.keys(edits).length > 0;
  const info = configState?.info;

  const update = <K extends keyof OpenCodeConfig>(
    k: K,
    val: OpenCodeConfig[K]
  ) => {
    setBrowseNote(null);
    setConfirmReset(false);
    setEdits((prev) => ({ ...prev, [k]: val }));
  };

  const handleBrowse = async () => {
    const out = await onBrowseFile(
      "Locate VEGA AI (OpenCode) CLI Executable",
      draft.executable_path ?? undefined
    );
    if (!out.supported) {
      setBrowseNote(
        "OS file picker requires Electron desktop mode. Enter the path to `opencode`, `opencode.exe`, or `opencode.cmd` below."
      );
      return;
    }
    if (!out.canceled && out.path) {
      update("executable_path", out.path);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await onSave(draft);
    if (res) setEdits({});
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const res = await onReset();
    if (res) setEdits({});
  };

  return (
  <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[8px] border border-red-400/25 bg-[#181818] px-3.5 py-2.5 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-red-300 uppercase">
              VEGA AI Error
            </div>
            <p className="text-[11.5px] leading-relaxed text-[#F4F4F5]">{error}</p>
          </div>
        </div>
      )}

      {/* CLI Status Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
            <TerminalSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#F4F4F5]">
                VEGA AI Runtime (OpenCode CLI)
              </span>
              {info?.available ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                <CheckCircle2 className="h-2.5 w-2.5" />
                  <span>v{info.version || "?"}</span>
                </span>
              ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-500/12 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                <AlertTriangle className="h-2.5 w-2.5" />
                  <span>Not Detected</span>
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-[10.5px] text-[#E4E4E7]">
              {info?.executable_path
                ? `${info.executable_source}: ${info.executable_path}`
                : info?.unavailable_reason ||
                  "Install OpenCode CLI or configure its executable path below to enable VEGA AI."}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!isBackendConnected || loading}
          onClick={onRefresh}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 font-mono text-[11px] text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
        >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          <span>Verify CLI</span>
        </button>
      </div>

      {/* Executable Path Card */}
      <div className="space-y-3 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
        <div>
          <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
            VEGA AI CLI Executable (Allowlisted)
          </span>
          <p className="mt-0.5 text-[11px] text-[#E4E4E7]">
            Leave empty to auto-discover `opencode` on PATH. Only verified `opencode` binaries are accepted.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft.executable_path ?? ""}
            disabled={saving}
            placeholder="Auto-discover `opencode` from PATH"
            aria-label="VEGA AI CLI executable path"
            onChange={(e) =>
              update("executable_path", e.target.value || null)
            }
            className="h-8 min-w-0 flex-1 rounded-[6px] border border-[#2D2D30] bg-[#121214] px-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
          />
          {hasElectronBrowse && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleBrowse()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-[#2D2D30] bg-[#252527] px-2.5 font-mono text-[11px] text-[#F4F4F5] hover:bg-[#2D2D31]"
            >
            <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
              <span>Browse</span>
            </button>
          )}
        </div>
        {browseNote && (
        <p className="text-[11px] text-amber-200/85">{browseNote}</p>
        )}

        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-[0.06em] text-[#E4E4E7] uppercase">
              Optional Default Model
            </label>
            <input
              type="text"
              value={draft.default_model ?? ""}
              disabled={saving}
              placeholder="Use VEGA AI default"
              onChange={(e) => update("default_model", e.target.value || null)}
              className="h-8 w-full rounded-[6px] border border-[#2D2D30] bg-[#121214] px-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-[0.06em] text-[#E4E4E7] uppercase">
              <span>Server Startup Timeout</span>
              <span className="text-[#7AA2FF]">
                {draft.startup_timeout_seconds}s
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={draft.startup_timeout_seconds}
              disabled={saving}
              aria-label="VEGA AI startup timeout seconds"
              onChange={(e) =>
                update(
                  "startup_timeout_seconds",
                  parseFloat(e.target.value)
                )
              }
              style={{
                ["--fill" as string]: `${(((draft.startup_timeout_seconds - 5) / 55) * 100).toFixed(1)}%`,
              }}
              className="vega-slider mt-1.5"
            />
          </div>
        </div>
      </div>

      {/* Permission Policy Card */}
      <div className="space-y-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-4">
        <span className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
          Default Safety &amp; Permission Policy
        </span>
        <div className="space-y-2">
          {PERMISSION_OPTIONS.map((opt) => {
            const active = draft.default_permission_mode === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-[6px] border p-2.5 transition-colors ${
                  active
                    ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/12"
                    : "border-[#2D2D30] bg-[#252527] hover:bg-[#2D2D31]"
                }`}
              >
                <input
                  type="radio"
                  name="opencode_perm_mode"
                  checked={active}
                  onChange={() => update("default_permission_mode", opt.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#F4F4F5]">
                    {opt.title}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[#E4E4E7]">
                    {opt.desc}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Security & Credential Boundary Note */}
      <div className="flex items-start gap-2.5 rounded-[8px] border border-[#2D2D30] bg-[#181818] p-3 text-[11px] leading-relaxed text-[#E4E4E7]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#7AA2FF]" />
        <p>
          Provider API keys and login tokens are managed exclusively by your OpenCode CLI auth (`opencode auth`) for VEGA AI and are never saved in `vega-project.json` or VEGA SQLite storage.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          disabled={!isBackendConnected || saving}
          onClick={() => void handleReset()}
          className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-3 text-xs font-medium transition-colors disabled:opacity-45 ${
            confirmReset
              ? "border-red-400/45 bg-red-500/20 text-red-200"
              : "border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31]"
          }`}
        >
        <RotateCcw className="h-3.5 w-3.5" />
          <span>{confirmReset ? "Confirm Reset? " : "Reset Defaults"}</span>
        </button>

        <button
          type="submit"
          disabled={!isBackendConnected || saving || !hasUnsaved}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#7AA2FF]/45 bg-[#7AA2FF]/22 px-4 text-xs font-semibold text-[#F4F4F5] hover:bg-[#7AA2FF]/32 disabled:opacity-40"
        >
          {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
          <Save className="h-3.5 w-3.5" />
          )}
          <span>Save VEGA AI Settings</span>
        </button>
      </div>
    </form>
  );
}
