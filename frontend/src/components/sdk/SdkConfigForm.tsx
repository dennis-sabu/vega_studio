"use client";

import { useState, type FormEvent } from"react";
import {
  AlertTriangle,
  FileSearch,
  FolderOpen,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Stethoscope,
} from"lucide-react";
import type { BrowseOutcome } from"@/hooks/useSdkDoctor";
import type {
  SdkConfig,
  SdkConfigStateResponse,
  SdkDiscoveryResult,
} from"@/types/sdk";

interface SdkConfigFormProps {
  configState: SdkConfigStateResponse | null;
  hasElectronBrowse: boolean;
  isBackendConnected: boolean;
  saving: boolean;
  discovering: boolean;
  error?: string | null;
  onBrowseDirectory: (title: string, defaultPath?: string) => Promise<BrowseOutcome>;
  onBrowseFile: (title: string, defaultPath?: string) => Promise<BrowseOutcome>;
  onDiscover: (applyToConfig?: boolean) => Promise<SdkDiscoveryResult | null>;
  onSave: (
    config: SdkConfig,
    options?: { runCheckAfter?: boolean }
  ) => Promise<unknown>;
  onReset: () => Promise<unknown>;
}

const DEFAULT_CONFIG: SdkConfig = {
  sdk_root: null,
  toolchain_root: null,
  compiler_path: null,
  cross_compile_prefix: "riscv32-vega-elf",
  make_path: null,
  python_path: null,
  uploader_script: null,
  target_arch: "rv32i_zicsr",
  target_machine: "THEJAS32",
  extra_path_entries: [],
};

export function SdkConfigForm({
  configState,
  hasElectronBrowse,
  isBackendConnected,
  saving,
  discovering,
  error,
  onBrowseDirectory,
  onBrowseFile,
  onDiscover,
  onSave,
  onReset,
}: SdkConfigFormProps) {
  const baseConfig = configState?.config ?? DEFAULT_CONFIG;
  const [edits, setEdits] = useState<Partial<SdkConfig>>({});
  const [browseNotice, setBrowseNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const draft: SdkConfig = {
    ...baseConfig,
    ...edits,
  };

  const hasUnsavedEdits = Object.keys(edits).length > 0;

  const updateField = <K extends keyof SdkConfig>(key: K, value: SdkConfig[K]) => {
    setBrowseNotice(null);
    setConfirmReset(false);
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const handleBrowse = async (
    kind: "dir" |"file",
    key: keyof SdkConfig,
    title: string,
    currentVal: string | null
  ) => {
    setBrowseNotice(null);
    const outcome =
      kind === "dir"
        ? await onBrowseDirectory(title, currentVal ?? undefined)
        : await onBrowseFile(title, currentVal ?? undefined);

    if (!outcome.supported) {
      setBrowseNotice(
        "Native OS file/folder picker requires Electron desktop mode. Enter or paste the path directly below."
      );
      return;
    }
    if (!outcome.canceled && outcome.path) {
      updateField(key, outcome.path as SdkConfig[typeof key]);
    }
  };

  const handleAutoDetect = async () => {
    setBrowseNotice(null);
    const res = await onDiscover(false);
    if (res) {
      setEdits(res.suggested_config);
    }
  };

  const handleSave = async (runAfter: boolean) => {
    setBrowseNotice(null);
    const saved = await onSave(draft, { runCheckAfter: runAfter });
    if (saved) {
      setEdits({});
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const res = await onReset();
    if (res) {
      setEdits({});
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSave(true);
  };

  const renderPathField = (
    id: string,
    label: string,
    key:
      |"sdk_root"
      |"toolchain_root"
      |"compiler_path"
      |"make_path"
      |"python_path"
      |"uploader_script",
    kind: "dir" |"file",
    placeholder: string,
    hint: string
  ) => {
    const val = draft[key] ?? "";
    return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={id}
            className="text-xs font-medium text-[#F4F4F5]"
          >
            {label}
          </label>
          <span className="font-mono text-[10px] text-[#A1A1AA]">{hint}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            id={id}
            type="text"
            value={val}
            onChange={(e) => updateField(key, e.target.value || null)}
            placeholder={placeholder}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
          />
          <button
            type="button"
            title={
              hasElectronBrowse
                ? `Browse ${label}`
                : "Enter path manually in browser mode"
            }
            onClick={() =>
              void handleBrowse(kind, key, `Select ${label}`, draft[key])
            }
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#2D2D30] bg-[#252527] px-2.5 text-xs text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
          >
            {kind === "dir" ? (
            <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
            ) : (
            <FileSearch className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span className="hidden sm:inline">Browse</span>
          </button>
        </div>
      </div>
    );
  };

  return (
  <form onSubmit={handleSubmit} className="space-y-4">
      {/* Header action cluster */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2D2D30] bg-[#181818] px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#F4F4F5]">
            VEGA SDK &amp; Toolchain Paths
          </p>
          <p className="text-[11px] text-[#B4B4BC]">
            Stored in local application user data (`vega_studio.db`), never inside
            project repositories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!isBackendConnected || discovering || saving}
            onClick={() => void handleAutoDetect()}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-[#252527] px-3 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
          >
            {discovering ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
            ) : (
            <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span>Auto-Detect</span>
          </button>
          <button
            type="button"
            disabled={!isBackendConnected || saving || discovering}
            onClick={() => void handleReset()}
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[11px] font-medium transition-colors disabled:opacity-45 ${
              confirmReset
                ? "border-red-400/45 bg-red-500/20 text-red-200"
                : "border-[#2D2D30] bg-transparent text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
            }`}
          >
          <RotateCcw className="h-3 w-3" />
            <span>{confirmReset ? "Confirm Reset? " : "Reset Defaults"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/30 bg-red-500/12 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      {browseNotice && (
      <div className="rounded-xl border border-[#7AA2FF]/25 bg-[#7AA2FF]/10 px-3 py-2 text-xs text-[#F4F4F5]">
          {browseNotice}
        </div>
      )}

      {configState && configState.validation_warnings.length > 0 && (
      <div className="space-y-1 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-200">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Configured Path Notes</span>
          </div>
          {configState.validation_warnings.map((w) => (
          <p key={w} className="font-mono text-[11px] opacity-85">
              • {w}
            </p>
          ))}
        </div>
      )}

      {/* Primary SDK & Toolchain paths */}
      <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
        <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
          SDK &amp; Cross-Compiler
        </div>

        {renderPathField(
          "sdk-root-input",
          "VEGA SDK Root Directory",
          "sdk_root",
          "dir",
          "~/vega/vega-sdk",
          "Reference: ~/vega/vega-sdk"
        )}
        {renderPathField(
          "toolchain-root-input",
          "Toolchain Root Directory",
          "toolchain_root",
          "dir",
          "~/vega/vega-tools-rv32",
          "Reference: ~/vega/vega-tools-rv32"
        )}
        {renderPathField(
          "compiler-path-input",
          "Cross-Compiler Executable (Optional Override)",
          "compiler_path",
          "file",
          "Auto-resolved from Toolchain Root/bin",
          "riscv32-vega-elf-gcc"
        )}
      </div>

      {/* Build & Upload Prerequisites */}
      <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
        <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
          Build &amp; Upload Tools
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {renderPathField(
            "make-path-input",
            "Make Executable",
            "make_path",
            "file",
            "Auto-detected from PATH (make)",
            "make"
          )}
          {renderPathField(
            "python-path-input",
            "Python 3 Executable",
            "python_path",
            "file",
            "Auto-detected from PATH (python3)",
            "python3"
          )}
        </div>

        {renderPathField(
          "uploader-script-input",
          "VEGA XMODEM Uploader Script",
          "uploader_script",
          "file",
          "~/vega/tools/vega_xmodem.py",
          "Reference: ~/vega/tools/vega_xmodem.py"
        )}
      </div>

      {/* Target Architecture & Extra PATH */}
      <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
        <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
          VEGA ARIES V3 Target &amp; Environment
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label
              htmlFor="prefix-input"
              className="text-xs font-medium text-[#F4F4F5]"
            >
              Cross-Compile Prefix
            </label>
            <input
              id="prefix-input"
              type="text"
              value={draft.cross_compile_prefix}
              onChange={(e) =>
                updateField("cross_compile_prefix", e.target.value)
              }
              className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="arch-input"
              className="text-xs font-medium text-[#F4F4F5]"
            >
              Target Architecture
            </label>
            <input
              id="arch-input"
              type="text"
              value={draft.target_arch}
              onChange={(e) => updateField("target_arch", e.target.value)}
              className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="machine-input"
              className="text-xs font-medium text-[#F4F4F5]"
            >
              Target Machine
            </label>
            <input
              id="machine-input"
              type="text"
              value={draft.target_machine}
              onChange={(e) => updateField("target_machine", e.target.value)}
              className="h-8 w-full rounded-lg border border-[#2D2D30] bg-[#181818] px-2.5 font-mono text-xs text-[#F4F4F5] focus:border-[#7AA2FF]/55 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="extra-path-input"
              className="text-xs font-medium text-[#F4F4F5]"
            >
              Additional Toolchain PATH Entries (Optional)
            </label>
            <span className="font-mono text-[10px] text-[#A1A1AA]">
              One directory per line (never mutates OS PATH)
            </span>
          </div>
          <textarea
            id="extra-path-input"
            rows={2}
            value={draft.extra_path_entries.join("\n")}
            onChange={(e) =>
              updateField(
                "extra_path_entries",
                e.target.value
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            placeholder="~/vega/vega-tools-rv32/bin"
            className="w-full rounded-lg border border-[#2D2D30] bg-[#181818] p-2.5 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
          />
        </div>
      </div>

      {/* Footer Submit Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="font-mono text-[11px] text-[#B4B4BC]">
          {hasUnsavedEdits
            ? "Unsaved SDK configuration edits"
            : configState?.is_customized
            ? "Saved custom SDK configuration active"
            : "Using automatic reference defaults"}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!isBackendConnected || saving}
            onClick={() => void handleSave(false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#2D2D30] bg-[#252527] px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
          >
            {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
            ) : (
            <Save className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span>Save Only</span>
          </button>

          <button
            type="submit"
            disabled={!isBackendConnected || saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#7AA2FF]/45 bg-[#7AA2FF]/20 px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/30 disabled:opacity-45"
          >
            {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
            ) : (
            <Stethoscope className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span>Save &amp; Run Diagnostics</span>
          </button>
        </div>
      </div>
    </form>
  );
}
