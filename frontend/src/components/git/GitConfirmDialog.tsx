"use client";

import { AlertTriangle, GitBranch, Loader2, Trash2, Undo2 } from "lucide-react";
import type { GitConfirmDialogState } from "@/types/git";

interface GitConfirmDialogProps {
  dialog: GitConfirmDialogState | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function GitConfirmDialog({
  dialog,
  pending,
  onCancel,
  onConfirm,
}: GitConfirmDialogProps) {
  if (!dialog) return null;

  const isDiscard = dialog.kind === "discard";
  const isDeleteUntracked = dialog.kind === "delete_untracked";
  const isSwitchWarn = dialog.kind === "switch_warning";

  const affectedFiles = isSwitchWarn
    ? dialog.precheck.potentially_affected_files.length > 0
      ? dialog.precheck.potentially_affected_files
      : dialog.precheck.dirty_files
    : dialog.paths;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="git-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        className="vega-glass w-full max-w-md rounded-2xl border border-white/15 bg-[#090b13]/95 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
              isDeleteUntracked || isDiscard
                ? "border-red-400/35 bg-red-500/12 text-red-300"
                : "border-amber-400/35 bg-amber-500/12 text-amber-300"
            }`}
          >
            {isDeleteUntracked ? (
              <Trash2 className="h-4 w-4" />
            ) : isDiscard ? (
              <Undo2 className="h-4 w-4" />
            ) : (
              <GitBranch className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <h2
              id="git-confirm-title"
              className="text-sm font-semibold text-[#e8ebf7]"
            >
              {isDiscard
                ? "Discard Unstaged Changes?"
                : isDeleteUntracked
                ? "Delete Untracked Files?"
                : `Switch to '${dialog.branchName}' with Uncommitted Changes?`}
            </h2>

            <p className="text-xs leading-relaxed text-[#e8ebf7]/65">
              {isDiscard
                ? "Unstaged working-tree modifications in the following file(s) will be permanently reverted to the last staged/committed copy. Staged changes remain preserved."
                : isDeleteUntracked
                ? "The following untracked file(s) are not stored in Git history and will be permanently removed from disk."
                : dialog.precheck.warning ??
                  "You have uncommitted changes in your working tree. Git will preserve compatible edits or abort safely if conflicts occur."}
            </p>

            {affectedFiles.length > 0 && (
              <div className="vega-scroll max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-[#e8ebf7]/85">
                {affectedFiles.map((path) => (
                  <div key={path} className="flex items-center gap-1.5 py-0.5">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-300" />
                    <span className="truncate">{path}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={pending}
                onClick={onCancel}
                className="inline-flex h-8 items-center rounded-lg border border-white/12 bg-white/[0.04] px-3 text-xs font-medium text-[#e8ebf7]/80 hover:bg-white/[0.09] disabled:opacity-45"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onConfirm}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium disabled:opacity-45 ${
                  isDiscard || isDeleteUntracked
                    ? "border-red-400/45 bg-red-500/25 text-red-100 hover:bg-red-500/35"
                    : "border-[#7aa2ff]/45 bg-[#7aa2ff]/22 text-[#e8ebf7] hover:bg-[#7aa2ff]/32"
                }`}
              >
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>
                  {isDiscard
                    ? "Discard Changes"
                    : isDeleteUntracked
                    ? "Delete Files"
                    : "Switch Branch"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
