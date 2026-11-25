"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudUpload,
  FolderPlus,
  Link2,
  Loader2,
  Trash2,
} from "lucide-react";
import type { GitHubConfirmDialogState } from "@/hooks/useGitHubIntegration";
import type { GitHubVisibility } from "@/types/github";

interface GitHubConfirmDialogProps {
  dialog: GitHubConfirmDialogState;
  pending: boolean;
  onCancel: () => void;
  onConfirmUpdateRemote: (name: string, url: string) => void;
  onConfirmRemoveRemote: (name: string) => void;
  onConfirmCreateRepo: (payload: {
    name: string;
    description: string;
    visibility: GitHubVisibility;
    addReadme: boolean;
    configureRemote: boolean;
    remoteName: string;
  }) => void;
  onConfirmPublish: (payload: {
    name: string;
    description: string;
    visibility: GitHubVisibility;
    remoteName: string;
    reuseExistingRemote: boolean;
  }) => void;
  onConfirmPull: (remote: string | null) => void;
  onConfirmPush: (remote: string | null, setUpstream: boolean) => void;
}

export function GitHubConfirmDialog({
  dialog,
  pending,
  onCancel,
  onConfirmUpdateRemote,
  onConfirmRemoveRemote,
  onConfirmCreateRepo,
  onConfirmPublish,
  onConfirmPull,
  onConfirmPush,
}: GitHubConfirmDialogProps) {
  if (!dialog) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="github-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        className="vega-glass w-full max-w-lg rounded-2xl border border-white/15 bg-[#090b13]/95 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {dialog.kind === "update_remote" && (
          <UpdateRemoteBody
            name={dialog.name}
            initialUrl={dialog.url}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmUpdateRemote}
          />
        )}
        {dialog.kind === "remove_remote" && (
          <RemoveRemoteBody
            name={dialog.name}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmRemoveRemote}
          />
        )}
        {dialog.kind === "create_repo" && (
          <CreateRepoBody
            key={dialog.suggestedName}
            suggestedName={dialog.suggestedName}
            hasRemotes={dialog.hasRemotes}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmCreateRepo}
          />
        )}
        {dialog.kind === "publish" && (
          <PublishBody
            key={dialog.preview.project_dir}
            dialog={dialog}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmPublish}
          />
        )}
        {dialog.kind === "pull" && (
          <PullBody
            dialog={dialog}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmPull}
          />
        )}
        {dialog.kind === "push" && (
          <PushBody
            dialog={dialog}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirmPush}
          />
        )}
      </div>
    </div>
  );
}

function UpdateRemoteBody({
  name,
  initialUrl,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  initialUrl: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (name: string, url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/35 bg-amber-500/12 text-amber-300">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Update Remote &lsquo;{name}&rsquo; URL?
          </h2>
          <p className="text-xs text-[#e8ebf7]/65">
            Changing a remote URL affects future fetch, pull, and push targets for this repository. Use HTTPS or SSH without embedded credentials.
          </p>
        </div>
      </div>

      <input
        type="text"
        value={url}
        disabled={pending}
        aria-label="Updated remote URL"
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo.git"
        className="w-full rounded-lg border border-white/15 bg-[#06070c] px-2.5 py-1.5 font-mono text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
      />

      <DialogFooter
        pending={pending}
        confirmLabel="Confirm Update Remote"
        confirmDisabled={!url.trim()}
        onCancel={onCancel}
        onConfirm={() => onConfirm(name, url.trim())}
      />
    </div>
  );
}

function RemoveRemoteBody({
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-400/35 bg-red-500/12 text-red-300">
          <Trash2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Remove Remote &lsquo;{name}&rsquo;?
          </h2>
          <p className="text-xs leading-relaxed text-[#e8ebf7]/65">
            This disconnects local remote configuration &lsquo;{name}&rsquo; in `.git/config`. Your local commits and the remote GitHub repository itself remain intact.
          </p>
        </div>
      </div>

      <DialogFooter
        pending={pending}
        danger
        confirmLabel="Remove Remote"
        onCancel={onCancel}
        onConfirm={() => onConfirm(name)}
      />
    </div>
  );
}

function CreateRepoBody({
  suggestedName,
  hasRemotes,
  pending,
  onCancel,
  onConfirm,
}: {
  suggestedName: string;
  hasRemotes: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (payload: {
    name: string;
    description: string;
    visibility: GitHubVisibility;
    addReadme: boolean;
    configureRemote: boolean;
    remoteName: string;
  }) => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GitHubVisibility>("private");
  const [addReadme, setAddReadme] = useState(false);
  const [configureRemote, setConfigureRemote] = useState(!hasRemotes);
  const [remoteName, setRemoteName] = useState("origin");

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]">
          <FolderPlus className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Create GitHub Repository
          </h2>
          <p className="text-xs text-[#e8ebf7]/65">
            Creates a new repository under your signed-in GitHub account via `gh repo create`. Local working tree files are never auto-staged or overwritten.
          </p>
        </div>
      </div>

      <div className="space-y-2.5 text-xs">
        <div>
          <label className="mb-1 block font-mono text-[10.5px] text-[#e8ebf7]/70">
            Repository Name
          </label>
          <input
            type="text"
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-[#06070c] px-2.5 py-1.5 font-mono text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10.5px] text-[#e8ebf7]/70">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            disabled={pending}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="VEGA ARIES V3 firmware project"
            className="w-full rounded-lg border border-white/15 bg-[#06070c] px-2.5 py-1.5 text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#e8ebf7]/85">
            <input
              type="radio"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            <span>Private (Recommended)</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#e8ebf7]/85">
            <input
              type="radio"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            <span>Public</span>
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[#e8ebf7]/75">
          <input
            type="checkbox"
            checked={configureRemote}
            onChange={(e) => setConfigureRemote(e.target.checked)}
          />
          <span>Connect local remote:</span>
          <input
            type="text"
            value={remoteName}
            disabled={!configureRemote || pending}
            onChange={(e) => setRemoteName(e.target.value)}
            className="w-24 rounded border border-white/15 bg-[#06070c] px-1.5 py-0.5 font-mono text-[11px] text-[#e8ebf7] disabled:opacity-40"
          />
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-[#e8ebf7]/75">
          <input
            type="checkbox"
            checked={addReadme}
            onChange={(e) => setAddReadme(e.target.checked)}
          />
          <span>Initialize GitHub repo with README.md (blocked if local README.md exists)</span>
        </label>
      </div>

      <DialogFooter
        pending={pending}
        confirmLabel="Create GitHub Repo"
        confirmDisabled={!name.trim() || (configureRemote && !remoteName.trim())}
        onCancel={onCancel}
        onConfirm={() =>
          onConfirm({
            name: name.trim(),
            description: description.trim(),
            visibility,
            addReadme,
            configureRemote,
            remoteName: remoteName.trim(),
          })
        }
      />
    </div>
  );
}

function PublishBody({
  dialog,
  pending,
  onCancel,
  onConfirm,
}: {
  dialog: Extract<NonNullable<GitHubConfirmDialogState>, { kind: "publish" }>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (payload: {
    name: string;
    description: string;
    visibility: GitHubVisibility;
    remoteName: string;
    reuseExistingRemote: boolean;
  }) => void;
}) {
  const { preview } = dialog;
  const [name, setName] = useState(preview.suggested_repo_name);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GitHubVisibility>("private");
  const [remoteName, setRemoteName] = useState("origin");
  const [reuseExistingRemote, setReuseExistingRemote] = useState(false);

  const remoteCollision = preview.existing_remotes.some((r) => r.name === remoteName);
  const blocked =
    preview.blockers.length > 0 || (remoteCollision && !reuseExistingRemote);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]">
          <CloudUpload className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Publish Project to GitHub
          </h2>
          <p className="text-xs text-[#e8ebf7]/65">
            Branch{" "}
            <span className="font-mono text-[#e8ebf7]">
              {preview.current_branch || "(none)"}
            </span>{" "}
            {preview.username ? (
              <>
                under <span className="font-mono text-[#7aa2ff]">{preview.username}</span>
              </>
            ) : null}
            . Only existing commits are pushed.
          </p>
        </div>
      </div>

      {preview.blockers.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-400/30 bg-red-500/10 p-2.5 text-xs text-red-200">
          {preview.blockers.map((b, idx) => (
            <li key={idx}>• {b}</li>
          ))}
        </ul>
      )}

      {preview.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          {preview.warnings.map((w, idx) => (
            <li key={idx}>• {w}</li>
          ))}
        </ul>
      )}

      <div className="space-y-2.5 text-xs">
        <div>
          <label className="mb-1 block font-mono text-[10.5px] text-[#e8ebf7]/70">
            GitHub Repository Name
          </label>
          <input
            type="text"
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-[#06070c] px-2.5 py-1.5 font-mono text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10.5px] text-[#e8ebf7]/70">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            disabled={pending}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="VEGA ARIES V3 firmware project"
            className="w-full rounded-lg border border-white/15 bg-[#06070c] px-2.5 py-1.5 text-xs text-[#e8ebf7] focus:border-[#7aa2ff]/60 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#e8ebf7]/85">
              <input
                type="radio"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              <span>Private</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#e8ebf7]/85">
              <input
                type="radio"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              <span>Public</span>
            </label>
          </div>

          <label className="inline-flex items-center gap-1.5 text-[#e8ebf7]/70">
            <span>Remote:</span>
            <input
              type="text"
              value={remoteName}
              disabled={pending}
              onChange={(e) => setRemoteName(e.target.value)}
              className="w-24 rounded border border-white/15 bg-[#06070c] px-1.5 py-0.5 font-mono text-[11px] text-[#e8ebf7]"
            />
          </label>
        </div>

        {remoteCollision && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/8 p-2 text-amber-200">
            <input
              type="checkbox"
              checked={reuseExistingRemote}
              onChange={(e) => setReuseExistingRemote(e.target.checked)}
            />
            <span>
              Remote &lsquo;{remoteName}&rsquo; already exists — push to it instead of creating a new remote.
            </span>
          </label>
        )}
      </div>

      <DialogFooter
        pending={pending}
        confirmLabel="Publish & Push Branch"
        confirmDisabled={blocked || !name.trim() || !remoteName.trim()}
        onCancel={onCancel}
        onConfirm={() =>
          onConfirm({
            name: name.trim(),
            description: description.trim(),
            visibility,
            remoteName: remoteName.trim(),
            reuseExistingRemote,
          })
        }
      />
    </div>
  );
}

function PullBody({
  dialog,
  pending,
  onCancel,
  onConfirm,
}: {
  dialog: Extract<NonNullable<GitHubConfirmDialogState>, { kind: "pull" }>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (remote: string | null) => void;
}) {
  const { precheck } = dialog;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            precheck.ready
              ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]"
              : "border-red-400/35 bg-red-500/12 text-red-300"
          }`}
        >
          {precheck.ready ? (
            <ArrowDownToLine className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Confirm Git Pull
          </h2>
          <p className="text-xs text-[#e8ebf7]/65">
            Pull{" "}
            <span className="font-mono text-[#e8ebf7]">
              {precheck.target_remote || "(none)"}/{precheck.current_branch || "(detached)"}
            </span>{" "}
            into local branch (non-destructive merge; never resets or discards local changes).
          </p>
        </div>
      </div>

      {precheck.blockers.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-400/30 bg-red-500/10 p-2.5 text-xs text-red-200">
          {precheck.blockers.map((b, idx) => (
            <li key={idx}>• {b}</li>
          ))}
        </ul>
      )}

      {precheck.dirty_paths.length > 0 && (
        <ul className="vega-scroll max-h-28 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-[#05060b] p-2 font-mono text-[11px] text-[#e8ebf7]/75">
          {precheck.dirty_paths.map((p) => (
            <li key={p} className="truncate">
              {p}
            </li>
          ))}
        </ul>
      )}

      {precheck.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          {precheck.warnings.map((w, idx) => (
            <li key={idx}>• {w}</li>
          ))}
        </ul>
      )}

      <DialogFooter
        pending={pending}
        confirmLabel="Pull Changes"
        confirmDisabled={!precheck.ready}
        onCancel={onCancel}
        onConfirm={() => onConfirm(precheck.target_remote)}
      />
    </div>
  );
}

function PushBody({
  dialog,
  pending,
  onCancel,
  onConfirm,
}: {
  dialog: Extract<NonNullable<GitHubConfirmDialogState>, { kind: "push" }>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (remote: string | null, setUpstream: boolean) => void;
}) {
  const { precheck } = dialog;
  const [setUpstream, setSetUpstream] = useState(precheck.needs_upstream_setup);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            precheck.ready
              ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/12 text-[#7aa2ff]"
              : "border-red-400/35 bg-red-500/12 text-red-300"
          }`}
        >
          <ArrowUpFromLine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="github-confirm-title" className="text-sm font-semibold text-[#e8ebf7]">
            Confirm Git Push
          </h2>
          <p className="text-xs text-[#e8ebf7]/65">
            Push committed history on{" "}
            <span className="font-mono text-[#e8ebf7]">
              {precheck.current_branch || "(detached)"}
            </span>{" "}
            to remote{" "}
            <span className="font-mono text-[#7aa2ff]">
              {precheck.target_remote || "(none)"}
            </span>{" "}
            ({precheck.ahead} commit(s) ahead). Never force-pushes.
          </p>
        </div>
      </div>

      {precheck.blockers.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-400/30 bg-red-500/10 p-2.5 text-xs text-red-200">
          {precheck.blockers.map((b, idx) => (
            <li key={idx}>• {b}</li>
          ))}
        </ul>
      )}

      {precheck.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          {precheck.warnings.map((w, idx) => (
            <li key={idx}>• {w}</li>
          ))}
        </ul>
      )}

      {precheck.needs_upstream_setup && precheck.ready && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#e8ebf7]/80">
          <input
            type="checkbox"
            checked={setUpstream}
            onChange={(e) => setSetUpstream(e.target.checked)}
          />
          <span>Set upstream tracking (`git push -u`) for this branch</span>
        </label>
      )}

      <DialogFooter
        pending={pending}
        confirmLabel="Push Commits"
        confirmDisabled={!precheck.ready}
        onCancel={onCancel}
        onConfirm={() => onConfirm(precheck.target_remote, setUpstream)}
      />
    </div>
  );
}

function DialogFooter({
  pending,
  danger,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  danger?: boolean;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        disabled={pending}
        onClick={onCancel}
        className="inline-flex h-8 items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-medium text-[#e8ebf7]/80 hover:bg-white/[0.09] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={pending || confirmDisabled}
        onClick={onConfirm}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-45 ${
          danger
            ? "border-red-400/40 bg-red-500/20 text-red-100 hover:bg-red-500/30"
            : "border-[#7aa2ff]/45 bg-[#7aa2ff]/22 text-[#e8ebf7] hover:bg-[#7aa2ff]/32"
        }`}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{confirmLabel}</span>
      </button>
    </div>
  );
}
