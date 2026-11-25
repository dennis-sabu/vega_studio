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
  useEffect(() => {
    onLogRef.current = onLog;
    onEntryRenamedRef.current = onEntryRenamed;
    onEntryDeletedRef.current = onEntryDeleted;
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
      if (!projectDir || !isBackendConnected) return null;
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      try {
        const listing = await fetchDirectoryTree(
          projectDir,
          dirPath,
          hiddenFlag,
          signal
        );
        setChildrenByPath((prev) => ({
          ...prev,
          [dirPath]: listing.entries,
        }));
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

    queueMicrotask(() => {
      if (!active) return;
      if (!projectDir) {
        setChildrenByPath({});
        setExpandedPaths(new Set());
        setDirErrors({});
        setTruncatedDirs({});
        setSelectedPath(null);
        setFeedback(null);
        return;
      }

      setChildrenByPath({});
      setDirErrors({});
      setTruncatedDirs({});
      setSelectedPath(null);
      setExpandedPaths(new Set());

      if (!isBackendConnected) return;

      fetchDirectoryTree(projectDir, "", showHidden, controller.signal)
        .then((rootListing) => {
          if (!active) return;
          setChildrenByPath({ "": rootListing.entries });
          if (rootListing.truncated) {
            setTruncatedDirs({ "": rootListing.total_count });
          }

          // Auto-expand src/ on initial project load if present for quick orientation.
          const hasSrc = rootListing.entries.some(
            (e) => e.kind === "dir" && e.path === "src" && e.accessible
          );
          if (hasSrc) {
            fetchDirectoryTree(projectDir, "src", showHidden, controller.signal)
              .then((srcListing) => {
                if (!active) return;
                setChildrenByPath((prev) => ({
                  ...prev,
                  src: srcListing.entries,
                }));
                setExpandedPaths(new Set(["src"]));
              })
              .catch(() => {
                // Non-fatal if src auto-expand fails.
              });
          }
        })
        .catch((err: unknown) => {
          if (!active) return;
          if (err instanceof Error && err.name === "AbortError") return;
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to load project files.";
          setDirErrors({ "": msg });
        });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [projectDir, isBackendConnected, showHidden]);

  const toggleExpand = useCallback(
    async (dirPath: string) => {
      let expanding = false;
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
          expanding = false;
        } else {
          next.add(dirPath);
          expanding = true;
        }
        return next;
      });
      if (expanding && !(dirPath in childrenByPath)) {
        await loadDirectory(dirPath);
      }
    },
    [childrenByPath, loadDirectory]
  );

  const expandDirectory = useCallback(
    async (dirPath: string) => {
      setExpandedPaths((prev) => {
        if (prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      if (dirPath !== "" && !(dirPath in childrenByPath)) {
        await loadDirectory(dirPath);
      }
    },
    [childrenByPath, loadDirectory]
  );

  const collapseDirectory = useCallback((dirPath: string) => {
    setExpandedPaths((prev) => {
      if (!prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });
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
