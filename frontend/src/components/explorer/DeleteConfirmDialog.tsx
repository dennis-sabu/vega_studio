"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { FileNode } from "@/types/explorer";

interface DeleteConfirmDialogProps {
  target: FileNode | null;
  pending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (recursive: boolean) => Promise<void>;
}

export function DeleteConfirmDialog({
  target,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [confirmRecursive, setConfirmRecursive] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setConfirmRecursive(false));
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
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
      aria-label={`Confirm delete ${target.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/70 p-4 backdrop-blur-sm"
    >
      <div
        className="vega-glass flex w-full max-w-md flex-col overflow-hidden rounded-[24px] bg-[#090b13]/94 shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/15 text-red-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8ebf7]">
                Delete {isFolder ? "Folder" : "File"}
              </h2>
              <p className="text-[11px] text-[#e8ebf7]/50">
                This action removes the entry from disk
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={pending}
            aria-label="Cancel deletion"
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[#e8ebf7]/70 hover:bg-white/12 hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-5 text-xs">
          <p className="leading-relaxed text-[#e8ebf7]/80">
            Are you sure you want to delete{" "}
            <span className="font-mono font-semibold text-[#e8ebf7]">
              {target.name}
            </span>
            ?
          </p>

          <div className="rounded-xl border border-white/8 bg-[#06070c]/75 px-3 py-2 font-mono text-[11px] text-[#e8ebf7]/60">
            {target.path}
          </div>

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
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] bg-[#070910]/75 px-5 py-3">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-[#e8ebf7]/75 hover:bg-white/10 hover:text-[#e8ebf7]"
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
