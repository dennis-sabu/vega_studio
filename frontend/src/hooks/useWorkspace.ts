"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeWorkspace,
  createProject,
  fetchWorkspaceState,
  openProject,
  removeRecentProject,
} from "@/lib/api";
import type {
  CreateProjectPayload,
  RecentProjectEntry,
  WorkspaceSummary,
} from "@/types/project";

export interface DirectoryPickerOutcome {
  supported: boolean;
  canceled: boolean;
  path: string | null;
}

interface UseWorkspaceOptions {
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useWorkspace({
  isBackendConnected,
  onLog,
}: UseWorkspaceOptions) {
  const [activeProject, setActiveProject] = useState<WorkspaceSummary | null>(
    null
  );
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(
    []
  );
  const [defaultProjectsDir, setDefaultProjectsDir] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isElectronBridge, setIsElectronBridge] = useState(false);

  const onLogRef = useRef(onLog);
  useEffect(() => {
    onLogRef.current = onLog;
  });

  // Detect Electron bridge capabilities & default projects directory safely.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const bridge = typeof window !== "undefined" ? window.vegaStudio : undefined;
      setIsElectronBridge(Boolean(bridge?.selectDirectory));
      if (bridge?.getDefaultProjectsDir) {
        bridge
          .getDefaultProjectsDir()
          .then((dir) => {
            if (active && dir) {
              setDefaultProjectsDir((prev) => prev || dir);
            }
          })
          .catch(() => {
            // Fall back to backend default_projects_dir when available.
          });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const state = await fetchWorkspaceState();
      setActiveProject(state.active_project);
      setRecentProjects(state.recent_projects);
      if (state.default_projects_dir) {
        setDefaultProjectsDir((prev) => prev || state.default_projects_dir);
      }
      setWarning(state.warning);
      if (state.warning) {
        onLogRef.current?.("warn", state.warning);
      } else if (state.active_project) {
        onLogRef.current?.(
          "info",
          `Restored workspace: ${state.active_project.project.name} (${state.active_project.project_dir})`
        );
      }
      setError(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load workspace state.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Automatically hydrate workspace state whenever the backend connects.
  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    fetchWorkspaceState(controller.signal)
      .then((state) => {
        setActiveProject(state.active_project);
        setRecentProjects(state.recent_projects);
        if (state.default_projects_dir) {
          setDefaultProjectsDir((prev) => prev || state.default_projects_dir);
        }
        setWarning(state.warning);
        if (state.warning) {
          onLogRef.current?.("warn", state.warning);
        } else if (state.active_project) {
          onLogRef.current?.(
            "info",
            `Workspace active: ${state.active_project.project.name}`
          );
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to load workspace state."
        );
      });
    return () => controller.abort();
  }, [isBackendConnected]);

  const browseDirectory = useCallback(
    async (
      title: string,
      defaultPath?: string
    ): Promise<DirectoryPickerOutcome> => {
      const bridge = typeof window !== "undefined" ? window.vegaStudio : undefined;
      if (!bridge?.selectDirectory) {
        return { supported: false, canceled: false, path: null };
      }
      const res = await bridge.selectDirectory({
        title,
        defaultPath: defaultPath || defaultProjectsDir || undefined,
      });
      return {
        supported: true,
        canceled: res.canceled,
        path: res.path,
      };
    },
    [defaultProjectsDir]
  );

  const createNewProject = useCallback(
    async (payload: CreateProjectPayload): Promise<WorkspaceSummary> => {
      setActionPending(true);
      setError(null);
      setWarning(null);
      try {
        const summary = await createProject(payload);
        setActiveProject(summary);
        onLogRef.current?.(
          "info",
          `Created and opened project '${summary.project.name}' at ${summary.project_dir}`
        );
        try {
          const state = await fetchWorkspaceState();
          setRecentProjects(state.recent_projects);
        } catch {
          // Non-fatal if recent list refresh fails after creation.
        }
        return summary;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to create project.";
        setError(message);
        onLogRef.current?.("error", `Create project failed: ${message}`);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    []
  );

  const openExistingProject = useCallback(
    async (projectDir: string): Promise<WorkspaceSummary> => {
      setActionPending(true);
      setError(null);
      setWarning(null);
      try {
        const summary = await openProject({ project_dir: projectDir });
        setActiveProject(summary);
        onLogRef.current?.(
          "info",
          `Opened project '${summary.project.name}' (${summary.project_dir})`
        );
        try {
          const state = await fetchWorkspaceState();
          setRecentProjects(state.recent_projects);
        } catch {
          // Non-fatal.
        }
        return summary;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to open project.";
        setError(message);
        onLogRef.current?.("error", `Open project failed: ${message}`);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    []
  );

  const closeActiveWorkspace = useCallback(async (): Promise<void> => {
    setActionPending(true);
    setError(null);
    try {
      const closedName = activeProject?.project.name;
      const state = await closeWorkspace();
      setActiveProject(state.active_project);
      setRecentProjects(state.recent_projects);
      setWarning(null);
      onLogRef.current?.(
        "info",
        closedName ? `Closed workspace '${closedName}'.` : "Closed workspace."
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to close workspace.";
      setError(message);
      onLogRef.current?.("error", message);
    } finally {
      setActionPending(false);
    }
  }, [activeProject]);

  const forgetRecentProject = useCallback(async (projectDir: string) => {
    try {
      const state = await removeRecentProject(projectDir);
      setRecentProjects(state.recent_projects);
    } catch {
      // Ignore errors removing stale history.
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setWarning(null);
  }, []);

  return {
    activeProject,
    recentProjects,
    defaultProjectsDir,
    loading,
    actionPending,
    error,
    warning,
    isElectronBridge,
    refreshWorkspace,
    browseDirectory,
    createNewProject,
    openExistingProject,
    closeActiveWorkspace,
    forgetRecentProject,
    clearFeedback,
  };
}
