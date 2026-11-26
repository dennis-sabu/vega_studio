"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Cpu,
  FolderOpen,
  FolderPlus,
  Loader2,
  X,
} from "lucide-react";
import type { DirectoryPickerOutcome } from "@/hooks/useWorkspace";
import type { CreateProjectPayload, ProjectTemplate } from "@/types/project";

interface NewProjectDialogProps {
  open: boolean;
  defaultParentDir: string;
  isBackendConnected: boolean;
  isElectronBridge: boolean;
  pending: boolean;
  serverError: string | null;
  onClose: () => void;
  onBrowseParent: (currentPath: string) => Promise<DirectoryPickerOutcome>;
  onSubmit: (payload: CreateProjectPayload) => Promise<void>;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function validateProjectNameClient(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null; // Shown gently before submit
  if (name.length > 64) return "Name must be 64 characters or fewer.";
  if (name.includes("..")) return "Name cannot contain '..'.";
  if (INVALID_CHARS.test(name)) {
    return "Name contains invalid filesystem characters.";
  }
  if (name.endsWith(".") || name.endsWith(" ")) {
    return "Name cannot end with a period or space.";
  }
  if (RESERVED_NAMES.has(name.split(".")[0].toUpperCase())) {
    return `'${name}' is a reserved device name.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return "Start with a letter or digit; use letters, digits, spaces, '.', '_' or '-'.";
  }
  return null;
}

export function NewProjectDialog({
  open,
  defaultParentDir,
  isBackendConnected,
  isElectronBridge,
  pending,
  serverError,
  onClose,
  onBrowseParent,
  onSubmit,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("minimal");
  const [localError, setLocalError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  // Sync default location when opening if parentDir is still blank
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setLocalError(null);
      if (!parentDir && defaultParentDir) {
        setParentDir(defaultParentDir);
      }
    });
  }, [open, defaultParentDir, parentDir]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  const nameValidationError = useMemo(
    () => validateProjectNameClient(name),
    [name]
  );

  const previewPath = useMemo(() => {
    const cleanParent = parentDir.trim().replace(/[\\/]+$/, "");
    const cleanName = name.trim();
    if (!cleanParent || !cleanName) return cleanParent || "—";
    const sep = cleanParent.includes("\\") ? "\\" : "/";
    return `${cleanParent}${sep}${cleanName}`;
  }, [parentDir, name]);

  if (!open) return null;

  const handleBrowse = async () => {
    setBrowsing(true);
    setLocalError(null);
    try {
      const outcome = await onBrowseParent(parentDir);
      if (!outcome.supported) {
        setLocalError(
          "Native folder picker requires Electron desktop mode. Enter an absolute folder path manually."
        );
      } else if (!outcome.canceled && outcome.path) {
        setParentDir(outcome.path);
      }
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to open folder picker."
      );
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const trimmedName = name.trim();
    const trimmedParent = parentDir.trim();

    if (!trimmedName) {
      setLocalError("Please enter a project name.");
      return;
    }
    if (nameValidationError) {
      setLocalError(nameValidationError);
      return;
    }
    if (!trimmedParent) {
      setLocalError("Please choose a project location.");
      return;
    }
    if (!isBackendConnected) {
      setLocalError(
        "FastAPI backend is offline. Start the backend before creating a project."
      );
      return;
    }

    try {
      await onSubmit({
        name: trimmedName,
        parent_dir: trimmedParent,
        description: description.trim(),
        template,
      });
      setName("");
      setDescription("");
      onClose();
    } catch {
      // Server error is surfaced via serverError prop.
    }
  };

  const displayedError = localError ?? nameValidationError ?? serverError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New VEGA Studio Project"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/70 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="vega-glass flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] bg-[#090b13]/92 shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-[#7aa2ff]">
              <FolderPlus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8ebf7]">
                New VEGA Project
              </h2>
              <p className="text-[11px] text-[#e8ebf7]/50">
                Portable project workspace for C-DAC VEGA ARIES V3
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={pending}
            aria-label="Close New Project dialog"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[#e8ebf7]/70 hover:bg-white/12 hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="vega-scroll space-y-4 overflow-y-auto p-5">
          {!isBackendConnected && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Backend service is disconnected. Connect or start the FastAPI
                backend to initialize projects on disk.
              </span>
            </div>
          )}

          {displayedError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/12 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{displayedError}</span>
            </div>
          )}

          {/* Project Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="vega-project-name"
              className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/55 uppercase"
            >
              Project Name
            </label>
            <input
              id="vega-project-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => {
                setLocalError(null);
                setName(e.target.value);
              }}
              placeholder="aries_v3_firmware"
              className="h-10 w-full rounded-xl border border-white/12 bg-[#06070c]/85 px-3 font-mono text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none focus:ring-2 focus:ring-[#7aa2ff]/20"
            />
          </div>

          {/* Project Location */}
          <div className="space-y-1.5">
            <label
              htmlFor="vega-project-location"
              className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/55 uppercase"
            >
              Location
            </label>
            <div className="flex gap-2">
              <input
                id="vega-project-location"
                type="text"
                value={parentDir}
                onChange={(e) => {
                  setLocalError(null);
                  setParentDir(e.target.value);
                }}
                placeholder="C:\Users\...\Documents\VEGA Studio Projects"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/12 bg-[#06070c]/85 px-3 font-mono text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none focus:ring-2 focus:ring-[#7aa2ff]/20"
              />
              <button
                type="button"
                disabled={browsing || pending}
                onClick={() => void handleBrowse()}
                title={
                  isElectronBridge
                    ? "Choose parent directory"
                    : "Native dialog available in Electron desktop mode"
                }
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7]/85 transition-colors hover:bg-white/12 hover:text-[#e8ebf7] disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>{browsing ? "Opening..." : "Browse..."}</span>
              </button>
            </div>
            <p className="truncate font-mono text-[11px] text-[#e8ebf7]/40">
              Target folder: {previewPath}
            </p>
          </div>

          {/* Template Selection */}
          <div className="space-y-1.5">
            <span className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/55 uppercase">
              Initial Structure
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTemplate("minimal")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  template === "minimal"
                    ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/10 text-[#e8ebf7]"
                    : "border-white/10 bg-[#06070c]/60 text-[#e8ebf7]/65 hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Minimal Firmware</span>
                  <span className="font-mono text-[10px] text-[#7aa2ff]">
                    Recommended
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-[#e8ebf7]/45">
                  src/main.c, include/, Makefile, README.md, vega-project.json
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTemplate("empty")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  template === "empty"
                    ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/10 text-[#e8ebf7]"
                    : "border-white/10 bg-[#06070c]/60 text-[#e8ebf7]/65 hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Empty Project</span>
                </div>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-[#e8ebf7]/45">
                  src/, include/, README.md, .gitignore, vega-project.json
                </p>
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="vega-project-desc"
              className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/55 uppercase"
            >
              Description (optional)
            </label>
            <input
              id="vega-project-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Firmware workspace for VEGA ARIES V3"
              className="h-9 w-full rounded-xl border border-white/12 bg-[#06070c]/85 px-3 text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none focus:ring-2 focus:ring-[#7aa2ff]/20"
            />
          </div>

          {/* Target Metadata Summary */}
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-[#06070c]/60 px-3.5 py-2.5 font-mono text-[11px] text-[#e8ebf7]/55">
            <span className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-[#7aa2ff]" />
              <span>Target: VEGA_ARIES_V3</span>
            </span>
            <span>rv32i_zicsr · THEJAS32</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.08] bg-[#070910]/75 px-5 py-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-[#e8ebf7]/75 hover:bg-white/10 hover:text-[#e8ebf7] disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              pending ||
              !isBackendConnected ||
              !name.trim() ||
              !parentDir.trim() ||
              Boolean(nameValidationError)
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#e8ebf7] px-4 text-xs font-semibold text-[#06070c] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{pending ? "Creating..." : "Create Project"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
