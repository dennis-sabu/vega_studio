"use client";

import { useEffect, useState } from"react";
import { AlertTriangle, Loader2, Trash2, X } from"lucide-react";
import type { FileNode } from"@/types/explorer";

interface DeleteConfirmDialogProps {
  target: FileNode | null;
  pending: boolean;
  errorMessage: string | null;
  unsavedFilesCount?: number;
  onCancel: () => void;
  onConfirm: (recursive: boolean) => Promise<void>;
}

export function DeleteConfirmDialog({
  target,
  pending,
  errorMessage,
  unsavedFilesCount = 0,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [confirmRecursive, setConfirmRecursive] = useState(false);
  const isOpen = Boolean(target);

  useEffect(() => {
    queueMicrotask(() => setConfirmRecursive(false));
  }, [target]);

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
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, pending, onCancel]);

  if (!target) return null;

  const isFolder = target.kind === "dir";
  const needsRecursiveCheck = isFolder && target.has_children;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
    >
      <div
        className="vega-glass flex w-full max-w-md flex-col overflow-hidden rounded-[24px] shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2D2D30] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/15 text-red-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="delete-confirm-title"
                className="text-sm font-medium text-[#F4F4F5]"
              >
                Delete {isFolder ? "Folder" : "File"}
              </h2>
              <p className="text-[11px] text-[#B4B4BC]">
                This action removes the entry from disk
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={pending}
            aria-label="Cancel deletion"
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-40"
          >
          <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-5 text-xs">
          <p className="leading-relaxed text-[#F4F4F5]">
            Are you sure you want to delete{""}
            <span className="font-mono font-semibold text-[#F4F4F5]">
              {target.name}
            </span>
            ?
          </p>

          <div className="rounded-xl border border-[#2D2D30] bg-[#181818] px-3 py-2 font-mono text-[11px] text-[#E4E4E7]">
            {target.path}
          </div>

          {unsavedFilesCount > 0 && (
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/15 p-3 leading-relaxed text-amber-200">
              {unsavedFilesCount === 1
                ? "Warning: This target has unsaved edits open in the editor that will be discarded if deleted."
                : `Warning: ${unsavedFilesCount} open files inside this folder have unsaved edits that will be discarded if deleted.`}
            </div>
          )}

          {needsRecursiveCheck && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-amber-200">
              <input
                type="checkbox"
                checked={confirmRecursive}
                onChange={(e) => setConfirmRecursive(e.target.checked)}
                className="mt-0.5 accent-red-400"
              />
              <span className="leading-relaxed">
                This folder is not empty. Permanently delete this folder and all
                nested files inside it.
              </span>
            </label>
          )}

          {errorMessage && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/12 p-3 text-red-200">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#2D2D30] bg-[#181818] px-5 py-3">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-full border border-[#2D2D30] bg-[#252527] px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || (needsRecursiveCheck && !confirmRecursive)}
            onClick={() => void onConfirm(isFolder && target.has_children)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/25 px-4 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
            <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>{pending ? "Deleting..." : "Delete"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
