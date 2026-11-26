"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelFirmwareBuild,
  cleanFirmwareBuild,
  clearBuildHistory,
  clearBuildOutput,
  fetchBuildHistory,
  fetchBuildState,
  getBuildWsUrl,
  startFirmwareBuild,
} from "@/lib/api";
import type {
  BuildDiagnostic,
  BuildLogLine,
  BuildMode,
  BuildOperation,
  BuildSummary,
  BuildWsEvent,
} from "@/types/build";

const MAX_CLIENT_LOG_LINES = 5000;
const MAX_CLIENT_DIAGNOSTICS = 1000;

function normalizeFsPath(p: string | null | undefined): string {
  return (p ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

interface UseBuildSystemOptions {
  projectDir: string | null;
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useBuildSystem({
  projectDir,
  isBackendConnected,
  onLog,
}: UseBuildSystemOptions) {
  const [activeBuild, setActiveBuild] = useState<BuildSummary | null>(null);
  const [latestBuild, setLatestBuild] = useState<BuildSummary | null>(null);
  const [logs, setLogs] = useState<BuildLogLine[]>([]);
  const [diagnostics, setDiagnostics] = useState<BuildDiagnostic[]>([]);
  const [history, setHistory] = useState<BuildSummary[]>([]);

  const [buildMode, setBuildMode] = useState<BuildMode>("default");
  const [customTarget, setCustomTarget] = useState<string>("");
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const onLogRef = useRef(onLog);
  const projectDirRef = useRef(projectDir);
  useEffect(() => {
    onLogRef.current = onLog;
    projectDirRef.current = projectDir;
  });

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      try {
        ws.close();
      } catch {
        // Ignore close errors cleanly.
      }
    }
  }, []);

  const refreshHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchBuildHistory(signal);
      if (!signal?.aborted) {
        setHistory(res.history);
      }
    } catch {
      // Ignore transient poll errors cleanly.
    }
  }, []);

  const attachWebSocket = useCallback(
    (buildId: string) => {
      closeSocket();
      if (typeof WebSocket === "undefined") return;

      const ws = new WebSocket(getBuildWsUrl(buildId));
      wsRef.current = ws;

      ws.onmessage = (event: MessageEvent<string>) => {
        if (wsRef.current !== ws) return;
        let msg: BuildWsEvent;
        try {
          msg = JSON.parse(event.data) as BuildWsEvent;
        } catch {
          return;
        }

        if (msg.type === "snapshot") {
          setLatestBuild(msg.build);
          if (msg.build.status === "running") {
            setActiveBuild(msg.build);
          } else {
            setActiveBuild(null);
          }
          setLogs(msg.logs.slice(-MAX_CLIENT_LOG_LINES));
          setDiagnostics(msg.diagnostics);
        } else if (msg.type === "log") {
          setLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].seq >= msg.line.seq) {
              return prev;
            }
            const next = [...prev, msg.line];
            return next.length > MAX_CLIENT_LOG_LINES
              ? next.slice(-MAX_CLIENT_LOG_LINES)
              : next;
          });
        } else if (msg.type === "diagnostic") {
          setDiagnostics((prev) => {
            if (prev.length >= MAX_CLIENT_DIAGNOSTICS) return prev;
            if (prev.some((d) => d.id === msg.diagnostic.id)) return prev;
            return [...prev, msg.diagnostic];
          });
        } else if (msg.type === "completed") {
          setLatestBuild(msg.build);
          setActiveBuild(null);
          onLogRef.current?.(
            msg.build.status === "succeeded"
              ? "info"
              : msg.build.status === "cancelled"
              ? "warn"
              : "error",
            `Build ${msg.build.operation} ${msg.build.status} (exit ${msg.build.exit_code ?? "—"}, ${msg.build.error_count} error(s), ${msg.build.warning_count} warning(s))`
          );
          void refreshHistory();
          closeSocket();
        }
      };

      const reconcile = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        void fetchBuildState()
          .then((state) => {
            const curDir = normalizeFsPath(projectDirRef.current);
            const activeMatches =
              !state.active_build ||
              !curDir ||
              normalizeFsPath(state.active_build.project_dir) === curDir;
            const latestMatches =
              !state.latest_build ||
              !curDir ||
              normalizeFsPath(state.latest_build.project_dir) === curDir;
            setActiveBuild(activeMatches ? state.active_build : null);
            if (latestMatches) {
              setLatestBuild(state.latest_build);
              setLogs(state.logs.slice(-MAX_CLIENT_LOG_LINES));
              setDiagnostics(state.diagnostics.slice(0, MAX_CLIENT_DIAGNOSTICS));
            }
          })
          .catch(() => {
            setActiveBuild((prev) => (prev?.status === "running" ? null : prev));
          });
      };

      ws.onerror = reconcile;
      ws.onclose = reconcile;
    },
    [closeSocket, refreshHistory]
  );

  // Sync or reset build state cleanly when backend connection or active project changes
  useEffect(() => {
    closeSocket();
    if (!isBackendConnected) {
      queueMicrotask(() => {
        setActiveBuild(null);
      });
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setActiveBuild(null);
      setLatestBuild(null);
      setLogs([]);
      setDiagnostics([]);
      setError(null);
      setCustomTarget("");

      void Promise.all([
        fetchBuildState(controller.signal),
        fetchBuildHistory(controller.signal),
      ])
        .then(([state, hist]) => {
          if (controller.signal.aborted) return;
          setHistory(hist.history);
          if (!projectDir) {
            return;
          }
          const curDir = normalizeFsPath(projectDir);
          const activeMatches =
            state.active_build &&
            normalizeFsPath(state.active_build.project_dir) === curDir;
          const latestMatches =
            state.latest_build &&
            normalizeFsPath(state.latest_build.project_dir) === curDir;
          setActiveBuild(activeMatches ? state.active_build : null);
          if (latestMatches) {
            setLatestBuild(state.latest_build);
            setLogs(state.logs.slice(-MAX_CLIENT_LOG_LINES));
            setDiagnostics(state.diagnostics.slice(0, MAX_CLIENT_DIAGNOSTICS));
          }
          if (activeMatches && state.active_build?.status === "running") {
            attachWebSocket(state.active_build.build_id);
          }
        })
        .catch(() => {});
    });

    return () => {
      controller.abort();
    };
  }, [attachWebSocket, closeSocket, isBackendConnected, projectDir]);

  useEffect(() => {
    return () => {
      closeSocket();
    };
  }, [closeSocket]);

  const runOperation = useCallback(
    async (
      operation: BuildOperation,
      opts?: { targetOverride?: string | null }
    ): Promise<BuildSummary | null> => {
      const currentDir = projectDirRef.current;
      if (!currentDir) {
        setError("Open a VEGA firmware project before running a build.");
        return null;
      }
      if (!isBackendConnected) {
        setError("FastAPI backend is disconnected.");
        return null;
      }

      setPendingAction(true);
      setError(null);
      try {
        const cleanTarget =
          opts?.targetOverride !== undefined
            ? opts.targetOverride
            : customTarget.trim() || null;

        const payload = {
          project_dir: currentDir,
          operation,
          target: operation === "clean" ? null : cleanTarget,
          mode: buildMode,
        };

        const summary =
          operation === "clean"
            ? await cleanFirmwareBuild(payload)
            : await startFirmwareBuild(payload);

        setActiveBuild(summary);
        setLatestBuild(summary);
        setLogs([]);
        setDiagnostics([]);
        attachWebSocket(summary.build_id);
        onLogRef.current?.(
          "info",
          `Started ${operation} (${summary.project_name})`
        );
        void refreshHistory();
        return summary;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : `Failed to start ${operation}.`;
        setError(message);
        onLogRef.current?.("error", `Build start blocked: ${message}`);
        return null;
      } finally {
        setPendingAction(false);
      }
    },
    [attachWebSocket, buildMode, customTarget, isBackendConnected, refreshHistory]
  );

  const cancelActive = useCallback(async () => {
    const targetId = activeBuild?.build_id;
    setError(null);
    try {
      const summary = await cancelFirmwareBuild(targetId);
      setLatestBuild(summary);
      if (summary.status !== "running") {
        setActiveBuild(null);
      }
      void refreshHistory();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel active build."
      );
    }
  }, [activeBuild?.build_id, refreshHistory]);

  const clearOutput = useCallback(async () => {
    if (!isBackendConnected) {
      setLogs([]);
      setDiagnostics([]);
      return;
    }
    try {
      const state = await clearBuildOutput();
      setLatestBuild(state.latest_build);
      setLogs(state.logs);
      setDiagnostics(state.diagnostics);
    } catch {
      setLogs([]);
      setDiagnostics([]);
    }
  }, [isBackendConnected]);

  const clearHistory = useCallback(async () => {
    if (!isBackendConnected) {
      setHistory([]);
      return;
    }
    try {
      const res = await clearBuildHistory();
      setHistory(res.history);
    } catch {
      // Ignore cleanly.
    }
  }, [isBackendConnected]);

  const clearError = useCallback(() => setError(null), []);

  return {
    activeBuild,
    latestBuild,
    logs,
    diagnostics,
    history,
    buildMode,
    customTarget,
    pendingAction,
    error,
    isBuilding: activeBuild?.status === "running",
    setBuildMode,
    setCustomTarget,
    runOperation,
    cancelActive,
    clearOutput,
    clearHistory,
    clearError,
  };
}
