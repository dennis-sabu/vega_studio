"use client";

import { useEffect, useState } from"react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Loader2,
  ShieldAlert,
  X,
} from"lucide-react";
import { validateAiCodeApply } from"@/lib/api";
import type {
  AICodeApplyValidateResponse,
  PendingCodeApplyProposal,
} from"@/types/ai";

interface AiCodeApplyModalProps {
  proposal: PendingCodeApplyProposal | null;
  projectDir: string | null;
  activeFilePath: string | null;
  activeFileDirty: boolean;
  existingSelectionText: string | null;
  existingFileContent: string | null;
  onCancel: () => void;
  onConfirmApply: (proposal: PendingCodeApplyProposal) => void;
}

const MODE_LABELS = {
  insert_at_cursor: "Insert at Cursor",
  replace_selection: "Replace Current Selection",
  replace_file: "Replace Active File Buffer",
} as const;

export function AiCodeApplyModal({
  proposal,
  projectDir,
  activeFilePath,
  activeFileDirty,
  existingSelectionText,
  existingFileContent,
  onCancel,
  onConfirmApply,
}: AiCodeApplyModalProps) {
  const requestKey =
    proposal && projectDir && activeFilePath
      ? `${projectDir}|${activeFilePath}|${proposal.mode}|${proposal.code.length}|${proposal.code.slice(0, 32)}`
      : null;

  const [validationState, setValidationState] = useState<{
    key: string;
    res: AICodeApplyValidateResponse | null;
    error: string | null;
  } | null>(null);

  const isOpen = Boolean(proposal);

  useEffect(() => {
    if (!isOpen) return;
    const prev =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      queueMicrotask(() => {
        if (prev && prev.isConnected) prev.focus();
      });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  useEffect(() => {
    if (!proposal || !projectDir || !activeFilePath || !requestKey) {
      return;
    }
    let cancelled = false;

    validateAiCodeApply({
      project_dir: projectDir,
      relative_path: activeFilePath,
      mode: proposal.mode,
      code: proposal.code,
    })
      .then((res) => {
        if (!cancelled) {
          setValidationState({ key: requestKey, res, error: null });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setValidationState({
            key: requestKey,
            res: null,
            error: err instanceof Error ? err.message : "Validation failed.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [proposal, projectDir, activeFilePath, requestKey]);

  if (!proposal) return null;

  const activeResult =
    requestKey && validationState?.key === requestKey ? validationState : null;
  const validating = Boolean(requestKey && !activeResult);
  const validation = activeResult?.res ?? null;
  const validationError = activeResult?.error ?? null;

  const canApply =
    Boolean(projectDir && activeFilePath) &&
    !validating &&
    !validationError &&
    Boolean(validation?.allowed);

  const beforeText =
    proposal.mode === "replace_selection"
      ? existingSelectionText ?? "(No text selected)"
      : proposal.mode === "replace_file"
      ? existingFileContent ?? validation?.current_excerpt ?? ""
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-code-apply-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
    >
      <div
        className="vega-glass flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2D2D30] px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#7AA2FF]/35 bg-[#7AA2FF]/15 text-[#7AA2FF]">
              <FileCode2 className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h2
                id="ai-code-apply-title"
                className="text-sm font-medium text-[#F4F4F5]"
              >
                Review AI Code Application — {MODE_LABELS[proposal.mode]}
              </h2>
              <p className="truncate font-mono text-[11px] text-[#E4E4E7]">
                Target: {activeFilePath ?? "No active file open"}{""}
                {activeFileDirty ? "· (Unsaved edits open)" : ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Cancel review"
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
          >
          <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="vega-scroll flex-1 space-y-3 overflow-y-auto p-5">
          <div className="rounded-xl border border-[#7AA2FF]/25 bg-[#7AA2FF]/[0.07] px-3.5 py-2.5 text-[11.5px] text-[#F4F4F5]">
            Applying updates only the active Monaco editor buffer (you can undo with{""}
            <kbd className="rounded bg-[#2C2C30] px-1 font-mono text-[10px]">Ctrl+Z</kbd>{""}
            and must save explicitly with{""}
            <kbd className="rounded bg-[#2C2C30] px-1 font-mono text-[10px]">Ctrl+S</kbd>
            ). Nothing is written to disk silently.
          </div>

          {validating ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#2D2D30] bg-[#252527] px-3.5 py-2.5 text-xs text-[#F4F4F5]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              <span>Validating workspace file boundary…</span>
            </div>
          ) : validationError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/35 bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          ) : validation && !validation.allowed ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/35 bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{validation.reason ||"Target file rejected by workspace guard."}</span>
            </div>
          ) : validation?.allowed ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2 text-[11.5px] text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Target verified inside workspace:{""}
                <span className="font-mono font-semibold">
                  {validation.normalized_relative_path}
                </span>
              </span>
            </div>
          ) : (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Open an editable project file tab before applying code.</span>
            </div>
          )}

          {/* Diff / Preview Split */}
          <div
            className={`grid gap-3 ${
              beforeText !== null ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
            }`}
          >
            {beforeText !== null && (
            <div className="overflow-hidden rounded-xl border border-[#2D2D30] bg-[#181818]">
              <div className="border-b border-[#2D2D30] bg-[#181818] px-3 py-1.5 font-mono text-[10px] font-semibold text-red-200 uppercase">
                  Current ({proposal.mode === "replace_selection" ? "Selected Text" : "File Buffer"})
                </div>
                <pre className="vega-scroll max-h-64 overflow-auto p-3 font-mono text-[10.5px] leading-relaxed text-[#F4F4F5]">
                  {beforeText.slice(0, 6000)}
                </pre>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-emerald-400/20 bg-[#181818]">
              <div className="border-b border-[#2D2D30] bg-[#181818] px-3 py-1.5 font-mono text-[10px] font-semibold text-emerald-300 uppercase">
                Proposed ({proposal.language ||"code"})
              </div>
              <pre className="vega-scroll max-h-64 overflow-auto p-3 font-mono text-[10.5px] leading-relaxed text-[#F4F4F5]/95">
                {proposal.code}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#2D2D30] bg-[#181818] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-full border border-[#2D2D30] bg-[#252527] px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => onConfirmApply(proposal)}
            className="inline-flex h-8 items-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply to Editor Buffer
          </button>
        </div>
      </div>
    </div>
  );
}
