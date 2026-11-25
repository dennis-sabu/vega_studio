"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FolderPlus,
  Globe,
  Link2,
  Loader2,
  Lock,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  GitHubRemoteRepoDetail,
  GitHubStatusResponse,
} from "@/types/github";

export interface GitHubSidebarProps {
  status: GitHubStatusResponse | null;
  loading: boolean;
  actionPending: boolean;
  error: string | null;
  notice: string | null;
  remoteRepoDetail: GitHubRemoteRepoDetail | null;
  loadingRemoteRepoDetail: boolean;
  onClearFeedback: () => void;
  onRefreshStatus: () => void;
  onSignInWithGitHub: (protocol: "https" | "ssh") => void;
  onCancelOperation: () => void;
  onAddRemote: (name: string, url: string) => Promise<boolean>;
  onRequestUpdateRemote: (name: string, url: string) => void;
  onRequestRemoveRemote: (name: string) => void;
  onRequestCreateRepo: () => void;
  onRequestPublish: () => void;
  onFetchRemote: (remote: string) => void;
  onRequestPull: (remote?: string | null) => void;
  onRequestPush: (remote?: string | null) => void;
  onInspectRemoteInfo: (remote?: string | null) => void;
}

export function GitHubSidebarSection({
  status,
  loading,
  actionPending,
  error,
  notice,
  remoteRepoDetail,
  loadingRemoteRepoDetail,
  onClearFeedback,
  onRefreshStatus,
  onSignInWithGitHub,
  onCancelOperation,
  onAddRemote,
  onRequestUpdateRemote,
  onRequestRemoveRemote,
  onRequestCreateRepo,
  onRequestPublish,
  onFetchRemote,
  onRequestPull,
  onRequestPush,
  onInspectRemoteInfo,
}: GitHubSidebarProps) {
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const [selectedRemote, setSelectedRemote] = useState<string>("");
  const [showAddRemote, setShowAddRemote] = useState(false);
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");

  const cli = status?.cli;
  const remotes = status?.remotes ?? [];
  const activeOp = status?.active_operation ?? null;
  const latestOp = status?.latest_operation ?? null;
  const displayedOp = activeOp ?? latestOp;
  const isBusy = actionPending || activeOp?.status === "running";

  const effectiveRemote =
    remotes.find((r) => r.name === selectedRemote)?.name ??
    status?.primary_remote?.name ??
    remotes[0]?.name ??
    "";

  const handleAddRemoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remoteName.trim() || !remoteUrl.trim()) return;
    const ok = await onAddRemote(remoteName.trim(), remoteUrl.trim());
    if (ok) {
      setRemoteUrl("");
      setShowAddRemote(false);
    }
  };

  return (
    <div
      data-testid="github-sidebar-section"
      className="vega-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2.5"
    >
      {/* Feedback Banners */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/12 px-2.5 py-2 text-[11px] text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <p className="min-w-0 flex-1 break-words">{error}</p>
          <button
            type="button"
            onClick={onClearFeedback}
            className="text-red-300/70 hover:text-red-100"
            aria-label="Dismiss GitHub error"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <p className="min-w-0 flex-1 break-words">{notice}</p>
          <button
            type="button"
            onClick={onClearFeedback}
            className="text-emerald-300/70 hover:text-emerald-100"
            aria-label="Dismiss GitHub notice"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 1. GitHub CLI & Auth Card */}
      <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
            GitHub CLI &amp; Auth
          </span>
          <button
            type="button"
            disabled={loading || isBusy}
            onClick={onRefreshStatus}
            title="Recheck gh CLI & authentication status"
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 font-mono text-[10px] text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span>Check</span>
          </button>
        </div>

        {!cli ? (
          <p className="text-[11px] text-[#e8ebf7]/50">Checking GitHub CLI status…</p>
        ) : !cli.gh_available ? (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              {cli.unavailable_reason ||
                "GitHub CLI (`gh`) is not installed. Remotes and Git push/pull remain available with existing credentials."}
            </p>
            <a
              href={cli.install_guide_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 font-mono text-[10.5px] text-[#e8ebf7] hover:bg-white/[0.1]"
            >
              <span>Install GitHub CLI</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : cli.authenticated ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="truncate">
                Signed in as{" "}
                <span className="font-mono text-white">
                  {cli.username || "GitHub user"}
                </span>
              </span>
            </div>
            <p className="font-mono text-[10px] text-[#e8ebf7]/45">
              gh v{cli.gh_version || "?"}
              {cli.git_protocol ? ` · protocol: ${cli.git_protocol}` : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-[#e8ebf7]/65">
              {cli.auth_message || "gh CLI detected, but not signed in."}
            </p>
            <div className="flex items-center gap-1.5">
              <select
                value={protocol}
                disabled={isBusy}
                aria-label="Git protocol for GitHub sign-in"
                onChange={(e) =>
                  setProtocol(e.target.value === "ssh" ? "ssh" : "https")
                }
                className="h-7 rounded-lg border border-white/15 bg-[#0b0e17] px-2 font-mono text-[10.5px] text-[#e8ebf7]"
              >
                <option value="https">HTTPS</option>
                <option value="ssh">SSH</option>
              </select>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onSignInWithGitHub(protocol)}
                className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 text-[11px] font-semibold text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:opacity-45"
              >
                <LogIn className="h-3 w-3 text-[#7aa2ff]" />
                <span>Sign in with GitHub</span>
              </button>
            </div>
          </div>
        )}

        {/* Active device code box during gh auth login --web */}
        {activeOp?.kind === "auth_login" &&
          activeOp.status === "running" &&
          (activeOp.device_code || activeOp.verification_url) && (
            <div className="rounded-lg border border-[#7aa2ff]/35 bg-[#7aa2ff]/10 p-2 space-y-1.5 text-[11px]">
              {activeOp.device_code && (
                <div>
                  <span className="text-[#e8ebf7]/65">One-time code: </span>
                  <span className="select-all font-mono font-bold text-white">
                    {activeOp.device_code}
                  </span>
                </div>
              )}
              {activeOp.verification_url && (
                <a
                  href={activeOp.verification_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10.5px] text-[#9bb8ff] underline"
                >
                  <span>Open Browser Verification</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
      </div>

      {/* 2. Guided Publish & Repo Create */}
      <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5 space-y-2">
        <span className="block font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
          GitHub Repository
        </span>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            disabled={isBusy || !cli?.gh_available || !cli?.authenticated}
            onClick={onRequestPublish}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-3 text-xs font-semibold text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:opacity-40"
          >
            <CloudUpload className="h-3.5 w-3.5 text-[#7aa2ff]" />
            <span>Publish Project to GitHub…</span>
          </button>
          <button
            type="button"
            disabled={isBusy || !cli?.gh_available || !cli?.authenticated}
            onClick={onRequestCreateRepo}
            className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 font-mono text-[10.5px] text-[#e8ebf7]/85 hover:bg-white/[0.08] disabled:opacity-40"
          >
            <FolderPlus className="h-3 w-3 text-[#7aa2ff]" />
            <span>Create Empty GitHub Repo…</span>
          </button>
        </div>
      </div>

      {/* 3. Sync Actions: Fetch / Pull / Push */}
      <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
            Remote Sync
          </span>
          {status?.upstream && (
            <span className="font-mono text-[10px] text-[#7aa2ff]">
              ↑{status.ahead} ↓{status.behind}
            </span>
          )}
        </div>

        {remotes.length === 0 ? (
          <p className="text-[11px] text-[#e8ebf7]/45">
            No Git remotes configured yet. Publish or add a remote below to fetch, pull, or push.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="gh-sync-remote"
                className="font-mono text-[10px] text-[#e8ebf7]/55"
              >
                Remote
              </label>
              <select
                id="gh-sync-remote"
                value={effectiveRemote}
                disabled={isBusy}
                onChange={(e) => setSelectedRemote(e.target.value)}
                className="h-6 min-w-0 flex-1 rounded border border-white/15 bg-[#0b0e17] px-2 font-mono text-[10.5px] text-[#e8ebf7]"
              >
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.github_owner_repo ? ` (${r.github_owner_repo})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={isBusy || !effectiveRemote}
                onClick={() => onFetchRemote(effectiveRemote)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-white/12 bg-white/[0.05] px-2 font-mono text-[10.5px] text-[#e8ebf7]/85 hover:bg-white/[0.1] disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3 text-[#7aa2ff]" />
                <span>Fetch</span>
              </button>
              <button
                type="button"
                disabled={isBusy || !effectiveRemote}
                onClick={() => onRequestPull(effectiveRemote)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-white/12 bg-white/[0.05] px-2 font-mono text-[10.5px] text-[#e8ebf7]/85 hover:bg-white/[0.1] disabled:opacity-40"
              >
                <ArrowDownToLine className="h-3 w-3 text-[#7aa2ff]" />
                <span>Pull</span>
              </button>
              <button
                type="button"
                disabled={isBusy || !effectiveRemote}
                onClick={() => onRequestPush(effectiveRemote)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#7aa2ff]/35 bg-[#7aa2ff]/16 px-2 font-mono text-[10.5px] text-[#e8ebf7] hover:bg-[#7aa2ff]/26 disabled:opacity-40"
              >
                <ArrowUpFromLine className="h-3 w-3 text-[#7aa2ff]" />
                <span>Push</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 4. Configured Remotes */}
      <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
            Remotes ({remotes.length})
          </span>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setShowAddRemote((v) => !v)}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 font-mono text-[10px] text-[#7aa2ff] hover:bg-white/[0.07]"
          >
            <Plus className="h-3 w-3" />
            <span>Add</span>
          </button>
        </div>

        {showAddRemote && (
          <form onSubmit={handleAddRemoteSubmit} className="space-y-1.5 rounded-lg border border-white/10 bg-[#0b0e17] p-2">
            <input
              type="text"
              value={remoteName}
              disabled={isBusy}
              onChange={(e) => setRemoteName(e.target.value)}
              placeholder="origin"
              aria-label="New remote name"
              className="w-full rounded border border-white/12 bg-[#06070c] px-2 py-1 font-mono text-[11px] text-[#e8ebf7]"
            />
            <input
              type="text"
              value={remoteUrl}
              disabled={isBusy}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              aria-label="New remote URL"
              className="w-full rounded border border-white/12 bg-[#06070c] px-2 py-1 font-mono text-[11px] text-[#e8ebf7]"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setShowAddRemote(false)}
                className="h-6 rounded px-2 font-mono text-[10px] text-[#e8ebf7]/60 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBusy || !remoteName.trim() || !remoteUrl.trim()}
                className="h-6 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/20 px-2 font-mono text-[10px] text-[#e8ebf7] disabled:opacity-40"
              >
                Save Remote
              </button>
            </div>
          </form>
        )}

        {remotes.length > 0 && (
          <ul className="space-y-1.5">
            {remotes.map((r) => (
              <li
                key={r.name}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-semibold text-[#e8ebf7]">
                    <Link2 className="h-3 w-3 shrink-0 text-[#7aa2ff]" />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      title={`Edit remote ${r.name}`}
                      onClick={() => onRequestUpdateRemote(r.name, r.fetch_url)}
                      className="rounded p-1 text-[#e8ebf7]/55 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      title={`Remove remote ${r.name}`}
                      onClick={() => onRequestRemoveRemote(r.name)}
                      className="rounded p-1 text-red-300/70 hover:bg-red-500/15 hover:text-red-200"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="truncate font-mono text-[10px] text-[#e8ebf7]/50" title={r.fetch_url}>
                  {r.fetch_url}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 5. Explicit Remote Repository Info */}
      {remotes.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/75 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/60 uppercase">
              Remote Details
            </span>
            <button
              type="button"
              disabled={loadingRemoteRepoDetail || isBusy || !effectiveRemote}
              onClick={() => onInspectRemoteInfo(effectiveRemote)}
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 font-mono text-[10px] text-[#7aa2ff] hover:bg-white/[0.07] disabled:opacity-40"
            >
              {loadingRemoteRepoDetail ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              <span>Inspect Remote</span>
            </button>
          </div>

          {!remoteRepoDetail ? (
            <p className="text-[11px] text-[#e8ebf7]/45">
              Click Inspect Remote to query remote metadata and branches on demand.
            </p>
          ) : (
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono font-semibold text-[#e8ebf7]">
                  {remoteRepoDetail.owner_repo}
                </span>
                {remoteRepoDetail.visibility && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] text-[#e8ebf7]/80 uppercase">
                    {remoteRepoDetail.visibility === "private" ? (
                      <Lock className="h-2.5 w-2.5" />
                    ) : (
                      <Globe className="h-2.5 w-2.5" />
                    )}
                    <span>{remoteRepoDetail.visibility}</span>
                  </span>
                )}
              </div>
              {remoteRepoDetail.description && (
                <p className="text-[#e8ebf7]/65">{remoteRepoDetail.description}</p>
              )}
              {remoteRepoDetail.default_branch && (
                <p className="font-mono text-[10px] text-[#e8ebf7]/50">
                  Default branch: {remoteRepoDetail.default_branch}
                </p>
              )}
              <div>
                <p className="font-mono text-[10px] text-[#e8ebf7]/50">
                  Remote branches ({remoteRepoDetail.remote_branches.length}):
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {remoteRepoDetail.remote_branches.map((br) => (
                    <span
                      key={br}
                      className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#e8ebf7]/80"
                    >
                      {br}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Active / Latest Operation Output & Cancel */}
      {displayedOp && (
        <div className="rounded-xl border border-white/[0.08] bg-[#06070c]/85 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase text-[#e8ebf7]/75">
              {displayedOp.status === "running" && (
                <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
              )}
              <span>
                {displayedOp.kind.replace("_", " ")} · {displayedOp.status}
              </span>
            </span>
            {displayedOp.status === "running" && displayedOp.cancellable && (
              <button
                type="button"
                onClick={onCancelOperation}
                className="inline-flex h-5 items-center gap-1 rounded border border-red-400/35 bg-red-500/15 px-1.5 font-mono text-[10px] text-red-200 hover:bg-red-500/25"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>Cancel</span>
              </button>
            )}
          </div>
          {displayedOp.output_lines.length > 0 && (
            <pre className="vega-scroll max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-white/[0.06] bg-[#030407] p-2 font-mono text-[10px] leading-relaxed text-[#e8ebf7]/70">
              {displayedOp.output_lines.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
