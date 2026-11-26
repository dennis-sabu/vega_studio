"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAiGeneration,
  clearAiConversation,
  createAiConversation,
  deleteAiConversation,
  deleteAiCredential,
  fetchAiConversation,
  fetchAiConversations,
  fetchAiProvidersState,
  getNativeAiWsUrl,
  previewAiContext,
  resetAiConfig,
  retryAiMessage,
  sendAiMessage,
  setAiCredential,
  testAiConnection,
  updateAiConfig,
  updateAiConversation,
} from "@/lib/api";
import type {
  AIConfig,
  AIConnectionTestResponse,
  AIContextAttachment,
  AIContextPreviewResponse,
  AIConversationDetailResponse,
  AIConversationSummary,
  AIProviderId,
  AIProvidersStateResponse,
  AIToolTraceItem,
} from "@/types/ai";

export type NativeAiWsState = "disconnected" | "connecting" | "connected";

function normalizeFsPath(p: string | null | undefined): string {
  return (p ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

interface UseNativeAiOptions {
  projectDir: string | null;
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useNativeAi({
  projectDir,
  isBackendConnected,
  onLog,
}: UseNativeAiOptions) {
  const [providersState, setProvidersState] =
    useState<AIProvidersStateResponse | null>(null);
  const [conversations, setConversations] = useState<AIConversationSummary[]>(
    []
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationDetail, setConversationDetail] =
    useState<AIConversationDetailResponse | null>(null);
  const [wsState, setWsState] = useState<NativeAiWsState>("disconnected");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    AIContextAttachment[]
  >([]);
  const [contextPreview, setContextPreview] =
    useState<AIContextPreviewResponse | null>(null);
  const [testResult, setTestResult] = useState<AIConnectionTestResponse | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onLogRef = useRef(onLog);
  useEffect(() => {
    onLogRef.current = onLog;
  });

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const refreshState = useCallback(
    async (signal?: AbortSignal) => {
      if (!isBackendConnected) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [provRes, convRes] = await Promise.all([
          fetchAiProvidersState(signal),
          fetchAiConversations(projectDir, signal),
        ]);
        if (signal?.aborted) return;
        setProvidersState(provRes);
        setConversations(convRes.conversations);
        setActiveConversationId((prev) => {
          const match = convRes.conversations.find(
            (c) =>
              c.project_dir &&
              projectDir &&
              normalizeFsPath(c.project_dir) === normalizeFsPath(projectDir)
          );
          if (prev && projectDir) {
            const prevRec = convRes.conversations.find((c) => c.conversation_id === prev);
            if (prevRec && (!prevRec.project_dir || normalizeFsPath(prevRec.project_dir) === normalizeFsPath(projectDir))) {
              return prev;
            }
          } else if (prev && !projectDir && convRes.conversations.some((c) => c.conversation_id === prev)) {
            return prev;
          }
          return match?.conversation_id ?? (projectDir ? null : convRes.conversations[0]?.conversation_id ?? null);
        });
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        const msg =
          err instanceof Error ? err.message : "Failed to load Native AI state.";
        setError(msg);
        onLogRef.current?.("warn", msg);
      } finally {
        setLoading(false);
      }
    },
    [isBackendConnected, projectDir]
  );

  useEffect(() => {
    queueMicrotask(() => {
      setDraftPrompt("");
      setPendingAttachments([]);
      setContextPreview(null);
      setError(null);
      setNotice(null);
      setConversationDetail(null);
      if (!isBackendConnected) {
        setLoading(false);
        setWsState("disconnected");
      }
    });
    if (!isBackendConnected) return;
    const ctrl = new AbortController();
    queueMicrotask(() => {
      if (!ctrl.signal.aborted) {
        void refreshState(ctrl.signal);
      }
    });
    return () => {
      ctrl.abort();
    };
  }, [isBackendConnected, projectDir, refreshState]);

  // WebSocket live streaming subscription for active conversation
  useEffect(() => {
    if (!isBackendConnected || !activeConversationId) {
      queueMicrotask(() => {
        setWsState("disconnected");
        if (!activeConversationId) {
          setConversationDetail(null);
        }
      });
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retryCount = 0;
    const ctrl = new AbortController();

    fetchAiConversation(activeConversationId, ctrl.signal)
      .then((detail) => {
        if (!cancelled) setConversationDetail(detail);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setConversationDetail(null);
        setError(
          err instanceof Error ? err.message : "Failed to load conversation history."
        );
      });

    const connectWs = () => {
      if (cancelled) return;
      setWsState("connecting");
      ws = new WebSocket(getNativeAiWsUrl(activeConversationId));

      ws.onopen = () => {
        if (!cancelled) {
          retryCount = 0;
          setWsState("connected");
        }
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            delta?: string;
            detail?: AIConversationDetailResponse;
            tool?: AIToolTraceItem;
            error?: string;
          };

          if (msg.type === "snapshot" && msg.detail) {
            setConversationDetail(msg.detail);
            return;
          }

          if (msg.type === "generation_started") {
            setConversationDetail((prev) =>
              prev
                ? {
                    ...prev,
                    conversation: {
                      ...prev.conversation,
                      status: "streaming",
                      last_error: null,
                    },
                  }
                : prev
            );
            return;
          }

          if (msg.type === "chunk_delta" && typeof msg.delta === "string") {
            const delta = msg.delta;
            setConversationDetail((prev) => {
              if (!prev) return prev;
              const msgs = [...prev.messages];
              const last = msgs[msgs.length - 1];
              if (last && last.role === "assistant" && last.is_streaming) {
                msgs[msgs.length - 1] = {
                  ...last,
                  content: last.content + delta,
                };
              } else {
                msgs.push({
                  id: "streaming_pending",
                  seq: (last?.seq ?? 0) + 1,
                  role: "assistant",
                  content: delta,
                  attachments: [],
                  tool_traces: [],
                  provider_id: prev.conversation.provider_id,
                  model: prev.conversation.model,
                  finish_reason: null,
                  usage: null,
                  error_message: null,
                  created_at: new Date().toISOString(),
                  is_streaming: true,
                });
              }
              return {
                ...prev,
                conversation: { ...prev.conversation, status: "streaming" },
                messages: msgs,
              };
            });
            return;
          }

          if (
            (msg.type === "tool_call" || msg.type === "tool_result") &&
            msg.tool
          ) {
            const toolItem = msg.tool;
            setConversationDetail((prev) => {
              if (!prev) return prev;
              const msgs = [...prev.messages];
              let last = msgs[msgs.length - 1];
              if (!last || last.role !== "assistant" || !last.is_streaming) {
                last = {
                  id: "streaming_pending",
                  seq: (last?.seq ?? 0) + 1,
                  role: "assistant",
                  content: "",
                  attachments: [],
                  tool_traces: [],
                  provider_id: prev.conversation.provider_id,
                  model: prev.conversation.model,
                  finish_reason: null,
                  usage: null,
                  error_message: null,
                  created_at: new Date().toISOString(),
                  is_streaming: true,
                };
                msgs.push(last);
              }
              const traces = [...last.tool_traces];
              const idx = traces.findIndex((t) => t.call_id === toolItem.call_id);
              if (idx >= 0) {
                traces[idx] = toolItem;
              } else {
                traces.push(toolItem);
              }
              msgs[msgs.length - 1] = { ...last, tool_traces: traces };
              return { ...prev, messages: msgs };
            });
            return;
          }

          if (
            (msg.type === "generation_completed" ||
              msg.type === "generation_cancelled" ||
              msg.type === "generation_error") &&
            msg.detail
          ) {
            const finalDetail = msg.detail;
            setConversationDetail(finalDetail);
            setConversations((prev) =>
              prev.map((c) =>
                c.conversation_id === finalDetail.conversation.conversation_id
                  ? finalDetail.conversation
                  : c
              )
            );
            if (msg.type === "generation_error" && msg.error) {
              setError(msg.error);
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setWsState("disconnected");
        fetchAiConversation(activeConversationId, ctrl.signal)
          .then((detail) => {
            if (!cancelled) setConversationDetail(detail);
          })
          .catch(() => {});
      };

      ws.onclose = () => {
        if (cancelled) return;
        setWsState("disconnected");
        // Reconcile state cleanly in case socket dropped mid-stream
        fetchAiConversation(activeConversationId, ctrl.signal)
          .then((detail) => {
            if (!cancelled) setConversationDetail(detail);
          })
          .catch(() => {});
        if (retryCount >= 8) return;
        const delayMs = Math.min(1800 * Math.pow(2, retryCount), 15000);
        retryCount += 1;
        reconnectTimer = window.setTimeout(() => {
          if (!cancelled && document.visibilityState !== "hidden") {
            connectWs();
          } else if (!cancelled) {
            const onVis = () => {
              if (document.visibilityState !== "hidden") {
                document.removeEventListener("visibilitychange", onVis);
                if (!cancelled) connectWs();
              }
            };
            document.addEventListener("visibilitychange", onVis);
          }
        }, delayMs);
      };
    };

    connectWs();

    return () => {
      cancelled = true;
      ctrl.abort();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [isBackendConnected, activeConversationId]);

  const saveConfig = useCallback(async (cfg: AIConfig) => {
    setSavingConfig(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateAiConfig(cfg);
      setProvidersState(next);
      setNotice("Native AI provider configuration saved.");
      return next;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save AI configuration.";
      setError(msg);
      return null;
    } finally {
      setSavingConfig(false);
    }
  }, []);

  const resetConfig = useCallback(async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const next = await resetAiConfig();
      setProvidersState(next);
      setNotice("Native AI settings reset to defaults.");
      return next;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset AI settings."
      );
      return null;
    } finally {
      setSavingConfig(false);
    }
  }, []);

  const saveCredential = useCallback(
    async (providerId: AIProviderId, apiKey: string, sessionOnly: boolean) => {
      setSavingConfig(true);
      setError(null);
      setNotice(null);
      try {
        await setAiCredential(providerId, apiKey, sessionOnly);
        const refreshed = await fetchAiProvidersState();
        setProvidersState(refreshed);
        setNotice(
          sessionOnly
            ? `API key stored in memory for this session (${providerId}).`
            : `API key saved securely in ${refreshed.storage.backend_name}.`
        );
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to store API credential."
        );
        return false;
      } finally {
        setSavingConfig(false);
      }
    },
    []
  );

  const removeCredential = useCallback(async (providerId: AIProviderId) => {
    setSavingConfig(true);
    setError(null);
    try {
      await deleteAiCredential(providerId);
      const refreshed = await fetchAiProvidersState();
      setProvidersState(refreshed);
      setNotice(`Removed stored API key for ${providerId}.`);
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove API key."
      );
      return false;
    } finally {
      setSavingConfig(false);
    }
  }, []);

  const runConnectionTest = useCallback(
    async (payload: {
      provider_id: AIProviderId;
      model?: string | null;
      base_url?: string | null;
      api_key_override?: string | null;
    }) => {
      setTestingConnection(true);
      setTestResult(null);
      setError(null);
      try {
        const res = await testAiConnection(payload);
        setTestResult(res);
        return res;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Connection test failed.";
        setError(msg);
        return null;
      } finally {
        setTestingConnection(false);
      }
    },
    []
  );

  const createNewConversation = useCallback(
    async (opts?: { title?: string; allowTools?: boolean }) => {
      setActionPending(true);
      setError(null);
      setNotice(null);
      try {
        const detail = await createAiConversation({
          project_dir: projectDir,
          title: opts?.title,
          allow_tools: opts?.allowTools ?? true,
        });
        setConversations((prev) => [detail.conversation, ...prev]);
        setActiveConversationId(detail.conversation.conversation_id);
        setConversationDetail(detail);
        return detail;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create conversation."
        );
        return null;
      } finally {
        setActionPending(false);
      }
    },
    [projectDir]
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      try {
        const detail = await updateAiConversation(conversationId, { title });
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === conversationId ? detail.conversation : c
          )
        );
        if (activeConversationId === conversationId) {
          setConversationDetail(detail);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to rename conversation."
        );
      }
    },
    [activeConversationId]
  );

  const toggleConversationTools = useCallback(
    async (allowTools: boolean) => {
      if (!activeConversationId) return;
      try {
        const detail = await updateAiConversation(activeConversationId, {
          allow_tools: allowTools,
        });
        setConversationDetail(detail);
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === activeConversationId ? detail.conversation : c
          )
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update tool setting."
        );
      }
    },
    [activeConversationId]
  );

  const clearCurrentConversation = useCallback(async () => {
    if (!activeConversationId) return;
    setActionPending(true);
    setError(null);
    try {
      const detail = await clearAiConversation(activeConversationId);
      setConversationDetail(detail);
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation_id === activeConversationId ? detail.conversation : c
        )
      );
      setNotice("Conversation messages cleared.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear conversation."
      );
    } finally {
      setActionPending(false);
    }
  }, [activeConversationId]);

  const removeConversation = useCallback(
    async (conversationId: string) => {
      setActionPending(true);
      setError(null);
      try {
        await deleteAiConversation(conversationId);
        setConversations((prev) => {
          const remaining = prev.filter(
            (c) => c.conversation_id !== conversationId
          );
          if (activeConversationId === conversationId) {
            setActiveConversationId(remaining[0]?.conversation_id ?? null);
          }
          return remaining;
        });
        if (activeConversationId === conversationId) {
          setConversationDetail(null);
        }
        setNotice("Conversation deleted.");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete conversation."
        );
      } finally {
        setActionPending(false);
      }
    },
    [activeConversationId]
  );

  const sendPrompt = useCallback(
    async (override?: {
      prompt?: string;
      attachments?: AIContextAttachment[];
    }) => {
      const text = (override?.prompt ?? draftPrompt).trim();
      if (!text) return false;
      const attachments = override?.attachments ?? pendingAttachments;

      setActionPending(true);
      setError(null);
      setNotice(null);
      try {
        let targetId = activeConversationId;
        const current =
          conversationDetail?.conversation ??
          conversations.find((c) => c.conversation_id === targetId);
        const crossProject =
          current?.project_dir &&
          projectDir &&
          normalizeFsPath(current.project_dir) !== normalizeFsPath(projectDir);

        if (!targetId || !current || crossProject) {
          const created = await createAiConversation({
            project_dir: projectDir,
            allow_tools: providersState?.config.allow_context_tools ?? true,
          });
          setConversations((prev) => [created.conversation, ...prev]);
          setActiveConversationId(created.conversation.conversation_id);
          setConversationDetail(created);
          targetId = created.conversation.conversation_id;
        }

        const updated = await sendAiMessage(targetId, {
          project_dir: projectDir,
          prompt: text,
          attachments,
        });
        setConversationDetail(updated);
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === updated.conversation.conversation_id
              ? updated.conversation
              : c
          )
        );
        if (!override?.prompt) setDraftPrompt("");
        if (!override?.attachments) setPendingAttachments([]);
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to send AI message."
        );
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [
      activeConversationId,
      conversationDetail,
      conversations,
      draftPrompt,
      pendingAttachments,
      projectDir,
      providersState,
    ]
  );

  const retryLastTurn = useCallback(async () => {
    if (!activeConversationId) return;
    setActionPending(true);
    setError(null);
    try {
      const updated = await retryAiMessage(activeConversationId);
      setConversationDetail(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setActionPending(false);
    }
  }, [activeConversationId]);

  const stopGeneration = useCallback(async () => {
    if (!activeConversationId) return;
    setActionPending(true);
    try {
      const updated = await cancelAiGeneration(activeConversationId);
      setConversationDetail(updated);
      setNotice("AI generation stopped.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop AI.");
    } finally {
      setActionPending(false);
    }
  }, [activeConversationId]);

  const addAttachment = useCallback((att: AIContextAttachment) => {
    setPendingAttachments((prev) => {
      const key = `${att.kind}|${att.title}|${att.relative_path ?? ""}|${att.start_line ?? ""}`;
      if (
        prev.some(
          (p) =>
            `${p.kind}|${p.title}|${p.relative_path ?? ""}|${p.start_line ?? ""}` ===
            key
        )
      ) {
        return prev;
      }
      return [...prev.slice(-7), att];
    });
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  const loadContextPreview = useCallback(async () => {
    try {
      const prev = await previewAiContext({
        project_dir: projectDir,
        attachments: pendingAttachments,
        include_workspace_summary:
          providersState?.config.auto_include_workspace_summary ?? true,
      });
      setContextPreview(prev);
      return prev;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to preview context."
      );
      return null;
    }
  }, [pendingAttachments, projectDir, providersState]);

  const effectiveWsState: NativeAiWsState =
    isBackendConnected && activeConversationId ? wsState : "disconnected";
  const effectiveDetail =
    isBackendConnected && activeConversationId ? conversationDetail : null;

  const activeConversation =
    effectiveDetail?.conversation ??
    conversations.find((c) => c.conversation_id === activeConversationId) ??
    null;
  const activeProviderStatus =
    providersState?.providers.find(
      (p) => p.id === (activeConversation?.provider_id ?? providersState.config.active_provider)
    ) ?? null;
  const isCrossProjectConversation = Boolean(
    projectDir &&
      activeConversation?.project_dir &&
      normalizeFsPath(projectDir) !==
        normalizeFsPath(activeConversation.project_dir)
  );

  return {
    providersState,
    activeProviderStatus,
    conversations,
    activeConversationId,
    conversationDetail: effectiveDetail,
    activeConversation,
    isCrossProjectConversation,
    wsState: effectiveWsState,
    draftPrompt,
    setDraftPrompt,
    pendingAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    contextPreview,
    setContextPreview,
    loadContextPreview,
    testResult,
    setTestResult,
    loading,
    actionPending,
    savingConfig,
    testingConnection,
    error,
    notice,
    clearFeedback,
    refreshState,
    saveConfig,
    resetConfig,
    saveCredential,
    removeCredential,
    runConnectionTest,
    selectConversation: setActiveConversationId,
    createNewConversation,
    renameConversation,
    toggleConversationTools,
    clearCurrentConversation,
    removeConversation,
    sendPrompt,
    retryLastTurn,
    stopGeneration,
  };
}
