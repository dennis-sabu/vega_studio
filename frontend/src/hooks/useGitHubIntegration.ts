"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addGitHubRemote,
  cancelGitHubOperation,
  createGitHubRepository,
  fetchGitHubOperationState,
  fetchGitHubRemoteRepoInfo,
  fetchGitHubStatus,
  precheckGitHubPull,
  precheckGitHubPush,
  previewGitHubPublish,
  publishGitHubProject,
  removeGitHubRemote,
  startGitHubAuthLogin,
  startGitHubFetch,
  startGitHubPull,
  startGitHubPush,
  updateGitHubRemote,
} from "@/lib/api";
import type {
  GitHubOperationSummary,
  GitHubPublishPreviewResponse,
  GitHubRemoteRepoDetail,
  GitHubStatusResponse,
  GitHubSyncPrecheckResponse,
  GitHubVisibility,
} from "@/types/github";

export type GitHubConfirmDialogState =
  | {
      kind: "update_remote";
      name: string;
      url: string;
    }
  | {
      kind: "remove_remote";
      name: string;
    }
  | {
      kind: "create_repo";
      suggestedName: string;
      hasRemotes: boolean;
    }
  | {
      kind: "publish";
      preview: GitHubPublishPreviewResponse;
    }
  | {
      kind: "pull";
      precheck: GitHubSyncPrecheckResponse;
    }
  | {
      kind: "push";
      precheck: GitHubSyncPrecheckResponse;
    }
  | null;

interface UseGitHubIntegrationOptions {
  projectDir: string | null;
  enabled: boolean;
  onRefreshGit?: () => void;
  onLog?: (message: string) => void;
}

export function useGitHubIntegration({
  projectDir,
  enabled,
  onRefreshGit,
  onLog,
}: UseGitHubIntegrationOptions) {
  const [status, setStatus] = useState<GitHubStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteRepoDetail, setRemoteRepoDetail] =
    useState<GitHubRemoteRepoDetail | null>(null);
  const [loadingRemoteRepoDetail, setLoadingRemoteRepoDetail] = useState(false);
  const [confirmDialog, setConfirmDialog] =
    useState<GitHubConfirmDialogState>(null);

  const onRefreshGitRef = useRef(onRefreshGit);
  const onLogRef = useRef(onLog);
  const lastCompletedOpIdRef = useRef<string | null>(null);

  useEffect(() => {
    onRefreshGitRef.current = onRefreshGit;
    onLogRef.current = onLog;
  }, [onRefreshGit, onLog]);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const refreshStatus = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!enabled) return;
      if (!opts?.silent) {
        setLoading(true);
      }
      try {
        const res = await fetchGitHubStatus(projectDir ?? undefined);
        setStatus(res);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to check GitHub integration status."
        );
      } finally {
        if (!opts?.silent) {
          setLoading(false);
        }
      }
    },
    [enabled, projectDir]
  );

  // Refresh local CLI/auth + configured remotes on project/backend change (never auto-fetches remotes!)
  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => {
        setStatus(null);
        setRemoteRepoDetail(null);
        setConfirmDialog(null);
      });
      return;
    }

    const ctrl = new AbortController();
    queueMicrotask(() => {
      setRemoteRepoDetail(null);
      setLoading(true);
    });
    fetchGitHubStatus(projectDir ?? undefined, ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) {
          setStatus(res);
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load GitHub status."
          );
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      });

    return () => ctrl.abort();
  }, [enabled, projectDir]);

  // Poll active operation state while a background CLI/Git network process is running
  const activeOpId = status?.active_operation?.op_id ?? null;
  const activeOpStatus = status?.active_operation?.status ?? null;

  useEffect(() => {
    if (!enabled || !activeOpId || activeOpStatus !== "running") {
      return;
    }

    const ctrl = new AbortController();
    const timer = window.setInterval(() => {
      fetchGitHubOperationState(ctrl.signal)
        .then((opState) => {
          if (ctrl.signal.aborted) return;
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  active_operation: opState.active_operation,
                  latest_operation: opState.latest_operation,
                }
              : prev
          );

          const finished =
            !opState.active_operation &&
            opState.latest_operation &&
            opState.latest_operation.status !== "running" &&
            lastCompletedOpIdRef.current !== opState.latest_operation.op_id;

          if (finished && opState.latest_operation) {
            const doneOp: GitHubOperationSummary = opState.latest_operation;
            lastCompletedOpIdRef.current = doneOp.op_id;
            if (doneOp.status === "succeeded") {
              setNotice(`GitHub ${doneOp.kind.replace("_", " ")} completed.`);
              setError(null);
              onLogRef.current?.(
                `[GitHub] ${doneOp.kind} completed successfully.`
              );
            } else if (doneOp.status === "cancelled") {
              setNotice(`GitHub ${doneOp.kind.replace("_", " ")} cancelled.`);
              onLogRef.current?.(`[GitHub] ${doneOp.kind} cancelled.`);
            } else {
              const errMsg =
                doneOp.error_message ||
                `GitHub ${doneOp.kind.replace("_", " ")} failed.`;
              setError(errMsg);
              onLogRef.current?.(`[GitHub Error] ${errMsg}`);
            }

            void fetchGitHubStatus(projectDir ?? undefined).then((next) => {
              if (!ctrl.signal.aborted) {
                setStatus(next);
              }
            });
            onRefreshGitRef.current?.();
          }
        })
        .catch(() => {
          // Transient polling error will retry cleanly on next interval
        });
    }, 350);

    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [enabled, activeOpId, activeOpStatus, projectDir]);

  const applyRunningOp = useCallback((op: GitHubOperationSummary) => {
    lastCompletedOpIdRef.current = null;
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            active_operation: op.status === "running" ? op : null,
            latest_operation: op,
          }
        : prev
    );
  }, []);

  const runAction = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      successMsg?: string
    ): Promise<T | null> => {
      setActionPending(true);
      setError(null);
      if (successMsg) setNotice(null);
      try {
        const res = await fn();
        if (successMsg) {
          setNotice(successMsg);
          onLogRef.current?.(`[GitHub] ${successMsg}`);
        }
        return res;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "GitHub operation failed.";
        setError(msg);
        onLogRef.current?.(`[GitHub Error] ${msg}`);
        return null;
      } finally {
        setActionPending(false);
      }
    },
    []
  );

  // ── Auth Actions ──────────────────────────────────────────────────────────────

  const signInWithGitHub = useCallback(
    async (protocol: "https" | "ssh" = "https") => {
      const op = await runAction(() => startGitHubAuthLogin(protocol));
      if (op) {
        applyRunningOp(op);
        setNotice(
          "GitHub CLI sign-in started. Copy the one-time code if shown and complete authorization in your browser, then verify auth status."
        );
      }
    },
    [applyRunningOp, runAction]
  );

  const cancelOperation = useCallback(async () => {
    const op = await runAction(() => cancelGitHubOperation());
    if (op) {
      applyRunningOp(op);
      setNotice("Cancellation requested.");
    }
  }, [applyRunningOp, runAction]);

  // ── Remote Management ─────────────────────────────────────────────────────────

  const addRemote = useCallback(
    async (name: string, url: string): Promise<boolean> => {
      if (!projectDir) return false;
      const updated = await runAction(
        () => addGitHubRemote(projectDir, name, url),
        `Added remote '${name}'.`
      );
      if (!updated) return false;
      await refreshStatus({ silent: true });
      return true;
    },
    [projectDir, refreshStatus, runAction]
  );

  const requestUpdateRemote = useCallback((name: string, url: string) => {
    setConfirmDialog({ kind: "update_remote", name, url });
  }, []);

  const requestRemoveRemote = useCallback((name: string) => {
    setConfirmDialog({ kind: "remove_remote", name });
  }, []);

  const confirmUpdateRemote = useCallback(
    async (name: string, url: string) => {
      if (!projectDir) return;
      const updated = await runAction(
        () => updateGitHubRemote(projectDir, name, url, true),
        `Updated remote '${name}'.`
      );
      if (updated) {
        setConfirmDialog(null);
        await refreshStatus({ silent: true });
      }
    },
    [projectDir, refreshStatus, runAction]
  );

  const confirmRemoveRemote = useCallback(
    async (name: string) => {
      if (!projectDir) return;
      const updated = await runAction(
        () => removeGitHubRemote(projectDir, name, true),
        `Removed remote '${name}'.`
      );
      if (updated) {
        setRemoteRepoDetail(null);
        setConfirmDialog(null);
        await refreshStatus({ silent: true });
      }
    },
    [projectDir, refreshStatus, runAction]
  );

  // ── Create Repo & Guided Publish ──────────────────────────────────────────────

  const requestCreateRepo = useCallback(() => {
    const baseName =
      projectDir?.split(/[\\/]/).filter(Boolean).pop() || "vega-firmware";
    const cleaned =
      baseName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]|[-.]$/g, "") ||
      "vega-firmware";
    setConfirmDialog({
      kind: "create_repo",
      suggestedName: cleaned,
      hasRemotes: (status?.remotes.length ?? 0) > 0,
    });
  }, [projectDir, status?.remotes.length]);

  const confirmCreateRepo = useCallback(
    async (payload: {
      name: string;
      description: string;
      visibility: GitHubVisibility;
      addReadme: boolean;
      configureRemote: boolean;
      remoteName: string;
    }) => {
      if (!projectDir) return;
      const res = await runAction(
        () =>
          createGitHubRepository({
            project_dir: projectDir,
            name: payload.name,
            description: payload.description,
            visibility: payload.visibility,
            add_readme: payload.addReadme,
            configure_remote: payload.configureRemote,
            remote_name: payload.remoteName,
            confirm: true,
          }),
        `Created GitHub repository '${payload.name}'.`
      );
      if (res) {
        setConfirmDialog(null);
        await refreshStatus({ silent: true });
        onRefreshGitRef.current?.();
      }
    },
    [projectDir, refreshStatus, runAction]
  );

  const requestPublish = useCallback(async () => {
    if (!projectDir) return;
    const preview = await runAction(() => previewGitHubPublish(projectDir));
    if (preview) {
      setConfirmDialog({ kind: "publish", preview });
    }
  }, [projectDir, runAction]);

  const confirmPublish = useCallback(
    async (payload: {
      name: string;
      description: string;
      visibility: GitHubVisibility;
      remoteName: string;
      reuseExistingRemote: boolean;
    }) => {
      if (!projectDir) return;
      const op = await runAction(() =>
        publishGitHubProject({
          project_dir: projectDir,
          name: payload.name,
          description: payload.description,
          visibility: payload.visibility,
          remote_name: payload.remoteName,
          reuse_existing_remote: payload.reuseExistingRemote,
          confirm: true,
        })
      );
      if (op) {
        setConfirmDialog(null);
        applyRunningOp(op);
      }
    },
    [applyRunningOp, projectDir, runAction]
  );

  // ── Sync Actions (Fetch / Pull / Push) & Explicit Repo Info ──────────────────

  const fetchRemote = useCallback(
    async (remote: string = "origin") => {
      if (!projectDir) return;
      const op = await runAction(() => startGitHubFetch(projectDir, remote));
      if (op) {
        applyRunningOp(op);
      }
    },
    [applyRunningOp, projectDir, runAction]
  );

  const requestPull = useCallback(
    async (remote?: string | null) => {
      if (!projectDir) return;
      const precheck = await runAction(() =>
        precheckGitHubPull(projectDir, remote)
      );
      if (precheck) {
        setConfirmDialog({ kind: "pull", precheck });
      }
    },
    [projectDir, runAction]
  );

  const confirmPull = useCallback(
    async (remote?: string | null) => {
      if (!projectDir) return;
      const op = await runAction(() =>
        startGitHubPull({
          project_dir: projectDir,
          remote: remote ?? null,
          confirm: true,
        })
      );
      if (op) {
        setConfirmDialog(null);
        applyRunningOp(op);
      }
    },
    [applyRunningOp, projectDir, runAction]
  );

  const requestPush = useCallback(
    async (remote?: string | null) => {
      if (!projectDir) return;
      const precheck = await runAction(() =>
        precheckGitHubPush(projectDir, remote)
      );
      if (precheck) {
        setConfirmDialog({ kind: "push", precheck });
      }
    },
    [projectDir, runAction]
  );

  const confirmPush = useCallback(
    async (remote: string | null, setUpstream: boolean) => {
      if (!projectDir) return;
      const op = await runAction(() =>
        startGitHubPush({
          project_dir: projectDir,
          remote,
          set_upstream: setUpstream,
          confirm: true,
        })
      );
      if (op) {
        setConfirmDialog(null);
        applyRunningOp(op);
      }
    },
    [applyRunningOp, projectDir, runAction]
  );

  const inspectRemoteInfo = useCallback(
    async (remote?: string | null) => {
      if (!projectDir) return;
      setLoadingRemoteRepoDetail(true);
      setError(null);
      try {
        const detail = await fetchGitHubRemoteRepoInfo(projectDir, remote);
        setRemoteRepoDetail(detail);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load remote repository details."
        );
      } finally {
        setLoadingRemoteRepoDetail(false);
      }
    },
    [projectDir]
  );

  return {
    status,
    loading,
    actionPending,
    error,
    notice,
    remoteRepoDetail,
    loadingRemoteRepoDetail,
    confirmDialog,
    closeConfirmDialog: () => setConfirmDialog(null),
    clearFeedback,
    refreshStatus,
    signInWithGitHub,
    cancelOperation,
    addRemote,
    requestUpdateRemote,
    requestRemoveRemote,
    confirmUpdateRemote,
    confirmRemoveRemote,
    requestCreateRepo,
    confirmCreateRepo,
    requestPublish,
    confirmPublish,
    fetchRemote,
    requestPull,
    confirmPull,
    requestPush,
    confirmPush,
    inspectRemoteInfo,
  };
}
