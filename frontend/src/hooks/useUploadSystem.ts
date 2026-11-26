"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelFirmwareUpload,
  clearUploadHistory,
  clearUploadOutput,
  fetchUploadDevices,
  fetchUploadHistory,
  fetchUploadState,
  getUploadWsUrl,
  runUploadPreflight,
  startFirmwareUpload,
} from "@/lib/api";
import type {
  DeviceListResponse,
  UploadInvocationMode,
  UploadLogLine,
  UploadPreflightResponse,
  UploadSummary,
  UploadWsEvent,
} from "@/types/upload";

const MAX_CLIENT_UPLOAD_LOGS = 5000;

interface UseUploadSystemOptions {
  projectDir: string | null;
  boardId: string | null;
  sdkConfigUpdatedAt?: string | null;
  latestBuildFinishedAt?: string | null;
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useUploadSystem({
  projectDir,
  boardId,
  sdkConfigUpdatedAt,
  latestBuildFinishedAt,
  isBackendConnected,
  onLog,
}: UseUploadSystemOptions) {
  const [deviceInfo, setDeviceInfo] = useState<DeviceListResponse | null>(null);
  const [preflight, setPreflight] = useState<UploadPreflightResponse | null>(
    null
  );
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>("");
  const [invocationMode, setInvocationMode] =
    useState<UploadInvocationMode>("auto");

  const [activeUpload, setActiveUpload] = useState<UploadSummary | null>(null);
  const [latestUpload, setLatestUpload] = useState<UploadSummary | null>(null);
  const [logs, setLogs] = useState<UploadLogLine[]>([]);
  const [history, setHistory] = useState<UploadSummary[]>([]);

  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const preflightSeqRef = useRef(0);
  const deviceRefreshSeqRef = useRef(0);
  const preflightDebounceTimerRef = useRef<number | null>(null);
  const preflightActionAbortRef = useRef<AbortController | null>(null);
  const onLogRef = useRef(onLog);
  const projectDirRef = useRef(projectDir);
  const selectedPortRef = useRef(selectedPort);
  const selectedArtifactRef = useRef(selectedArtifactPath);
  const invocationModeRef = useRef(invocationMode);

  useEffect(() => {
    onLogRef.current = onLog;
    projectDirRef.current = projectDir;
    selectedPortRef.current = selectedPort;
    selectedArtifactRef.current = selectedArtifactPath;
    invocationModeRef.current = invocationMode;
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
      const res = await fetchUploadHistory(signal);
      if (!signal?.aborted) {
        setHistory(res.history);
      }
    } catch {
      // Ignore transient poll errors.
    }
  }, []);

  const attachWebSocket = useCallback(
    (uploadId: string) => {
      closeSocket();
      if (typeof WebSocket === "undefined") return;

      const ws = new WebSocket(getUploadWsUrl(uploadId));
      wsRef.current = ws;
      let completed = false;

      ws.onmessage = (event: MessageEvent<string>) => {
        if (wsRef.current !== ws) return;
        let msg: UploadWsEvent;
        try {
          msg = JSON.parse(event.data) as UploadWsEvent;
        } catch {
          return;
        }

        if (msg.type === "snapshot") {
          setLatestUpload(msg.upload);
          setActiveUpload(
            msg.upload.status === "running" ? msg.upload : null
          );
          setLogs(msg.logs.slice(-MAX_CLIENT_UPLOAD_LOGS));
        } else if (msg.type === "log") {
          setLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].seq >= msg.line.seq) {
              return prev;
            }
            const next = [...prev, msg.line];
            return next.length > MAX_CLIENT_UPLOAD_LOGS
              ? next.slice(-MAX_CLIENT_UPLOAD_LOGS)
              : next;
          });
        } else if (msg.type === "progress") {
          setLatestUpload(msg.upload);
          if (msg.upload.status === "running") {
            setActiveUpload(msg.upload);
          }
        } else if (msg.type === "completed") {
          completed = true;
          setLatestUpload(msg.upload);
          setActiveUpload(null);
          onLogRef.current?.(
            msg.upload.status === "succeeded"
              ? "info"
              : msg.upload.status === "cancelled"
              ? "warn"
              : "error",
            `Firmware upload ${msg.upload.status} (${msg.upload.artifact_path} -> ${msg.upload.port}, exit ${msg.upload.exit_code ?? "—"})`
          );
          void refreshHistory();
          closeSocket();
        }
      };

      const reconcileState = () => {
        void fetchUploadState()
          .then((state) => {
            setActiveUpload(state.active_upload);
            setLatestUpload(state.latest_upload);
            setLogs(state.logs.slice(-MAX_CLIENT_UPLOAD_LOGS));
          })
          .catch(() => {});
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        reconcileState();
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (!completed) {
          reconcileState();
        }
      };
    },
    [closeSocket, refreshHistory]
  );

  const runPreflightCheck = useCallback(
    async (
      overrides?: {
        port?: string;
        artifactPath?: string;
        mode?: UploadInvocationMode;
        signal?: AbortSignal;
      }
    ): Promise<UploadPreflightResponse | null> => {
      const currentDir = projectDirRef.current;
      if (!currentDir || !isBackendConnected) {
        if (!currentDir) setPreflight(null);
        return null;
      }

      const targetPort =
        overrides?.port !== undefined ? overrides.port : selectedPortRef.current;
      const targetArtifact =
        overrides?.artifactPath !== undefined
          ? overrides.artifactPath
          : selectedArtifactRef.current;
      const targetMode =
        overrides?.mode !== undefined
          ? overrides.mode
          : invocationModeRef.current;

      const reqSeq = ++preflightSeqRef.current;
      const controller = overrides?.signal
        ? null
        : new AbortController();
      if (controller) {
        preflightActionAbortRef.current?.abort();
        preflightActionAbortRef.current = controller;
      }
      const effectiveSignal = overrides?.signal ?? controller?.signal;

      setRunningPreflight(true);
      try {
        const res = await runUploadPreflight(
          {
            project_dir: currentDir,
            port: targetPort.trim() || null,
            artifact_path: targetArtifact.trim() || null,
            invocation_mode: targetMode,
          },
          effectiveSignal
        );
        if (effectiveSignal?.aborted || reqSeq !== preflightSeqRef.current) {
          return null;
        }
        setPreflight(res);
        setDeviceInfo((prev) =>
          prev
            ? { ...prev, devices: res.devices }
            : {
                platform_os: "unknown",
                discovery_method: "preflight",
                discovery_supported: true,
                devices: res.devices,
                warnings: [],
                notes: [],
              }
        );

        // Sync selected port cleanly only when unassigned or auto-selected single device
        if (!targetPort.trim() && res.selected_port) {
          setSelectedPort(res.selected_port);
        }
        // Sync selected artifact cleanly if single artifact discovered or previous disappeared
        if (
          targetArtifact.trim() &&
          !res.artifacts.some((a) => a.relative_path === targetArtifact.trim())
        ) {
          setSelectedArtifactPath(res.selected_artifact?.relative_path ?? "");
        } else if (!targetArtifact.trim() && res.selected_artifact) {
          setSelectedArtifactPath(res.selected_artifact.relative_path);
        }

        return res;
      } catch (err: unknown) {
        if (
          effectiveSignal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return null;
        }
        return null;
      } finally {
        if (reqSeq === preflightSeqRef.current) {
          setRunningPreflight(false);
        }
      }
    },
    [isBackendConnected]
  );

  const refreshDevicesAndPreflight = useCallback(
    async (signal?: AbortSignal) => {
      if (!isBackendConnected) return;
      const reqSeq = ++deviceRefreshSeqRef.current;
      setRefreshingDevices(true);
      try {
        const dev = await fetchUploadDevices(signal);
        if (signal?.aborted || reqSeq !== deviceRefreshSeqRef.current) return;
        setDeviceInfo(dev);
        await runPreflightCheck({ signal });
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
      } finally {
        if (reqSeq === deviceRefreshSeqRef.current) {
          setRefreshingDevices(false);
        }
      }
    },
    [isBackendConnected, runPreflightCheck]
  );

  // Sync active/latest upload & history when backend connects
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void Promise.all([
        fetchUploadState(controller.signal),
        fetchUploadHistory(controller.signal),
        fetchUploadDevices(controller.signal),
      ])
        .then(([state, hist, dev]) => {
          if (controller.signal.aborted) return;
          setActiveUpload(state.active_upload);
          setLatestUpload(state.latest_upload);
          setLogs(state.logs.slice(-MAX_CLIENT_UPLOAD_LOGS));
          setHistory(hist.history);
          setDeviceInfo(dev);
          if (state.active_upload?.status === "running") {
            attachWebSocket(state.active_upload.upload_id);
          }
        })
        .catch(() => {});
    });

    return () => controller.abort();
  }, [attachWebSocket, isBackendConnected]);

  // Refresh preflight & devices whenever workspace project, board, SDK, or build changes
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (!projectDir) {
        setPreflight(null);
        setSelectedArtifactPath("");
        setError(null);
        setRunningPreflight(false);
        setRefreshingDevices(false);
        return;
      }
      void refreshDevicesAndPreflight(controller.signal);
    });
    return () => controller.abort();
  }, [
    isBackendConnected,
    projectDir,
    boardId,
    sdkConfigUpdatedAt,
    latestBuildFinishedAt,
    refreshDevicesAndPreflight,
  ]);

  useEffect(() => {
    return () => {
      if (preflightDebounceTimerRef.current !== null) {
        window.clearTimeout(preflightDebounceTimerRef.current);
      }
      preflightActionAbortRef.current?.abort();
      closeSocket();
    };
  }, [closeSocket]);

  const schedulePreflightCheck = useCallback(
    (overrides: {
      port?: string;
      artifactPath?: string;
      mode?: UploadInvocationMode;
    }) => {
      if (preflightDebounceTimerRef.current !== null) {
        window.clearTimeout(preflightDebounceTimerRef.current);
      }
      preflightDebounceTimerRef.current = window.setTimeout(() => {
        preflightDebounceTimerRef.current = null;
        void runPreflightCheck(overrides);
      }, 180);
    },
    [runPreflightCheck]
  );

  const updatePort = useCallback(
    (nextPort: string) => {
      setSelectedPort(nextPort);
      setError(null);
      schedulePreflightCheck({ port: nextPort });
    },
    [schedulePreflightCheck]
  );

  const updateArtifactPath = useCallback(
    (nextPath: string) => {
      setSelectedArtifactPath(nextPath);
      setError(null);
      schedulePreflightCheck({ artifactPath: nextPath });
    },
    [schedulePreflightCheck]
  );

  const updateInvocationMode = useCallback(
    (nextMode: UploadInvocationMode) => {
      setInvocationMode(nextMode);
      setError(null);
      if (preflightDebounceTimerRef.current !== null) {
        window.clearTimeout(preflightDebounceTimerRef.current);
        preflightDebounceTimerRef.current = null;
      }
      void runPreflightCheck({ mode: nextMode });
    },
    [runPreflightCheck]
  );

  const startUpload = useCallback(
    async (options?: {
      allowStaleArtifact?: boolean;
      strictPortCheck?: boolean;
    }): Promise<UploadSummary | null> => {
      const currentDir = projectDirRef.current;
      if (!currentDir) {
        setError("Open a VEGA firmware project before uploading firmware.");
        return null;
      }
      if (!isBackendConnected) {
        setError("FastAPI backend is disconnected.");
        return null;
      }

      setPendingAction(true);
      setError(null);
      try {
        const summary = await startFirmwareUpload({
          project_dir: currentDir,
          port: selectedPortRef.current.trim() || null,
          artifact_path: selectedArtifactRef.current.trim() || null,
          invocation_mode: invocationModeRef.current,
          allow_stale_artifact: options?.allowStaleArtifact ?? true,
          strict_port_check: options?.strictPortCheck ?? false,
        });

        setActiveUpload(summary);
        setLatestUpload(summary);
        setLogs([]);
        attachWebSocket(summary.upload_id);
        onLogRef.current?.(
          "info",
          `Started firmware upload (${summary.artifact_path} -> ${summary.port})`
        );
        void refreshHistory();
        return summary;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to initiate firmware upload.";
        setError(message);
        onLogRef.current?.("error", `Upload blocked: ${message}`);
        void runPreflightCheck();
        return null;
      } finally {
        setPendingAction(false);
      }
    },
    [attachWebSocket, isBackendConnected, refreshHistory, runPreflightCheck]
  );

  const cancelActive = useCallback(async () => {
    const targetId = activeUpload?.upload_id;
    setError(null);
    try {
      const summary = await cancelFirmwareUpload(targetId);
      setLatestUpload(summary);
      if (summary.status !== "running") {
        setActiveUpload(null);
      }
      void refreshHistory();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to cancel active firmware upload."
      );
    }
  }, [activeUpload?.upload_id, refreshHistory]);

  const clearOutput = useCallback(async () => {
    if (!isBackendConnected) {
      setLogs([]);
      return;
    }
    try {
      const state = await clearUploadOutput();
      setLatestUpload(state.latest_upload);
      setLogs(state.logs);
    } catch {
      setLogs([]);
    }
  }, [isBackendConnected]);

  const clearHistory = useCallback(async () => {
    if (!isBackendConnected) {
      setHistory([]);
      return;
    }
    try {
      const res = await clearUploadHistory();
      setHistory(res.history);
    } catch {
      // Ignore cleanly.
    }
  }, [isBackendConnected]);

  const clearError = useCallback(() => setError(null), []);

  return {
    deviceInfo,
    devices: preflight?.devices ?? deviceInfo?.devices ?? [],
    preflight,
    selectedPort,
    selectedArtifactPath,
    invocationMode,
    activeUpload,
    latestUpload,
    logs,
    history,
    refreshingDevices,
    runningPreflight,
    pendingAction,
    error,
    isUploading: activeUpload?.status === "running",
    updatePort,
    updateArtifactPath,
    updateInvocationMode,
    refreshDevicesAndPreflight,
    runPreflightCheck,
    startUpload,
    cancelActive,
    clearOutput,
    clearHistory,
    clearError,
  };
}
