"use client";

import { useEffect, useState } from"react";
import { AlertTriangle, FileCode2, Loader2, Save, Trash2, X } from"lucide-react";
import type { UnsavedGuardPrompt } from"@/types/editor";

interface UnsavedChangesDialogProps {
  prompt: UnsavedGuardPrompt | null;
}

export function UnsavedChangesDialog({ prompt }: UnsavedChangesDialogProps) {
  const [busyAction, setBusyAction] = useState<"save" |"discard" | null>(null);
  const isOpen = Boolean(prompt);

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
    if (!prompt) {
      queueMicrotask(() => setBusyAction(null));
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyAction) {
        event.preventDefault();
        event.stopPropagation();
        prompt.resolve("cancel");
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [busyAction, prompt]);

  if (!prompt) return null;

  const handleDecision = (decision: "save" |"discard" |"cancel") => {
    if (busyAction) return;
    if (decision !== "cancel") {
      setBusyAction(decision);
    }
    prompt.resolve(decision);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyAction) {
          handleDecision("cancel");
        }
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
    >
      <div
        className="vega-glass w-full max-w-md overflow-hidden rounded-[22px] shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
      <div className="flex items-start justify-between gap-3 border-b border-[#2D2D30] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/12 text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="unsaved-changes-title"
                className="text-sm font-medium text-[#F4F4F5]"
              >
                {prompt.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#E4E4E7]">
                {prompt.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cancel"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("cancel")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-45"
          >
          <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="vega-scroll max-h-44 space-y-1.5 overflow-y-auto px-5 py-3.5">
          {prompt.files.map((file) => (
            <div
              key={file.uid}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#2D2D30] bg-[#181818] px-3 py-2"
            >
            <div className="flex min-w-0 items-center gap-2">
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#7AA2FF]" />
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-medium text-[#F4F4F5]">
                    {file.name}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#B4B4BC]">
                    {file.path}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-200">
                Unsaved
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#2D2D30] bg-[#181818] px-5 py-3.5">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("cancel")}
            className="inline-flex h-8 items-center justify-center rounded-full border border-[#2D2D30] bg-[#252527] px-3.5 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-45"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("discard")}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/15 px-3.5 text-xs font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-45"
          >
          <Trash2 className="h-3.5 w-3.5" />
            <span>{prompt.confirmDiscardLabel}</span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("save")}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[#7AA2FF]/45 bg-[#7AA2FF]/20 px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#7AA2FF]/30 disabled:opacity-50"
          >
            {busyAction === "save" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
            <Save className="h-3.5 w-3.5 text-[#7AA2FF]" />
            )}
            <span>{prompt.confirmSaveLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
