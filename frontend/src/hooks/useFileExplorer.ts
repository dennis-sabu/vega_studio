"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  fetchDirectoryTree,
  renameExplorerEntry,
} from "@/lib/api";
import type { EntryKind, FileNode } from "@/types/explorer";

export interface ExplorerFeedback {
  kind: "success" | "error";
  message: string;
}

interface UseFileExplorerOptions {
  projectDir: string | null;
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  onEntryRenamed?: (oldPath: string, newPath: string, newName: string) => void;
  onEntryDeleted?: (deletedPath: string) => void;
}

function getParentPath(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

function remapDescendantPath(
  path: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }
  return path;
}

export function useFileExplorer({
  projectDir,
  isBackendConnected,
  onLog,
  onEntryRenamed,
  onEntryDeleted,
}: UseFileExplorerOptions) {
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, FileNode[]>
  >({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [truncatedDirs, setTruncatedDirs] = useState<Record<string, number>>(
    {}
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState<boolean>(true);
  const [actionPending, setActionPending] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<ExplorerFeedback | null>(null);

  const onLogRef = useRef(onLog);
  const onEntryRenamedRef = useRef(onEntryRenamed);
  const onEntryDeletedRef = useRef(onEntryDeleted);
  const activeProjectDirRef = useRef(projectDir);
  const expandedPathsRef = useRef(expandedPaths);
  const childrenByPathRef = useRef(childrenByPath);
  useEffect(() => {
    onLogRef.current = onLog;
    onEntryRenamedRef.current = onEntryRenamed;
    onEntryDeletedRef.current = onEntryDeleted;
    activeProjectDirRef.current = projectDir;
    expandedPathsRef.current = expandedPaths;
    childrenByPathRef.current = childrenByPath;
  });

  // Auto-dismiss transient success feedback after 3s
  useEffect(() => {
    if (!feedback || feedback.kind !== "success") return;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const loadDirectory = useCallback(
    async (
      dirPath: string,
      signal?: AbortSignal,
      hiddenFlag = showHidden
    ): Promise<FileNode[] | null> => {
      const targetProjectDir = projectDir;
      if (!targetProjectDir || !isBackendConnected) return null;
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      try {
        const listing = await fetchDirectoryTree(
          targetProjectDir,
          dirPath,
          hiddenFlag,
          signal
        );
        if (activeProjectDirRef.current !== targetProjectDir) {
          return null;
        }
        setChildrenByPath((prev) => {
          const next = {
            ...prev,
            [dirPath]: listing.entries,
          };
          childrenByPathRef.current = next;
          return next;
        });
        setDirErrors((prev) => {
          if (!(dirPath in prev)) return prev;
          const next = { ...prev };
          delete next[dirPath];
          return next;
        });
        setTruncatedDirs((prev) => {
          const next = { ...prev };
          if (listing.truncated) {
            next[dirPath] = listing.total_count;
          } else {
            delete next[dirPath];
          }
          return next;
        });
        return listing.entries;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return null;
        if (activeProjectDirRef.current !== targetProjectDir) return null;
        const message =
          err instanceof Error ? err.message : "Failed to load directory.";
        setDirErrors((prev) => ({ ...prev, [dirPath]: message }));
        return null;
      } finally {
        setLoadingPaths((prev) => {
          if (!prev.has(dirPath)) return prev;
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [projectDir, isBackendConnected, showHidden]
  );

  // Reset and load root directory whenever projectDir, connectivity, or hidden toggle changes.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    activeProjectDirRef.current = projectDir;

    queueMicrotask(() => {
      if (!active) return;
      if (!projectDir) {
        childrenByPathRef.current = {};
        expandedPathsRef.current = new Set();
        setChildrenByPath({});
        setExpandedPaths(new Set());
        setLoadingPaths(new Set());
        setDirErrors({});
        setTruncatedDirs({});
        setSelectedPath(null);
        setFeedback(null);
        return;
      }

      childrenByPathRef.current = {};
      expandedPathsRef.current = new Set();
      setChildrenByPath({});
      setDirErrors({});
      setTruncatedDirs({});
      setSelectedPath(null);
      setExpandedPaths(new Set());

      if (!isBackendConnected) {
        setLoadingPaths(new Set());
        return;
      }

      setLoadingPaths(new Set([""]));
      const requestedProjectDir = projectDir;

      fetchDirectoryTree(requestedProjectDir, "", showHidden, controller.signal)
        .then((rootListing) => {
          if (!active || activeProjectDirRef.current !== requestedProjectDir) {
            return;
          }
          const initialMap = { "": rootListing.entries };
          childrenByPathRef.current = initialMap;
          setChildrenByPath(initialMap);
          if (rootListing.truncated) {
            setTruncatedDirs({ "": rootListing.total_count });
          }

          // Auto-expand src/ on initial project load if present for quick orientation.
          const hasSrc = rootListing.entries.some(
            (e) => e.kind === "dir" && e.path === "src" && e.accessible
          );
          if (hasSrc) {
            fetchDirectoryTree(
              requestedProjectDir,
              "src",
              showHidden,
              controller.signal
            )
              .then((srcListing) => {
                if (
                  !active ||
                  activeProjectDirRef.current !== requestedProjectDir
                ) {
                  return;
                }
                setChildrenByPath((prev) => {
                  const next = {
                    ...prev,
                    src: srcListing.entries,
                  };
                  childrenByPathRef.current = next;
                  return next;
                });
                setExpandedPaths((prev) => {
                  if (prev.has("src")) return prev;
                  const next = new Set(prev);
                  next.add("src");
                  expandedPathsRef.current = next;
                  return next;
                });
              })
              .catch(() => {
                // Non-fatal if src auto-expand fails.
              });
          }
        })
        .catch((err: unknown) => {
          if (!active || activeProjectDirRef.current !== requestedProjectDir) {
            return;
          }
          if (err instanceof Error && err.name === "AbortError") return;
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to load project files.";
          setDirErrors({ "": msg });
        })
        .finally(() => {
          if (!active) return;
          setLoadingPaths((prev) => {
            if (!prev.has("")) return prev;
            const next = new Set(prev);
            next.delete("");
            return next;
          });
        });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [projectDir, isBackendConnected, showHidden]);

  const toggleExpand = useCallback(
    async (dirPath: string) => {
      const expanding = !expandedPathsRef.current.has(dirPath);
      const nextExpanded = new Set(expandedPathsRef.current);
      if (expanding) {
        nextExpanded.add(dirPath);
      } else {
        nextExpanded.delete(dirPath);
      }
      expandedPathsRef.current = nextExpanded;
      setExpandedPaths(nextExpanded);

      if (expanding && !(dirPath in childrenByPathRef.current)) {
        await loadDirectory(dirPath);
      }
    },
    [loadDirectory]
  );

  const expandDirectory = useCallback(
    async (dirPath: string) => {
      if (!expandedPathsRef.current.has(dirPath)) {
        const nextExpanded = new Set(expandedPathsRef.current);
        nextExpanded.add(dirPath);
        expandedPathsRef.current = nextExpanded;
        setExpandedPaths(nextExpanded);
      }
      if (dirPath !== "" && !(dirPath in childrenByPathRef.current)) {
        await loadDirectory(dirPath);
      }
    },
    [loadDirectory]
  );

  const collapseDirectory = useCallback((dirPath: string) => {
    if (!expandedPathsRef.current.has(dirPath)) return;
    const next = new Set(expandedPathsRef.current);
    next.delete(dirPath);
    expandedPathsRef.current = next;
    setExpandedPaths(next);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!projectDir || !isBackendConnected) return;
    const dirsToReload = ["", ...Array.from(expandedPaths)];
    await Promise.all(dirsToReload.map((d) => loadDirectory(d)));
    setFeedback({ kind: "success", message: "Refreshed file explorer." });
  }, [expandedPaths, isBackendConnected, loadDirectory, projectDir]);

  const createEntry = useCallback(
    async (parentPath: string, name: string, kind: EntryKind) => {
      if (!projectDir) {
        throw new Error("No active project open.");
      }
      setActionPending(true);
      setFeedback(null);
      try {
        const res = await createExplorerEntry({
          project_dir: projectDir,
          parent_path: parentPath,
          name,
          kind,
        });
        if (parentPath !== "") {
          setExpandedPaths((prev) => {
            const next = new Set(prev);
            next.add(parentPath);
            return next;
          });
        }
        await loadDirectory(parentPath);
        if (parentPath !== "") {
          // Ensure parent's has_children updates accurately
          await loadDirectory(getParentPath(parentPath));
        }
        setSelectedPath(res.relative_path);
        setFeedback({ kind: "success", message: res.message });
        onLogRef.current?.("info", res.message);
        return res;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to create entry.";
        setFeedback({ kind: "error", message });
        onLogRef.current?.("error", message);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    [loadDirectory, projectDir]
  );

  const renameEntry = useCallback(
    async (targetPath: string, newName: string) => {
      if (!projectDir) {
        throw new Error("No active project open.");
      }
      setActionPending(true);
      setFeedback(null);
      try {
        const res = await renameExplorerEntry({
          project_dir: projectDir,
          target_path: targetPath,
          new_name: newName,
        });
        const newPath = res.relative_path;

        // Remap expanded paths & selection
        setExpandedPaths((prev) => {
          const next = new Set<string>();
          for (const p of prev) {
            next.add(remapDescendantPath(p, targetPath, newPath));
          }
          return next;
        });
        setSelectedPath((prev) =>
          prev ? remapDescendantPath(prev, targetPath, newPath) : prev
        );

        const parentDir = getParentPath(targetPath);
        await loadDirectory(parentDir);
        if (res.node?.kind === "dir") {
          await loadDirectory(newPath);
        }

        setFeedback({ kind: "success", message: res.message });
        onLogRef.current?.("info", res.message);
        onEntryRenamedRef.current?.(targetPath, newPath, newName);
        return res;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to rename entry.";
        setFeedback({ kind: "error", message });
        onLogRef.current?.("error", message);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    [loadDirectory, projectDir]
  );

  const deleteEntry = useCallback(
    async (targetPath: string, recursive: boolean) => {
      if (!projectDir) {
        throw new Error("No active project open.");
      }
      setActionPending(true);
      setFeedback(null);
      try {
        const res = await deleteExplorerEntry({
          project_dir: projectDir,
          target_path: targetPath,
          recursive,
        });

        setExpandedPaths((prev) => {
          const next = new Set<string>();
          for (const p of prev) {
            if (p !== targetPath && !p.startsWith(`${targetPath}/`)) {
              next.add(p);
            }
          }
          return next;
        });

        setSelectedPath((prev) => {
          if (
            prev &&
            (prev === targetPath || prev.startsWith(`${targetPath}/`))
          ) {
            return getParentPath(targetPath) || null;
          }
          return prev;
        });

        const parentDir = getParentPath(targetPath);
        await loadDirectory(parentDir);
        if (parentDir !== "") {
          await loadDirectory(getParentPath(parentDir));
        }

        setFeedback({ kind: "success", message: res.message });
        onLogRef.current?.("info", res.message);
        onEntryDeletedRef.current?.(targetPath);
        return res;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to delete entry.";
        setFeedback({ kind: "error", message });
        onLogRef.current?.("error", message);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    [loadDirectory, projectDir]
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return {
    childrenByPath,
    expandedPaths,
    loadingPaths,
    dirErrors,
    truncatedDirs,
    selectedPath,
    showHidden,
    actionPending,
    feedback,
    setSelectedPath,
    setShowHidden,
    toggleExpand,
    expandDirectory,
    collapseDirectory,
    loadDirectory,
    refreshAll,
    createEntry,
    renameEntry,
    deleteEntry,
    clearFeedback,
  };
}
