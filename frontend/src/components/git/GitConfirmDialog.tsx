"use client";

import { useEffect } from"react";
import { AlertTriangle, GitBranch, Loader2, Trash2, Undo2 } from"lucide-react";
import type { GitConfirmDialogState } from"@/types/git";

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
  const isOpen = Boolean(dialog);

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
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, pending, onCancel]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-md"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        className="vega-glass w-full max-w-md rounded-2xl border border-[#2D2D30] p-5 shadow-2xl"
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
              className="text-sm font-semibold text-[#F4F4F5]"
            >
              {isDiscard
                ? "Discard Unstaged Changes? "
                : isDeleteUntracked
                ? "Delete Untracked Files? "
                : `Switch to '${dialog.branchName}' with Uncommitted Changes?`}
            </h2>

            <p className="text-xs leading-relaxed text-[#E4E4E7]">
              {isDiscard
                ? "Unstaged working-tree modifications in the following file(s) will be permanently reverted to the last staged/committed copy. Staged changes remain preserved."
                : isDeleteUntracked
                ? "The following untracked file(s) are not stored in Git history and will be permanently removed from disk."
                : dialog.precheck.warning ??
                  "You have uncommitted changes in your working tree. Git will preserve compatible edits or abort safely if conflicts occur."}
            </p>

            {affectedFiles.length > 0 && (
            <div className="vega-scroll max-h-36 overflow-y-auto rounded-lg border border-[#2D2D30] bg-[#141414] p-2 font-mono text-[11px] text-[#F4F4F5]">
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
                className="inline-flex h-8 items-center rounded-lg border border-[#2D2D30] bg-[#252527] px-3 text-xs font-medium text-[#F4F4F5] hover:bg-[#252527] disabled:opacity-45"
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
                    : "border-[#7AA2FF]/45 bg-[#7AA2FF]/22 text-[#F4F4F5] hover:bg-[#7AA2FF]/32"
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
