"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileCode2,
  FolderOpen,
  FolderPlus,
  Loader2,
  X,
} from "lucide-react";
import { validateProjectNameClient } from "@/components/project/NewProjectDialog";
import type { DirectoryPickerOutcome } from "@/hooks/useWorkspace";
import type { BoardProfile } from "@/types/board";
import type {
  CreateProjectFromExamplePayload,
  ExampleSummary,
  ExampleValidationResponse,
} from "@/types/learning";

interface CreateFromExampleModalProps {
  example: ExampleSummary | null;
  boards: BoardProfile[];
  defaultParentDir: string;
  isBackendConnected: boolean;
  isElectronBridge: boolean;
  validating: boolean;
  validationReport: ExampleValidationResponse | null;
  pending: boolean;
  serverError: string | null;
  collisionPrompted: boolean;
  onValidateForBoard: (exampleId: string, boardId: string) => void;
  onBrowseParent: (currentPath: string) => Promise<DirectoryPickerOutcome>;
  onClose: () => void;
  onSubmit: (payload: CreateProjectFromExamplePayload) => Promise<boolean>;
}

function suggestProjectName(exampleId: string | undefined): string {
  if (!exampleId) return "";
  const cleaned = exampleId
    .replace(/^sdk:/i, "sdk_")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 48);
  return cleaned ? `${cleaned}_app` : "vega_example_app";
}

function InnerCreateFromExampleModal({
  example,
  boards,
  defaultParentDir,
  isBackendConnected,
  isElectronBridge,
  validating,
  validationReport,
  pending,
  serverError,
  collisionPrompted,
  onValidateForBoard,
  onBrowseParent,
  onClose,
  onSubmit,
}: Omit<CreateFromExampleModalProps, "example"> & { example: ExampleSummary }) {
  const [name, setName] = useState(() => suggestProjectName(example.id));
  const [parentDir, setParentDir] = useState(defaultParentDir);
  const [boardId, setBoardId] = useState(
    example.compatible_boards[0] ?? boards[0]?.id ?? "VEGA_ARIES_V3"
  );
  const [description, setDescription] = useState(example.short_description);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const effectiveParent = parentDir || defaultParentDir;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, onClose]);

  const nameValidationError = useMemo(
    () => validateProjectNameClient(name),
    [name]
  );

  const previewPath = useMemo(() => {
    const cleanParent = effectiveParent.trim().replace(/[\\/]+$/, "");
    const cleanName = name.trim();
    if (!cleanParent || !cleanName) return cleanParent || "—";
    const sep = cleanParent.includes("\\") ? "\\" : "/";
    return `${cleanParent}${sep}${cleanName}`;
  }, [effectiveParent, name]);

  const handleBrowse = async () => {
    setBrowsing(true);
    setLocalError(null);
    try {
      const outcome = await onBrowseParent(effectiveParent);
      if (!outcome.supported) {
        setLocalError(
          "Native folder picker requires Electron desktop mode. Enter an absolute directory path manually."
        );
      } else if (!outcome.canceled && outcome.path) {
        setParentDir(outcome.path);
      }
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to open directory picker."
      );
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const trimmedName = name.trim();
    const trimmedParent = effectiveParent.trim();
    if (!trimmedName) {
      setLocalError("Please enter a project name.");
      return;
    }
    if (nameValidationError) {
      setLocalError(nameValidationError);
      return;
    }
    if (!trimmedParent) {
      setLocalError("Please choose a destination parent folder.");
      return;
    }
    if (!isBackendConnected) {
      setLocalError(
        "FastAPI backend is offline. Start the backend before creating a project."
      );
      return;
    }
    if (collisionPrompted && !confirmOverwrite) {
      setLocalError(
        "Destination folder already exists. Confirm overwriting matching example files or choose a new folder name."
      );
      return;
    }

    await onSubmit({
      example_id: example.id,
      project_name: trimmedName,
      parent_dir: trimmedParent,
      board_id: boardId,
      description: description.trim() || null,
      confirm_overwrite: collisionPrompted ? confirmOverwrite : false,
    });
  };

  const displayError = localError || serverError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-from-example-title"
    >
      <div className="vega-panel-glass flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 shadow-[0_28px_80px_rgba(0,0,0,0.85)]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 text-[#9ec0ff]">
              <FolderPlus className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2
                id="create-from-example-title"
                className="text-base font-semibold tracking-tight text-[#f0f3ff]"
              >
                Create Project from Example
              </h2>
              <p className="mt-0.5 text-xs text-[#e8ebf7]/60">
                {example.title} ({example.origin_label})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close create from example modal"
            className="rounded-lg p-1.5 text-[#e8ebf7]/50 transition-colors hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="vega-scroll flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          {/* Verification notice */}
          <div className="rounded-xl border border-white/10 bg-[#0b0e18]/75 px-3.5 py-2.5 text-xs text-[#e8ebf7]/78">
            <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#7aa2ff] uppercase">
              Source Provenance:{" "}
              {example.verification_status.replace("_", " ")}
            </span>
            <p className="mt-1 leading-relaxed text-[#e8ebf7]/68">
              {example.verification_note}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Project Name */}
            <div>
              <label
                htmlFor="example-proj-name"
                className="mb-1.5 block font-mono text-[11px] font-medium tracking-[0.04em] text-[#e8ebf7]/70 uppercase"
              >
                Project Name
              </label>
              <input
                id="example-proj-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setConfirmOverwrite(false);
                }}
                placeholder="aries_firmware_app"
                className="w-full rounded-xl border border-white/12 bg-[#06070c]/80 px-3 py-2 text-sm text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/60 focus:outline-none"
                disabled={pending}
                autoFocus
              />
              {nameValidationError && (
                <p className="mt-1 text-[11px] text-rose-400">
                  {nameValidationError}
                </p>
              )}
            </div>

            {/* Target Board */}
            <div>
              <label
                htmlFor="example-board-id"
                className="mb-1.5 block font-mono text-[11px] font-medium tracking-[0.04em] text-[#e8ebf7]/70 uppercase"
              >
                Target Board
              </label>
              <div className="relative flex items-center">
                <Cpu className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#7aa2ff]" />
                <select
                  id="example-board-id"
                  value={boardId}
                  onChange={(e) => {
                    const nextBoard = e.target.value;
                    setBoardId(nextBoard);
                    onValidateForBoard(example.id, nextBoard);
                  }}
                  disabled={pending}
                  className="w-full rounded-xl border border-white/12 bg-[#06070c]/80 py-2 pr-3 pl-9 text-sm text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
                >
                  {(boards.length > 0
                    ? boards
                    : [
                        {
                          id: "VEGA_ARIES_V3",
                          name: "VEGA ARIES V3",
                        } as BoardProfile,
                      ]
                  ).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Parent Directory */}
          <div>
            <label
              htmlFor="example-parent-dir"
              className="mb-1.5 block font-mono text-[11px] font-medium tracking-[0.04em] text-[#e8ebf7]/70 uppercase"
            >
              Location
            </label>
            <div className="flex gap-2">
              <input
                id="example-parent-dir"
                type="text"
                value={effectiveParent}
                onChange={(e) => {
                  setParentDir(e.target.value);
                  setConfirmOverwrite(false);
                }}
                placeholder="C:\Users\you\Documents\VEGA Studio Projects"
                className="flex-1 rounded-xl border border-white/12 bg-[#06070c]/80 px-3 py-2 font-mono text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/60 focus:outline-none"
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => void handleBrowse()}
                disabled={pending || browsing}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 text-xs font-medium text-[#e8ebf7]/85 transition-colors hover:bg-white/[0.12] disabled:opacity-45"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>{browsing ? "Browsing..." : "Browse..."}</span>
              </button>
            </div>
            {!isElectronBridge && (
              <p className="mt-1 text-[11px] text-[#e8ebf7]/45">
                Running in browser mode: enter an absolute host directory path directly.
              </p>
            )}
            <div className="mt-1.5 rounded-lg border border-white/8 bg-[#05060b]/70 px-2.5 py-1.5 font-mono text-[11px] text-[#e8ebf7]/60">
              Destination: <span className="text-[#a8c4ff]">{previewPath}</span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="example-proj-desc"
              className="mb-1.5 block font-mono text-[11px] font-medium tracking-[0.04em] text-[#e8ebf7]/70 uppercase"
            >
              Description (Optional)
            </label>
            <input
              id="example-proj-desc"
              type="text"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-white/12 bg-[#06070c]/80 px-3 py-2 text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
              disabled={pending}
            />
          </div>

          {/* Validation & Planned Files Preview */}
          <div className="rounded-xl border border-white/10 bg-[#070a12]/80 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] font-semibold tracking-[0.06em] text-[#e8ebf7]/65 uppercase">
                Validation &amp; Planned Files
              </span>
              {validating ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#7aa2ff]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking...
                </span>
              ) : validationReport ? (
                <span
                  className={`inline-flex items-center gap-1 font-mono text-[10.5px] ${
                    validationReport.compatible && validationReport.valid
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }`}
                >
                  {validationReport.compatible && validationReport.valid ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {validationReport.sdk_ready_note}
                </span>
              ) : null}
            </div>

            {validationReport?.issues.map((issue, idx) => (
              <p
                key={`issue-${idx}`}
                className="mt-1.5 text-xs text-rose-300"
              >
                • {issue}
              </p>
            ))}
            {validationReport?.warnings.map((warn, idx) => (
              <p
                key={`warn-${idx}`}
                className="mt-1.5 text-xs text-amber-200/85"
              >
                • {warn}
              </p>
            ))}

            {validationReport && validationReport.planned_files.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {validationReport.planned_files.map((rel) => (
                  <span
                    key={rel}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-[#e8ebf7]/75"
                  >
                    <FileCode2 className="h-3 w-3 text-[#7aa2ff]/80" />
                    <span>{rel}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Collision Guard Confirmation */}
          {collisionPrompted && (
            <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="font-medium text-amber-200">
                    Destination folder already exists
                  </p>
                  <p className="mt-1 text-amber-100/80">
                    Rename the project above, or explicitly confirm overwriting
                    matching files inside this destination directory.
                  </p>
                  <label className="mt-2.5 flex cursor-pointer items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={confirmOverwrite}
                      onChange={(e) => setConfirmOverwrite(e.target.checked)}
                      className="h-4 w-4 rounded border-amber-300/40 bg-[#06070c]"
                    />
                    <span className="font-medium text-amber-200">
                      Yes, overwrite matching example files in existing folder
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {displayError && !collisionPrompted && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{displayError}</span>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 border-t border-white/8 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-medium text-[#e8ebf7]/80 transition-colors hover:bg-white/[0.09] disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                pending ||
                Boolean(nameValidationError) ||
                (collisionPrompted && !confirmOverwrite) ||
                (validationReport ? !validationReport.compatible : false)
              }
              className="inline-flex items-center gap-2 rounded-xl border border-[#7aa2ff]/40 bg-[#7aa2ff]/20 px-4 py-2 text-xs font-semibold text-[#edf2ff] transition-colors hover:bg-[#7aa2ff]/30 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Creating Project...</span>
                </>
              ) : (
                <>
                  <FolderPlus className="h-3.5 w-3.5 text-[#a8c4ff]" />
                  <span>
                    {collisionPrompted
                      ? "Overwrite & Open Project"
                      : "Create & Open Project"}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateFromExampleModal(props: CreateFromExampleModalProps) {
  if (!props.example) return null;
  return (
    <InnerCreateFromExampleModal
      key={props.example.id}
      {...props}
      example={props.example}
    />
  );
}
