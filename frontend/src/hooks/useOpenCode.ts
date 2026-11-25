"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createOpenCodeSession,
  fetchOpenCodeConfig,
  fetchOpenCodeInfo,
  fetchOpenCodeSession,
  fetchOpenCodeSessions,
  getOpenCodeWsUrl,
  interruptOpenCodeSession,
  promptOpenCodeSession,
  replyOpenCodePermission,
  resetOpenCodeConfig,
  terminateOpenCodeSession,
  updateOpenCodeConfig,
} from "@/lib/api";
import type {
  OpenCodeConfig,
  OpenCodeConfigStateResponse,
  OpenCodeContextAttachment,
  OpenCodeInfoResponse,
  OpenCodePermissionDecision,
  OpenCodePermissionMode,
  OpenCodeSessionDetailResponse,
  OpenCodeSessionSummary,
} from "@/types/opencode";

export type OpenCodeWsState = "disconnected" | "connecting" | "connected";

function normalizeFsPath(p: string | null | undefined): string {
  return (p ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

interface UseOpenCodeOptions {
  projectDir: string | null;
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  onAfterSessionComplete?: () => void;
}

export function useOpenCode({
  projectDir,
  isBackendConnected,
  onLog,
  onAfterSessionComplete,
}: UseOpenCodeOptions) {
  const [info, setInfo] = useState<OpenCodeInfoResponse | null>(null);
  const [configState, setConfigState] =
    useState<OpenCodeConfigStateResponse | null>(null);
  const [sessions, setSessions] = useState<OpenCodeSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] =
    useState<OpenCodeSessionDetailResponse | null>(null);
  const [wsState, setWsState] = useState<OpenCodeWsState>("disconnected");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [pendingContexts, setPendingContexts] = useState<
    OpenCodeContextAttachment[]
  >([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onLogRef = useRef(onLog);
  const onCompleteRef = useRef(onAfterSessionComplete);
  useEffect(() => {
    onLogRef.current = onLog;
    onCompleteRef.current = onAfterSessionComplete;
  }, [onLog, onAfterSessionComplete]);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const refreshInfoAndSessions = useCallback(
    async (opts?: { silent?: boolean; queryModels?: boolean }) => {
      if (!isBackendConnected) return;
      if (!opts?.silent) setLoading(true);
      try {
        const [infoRes, cfgRes, sessRes] = await Promise.all([
          fetchOpenCodeInfo(Boolean(opts?.queryModels)),
          fetchOpenCodeConfig(),
          fetchOpenCodeSessions(),
        ]);
        setInfo(infoRes);
        setConfigState(cfgRes);
        setSessions(sessRes.sessions);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to check OpenCode CLI status.";
        setError(msg);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [isBackendConnected]
  );

  // Refresh detection & session list when backend connects or project changes
  useEffect(() => {
    if (!isBackendConnected) {
      queueMicrotask(() => {
        setInfo(null);
        setConfigState(null);
        setSessions([]);
        setSessionDetail(null);
        setWsState("disconnected");
      });
      return;
    }

    const ctrl = new AbortController();
    queueMicrotask(() => setLoading(true));
    Promise.all([
      fetchOpenCodeInfo(false, ctrl.signal),
      fetchOpenCodeConfig(ctrl.signal),
      fetchOpenCodeSessions(undefined, ctrl.signal),
    ])
      .then(([infoRes, cfgRes, sessRes]) => {
        if (ctrl.signal.aborted) return;
        setInfo(infoRes);
        setConfigState(cfgRes);
        setSessions(sessRes.sessions);
        // Auto-select most recent active/idle session for the newly opened project if none selected for it
        if (projectDir) {
          const normProj = normalizeFsPath(projectDir);
          const matching = sessRes.sessions.find(
            (s) =>
              normalizeFsPath(s.project_dir) === normProj &&
              s.status !== "closed" &&
              s.status !== "unavailable"
          );
          if (matching) {
            setActiveSessionId((prev) => {
              const currentMatchesProject =
                prev &&
                sessRes.sessions.some(
                  (s) =>
                    s.session_id === prev &&
                    normalizeFsPath(s.project_dir) === normProj
                );
              return currentMatchesProject ? prev : matching.session_id;
            });
          }
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load OpenCode state."
          );
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [isBackendConnected, projectDir]);

  // Sync active session detail + live WebSocket connection when activeSessionId changes
  useEffect(() => {
    if (!isBackendConnected || !activeSessionId) {
      queueMicrotask(() => {
        setSessionDetail(null);
        setWsState("disconnected");
      });
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const ctrl = new AbortController();

    fetchOpenCodeSession(activeSessionId, { sync: true, signal: ctrl.signal })
      .then((detail) => {
        if (!cancelled) {
          setSessionDetail(detail);
          setSessions((prev) =>
            prev.map((s) =>
              s.session_id === detail.session.session_id ? detail.session : s
            )
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to inspect session."
          );
        }
      });

    const connectWs = () => {
      if (cancelled) return;
      setWsState("connecting");
      const url = getOpenCodeWsUrl(activeSessionId);
      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => {
        if (cancelled) return;
        setWsState("connected");
      };

      socket.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const type = String(payload.type || "");
          if (type === "ping" || type === "pong") return;

          if (type === "snapshot") {
            setSessionDetail({
              session: payload.session as OpenCodeSessionDetailResponse["session"],
              messages: (payload.messages ??
                []) as OpenCodeSessionDetailResponse["messages"],
              pending_permissions: (payload.pending_permissions ??
                []) as OpenCodeSessionDetailResponse["pending_permissions"],
              truncated_messages: Boolean(payload.truncated_messages),
            });
          } else if (type === "user_message") {
            const msg = payload.message as OpenCodeSessionDetailResponse["messages"][number];
            setSessionDetail((prev) => {
              if (!prev) return prev;
              const exists = prev.messages.some((m) => m.id === msg.id);
              return exists
                ? prev
                : { ...prev, messages: [...prev.messages, msg] };
            });
          } else if (type === "messages_synced") {
            const msgs = (payload.messages ??
              []) as OpenCodeSessionDetailResponse["messages"];
            setSessionDetail((prev) =>
              prev ? { ...prev, messages: msgs } : prev
            );
          } else if (type === "permission_requested") {
            const perm = payload.permission as OpenCodeSessionDetailResponse["pending_permissions"][number];
            setSessionDetail((prev) => {
              if (!prev) return prev;
              const exists = prev.pending_permissions.some(
                (p) => p.request_id === perm.request_id
              );
              const nextPerms = exists
                ? prev.pending_permissions.map((p) =>
                    p.request_id === perm.request_id ? perm : p
                  )
                : [...prev.pending_permissions, perm];
              return { ...prev, pending_permissions: nextPerms };
            });
          } else if (type === "permission_resolved") {
            const perm = payload.permission as OpenCodeSessionDetailResponse["pending_permissions"][number];
            setSessionDetail((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                pending_permissions: prev.pending_permissions.map((p) =>
                  p.request_id === perm.request_id ? perm : p
                ),
              };
            });
          } else if (type === "session_status" || type === "session_closed") {
            const sess = payload.session as OpenCodeSessionSummary;
            setSessionDetail((prev) =>
              prev ? { ...prev, session: sess } : prev
            );
            setSessions((prev) =>
              prev.map((s) => (s.session_id === sess.session_id ? sess : s))
            );
            if (sess.status === "completed") {
              onCompleteRef.current?.();
              void fetchOpenCodeInfo(true).then(setInfo).catch(() => {});
            }
          } else if (type === "error") {
            const msg = String(payload.message || "OpenCode agent error.");
            setError(msg);
            onLogRef.current?.("error", `[OpenCode] ${msg}`);
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      socket.onerror = () => {
        if (!cancelled) {
          setWsState("disconnected");
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setWsState("disconnected");
        reconnectTimer = window.setTimeout(() => {
          if (!cancelled) connectWs();
        }, 1800);
      };
    };

    connectWs();

    return () => {
      cancelled = true;
      ctrl.abort();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [isBackendConnected, activeSessionId]);

  const saveConfig = useCallback(
    async (cfg: OpenCodeConfig) => {
      setSavingConfig(true);
      setError(null);
      setNotice(null);
      try {
        const res = await updateOpenCodeConfig(cfg);
        setConfigState(res);
        setInfo(res.info);
        setNotice("OpenCode configuration saved.");
        return res;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to save OpenCode configuration.";
        setError(msg);
        return null;
      } finally {
        setSavingConfig(false);
      }
    },
    []
  );

  const resetConfig = useCallback(async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await resetOpenCodeConfig();
      setConfigState(res);
      setInfo(res.info);
      setNotice("OpenCode configuration reset to defaults.");
      return res;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reset OpenCode configuration."
      );
      return null;
    } finally {
      setSavingConfig(false);
    }
  }, []);

  const createSession = useCallback(
    async (opts?: {
      title?: string;
      permissionMode?: OpenCodePermissionMode;
      model?: string;
    }): Promise<OpenCodeSessionDetailResponse | null> => {
      if (!projectDir) {
        setError("Open a VEGA project first before starting an OpenCode session.");
        return null;
      }
      setActionPending(true);
      setError(null);
      setNotice(null);
      try {
        const detail = await createOpenCodeSession({
          project_dir: projectDir,
          title: opts?.title,
          permission_mode: opts?.permissionMode,
          model: opts?.model || selectedModel || undefined,
        });
        setSessions((prev) => [detail.session, ...prev]);
        setActiveSessionId(detail.session.session_id);
        setSessionDetail(detail);
        void fetchOpenCodeInfo(true).then(setInfo).catch(() => {});
        onLogRef.current?.(
          "info",
          `[OpenCode] Started session '${detail.session.title}' in ${detail.session.project_name}`
        );
        return detail;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to start OpenCode session.";
        setError(msg);
        return null;
      } finally {
        setActionPending(false);
      }
    },
    [projectDir, selectedModel]
  );

  const sendPrompt = useCallback(
    async (override?: {
      prompt?: string;
      contexts?: OpenCodeContextAttachment[];
    }) => {
      if (!projectDir) {
        setError("No active project open.");
        return false;
      }
      const text = (override?.prompt ?? draftPrompt).trim();
      if (!text) return false;
      const contexts = override?.contexts ?? pendingContexts;

      setActionPending(true);
      setError(null);
      try {
        let targetSessionId = activeSessionId;
        const current = sessionDetail?.session ?? sessions.find((s) => s.session_id === targetSessionId);
        const crossProject =
          current &&
          normalizeFsPath(current.project_dir) !== normalizeFsPath(projectDir);
        const unusable =
          !current ||
          current.status === "closed" ||
          current.status === "unavailable" ||
          crossProject;

        if (unusable) {
          const created = await createOpenCodeSession({
            project_dir: projectDir,
            model: selectedModel || undefined,
          });
          setSessions((prev) => [created.session, ...prev]);
          setActiveSessionId(created.session.session_id);
          setSessionDetail(created);
          targetSessionId = created.session.session_id;
        }

        if (!targetSessionId) return false;
        const updated = await promptOpenCodeSession(targetSessionId, {
          project_dir: projectDir,
          prompt: text,
          model: selectedModel || undefined,
          contexts,
        });
        setSessionDetail(updated);
        if (!override?.prompt) {
          setDraftPrompt("");
        }
        if (!override?.contexts) {
          setPendingContexts([]);
        }
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to send prompt."
        );
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [
      activeSessionId,
      draftPrompt,
      pendingContexts,
      projectDir,
      selectedModel,
      sessionDetail,
      sessions,
    ]
  );

  const interruptSession = useCallback(async () => {
    if (!activeSessionId) return;
    setActionPending(true);
    try {
      const summary = await interruptOpenCodeSession(activeSessionId);
      setSessionDetail((prev) =>
        prev ? { ...prev, session: summary } : prev
      );
      setSessions((prev) =>
        prev.map((s) => (s.session_id === summary.session_id ? summary : s))
      );
      setNotice("OpenCode execution interrupted.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to interrupt session."
      );
    } finally {
      setActionPending(false);
    }
  }, [activeSessionId]);

  const replyPermission = useCallback(
    async (
      requestId: string,
      decision: OpenCodePermissionDecision,
      message?: string
    ) => {
      if (!activeSessionId) return;
      const targetProj = sessionDetail?.session.project_dir ?? projectDir ?? undefined;
      setActionPending(true);
      try {
        const updated = await replyOpenCodePermission(activeSessionId, requestId, {
          project_dir: targetProj,
          decision,
          message,
        });
        setSessionDetail(updated);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to submit permission decision."
        );
      } finally {
        setActionPending(false);
      }
    },
    [activeSessionId, projectDir, sessionDetail?.session.project_dir]
  );

  const terminateSession = useCallback(
    async (sessionId: string) => {
      setActionPending(true);
      try {
        const closed = await terminateOpenCodeSession(sessionId);
        setSessions((prev) =>
          prev.map((s) => (s.session_id === closed.session_id ? closed : s))
        );
        if (activeSessionId === sessionId) {
          setSessionDetail((prev) =>
            prev ? { ...prev, session: closed } : prev
          );
        }
        setNotice("Session closed.");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to close session."
        );
      } finally {
        setActionPending(false);
      }
    },
    [activeSessionId]
  );

  const addContext = useCallback((ctx: OpenCodeContextAttachment) => {
    setPendingContexts((prev) => {
      const key = `${ctx.kind}|${ctx.title}|${ctx.relative_path ?? ""}|${ctx.start_line ?? ""}`;
      if (
        prev.some(
          (p) =>
            `${p.kind}|${p.title}|${p.relative_path ?? ""}|${p.start_line ?? ""}` ===
            key
        )
      ) {
        return prev;
      }
      return [...prev.slice(-5), ctx];
    });
  }, []);

  const removeContext = useCallback((idx: number) => {
    setPendingContexts((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const activeSessionSummary =
    sessionDetail?.session ??
    sessions.find((s) => s.session_id === activeSessionId) ??
    null;
  const isCrossProjectSession = Boolean(
    projectDir &&
      activeSessionSummary &&
      normalizeFsPath(projectDir) !==
        normalizeFsPath(activeSessionSummary.project_dir)
  );

  return {
    info,
    configState,
    sessions,
    activeSessionId,
    sessionDetail,
    activeSessionSummary,
    isCrossProjectSession,
    wsState,
    draftPrompt,
    setDraftPrompt,
    pendingContexts,
    addContext,
    removeContext,
    selectedModel,
    setSelectedModel,
    loading,
    actionPending,
    savingConfig,
    error,
    notice,
    clearFeedback,
    refreshInfoAndSessions,
    saveConfig,
    resetConfig,
    selectSession: setActiveSessionId,
    createSession,
    sendPrompt,
    interruptSession,
    replyPermission,
    terminateSession,
  };
}
