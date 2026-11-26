"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  commitGitChanges,
  createGitBranch,
  deleteUntrackedGitFiles,
  discardGitChanges,
  fetchGitBranches,
  fetchGitCommitDetail,
  fetchGitDiff,
  fetchGitHistory,
  fetchGitInfo,
  fetchGitStatus,
  initGitRepository,
  precheckGitBranchSwitch,
  stageAllGitChanges,
  stageGitPaths,
  switchGitBranch,
  unstageAllGitChanges,
  unstageGitPaths,
} from "@/lib/api";
import type {
  GitBranchInfo,
  GitCommitDetailResponse,
  GitCommitSummary,
  GitConfirmDialogState,
  GitDiffResponse,
  GitInfoResponse,
  GitStatusResponse,
} from "@/types/git";

const HISTORY_PAGE_SIZE = 25;
const HISTORY_MAX_CLIENT_COMMITS = 500;

interface UseGitIntegrationOptions {
  projectDir: string | null;
  isBackendConnected: boolean;
  onOpenDiffTab?: () => void;
  onAfterWorkingTreeChange?: () => Promise<void> | void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useGitIntegration({
  projectDir,
  isBackendConnected,
  onOpenDiffTab,
  onAfterWorkingTreeChange,
  onLog,
}: UseGitIntegrationOptions) {
  const [info, setInfo] = useState<GitInfoResponse | null>(null);
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState<boolean>(false);

  const [commitMessage, setCommitMessage] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState<boolean>(false);
  const [actionPending, setActionPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] =
    useState<GitConfirmDialogState | null>(null);

  const [activeDiff, setActiveDiff] = useState<GitDiffResponse | null>(null);
  const [activeCommit, setActiveCommit] =
    useState<GitCommitDetailResponse | null>(null);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const projectDirRef = useRef(projectDir);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const onOpenDiffTabRef = useRef(onOpenDiffTab);
  const onAfterWtChangeRef = useRef(onAfterWorkingTreeChange);
  const onLogRef = useRef(onLog);

  useEffect(() => {
    projectDirRef.current = projectDir;
    onOpenDiffTabRef.current = onOpenDiffTab;
    onAfterWtChangeRef.current = onAfterWorkingTreeChange;
    onLogRef.current = onLog;
  });

  const resetRepoViews = useCallback(() => {
    inspectAbortRef.current?.abort();
    inspectAbortRef.current = null;
    setStatus(null);
    setBranches([]);
    setCommits([]);
    setHistoryHasMore(false);
    setActiveDiff(null);
    setActiveCommit(null);
    setInspectError(null);
    setInspectLoading(false);
    setConfirmDialog(null);
    setCommitMessage("");
  }, []);

  const refreshAll = useCallback(
    async (signal?: AbortSignal) => {
      if (!isBackendConnected) return;
      const targetDir = projectDirRef.current;

      setLoading(true);
      try {
        const infoRes = await fetchGitInfo(targetDir ?? undefined, signal);
        if (signal?.aborted) return;
        setInfo(infoRes);

        if (!targetDir || !infoRes.git_available) {
          resetRepoViews();
          return;
        }

        const stRes = await fetchGitStatus(targetDir, signal);
        if (signal?.aborted) return;
        setStatus(stRes);

        if (!stRes.is_repository) {
          setBranches([]);
          setCommits([]);
          setHistoryHasMore(false);
          return;
        }

        const [brRes, histRes] = await Promise.all([
          fetchGitBranches(targetDir, signal),
          fetchGitHistory(targetDir, HISTORY_PAGE_SIZE, 0, signal),
        ]);
        if (signal?.aborted) return;

        setBranches(brRes.branches);
        setCommits(histRes.commits);
        setHistoryHasMore(histRes.has_more);
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to inspect Git status."
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [isBackendConnected, resetRepoViews]
  );

  // Sync automatically on backend connect or project switch
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setError(null);
        setNotice(null);
        inspectAbortRef.current?.abort();
        inspectAbortRef.current = null;
        setActiveDiff(null);
        setActiveCommit(null);
        void refreshAll(controller.signal);
      }
    });
    return () => {
      controller.abort();
      inspectAbortRef.current?.abort();
    };
  }, [isBackendConnected, projectDir, refreshAll]);

  const loadMoreHistory = useCallback(async () => {
    const targetDir = projectDirRef.current;
    if (
      !targetDir ||
      !isBackendConnected ||
      loadingMoreHistory ||
      commits.length >= HISTORY_MAX_CLIENT_COMMITS
    ) {
      return;
    }

    setLoadingMoreHistory(true);
    try {
      const nextPage = await fetchGitHistory(
        targetDir,
        HISTORY_PAGE_SIZE,
        commits.length
      );
      if (projectDirRef.current !== targetDir) return;
      let reachedCap = false;
      setCommits((prev) => {
        const seen = new Set(prev.map((c) => c.hash));
        const merged = [
          ...prev,
          ...nextPage.commits.filter((c) => !seen.has(c.hash)),
        ];
        if (merged.length >= HISTORY_MAX_CLIENT_COMMITS) {
          reachedCap = true;
          return merged.slice(0, HISTORY_MAX_CLIENT_COMMITS);
        }
        return merged;
      });
      setHistoryHasMore(Boolean(nextPage.has_more) && !reachedCap);
    } catch (err: unknown) {
      if (projectDirRef.current === targetDir) {
        setError(
          err instanceof Error ? err.message : "Failed to load more commits."
        );
      }
    } finally {
      setLoadingMoreHistory(false);
    }
  }, [commits.length, isBackendConnected, loadingMoreHistory]);

  const initRepository = useCallback(async () => {
    const targetDir = projectDirRef.current;
    if (!targetDir || !isBackendConnected) return;

    setActionPending(true);
    setError(null);
    setNotice(null);
    try {
      const nextStatus = await initGitRepository(targetDir);
      setStatus(nextStatus);
      await refreshAll();
      setNotice("Initialized empty Git repository in project root.");
      onLogRef.current?.("info", `Initialized Git repository in ${targetDir}`);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to initialize Git repository."
      );
    } finally {
      setActionPending(false);
    }
  }, [isBackendConnected, refreshAll]);

  const stagePaths = useCallback(
    async (paths: string[]) => {
      const targetDir = projectDirRef.current;
      if (!targetDir || paths.length === 0) return;

      setActionPending(true);
      setError(null);
      try {
        const nextStatus = await stageGitPaths(targetDir, paths);
        setStatus(nextStatus);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to stage selected files."
        );
      } finally {
        setActionPending(false);
      }
    },
    []
  );

  const stageAll = useCallback(async () => {
    const targetDir = projectDirRef.current;
    if (!targetDir) return;
    setActionPending(true);
    setError(null);
    try {
      const nextStatus = await stageAllGitChanges(targetDir);
      setStatus(nextStatus);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to stage all changes."
      );
    } finally {
      setActionPending(false);
    }
  }, []);

  const unstagePaths = useCallback(async (paths: string[]) => {
    const targetDir = projectDirRef.current;
    if (!targetDir || paths.length === 0) return;
    setActionPending(true);
    setError(null);
    try {
      const nextStatus = await unstageGitPaths(targetDir, paths);
      setStatus(nextStatus);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to unstage selected files."
      );
    } finally {
      setActionPending(false);
    }
  }, []);

  const unstageAll = useCallback(async () => {
    const targetDir = projectDirRef.current;
    if (!targetDir) return;
    setActionPending(true);
    setError(null);
    try {
      const nextStatus = await unstageAllGitChanges(targetDir);
      setStatus(nextStatus);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to unstage all changes."
      );
    } finally {
      setActionPending(false);
    }
  }, []);

  const requestDiscard = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setError(null);
    setConfirmDialog({ kind: "discard", paths });
  }, []);

  const requestDeleteUntracked = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setError(null);
    setConfirmDialog({ kind: "delete_untracked", paths });
  }, []);

  const executeConfirmedAction = useCallback(async () => {
    const targetDir = projectDirRef.current;
    const dialog = confirmDialog;
    if (!targetDir || !dialog) return;

    setActionPending(true);
    setError(null);
    setNotice(null);

    try {
      if (dialog.kind === "discard") {
        const nextStatus = await discardGitChanges(targetDir, dialog.paths, true);
        setStatus(nextStatus);
        setConfirmDialog(null);
        setNotice(
          `Discarded unstaged changes in ${dialog.paths.length} file(s).`
        );
        onLogRef.current?.(
          "warn",
          `Discarded unstaged Git changes: ${dialog.paths.join(", ")}`
        );
        await onAfterWtChangeRef.current?.();
      } else if (dialog.kind === "delete_untracked") {
        const nextStatus = await deleteUntrackedGitFiles(
          targetDir,
          dialog.paths,
          true
        );
        setStatus(nextStatus);
        setConfirmDialog(null);
        setNotice(`Deleted ${dialog.paths.length} untracked file(s).`);
        onLogRef.current?.(
          "warn",
          `Deleted untracked files: ${dialog.paths.join(", ")}`
        );
        await onAfterWtChangeRef.current?.();
      } else if (dialog.kind === "switch_warning") {
        const res = await switchGitBranch(targetDir, dialog.branchName);
        setStatus(res.status);
        setBranches(res.branches);
        setConfirmDialog(null);
        setNotice(`Switched to branch '${dialog.branchName}'.`);
        const hist = await fetchGitHistory(targetDir, HISTORY_PAGE_SIZE, 0);
        setCommits(hist.commits);
        setHistoryHasMore(hist.has_more);
        await onAfterWtChangeRef.current?.();
      }
    } catch (err: unknown) {
      setConfirmDialog(null);
      setError(
        err instanceof Error ? err.message : "Git operation could not complete."
      );
    } finally {
      setActionPending(false);
    }
  }, [confirmDialog]);

  const commitStaged = useCallback(async () => {
    const targetDir = projectDirRef.current;
    if (!targetDir) return;
    const trimmed = commitMessage.trim();
    if (!trimmed) {
      setError("Enter a commit message before committing staged changes.");
      return;
    }

    setActionPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await commitGitChanges(targetDir, trimmed);
      setStatus(res.status);
      setCommitMessage("");
      setNotice(`Committed ${res.short_hash}: ${res.summary}`);
      onLogRef.current?.(
        "info",
        `Committed ${res.short_hash} on ${res.branch ?? "HEAD"}: ${res.summary}`
      );
      await refreshAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setActionPending(false);
    }
  }, [commitMessage, refreshAll]);

  const requestSwitchBranch = useCallback(
    async (branchName: string) => {
      const targetDir = projectDirRef.current;
      if (!targetDir || !isBackendConnected) return;

      setActionPending(true);
      setError(null);
      setNotice(null);
      try {
        const pre = await precheckGitBranchSwitch(targetDir, branchName);
        if (pre.has_uncommitted_changes) {
          setConfirmDialog({
            kind: "switch_warning",
            branchName,
            precheck: pre,
          });
          setActionPending(false);
          return;
        }

        const res = await switchGitBranch(targetDir, branchName);
        setStatus(res.status);
        setBranches(res.branches);
        setNotice(`Switched to branch '${branchName}'.`);
        const hist = await fetchGitHistory(targetDir, HISTORY_PAGE_SIZE, 0);
        setCommits(hist.commits);
        setHistoryHasMore(hist.has_more);
        await onAfterWtChangeRef.current?.();
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to switch branch."
        );
      } finally {
        setActionPending(false);
      }
    },
    [isBackendConnected]
  );

  const createBranch = useCallback(
    async (name: string, checkout: boolean = true): Promise<boolean> => {
      const targetDir = projectDirRef.current;
      if (!targetDir || !isBackendConnected) return false;
      const trimmed = name.trim();
      if (!trimmed) {
        setError("Enter a local branch name.");
        return false;
      }

      setActionPending(true);
      setError(null);
      setNotice(null);
      try {
        const res = await createGitBranch(targetDir, trimmed, checkout);
        setStatus(res.status);
        setBranches(res.branches);
        setNotice(
          checkout
            ? `Created and switched to branch '${trimmed}'.`
            : `Created branch '${trimmed}'.`
        );
        if (checkout) {
          const hist = await fetchGitHistory(targetDir, HISTORY_PAGE_SIZE, 0);
          setCommits(hist.commits);
          setHistoryHasMore(hist.has_more);
        }
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to create branch."
        );
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [isBackendConnected]
  );

  const openFileDiff = useCallback(
    async (
      path: string,
      options?: { staged?: boolean; commit?: string | null; keepCommitOpen?: boolean }
    ) => {
      const targetDir = projectDirRef.current;
      if (!targetDir || !isBackendConnected) return;

      inspectAbortRef.current?.abort();
      const ctrl = new AbortController();
      inspectAbortRef.current = ctrl;

      onOpenDiffTabRef.current?.();
      setInspectLoading(true);
      setInspectError(null);
      if (!options?.keepCommitOpen) {
        setActiveCommit(null);
      }

      try {
        const diff = await fetchGitDiff(targetDir, path, {
          staged: options?.staged,
          commit: options?.commit,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted || projectDirRef.current !== targetDir) return;
        setActiveDiff(diff);
      } catch (err: unknown) {
        if (
          ctrl.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setInspectError(
          err instanceof Error ? err.message : "Failed to load file diff."
        );
      } finally {
        if (inspectAbortRef.current === ctrl) {
          setInspectLoading(false);
        }
      }
    },
    [isBackendConnected]
  );

  const openCommitDetail = useCallback(
    async (commitHash: string) => {
      const targetDir = projectDirRef.current;
      if (!targetDir || !isBackendConnected) return;

      inspectAbortRef.current?.abort();
      const ctrl = new AbortController();
      inspectAbortRef.current = ctrl;

      onOpenDiffTabRef.current?.();
      setInspectLoading(true);
      setInspectError(null);
      setActiveDiff(null);

      try {
        const detail = await fetchGitCommitDetail(
          targetDir,
          commitHash,
          ctrl.signal
        );
        if (ctrl.signal.aborted || projectDirRef.current !== targetDir) return;
        setActiveCommit(detail);
      } catch (err: unknown) {
        if (
          ctrl.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setInspectError(
          err instanceof Error ? err.message : "Failed to load commit details."
        );
      } finally {
        if (inspectAbortRef.current === ctrl) {
          setInspectLoading(false);
        }
      }
    },
    [isBackendConnected]
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const totalPendingChanges = status
    ? status.staged_count + status.unstaged_count + status.untracked_count
    : 0;

  return {
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
    confirmDialog,
    activeDiff,
    activeCommit,
    inspectLoading,
    inspectError,
    totalPendingChanges,
    setCommitMessage,
    setConfirmDialog,
    refreshAll,
    loadMoreHistory,
    initRepository,
    stagePaths,
    stageAll,
    unstagePaths,
    unstageAll,
    requestDiscard,
    requestDeleteUntracked,
    executeConfirmedAction,
    commitStaged,
    requestSwitchBranch,
    createBranch,
    openFileDiff,
    openCommitDetail,
    clearFeedback,
  };
}
