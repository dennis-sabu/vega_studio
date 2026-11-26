"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearTerminalReplay,
  closeTerminalSession,
  createTerminalSession,
  fetchTerminalSessions,
  fetchTerminalShells,
  restartTerminalSession,
} from "@/lib/api";
import type {
  TerminalPtyBackend,
  TerminalSessionSummary,
  TerminalShellInfo,
} from "@/types/terminal";

interface UseTerminalManagerOptions {
  activeProjectDir: string | null;
  defaultProjectsDir: string | null;
  isBackendConnected: boolean;
  hasElectronBrowse: boolean;
  onBrowseDirectory?: (
    title: string,
    defaultPath?: string
  ) => Promise<string | null>;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useTerminalManager({
  activeProjectDir,
  defaultProjectsDir,
  isBackendConnected,
  hasElectronBrowse,
  onBrowseDirectory,
  onLog,
}: UseTerminalManagerOptions) {
  const [shells, setShells] = useState<TerminalShellInfo[]>([]);
  const [selectedShellId, setSelectedShellId] = useState<string>("");
  const [defaultShellId, setDefaultShellId] = useState<string | null>(null);
  const [ptySupported, setPtySupported] = useState<boolean>(true);
  const [ptyBackend, setPtyBackend] =
    useState<TerminalPtyBackend>("unavailable");
  const [ptyMessage, setPtyMessage] = useState<string | null>(null);

  const [maxSessions, setMaxSessions] = useState<number>(6);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialLoaded, setInitialLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const onLogRef = useRef(onLog);
  const activeProjectDirRef = useRef(activeProjectDir);
  const selectedShellIdRef = useRef(selectedShellId);
  const activeSessionIdRef = useRef(activeSessionId);

  useEffect(() => {
    onLogRef.current = onLog;
    activeProjectDirRef.current = activeProjectDir;
    selectedShellIdRef.current = selectedShellId;
    activeSessionIdRef.current = activeSessionId;
  });

  const refreshState = useCallback(
    async (signal?: AbortSignal) => {
      if (!isBackendConnected) return;
      setLoading(true);
      try {
        const [shellsRes, listRes] = await Promise.all([
          fetchTerminalShells(signal),
          fetchTerminalSessions(signal),
        ]);
        if (signal?.aborted) return;

        setShells(shellsRes.shells);
        setDefaultShellId(shellsRes.default_shell_id);
        setPtySupported(shellsRes.pty_supported);
        setPtyBackend(shellsRes.pty_backend);
        setPtyMessage(shellsRes.pty_message);

        if (
          !selectedShellIdRef.current &&
          shellsRes.default_shell_id
        ) {
          setSelectedShellId(shellsRes.default_shell_id);
        }

        setMaxSessions(listRes.max_sessions);
        setSessions(listRes.sessions);

        const currActive = activeSessionIdRef.current;
        if (listRes.sessions.length === 0) {
          setActiveSessionId(null);
        } else if (
          !currActive ||
          !listRes.sessions.some((s) => s.session_id === currActive)
        ) {
          setActiveSessionId(listRes.sessions[0].session_id);
        }
        setInitialLoaded(true);
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
      } finally {
        setLoading(false);
      }
    },
    [isBackendConnected]
  );

  // Discover shells and reconnect any existing live backend sessions on backend startup
  useEffect(() => {
    if (!isBackendConnected) {
      queueMicrotask(() => {
        setLoading(false);
        setInitialLoaded(false);
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void refreshState(controller.signal);
      }
    });
    return () => controller.abort();
  }, [isBackendConnected, refreshState]);

  const createSession = useCallback(
    async (options?: {
      shellId?: string | null;
      cwd?: string | null;
      cols?: number;
      rows?: number;
    }): Promise<TerminalSessionSummary | null> => {
      if (!isBackendConnected) {
        setError("FastAPI backend is disconnected.");
        return null;
      }

      setPendingAction(true);
      setError(null);
      try {
        const res = await createTerminalSession({
          shell_id:
            options?.shellId !== undefined
              ? options.shellId
              : selectedShellIdRef.current || null,
          cwd: options?.cwd ?? null,
          project_dir: activeProjectDirRef.current,
          cols: options?.cols ?? 100,
          rows: options?.rows ?? 28,
        });

        setSessions((prev) => [...prev, res.session]);
        setActiveSessionId(res.session.session_id);
        onLogRef.current?.(
          "info",
          `Started terminal session (${res.session.shell_label}) in ${res.session.cwd}`
        );
        return res.session;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to create terminal session.";
        setError(message);
        onLogRef.current?.("error", `Terminal launch failed: ${message}`);
        return null;
      } finally {
        setPendingAction(false);
      }
    },
    [isBackendConnected]
  );

  const createSessionWithFolderPicker = useCallback(async () => {
    if (!hasElectronBrowse || !onBrowseDirectory) return;
    const initialPath =
      activeProjectDirRef.current ?? defaultProjectsDir ?? undefined;
    const picked = await onBrowseDirectory(
      "Select Terminal Working Directory",
      initialPath
    );
    if (picked) {
      await createSession({ cwd: picked });
    }
  }, [createSession, defaultProjectsDir, hasElectronBrowse, onBrowseDirectory]);

  const closeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!isBackendConnected) return;
      setPendingAction(true);
      setError(null);
      try {
        await closeTerminalSession(sessionId);
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.session_id !== sessionId);
          if (activeSessionIdRef.current === sessionId) {
            setActiveSessionId(
              remaining.length > 0
                ? remaining[remaining.length - 1].session_id
                : null
            );
          }
          return remaining;
        });
        onLogRef.current?.("info", "Closed terminal session.");
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to terminate terminal session.";
        setError(message);
      } finally {
        setPendingAction(false);
      }
    },
    [isBackendConnected]
  );

  const restartSession = useCallback(
    async (sessionId: string): Promise<TerminalSessionSummary | null> => {
      if (!isBackendConnected) return null;
      setPendingAction(true);
      setError(null);
      try {
        const res = await restartTerminalSession(sessionId);
        setSessions((prev) =>
          prev.map((item) =>
            item.session_id === sessionId ? res.session : item
          )
        );
        onLogRef.current?.(
          "info",
          `Restarted terminal session in ${res.session.cwd}`
        );
        return res.session;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to restart terminal session.";
        setError(message);
        return null;
      } finally {
        setPendingAction(false);
      }
    },
    [isBackendConnected]
  );

  const clearReplayBuffer = useCallback(
    async (sessionId: string) => {
      if (!isBackendConnected) return;
      try {
        const updated = await clearTerminalReplay(sessionId);
        setSessions((prev) =>
          prev.map((item) =>
            item.session_id === sessionId ? updated : item
          )
        );
      } catch {
        // Ignore transient clear failures cleanly.
      }
    },
    [isBackendConnected]
  );

  const syncSessionSummary = useCallback((updated: TerminalSessionSummary) => {
    setSessions((prev) =>
      prev.map((item) =>
        item.session_id === updated.session_id ? updated : item
      )
    );
  }, []);

  const updateSessionCwd = useCallback((sessionId: string, cwd: string) => {
    setSessions((prev) =>
      prev.map((item) =>
        item.session_id === sessionId && item.cwd !== cwd
          ? { ...item, cwd }
          : item
      )
    );
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const activeSession =
    sessions.find((s) => s.session_id === activeSessionId) ?? null;

  const runningCount = sessions.filter((s) => s.status === "running").length;

  return {
    shells,
    selectedShellId,
    defaultShellId,
    ptySupported,
    ptyBackend,
    ptyMessage,
    maxSessions,
    sessions,
    activeSessionId,
    activeSession,
    runningCount,
    hasElectronBrowse,
    pendingAction,
    loading,
    initialLoaded,
    error,
    setSelectedShellId,
    setActiveSessionId,
    refreshState,
    createSession,
    createSessionWithFolderPicker,
    closeSession,
    restartSession,
    clearReplayBuffer,
    syncSessionSummary,
    updateSessionCwd,
    clearError,
  };
}
