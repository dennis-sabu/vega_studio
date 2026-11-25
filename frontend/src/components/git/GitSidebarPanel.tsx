"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  GitHubSidebarSection,
  type GitHubSidebarProps,
} from "@/components/git/GitHubSidebarSection";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  GitBranchInfo,
  GitCommitSummary,
  GitFileChange,
  GitInfoResponse,
  GitStatusResponse,
} from "@/types/git";
import type { WorkspaceSummary } from "@/types/project";

interface GitSidebarPanelProps {
  activeProject: WorkspaceSummary | null;
  isBackendConnected: boolean;
  info: GitInfoResponse | null;
  status: GitStatusResponse | null;
  branches: GitBranchInfo[];
  commits: GitCommitSummary[];
  historyHasMore: boolean;
  commitMessage: string;
  loading: boolean;
  loadingMoreHistory: boolean;
  actionPending: boolean;
  error: string | null;
  notice: string | null;
  onRefresh: () => void;
  onInitRepo: () => void;
  onCommitMessageChange: (msg: string) => void;
  onCommit: () => void;
  onStagePaths: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstagePaths: (paths: string[]) => void;
  onUnstageAll: () => void;
  onDiscardPaths: (paths: string[]) => void;
  onDeleteUntrackedPaths: (paths: string[]) => void;
  onSwitchBranch: (name: string) => void;
  onCreateBranch: (name: string, checkout: boolean) => Promise<boolean>;
  onOpenFileDiff: (path: string, staged: boolean) => void;
  onOpenCommitDetail: (hash: string) => void;
  onLoadMoreHistory: () => void;
  onClearFeedback: () => void;
  onOpenProject: () => void;
  githubProps?: GitHubSidebarProps;
}

type GitSubTab = "changes" | "branches" | "history" | "github";

const SHORT_DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SHORT_DATE.format(d);
}

function statusBadgeMeta(change: GitFileChange): { letter: string; cls: string } {
  switch (change.status) {
    case "added":
      return { letter: "A", cls: "text-emerald-300" };
    case "deleted":
      return { letter: "D", cls: "text-red-300" };
    case "renamed":
      return { letter: "R", cls: "text-[#7aa2ff]" };
    case "copied":
      return { letter: "C", cls: "text-[#7aa2ff]" };
    case "unmerged":
      return { letter: "U", cls: "text-red-400" };
    case "untracked":
      return { letter: "U", cls: "text-emerald-300" };
    default:
      return { letter: "M", cls: "text-amber-300" };
  }
}

export function GitSidebarPanel({
  activeProject,
  isBackendConnected,
  info,
  status,
  branches,
  commits,
  historyHasMore,
  commitMessage,
  loading,
  loadingMoreHistory,
  actionPending,
  error,
  notice,
  onRefresh,
  onInitRepo,
  onCommitMessageChange,
  onCommit,
  onStagePaths,
  onStageAll,
  onUnstagePaths,
  onUnstageAll,
  onDiscardPaths,
  onDeleteUntrackedPaths,
  onSwitchBranch,
  onCreateBranch,
  onOpenFileDiff,
  onOpenCommitDetail,
  onLoadMoreHistory,
  onClearFeedback,
  onOpenProject,
  githubProps,
}: GitSidebarPanelProps) {
  const [subTab, setSubTab] = useState<GitSubTab>("changes");
  const [newBranchName, setNewBranchName] = useState("");
  const [checkoutNewBranch, setCheckoutNewBranch] = useState(true);
  const [selectedStaged, setSelectedStaged] = useState<string[]>([]);
  const [selectedWorktree, setSelectedWorktree] = useState<string[]>([]);

  if (!activeProject) {
    return (
      <div className="vega-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="rounded-2xl border border-white/[0.09] bg-[#06070c]/65 p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[#7aa2ff]">
            <GitBranch className="h-4 w-4" />
            <span className="font-mono text-[10px] font-semibold tracking-wider uppercase">
              Source Control
            </span>
          </div>
          <p className="text-xs leading-relaxed text-[#e8ebf7]/60">
            Open or create a VEGA firmware project to inspect repository status, stage changes, manage branches, and browse commit history.
          </p>
          <button
            type="button"
            onClick={onOpenProject}
            className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-lg border border-white/12 bg-white/[0.06] px-3 text-xs font-medium text-[#e8ebf7] hover:bg-white/12"
          >
            Open Project
          </button>
        </div>
      </div>
    );
  }

  const gitAvailable = info ? info.git_available : status?.git_available ?? true;
  const isRepo = Boolean(status?.is_repository);

  const toggleStagedCheck = (path: string) => {
    setSelectedStaged((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const toggleWorktreeCheck = (path: string) => {
    setSelectedWorktree((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const activeStagedPaths = new Set(status?.staged_files.map((f) => f.path) ?? []);
  const validSelectedStaged = selectedStaged.filter((p) => activeStagedPaths.has(p));

  const activeWorktreePaths = new Set([
    ...(status?.unstaged_files.map((f) => f.path) ?? []),
    ...(status?.untracked_files.map((f) => f.path) ?? []),
  ]);
  const validSelectedWorktree = selectedWorktree.filter((p) =>
    activeWorktreePaths.has(p)
  );

  const canCommit =
    isBackendConnected &&
    isRepo &&
    !actionPending &&
    (status?.staged_count ?? 0) > 0 &&
    commitMessage.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Repository Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] bg-[#06070c]/55 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#7aa2ff]" />
            <span className="truncate font-mono text-[11px] font-semibold text-[#e8ebf7]">
              {!gitAvailable
                ? "Git Unavailable"
                : !isRepo
                ? "Not a Git Repo"
                : status?.is_detached
                ? "Detached HEAD"
                : status?.current_branch ?? "main"}
            </span>
            {isRepo && status && (status.ahead > 0 || status.behind > 0) && (
              <span className="rounded bg-[#7aa2ff]/15 px-1 font-mono text-[9.5px] text-[#7aa2ff]">
                +{status.ahead}/-{status.behind}
              </span>
            )}
          </div>
          {info?.git_version && (
            <p className="truncate font-mono text-[9.5px] text-[#e8ebf7]/40">
              {info.git_version}
            </p>
          )}
        </div>

        <Tooltip label="Refresh Git status" side="bottom">
          <button
            type="button"
            aria-label="Refresh Git Repository"
            disabled={!isBackendConnected || loading}
            onClick={onRefresh}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? "animate-spin text-[#7aa2ff]" : ""}`}
            />
          </button>
        </Tooltip>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="flex items-start justify-between gap-2 border-b border-red-400/25 bg-red-500/12 px-3 py-2 text-[11px] text-red-100">
          <div className="flex min-w-0 items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
            <span className="whitespace-pre-wrap break-words">{error}</span>
          </div>
          <button
            type="button"
            aria-label="Dismiss Git error"
            onClick={onClearFeedback}
            className="shrink-0 rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {notice && !error && (
        <div className="flex items-start justify-between gap-2 border-b border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-200">
          <span className="truncate">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss Git notice"
            onClick={onClearFeedback}
            className="shrink-0 rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Missing Git Guidance */}
      {!gitAvailable ? (
        <div className="vega-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.08] p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Git CLI Not Found</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#e8ebf7]/70">
              {info?.unavailable_reason ??
                "Git must be installed and available on PATH to use VEGA Studio Source Control."}
            </p>
            <a
              href={info?.install_guide_url ?? "https://git-scm.com/downloads"}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-[#7aa2ff] hover:bg-white/12"
            >
              <span>Download Git</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      ) : !isRepo ? (
        /* Explicit Repository Initialization Card */
        <div className="vega-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="rounded-2xl border border-white/[0.09] bg-[#06070c]/65 p-3.5">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
              <FolderGit2 className="h-4 w-4" />
            </div>
            <h3 className="text-[13px] font-medium text-[#e8ebf7]">
              Initialize Git Repository
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[#e8ebf7]/55">
              This VEGA project folder is not a Git repository yet. Initialize local version control cleanly inside{" "}
              <span className="font-mono text-[#e8ebf7]/80">
                {activeProject.project.name}
              </span>
              .
            </p>
            {status?.has_parent_repo && (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/[0.08] px-2.5 py-1.5 text-[10.5px] text-amber-200">
                Note: A parent folder above this project is a Git repository, so VEGA Studio keeps Git strictly confined to the project root.
              </p>
            )}
            <button
              type="button"
              disabled={!isBackendConnected || actionPending}
              onClick={onInitRepo}
              className="mt-3.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-3 text-xs font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:opacity-45"
            >
              {actionPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
              ) : (
                <FolderGit2 className="h-3.5 w-3.5 text-[#7aa2ff]" />
              )}
              <span>Initialize Repository</span>
            </button>
          </div>
        </div>
      ) : (
        /* Active Repository Views: Changes | Branches | History | GitHub */
        <>
          <div className="grid grid-cols-4 gap-1 border-b border-white/[0.07] bg-[#070910]/65 p-1.5 select-none">
            {(
              [
                { id: "changes", label: "Changes", count: (status?.staged_count ?? 0) + (status?.unstaged_count ?? 0) + (status?.untracked_count ?? 0) },
                { id: "branches", label: "Branches", count: branches.length },
                { id: "history", label: "History", count: commits.length },
                { id: "github", label: "GitHub", count: githubProps?.status?.remotes.length ?? 0 },
              ] as const
            ).map((tab) => {
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSubTab(tab.id);
                    if (tab.id === "github") {
                      githubProps?.onRefreshStatus();
                    }
                  }}
                  className={`inline-flex h-6 items-center justify-center gap-1 rounded px-1.5 font-mono text-[10px] font-medium transition-colors ${
                    active
                      ? "bg-[#7aa2ff]/20 text-[#e8ebf7]"
                      : "text-[#e8ebf7]/50 hover:bg-white/[0.05] hover:text-[#e8ebf7]/85"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="rounded-full bg-white/10 px-1 text-[9px] text-[#e8ebf7]/75">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {subTab === "changes" ? (
            <div className="vega-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2.5">
              {/* Commit Box */}
              <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5">
                <textarea
                  rows={2}
                  aria-label="Git commit message"
                  value={commitMessage}
                  disabled={actionPending}
                  onChange={(e) => onCommitMessageChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
                      e.preventDefault();
                      onCommit();
                    }
                  }}
                  placeholder="Commit message (stages must be added explicitly)…"
                  className="vega-scroll w-full resize-none rounded-lg border border-white/10 bg-[#0b0e17] px-2.5 py-1.5 text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none"
                />

                {!status?.identity_configured && (
                  <p className="mt-1.5 text-[10px] leading-snug text-amber-200/85">
                    Configure Git identity (`user.name` &amp; `user.email`) before committing.
                  </p>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-[#e8ebf7]/55">
                    {status?.staged_count ?? 0} staged
                  </span>
                  <button
                    type="button"
                    disabled={!canCommit}
                    onClick={onCommit}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#7aa2ff]/45 bg-[#7aa2ff]/20 px-3 text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionPending ? (
                      <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
                    ) : (
                      <Check className="h-3 w-3 text-[#7aa2ff]" />
                    )}
                    <span>Commit Staged</span>
                  </button>
                </div>
              </div>

              {/* Staged Changes */}
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                    Staged Changes ({status?.staged_count ?? 0})
                  </span>
                  <div className="flex items-center gap-1">
                    {validSelectedStaged.length > 0 && (
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => {
                          onUnstagePaths(validSelectedStaged);
                          setSelectedStaged([]);
                        }}
                        className="rounded px-1.5 py-0.5 font-mono text-[9.5px] text-[#7aa2ff] hover:bg-white/[0.06]"
                      >
                        Unstage ({validSelectedStaged.length})
                      </button>
                    )}
                    {(status?.staged_count ?? 0) > 0 && (
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={onUnstageAll}
                        className="rounded px-1.5 py-0.5 font-mono text-[9.5px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                      >
                        Unstage All
                      </button>
                    )}
                  </div>
                </div>

                {status?.staged_files.length ? (
                  <ul className="space-y-0.5">
                    {status.staged_files.map((item) => {
                      const badge = statusBadgeMeta(item);
                      return (
                        <li
                          key={`staged:${item.path}`}
                          className="group flex items-center justify-between gap-1 rounded-md px-1.5 py-1 hover:bg-white/[0.04]"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <input
                              type="checkbox"
                              aria-label={`Select staged ${item.path}`}
                              checked={validSelectedStaged.includes(item.path)}
                              onChange={() => toggleStagedCheck(item.path)}
                              className="h-3 w-3 rounded border-white/25 bg-transparent accent-[#7aa2ff]"
                            />
                            <button
                              type="button"
                              title={
                                item.orig_path
                                  ? `${item.orig_path} -> ${item.path}`
                                  : item.path
                              }
                              onClick={() => onOpenFileDiff(item.path, true)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] text-[#e8ebf7]/85 hover:text-white"
                            >
                              <span
                                className={`w-3 shrink-0 text-center text-[10px] font-bold ${badge.cls}`}
                              >
                                {badge.letter}
                              </span>
                              <span className="truncate">{item.path}</span>
                            </button>
                          </div>

                          <Tooltip label="Unstage file" side="left">
                            <button
                              type="button"
                              aria-label={`Unstage ${item.path}`}
                              disabled={actionPending}
                              onClick={() => onUnstagePaths([item.path])}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#e8ebf7]/50 hover:bg-white/10 hover:text-[#e8ebf7]"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                          </Tooltip>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-1.5 py-1 text-[11px] text-[#e8ebf7]/35">
                    No files staged for commit.
                  </p>
                )}
              </div>

              {/* Unstaged Changes */}
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                    Unstaged Changes ({status?.unstaged_count ?? 0})
                  </span>
                  <div className="flex items-center gap-1">
                    {validSelectedWorktree.length > 0 && (
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => {
                          onStagePaths(validSelectedWorktree);
                          setSelectedWorktree([]);
                        }}
                        className="rounded px-1.5 py-0.5 font-mono text-[9.5px] text-[#7aa2ff] hover:bg-white/[0.06]"
                      >
                        Stage ({validSelectedWorktree.length})
                      </button>
                    )}
                    {((status?.unstaged_count ?? 0) > 0 ||
                      (status?.untracked_count ?? 0) > 0) && (
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={onStageAll}
                        className="rounded px-1.5 py-0.5 font-mono text-[9.5px] text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
                      >
                        Stage All
                      </button>
                    )}
                  </div>
                </div>

                {status?.unstaged_files.length ? (
                  <ul className="space-y-0.5">
                    {status.unstaged_files.map((item) => {
                      const badge = statusBadgeMeta(item);
                      return (
                        <li
                          key={`unstaged:${item.path}`}
                          className="group flex items-center justify-between gap-1 rounded-md px-1.5 py-1 hover:bg-white/[0.04]"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <input
                              type="checkbox"
                              aria-label={`Select unstaged ${item.path}`}
                              checked={validSelectedWorktree.includes(item.path)}
                              onChange={() => toggleWorktreeCheck(item.path)}
                              className="h-3 w-3 rounded border-white/25 bg-transparent accent-[#7aa2ff]"
                            />
                            <button
                              type="button"
                              title={item.path}
                              onClick={() => onOpenFileDiff(item.path, false)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] text-[#e8ebf7]/85 hover:text-white"
                            >
                              <span
                                className={`w-3 shrink-0 text-center text-[10px] font-bold ${badge.cls}`}
                              >
                                {badge.letter}
                              </span>
                              <span className="truncate">{item.path}</span>
                            </button>
                          </div>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <Tooltip
                              label="Discard changes (requires confirmation)"
                              side="left"
                            >
                              <button
                                type="button"
                                aria-label={`Discard ${item.path}`}
                                disabled={actionPending}
                                onClick={() => onDiscardPaths([item.path])}
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-[#e8ebf7]/45 hover:bg-red-500/20 hover:text-red-200"
                              >
                                <Undo2 className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip label="Stage file" side="left">
                              <button
                                type="button"
                                aria-label={`Stage ${item.path}`}
                                disabled={actionPending}
                                onClick={() => onStagePaths([item.path])}
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-[#e8ebf7]/55 hover:bg-white/10 hover:text-[#e8ebf7]"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </Tooltip>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-1.5 py-1 text-[11px] text-[#e8ebf7]/35">
                    Working tree clean.
                  </p>
                )}
              </div>

              {/* Untracked Files */}
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                    Untracked Files ({status?.untracked_count ?? 0})
                  </span>
                </div>

                {status?.untracked_files.length ? (
                  <ul className="space-y-0.5">
                    {status.untracked_files.map((item) => (
                      <li
                        key={`untracked:${item.path}`}
                        className="group flex items-center justify-between gap-1 rounded-md px-1.5 py-1 hover:bg-white/[0.04]"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Select untracked ${item.path}`}
                            checked={validSelectedWorktree.includes(item.path)}
                            onChange={() => toggleWorktreeCheck(item.path)}
                            className="h-3 w-3 rounded border-white/25 bg-transparent accent-[#7aa2ff]"
                          />
                          <button
                            type="button"
                            title={item.path}
                            onClick={() => onOpenFileDiff(item.path, false)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] text-[#e8ebf7]/80 hover:text-white"
                          >
                            <span className="w-3 shrink-0 text-center text-[10px] font-bold text-emerald-300">
                              U
                            </span>
                            <span className="truncate">{item.path}</span>
                          </button>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <Tooltip
                            label="Delete untracked file (requires confirmation)"
                            side="left"
                          >
                            <button
                              type="button"
                              aria-label={`Delete untracked ${item.path}`}
                              disabled={actionPending}
                              onClick={() => onDeleteUntrackedPaths([item.path])}
                              className="inline-flex h-5 w-5 items-center justify-center rounded text-[#e8ebf7]/45 hover:bg-red-500/20 hover:text-red-200"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </Tooltip>
                          <Tooltip label="Stage untracked file" side="left">
                            <button
                              type="button"
                              aria-label={`Stage untracked ${item.path}`}
                              disabled={actionPending}
                              onClick={() => onStagePaths([item.path])}
                              className="inline-flex h-5 w-5 items-center justify-center rounded text-[#e8ebf7]/55 hover:bg-white/10 hover:text-[#e8ebf7]"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </Tooltip>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-1.5 py-1 text-[11px] text-[#e8ebf7]/35">
                    No untracked files.
                  </p>
                )}
              </div>
            </div>
          ) : subTab === "branches" ? (
            <div className="vega-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2.5">
              {/* Create Local Branch */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onCreateBranch(newBranchName, checkoutNewBranch).then(
                    (ok) => {
                      if (ok) setNewBranchName("");
                    }
                  );
                }}
                className="space-y-2 rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5"
              >
                <p className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                  Create Local Branch
                </p>
                <input
                  type="text"
                  aria-label="New local branch name"
                  value={newBranchName}
                  disabled={actionPending || Boolean(status?.is_unborn)}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/driver-pwm"
                  className="h-7 w-full rounded border border-white/10 bg-[#0b0e17] px-2 font-mono text-[11px] text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none disabled:opacity-45"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-[#e8ebf7]/65">
                    <input
                      type="checkbox"
                      checked={checkoutNewBranch}
                      onChange={(e) => setCheckoutNewBranch(e.target.checked)}
                      className="h-3 w-3 accent-[#7aa2ff]"
                    />
                    <span>Switch on create</span>
                  </label>
                  <button
                    type="submit"
                    disabled={
                      actionPending ||
                      Boolean(status?.is_unborn) ||
                      !newBranchName.trim()
                    }
                    className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3 text-[#7aa2ff]" />
                    <span>Create</span>
                  </button>
                </div>
                {status?.is_unborn && (
                  <p className="text-[10px] text-[#e8ebf7]/45">
                    Make an initial commit before creating additional branches.
                  </p>
                )}
              </form>

              {/* Local Branches List */}
              <div className="space-y-1">
                <p className="px-1 font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                  Local Branches ({branches.length})
                </p>
                {branches.length === 0 ? (
                  <p className="px-1.5 py-2 text-[11px] text-[#e8ebf7]/40">
                    No branches created yet (unborn HEAD).
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {branches.map((br) => (
                      <li key={br.name}>
                        <button
                          type="button"
                          disabled={br.is_current || actionPending}
                          onClick={() => onSwitchBranch(br.name)}
                          className={`flex w-full flex-col rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                            br.is_current
                              ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/14 text-[#e8ebf7]"
                              : "border-white/[0.06] bg-white/[0.02] text-[#e8ebf7]/80 hover:bg-white/[0.07]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-medium">
                              <GitBranch className="h-3 w-3 shrink-0 text-[#7aa2ff]" />
                              <span className="truncate">{br.name}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[9.5px] text-[#e8ebf7]/50">
                              {br.is_current ? "CURRENT" : br.short_hash}
                            </span>
                          </div>
                          {br.subject && (
                            <span className="mt-0.5 truncate text-[10px] text-[#e8ebf7]/45">
                              {br.subject}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : subTab === "history" ? (
            /* Bounded Paginated Commit History */
            <div className="vega-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/55 uppercase">
                  Commit History
                </span>
                <History className="h-3 w-3 text-[#e8ebf7]/40" />
              </div>

              {commits.length === 0 ? (
                <p className="px-1.5 py-4 text-center text-[11px] text-[#e8ebf7]/40">
                  No commits recorded on this branch yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {commits.map((cmt) => (
                    <li key={cmt.hash}>
                      <button
                        type="button"
                        onClick={() => onOpenCommitDetail(cmt.hash)}
                        className="flex w-full flex-col rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-[#7aa2ff]/30 hover:bg-white/[0.06]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-[#7aa2ff]">
                            <GitCommitHorizontal className="h-3 w-3" />
                            <span>{cmt.short_hash}</span>
                          </span>
                          <span className="font-mono text-[9.5px] text-[#e8ebf7]/40">
                            {formatShortDate(cmt.authored_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] font-medium text-[#e8ebf7]/90">
                          {cmt.subject}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-[#e8ebf7]/45">
                          {cmt.author_name}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {historyHasMore && (
                <button
                  type="button"
                  disabled={loadingMoreHistory}
                  onClick={onLoadMoreHistory}
                  className="mt-1 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] font-mono text-[10.5px] text-[#e8ebf7]/75 hover:bg-white/[0.08]"
                >
                  {loadingMoreHistory && (
                    <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
                  )}
                  <span>Load Older Commits</span>
                </button>
              )}
            </div>
          ) : githubProps ? (
            <GitHubSidebarSection {...githubProps} />
          ) : null}
        </>
      )}
    </div>
  );
}
