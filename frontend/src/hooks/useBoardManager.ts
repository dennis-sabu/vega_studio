"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBoards,
  fetchProjectBoardStatus,
  selectProjectBoard,
  validateBoardCompatibility,
} from "@/lib/api";
import type {
  BoardCompatibilityReport,
  BoardProfile,
  ProjectBoardStatusResponse,
  SelectProjectBoardResponse,
} from "@/types/board";
import type { WorkspaceSummary } from "@/types/project";

interface UseBoardManagerOptions {
  activeProject: WorkspaceSummary | null;
  isBackendConnected: boolean;
  sdkConfigUpdatedAt?: string | null;
  onBoardChanged?: (workspace: WorkspaceSummary) => Promise<void> | void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useBoardManager({
  activeProject,
  isBackendConnected,
  sdkConfigUpdatedAt,
  onBoardChanged,
  onLog,
}: UseBoardManagerOptions) {
  const [boards, setBoards] = useState<BoardProfile[]>([]);
  const [manualInspectedBoardId, setManualInspectedBoardId] = useState<
    string | null
  >(null);
  const [compatibilityByBoard, setCompatibilityByBoard] = useState<
    Record<string, BoardCompatibilityReport>
  >({});
  const [projectBoardStatus, setProjectBoardStatus] =
    useState<ProjectBoardStatusResponse | null>(null);

  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [validatingCompatibility, setValidatingCompatibility] = useState(false);
  const [selectingBoard, setSelectingBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onLogRef = useRef(onLog);
  const onBoardChangedRef = useRef(onBoardChanged);
  useEffect(() => {
    onLogRef.current = onLog;
    onBoardChangedRef.current = onBoardChanged;
  });

  const activeProjectDir = activeProject?.project_dir ?? null;
  const activeProjectBoardId = activeProject?.project.target.board ?? null;

  const refreshBoards = useCallback(async (signal?: AbortSignal) => {
    setLoadingBoards(true);
    try {
      const res = await fetchBoards(signal);
      if (signal?.aborted) return;
      setBoards(res.boards);
      setError(null);
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load VEGA board registry.";
      setError(message);
    } finally {
      if (!signal?.aborted) {
        setLoadingBoards(false);
      }
    }
  }, []);

  const refreshProjectStatus = useCallback(
    async (projectDir: string | null, signal?: AbortSignal) => {
      if (!projectDir) {
        setProjectBoardStatus(null);
        return;
      }
      setLoadingStatus(true);
      try {
        const status = await fetchProjectBoardStatus(projectDir, signal);
        if (signal?.aborted) return;
        setProjectBoardStatus(status);
        if (status.board && status.compatibility) {
          const compat = status.compatibility;
          setCompatibilityByBoard((prev) => ({
            ...prev,
            [status.board!.id]: compat,
          }));
        }
        setError(null);
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : "Failed to inspect project board status.";
        setError(message);
      } finally {
        if (!signal?.aborted) {
          setLoadingStatus(false);
        }
      }
    },
    []
  );

  // Load board registry whenever backend comes online
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void refreshBoards(controller.signal);
      }
    });
    return () => controller.abort();
  }, [isBackendConnected, refreshBoards]);

  // Refresh active project board status when project, selected board, or SDK config changes
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (!activeProjectDir) {
        setProjectBoardStatus(null);
        return;
      }
      void refreshProjectStatus(activeProjectDir, controller.signal);
    });
    return () => controller.abort();
  }, [
    isBackendConnected,
    activeProjectDir,
    activeProjectBoardId,
    sdkConfigUpdatedAt,
    refreshProjectStatus,
  ]);

  // Reset cached compatibility reports whenever SDK config updates
  useEffect(() => {
    if (!sdkConfigUpdatedAt) return;
    queueMicrotask(() => {
      setCompatibilityByBoard({});
    });
  }, [sdkConfigUpdatedAt]);

  // Reset manual inspection override cleanly when switching projects
  useEffect(() => {
    queueMicrotask(() => {
      setManualInspectedBoardId(null);
      setFeedback(null);
      setError(null);
    });
  }, [activeProjectDir]);

  const inspectedBoardId = useMemo(() => {
    if (
      manualInspectedBoardId &&
      boards.some((b) => b.id === manualInspectedBoardId)
    ) {
      return manualInspectedBoardId;
    }
    if (
      activeProjectBoardId &&
      boards.some((b) => b.id === activeProjectBoardId)
    ) {
      return activeProjectBoardId;
    }
    return boards[0]?.id ?? null;
  }, [manualInspectedBoardId, activeProjectBoardId, boards]);

  const inspectedBoard = useMemo(
    () => boards.find((b) => b.id === inspectedBoardId) ?? null,
    [boards, inspectedBoardId]
  );

  const inspectedCompatibility = useMemo(() => {
    if (!inspectedBoardId) return null;
    if (compatibilityByBoard[inspectedBoardId]) {
      return compatibilityByBoard[inspectedBoardId];
    }
    if (
      projectBoardStatus?.compatibility &&
      projectBoardStatus.board?.id === inspectedBoardId
    ) {
      return projectBoardStatus.compatibility;
    }
    return null;
  }, [inspectedBoardId, compatibilityByBoard, projectBoardStatus]);

  const checkCompatibilityForBoard = useCallback(
    async (boardId: string): Promise<BoardCompatibilityReport | null> => {
      setValidatingCompatibility(true);
      try {
        const report = await validateBoardCompatibility(boardId);
        setCompatibilityByBoard((prev) => ({
          ...prev,
          [boardId]: report,
        }));
        setError(null);
        return report;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to validate board SDK compatibility.";
        setError(message);
        return null;
      } finally {
        setValidatingCompatibility(false);
      }
    },
    []
  );

  // Auto-validate compatibility for the currently inspected board when missing
  useEffect(() => {
    if (!isBackendConnected || !inspectedBoardId) return;
    if (inspectedCompatibility) return;
    const targetId = inspectedBoardId;
    const timer = setTimeout(() => {
      void checkCompatibilityForBoard(targetId);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    isBackendConnected,
    inspectedBoardId,
    inspectedCompatibility,
    checkCompatibilityForBoard,
  ]);

  const inspectBoard = useCallback((boardId: string) => {
    setManualInspectedBoardId(boardId);
    setFeedback(null);
    setError(null);
  }, []);

  const refreshAll = useCallback(async () => {
    setFeedback(null);
    setError(null);
    await refreshBoards();
    if (activeProjectDir) {
      await refreshProjectStatus(activeProjectDir);
    }
    if (inspectedBoardId) {
      await checkCompatibilityForBoard(inspectedBoardId);
    }
  }, [
    refreshBoards,
    activeProjectDir,
    refreshProjectStatus,
    inspectedBoardId,
    checkCompatibilityForBoard,
  ]);

  const applyBoardToProject = useCallback(
    async (boardId: string): Promise<SelectProjectBoardResponse | null> => {
      if (!activeProjectDir) {
        setError(
          "Open or create a VEGA project before assigning a target board."
        );
        return null;
      }
      setSelectingBoard(true);
      setError(null);
      setFeedback(null);
      try {
        const result = await selectProjectBoard(activeProjectDir, boardId);
        setProjectBoardStatus(result.board_status);
        setManualInspectedBoardId(boardId);
        if (result.board_status.compatibility) {
          const compat = result.board_status.compatibility;
          setCompatibilityByBoard((prev) => ({
            ...prev,
            [boardId]: compat,
          }));
        }
        setFeedback(result.message);
        onLogRef.current?.("info", result.message);
        await onBoardChangedRef.current?.(result.workspace);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to persist selected target board.";
        setError(message);
        onLogRef.current?.("error", message);
        return null;
      } finally {
        setSelectingBoard(false);
      }
    },
    [activeProjectDir]
  );

  const clearMessages = useCallback(() => {
    setError(null);
    setFeedback(null);
  }, []);

  return {
    boards,
    inspectedBoardId,
    inspectedBoard,
    inspectedCompatibility,
    projectBoardStatus,
    activeProjectBoardId,
    loadingBoards,
    loadingStatus,
    validatingCompatibility,
    selectingBoard,
    error,
    feedback,
    inspectBoard,
    refreshAll,
    checkCompatibilityForBoard,
    applyBoardToProject,
    clearMessages,
  };
}
