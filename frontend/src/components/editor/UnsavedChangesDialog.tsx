"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileCode2, Loader2, Save, Trash2, X } from "lucide-react";
import type { UnsavedGuardPrompt } from "@/types/editor";

interface UnsavedChangesDialogProps {
  prompt: UnsavedGuardPrompt | null;
}

export function UnsavedChangesDialog({ prompt }: UnsavedChangesDialogProps) {
  const [busyAction, setBusyAction] = useState<"save" | "discard" | null>(null);

  useEffect(() => {
    if (!prompt) {
      queueMicrotask(() => setBusyAction(null));
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyAction) {
        event.preventDefault();
        prompt.resolve("cancel");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busyAction, prompt]);

  if (!prompt) return null;

  const handleDecision = (decision: "save" | "discard" | "cancel") => {
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
      aria-label={prompt.title}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyAction) {
          handleDecision("cancel");
        }
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#06070c]/75 p-4 backdrop-blur-sm"
    >
      <div
        className="vega-glass w-full max-w-md overflow-hidden rounded-[22px] bg-[#090b13]/96 shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/12 text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8ebf7]">
                {prompt.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#e8ebf7]/60">
                {prompt.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cancel"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("cancel")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#e8ebf7]/65 hover:bg-white/10 hover:text-[#e8ebf7] disabled:opacity-45"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="vega-scroll max-h-44 space-y-1.5 overflow-y-auto px-5 py-3.5">
          {prompt.files.map((file) => (
            <div
              key={file.uid}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#06070c]/75 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#7aa2ff]" />
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-medium text-[#e8ebf7]">
                    {file.name}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#e8ebf7]/45">
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

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-[#070910]/80 px-5 py-3.5">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => handleDecision("cancel")}
            className="inline-flex h-8 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-xs font-medium text-[#e8ebf7]/80 hover:bg-white/10 disabled:opacity-45"
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
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[#7aa2ff]/45 bg-[#7aa2ff]/20 px-4 text-xs font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/30 disabled:opacity-50"
          >
            {busyAction === "save" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 text-[#7aa2ff]" />
            )}
            <span>{prompt.confirmSaveLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
