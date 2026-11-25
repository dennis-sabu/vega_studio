"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Columns2,
  FileCode2,
  FileDiff,
  GitCommitHorizontal,
  Loader2,
  Rows3,
  User,
} from "lucide-react";
import { MonacoDiffSurface } from "@/components/git/MonacoDiffSurface";
import type {
  GitCommitDetailResponse,
  GitDiffResponse,
  GitFileStatusCode,
} from "@/types/git";

interface GitDiffViewProps {
  activeDiff: GitDiffResponse | null;
  activeCommit: GitCommitDetailResponse | null;
  inspectLoading: boolean;
  inspectError: string | null;
  onSelectCommitFile: (path: string, commitHash: string) => void;
  onOpenFileInEditor?: (relativePath: string) => void;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

const STATUS_COLORS: Record<GitFileStatusCode, string> = {
  modified: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  added: "border-emerald-400/35 bg-emerald-500/12 text-emerald-300",
  deleted: "border-red-400/35 bg-red-500/12 text-red-200",
  renamed: "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]",
  copied: "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]",
  typechange: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  unmerged: "border-red-400/45 bg-red-500/18 text-red-200",
  untracked: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
};

function UnifiedDiffViewer({ patch }: { patch: string }) {
  const lines = patch.split(/\r?\n/);
  if (!patch.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 font-mono text-xs text-[#e8ebf7]/45">
        No textual diff hunks present.
      </div>
    );
  }

  return (
    <div className="vega-scroll min-h-0 flex-1 overflow-auto bg-[#06070c] p-3 font-mono text-[11.5px] leading-relaxed">
      {lines.map((line, idx) => {
        let cls = "text-[#e8ebf7]/78";
        if (line.startsWith("+++") || line.startsWith("---")) {
          cls = "text-[#e8ebf7]/50 font-semibold";
        } else if (line.startsWith("@@")) {
          cls = "bg-[#7aa2ff]/10 text-[#7aa2ff] font-medium";
        } else if (line.startsWith("+")) {
          cls = "bg-emerald-500/[0.11] text-emerald-200";
        } else if (line.startsWith("-")) {
          cls = "bg-red-500/[0.11] text-red-200";
        } else if (
          line.startsWith("diff --git") ||
          line.startsWith("index ")
        ) {
          cls = "text-[#e8ebf7]/45";
        }
        return (
          <div
            key={`${idx}-${line.slice(0, 12)}`}
            className={`min-h-[18px] px-2 whitespace-pre ${cls}`}
          >
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

export function GitDiffView({
  activeDiff,
  activeCommit,
  inspectLoading,
  inspectError,
  onSelectCommitFile,
  onOpenFileInEditor,
}: GitDiffViewProps) {
  const [viewerMode, setViewerMode] = useState<"monaco" | "unified">("monaco");
  const [sideBySide, setSideBySide] = useState(true);
  const [showFullCommitPatch, setShowFullCommitPatch] = useState(false);

  if (inspectLoading && !activeDiff && !activeCommit) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 font-mono text-xs text-[#e8ebf7]/60">
        <Loader2 className="h-4 w-4 animate-spin text-[#7aa2ff]" />
        <span>Loading Git inspection view…</span>
      </div>
    );
  }

  if (inspectError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-400/25 bg-[#090b13]/90 p-5 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-300" />
          <p className="text-sm font-medium text-[#e8ebf7]">
            Failed to Load Git Diff
          </p>
          <p className="mt-1 font-mono text-xs text-red-200/80">
            {inspectError}
          </p>
        </div>
      </div>
    );
  }

  if (!activeDiff && !activeCommit) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-[#08090f] p-6 text-center">
          <FileDiff className="mx-auto mb-3 h-7 w-7 text-[#7aa2ff]" />
          <h2 className="text-sm font-medium text-[#e8ebf7]">
            Source Control Diff &amp; Commit Inspector
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#e8ebf7]/55">
            Select any changed file under Staged, Unstaged, or Untracked changes—or click a commit in History—to inspect diffs and file details here.
          </p>
        </div>
      </div>
    );
  }

  const canRenderMonacoDiff = Boolean(
    activeDiff &&
      !activeDiff.is_binary &&
      !activeDiff.too_large &&
      activeDiff.original_content !== null &&
      activeDiff.modified_content !== null
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#06070c]">
      {/* Optional Commit Metadata Header + Changed Files Strip */}
      {activeCommit && (
        <div className="shrink-0 border-b border-white/[0.08] bg-[#080a12]/90 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded border border-[#7aa2ff]/35 bg-[#7aa2ff]/12 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[#7aa2ff]">
                  <GitCommitHorizontal className="h-3 w-3" />
                  <span>{activeCommit.short_hash}</span>
                </span>
                <span className="text-sm font-medium text-[#e8ebf7]">
                  {activeCommit.subject}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#e8ebf7]/55">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>
                    {activeCommit.author_name} &lt;{activeCommit.author_email}&gt;
                  </span>
                </span>
                <span>{formatDate(activeCommit.authored_at)}</span>
                {activeCommit.parents.length > 0 && (
                  <span>
                    Parent:{" "}
                    {activeCommit.parents.map((p) => p.slice(0, 7)).join(", ")}
                  </span>
                )}
              </div>

              {activeCommit.body && (
                <pre className="mt-1.5 font-sans text-xs whitespace-pre-wrap text-[#e8ebf7]/70">
                  {activeCommit.body}
                </pre>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
              <span className="text-emerald-300">
                +{activeCommit.total_insertions}
              </span>
              <span className="text-red-300">
                -{activeCommit.total_deletions}
              </span>
              <button
                type="button"
                onClick={() => setShowFullCommitPatch((prev) => !prev)}
                className={`rounded border px-2 py-1 text-[10.5px] transition-colors ${
                  showFullCommitPatch
                    ? "border-[#7aa2ff]/40 bg-[#7aa2ff]/18 text-[#e8ebf7]"
                    : "border-white/12 bg-white/[0.04] text-[#e8ebf7]/75 hover:bg-white/[0.08]"
                }`}
              >
                {showFullCommitPatch ? "Per-File Diff" : "Full Commit Patch"}
              </button>
            </div>
          </div>

          {/* Changed files chips inside commit */}
          {activeCommit.files.length > 0 && (
            <div className="vega-scroll mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {activeCommit.files.map((file) => {
                const isActive =
                  !showFullCommitPatch && activeDiff?.path === file.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      setShowFullCommitPatch(false);
                      onSelectCommitFile(file.path, activeCommit.hash);
                    }}
                    className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded border px-2 font-mono text-[10.5px] transition-colors ${
                      isActive
                        ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/18 text-[#e8ebf7]"
                        : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08]"
                    }`}
                  >
                    <span
                      className={`rounded px-1 text-[9px] font-semibold uppercase ${
                        STATUS_COLORS[file.status]
                      }`}
                    >
                      {file.status[0]}
                    </span>
                    <span className="max-w-[200px] truncate">{file.path}</span>
                    {!file.is_binary &&
                      file.insertions !== null &&
                      file.deletions !== null && (
                        <span className="text-[9.5px] text-[#e8ebf7]/45">
                          +{file.insertions}/-{file.deletions}
                        </span>
                      )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Body: Full Commit Patch OR Active File Diff */}
      {activeCommit && showFullCommitPatch ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeCommit.diff_truncated && (
            <div className="border-b border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              Commit patch truncated to 512 KiB for safe rendering.
            </div>
          )}
          <UnifiedDiffViewer patch={activeCommit.unified_diff} />
        </div>
      ) : activeDiff ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* File Diff Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#070910]/90 px-3 py-1.5 select-none">
            <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
              <span
                className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${
                  STATUS_COLORS[activeDiff.change_type]
                }`}
              >
                {activeDiff.change_type}
              </span>
              <span className="truncate font-semibold text-[#e8ebf7]">
                {activeDiff.path}
              </span>
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#e8ebf7]/60">
                {activeDiff.commit
                  ? `Commit ${activeDiff.commit.slice(0, 7)}`
                  : activeDiff.staged
                  ? "Staged (Index)"
                  : activeDiff.change_type === "untracked"
                  ? "Untracked"
                  : "Working Tree"}
              </span>
              {!activeDiff.is_binary && (
                <span className="text-[10.5px]">
                  <span className="text-emerald-300">
                    +{activeDiff.added_lines}
                  </span>{" "}
                  <span className="text-red-300">
                    -{activeDiff.removed_lines}
                  </span>
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px]">
              {inspectLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
              )}

              {onOpenFileInEditor && !activeDiff.commit && (
                <button
                  type="button"
                  onClick={() => onOpenFileInEditor(activeDiff.path)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-white/12 bg-white/[0.04] px-2 text-[#e8ebf7]/80 hover:bg-white/[0.09]"
                >
                  <FileCode2 className="h-3 w-3 text-[#7aa2ff]" />
                  <span>Open File</span>
                </button>
              )}

              {canRenderMonacoDiff && viewerMode === "monaco" && (
                <button
                  type="button"
                  onClick={() => setSideBySide((prev) => !prev)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-white/12 bg-white/[0.04] px-2 text-[#e8ebf7]/80 hover:bg-white/[0.09]"
                >
                  {sideBySide ? (
                    <Columns2 className="h-3 w-3 text-[#7aa2ff]" />
                  ) : (
                    <Rows3 className="h-3 w-3 text-[#7aa2ff]" />
                  )}
                  <span>{sideBySide ? "Side-by-Side" : "Inline"}</span>
                </button>
              )}

              {canRenderMonacoDiff && (
                <div className="inline-flex rounded border border-white/12 bg-white/[0.03] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewerMode("monaco")}
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      viewerMode === "monaco"
                        ? "bg-[#7aa2ff]/22 text-[#e8ebf7]"
                        : "text-[#e8ebf7]/55 hover:text-[#e8ebf7]"
                    }`}
                  >
                    Monaco Diff
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewerMode("unified")}
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      viewerMode === "unified"
                        ? "bg-[#7aa2ff]/22 text-[#e8ebf7]"
                        : "text-[#e8ebf7]/55 hover:text-[#e8ebf7]"
                    }`}
                  >
                    Unified
                  </button>
                </div>
              )}
            </div>
          </div>

          {activeDiff.note && (
            <div className="flex items-center gap-2 border-b border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{activeDiff.note}</span>
            </div>
          )}

          {activeDiff.is_binary ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-md rounded-xl border border-white/10 bg-[#08090f] p-5 text-center">
                <FileDiff className="mx-auto mb-2 h-6 w-6 text-[#e8ebf7]/45" />
                <p className="text-xs font-medium text-[#e8ebf7]">
                  Binary File ({activeDiff.total_bytes.toLocaleString()} bytes)
                </p>
                <p className="mt-1 text-[11px] text-[#e8ebf7]/55">
                  Text diff preview is unavailable for binary assets or compiled firmware artifacts.
                </p>
              </div>
            </div>
          ) : canRenderMonacoDiff && viewerMode === "monaco" ? (
            <MonacoDiffSurface
              path={activeDiff.path}
              originalContent={activeDiff.original_content ?? ""}
              modifiedContent={activeDiff.modified_content ?? ""}
              sideBySide={sideBySide}
            />
          ) : (
            <UnifiedDiffViewer patch={activeDiff.unified_diff} />
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-1.5">
            <p className="text-xs font-medium text-[#e8ebf7]">
              Inspecting Commit {activeCommit?.short_hash}
            </p>
            <p className="text-[11px] text-[#e8ebf7]/55">
              Select a changed file pill above to view its Monaco diff, or click &ldquo;Full Commit Patch&rdquo;.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
