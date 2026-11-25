"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchFileContent, saveFileContent } from "@/lib/api";
import {
  detectMonacoLanguageClient,
  disposeAllTabModels,
  disposeTabModel,
  getTabModelContent,
  getTabModelRecord,
  loadVegaMonaco,
  markTabModelSaved,
  resetTabModelFromDisk,
} from "@/lib/vegaMonaco";
import type { EditorCursorPosition, UnsavedGuardPrompt } from "@/types/editor";
import type { FileNode, OpenFileTab } from "@/types/explorer";

interface UseEditorTabsOptions {
  projectDir: string | null;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

function createTabUid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function pathBasename(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] ?? relativePath;
}

function pathExtension(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : "";
}

function remapPrefixPath(
  candidate: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (candidate === oldPrefix) return newPrefix;
  if (candidate.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${candidate.slice(oldPrefix.length)}`;
  }
  return candidate;
}

function matchesPathOrDescendant(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target}/`);
}

export function useEditorTabs({ projectDir, onLog }: UseEditorTabsOptions) {
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [activeFileTabPath, setActiveFileTabPath] = useState<string | null>(
    null
  );
  const [cursorPosition, setCursorPosition] = useState<EditorCursorPosition>({
    lineNumber: 1,
    column: 1,
    selectionLength: 0,
  });
  const [unsavedPrompt, setUnsavedPrompt] =
    useState<UnsavedGuardPrompt | null>(null);

  const tabsRef = useRef<OpenFileTab[]>(openFileTabs);
  const activePathRef = useRef<string | null>(activeFileTabPath);
  const projectDirRef = useRef<string | null>(projectDir);
  const onLogRef = useRef(onLog);
  const loadAbortsRef = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    tabsRef.current = openFileTabs;
    activePathRef.current = activeFileTabPath;
    projectDirRef.current = projectDir;
    onLogRef.current = onLog;
  });

  // Dispose in-flight requests and session Monaco models cleanly on unmount
  useEffect(() => {
    const aborts = loadAbortsRef.current;
    return () => {
      Object.values(aborts).forEach((c) => c.abort());
      disposeAllTabModels();
    };
  }, []);

  const dirtyPaths = useMemo(
    () =>
      new Set(openFileTabs.filter((tab) => tab.isDirty).map((tab) => tab.path)),
    [openFileTabs]
  );

  // Warn if browser/Electron window closes while dirty files exist
  useEffect(() => {
    if (dirtyPaths.size === 0) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyPaths.size]);

  const loadTabContent = useCallback(
    async (
      uid: string,
      targetProjectDir: string,
      relativePath: string,
      opts?: { reloadFromDisk?: boolean }
    ) => {
      loadAbortsRef.current[uid]?.abort();
      const controller = new AbortController();
      loadAbortsRef.current[uid] = controller;

      setOpenFileTabs((prev) =>
        prev.map((tab) =>
          tab.uid === uid
            ? {
                ...tab,
                loading: true,
                error: null,
                errorStatus: null,
                saveError: null,
                conflictError: null,
              }
            : tab
        )
      );

      try {
        const data = await fetchFileContent(
          targetProjectDir,
          relativePath,
          controller.signal
        );
        if (controller.signal.aborted) return;

        if (opts?.reloadFromDisk) {
          const monaco = await loadVegaMonaco();
          if (controller.signal.aborted) return;
          resetTabModelFromDisk(
            monaco,
            uid,
            data.content,
            data.monaco_language
          );
        }

        setOpenFileTabs((prev) =>
          prev.map((tab) =>
            tab.uid === uid
              ? {
                  ...tab,
                  name: data.name,
                  path: data.relative_path,
                  extension: data.extension,
                  language: data.language,
                  monacoLanguage: data.monaco_language,
                  lineEnding: data.line_ending,
                  size: data.size,
                  modifiedAt: data.modified_at,
                  versionStamp: data.version_stamp,
                  savedContent: data.content,
                  loading: false,
                  isDirty: false,
                  error: null,
                  errorStatus: null,
                  saveError: null,
                  conflictError: null,
                }
              : tab
          )
        );
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        const status = err instanceof ApiError ? err.status : null;
        const message =
          err instanceof Error ? err.message : "Failed to load file contents.";
        setOpenFileTabs((prev) =>
          prev.map((tab) =>
            tab.uid === uid
              ? {
                  ...tab,
                  loading: false,
                  error: message,
                  errorStatus: status,
                }
              : tab
          )
        );
        onLogRef.current?.("warn", `Unable to open ${relativePath}: ${message}`);
      }
    },
    []
  );

  const openFile = useCallback(
    (node: FileNode) => {
      const currentProjectDir = projectDirRef.current;
      if (!currentProjectDir || node.kind !== "file") return;

      const existing = tabsRef.current.find((tab) => tab.path === node.path);
      if (existing) {
        setActiveFileTabPath(existing.path);
        if (existing.error && !existing.loading) {
          void loadTabContent(existing.uid, currentProjectDir, existing.path);
        }
        return;
      }

      const detected = detectMonacoLanguageClient(node.name, node.extension);
      const uid = createTabUid();
      const newTab: OpenFileTab = {
        uid,
        path: node.path,
        name: node.name,
        extension: node.extension,
        language: detected.displayLabel,
        monacoLanguage: detected.monacoLanguage,
        lineEnding: "LF",
        size: node.size,
        modifiedAt: null,
        versionStamp: null,
        savedContent: "",
        loading: true,
        isDirty: false,
        isSaving: false,
        error: null,
        errorStatus: null,
        saveError: null,
        conflictError: null,
      };

      setOpenFileTabs((prev) => [...prev, newTab]);
      setActiveFileTabPath(node.path);
      void loadTabContent(uid, currentProjectDir, node.path);
    },
    [loadTabContent]
  );

  const setTabDirty = useCallback((uid: string, isDirty: boolean) => {
    setOpenFileTabs((prev) =>
      prev.map((tab) =>
        tab.uid === uid && tab.isDirty !== isDirty
          ? { ...tab, isDirty }
          : tab
      )
    );
  }, []);

  const saveTab = useCallback(
    async (
      uidOrPath: string,
      opts?: { overwriteConflict?: boolean }
    ): Promise<boolean> => {
      const currentProjectDir = projectDirRef.current;
      const tab = tabsRef.current.find(
        (candidate) =>
          candidate.uid === uidOrPath || candidate.path === uidOrPath
      );
      if (
        !currentProjectDir ||
        !tab ||
        tab.loading ||
        tab.error ||
        tab.isSaving
      ) {
        return false;
      }

      const content = getTabModelContent(tab.uid) ?? tab.savedContent;

      setOpenFileTabs((prev) =>
        prev.map((item) =>
          item.uid === tab.uid
            ? { ...item, isSaving: true, saveError: null, conflictError: null }
            : item
        )
      );

      try {
        const res = await saveFileContent({
          project_dir: currentProjectDir,
          relative_path: tab.path,
          content,
          expected_version: tab.versionStamp,
          overwrite_conflict: Boolean(opts?.overwriteConflict),
        });

        const stillDirty = markTabModelSaved(tab.uid, content);
        setOpenFileTabs((prev) =>
          prev.map((item) =>
            item.uid === tab.uid
              ? {
                  ...item,
                  savedContent: content,
                  size: res.size,
                  modifiedAt: res.modified_at,
                  versionStamp: res.version_stamp,
                  lineEnding: res.line_ending,
                  isDirty: stillDirty,
                  isSaving: false,
                  saveError: null,
                  conflictError: null,
                }
              : item
          )
        );
        onLogRef.current?.("info", res.message);
        return true;
      } catch (err: unknown) {
        const status = err instanceof ApiError ? err.status : null;
        const message =
          err instanceof Error ? err.message : "Failed to save file.";

        setOpenFileTabs((prev) =>
          prev.map((item) =>
            item.uid === tab.uid
              ? {
                  ...item,
                  isSaving: false,
                  saveError: status === 409 ? null : message,
                  conflictError: status === 409 ? message : null,
                }
              : item
          )
        );
        onLogRef.current?.("error", `Save failed for ${tab.path}: ${message}`);
        return false;
      }
    },
    []
  );

  const saveAllDirtyTabs = useCallback(async (): Promise<boolean> => {
    const dirtyTargets = tabsRef.current.filter(
      (tab) => tab.isDirty && !tab.loading && !tab.error
    );
    let allSucceeded = true;
    for (const tab of dirtyTargets) {
      const ok = await saveTab(tab.uid);
      if (!ok) {
        allSucceeded = false;
      }
    }
    return allSucceeded;
  }, [saveTab]);

  const reloadTabFromDisk = useCallback(
    async (uid: string) => {
      const currentProjectDir = projectDirRef.current;
      const tab = tabsRef.current.find((item) => item.uid === uid);
      if (!currentProjectDir || !tab) return;
      await loadTabContent(tab.uid, currentProjectDir, tab.path, {
        reloadFromDisk: true,
      });
    },
    [loadTabContent]
  );

  const commitRemoveTabs = useCallback((uidsToRemove: Set<string>) => {
    if (uidsToRemove.size === 0) return;

    const currentTabs = tabsRef.current;
    const currentActive = activePathRef.current;

    for (const uid of uidsToRemove) {
      loadAbortsRef.current[uid]?.abort();
      delete loadAbortsRef.current[uid];
      disposeTabModel(uid);
    }

    const activeIdx = currentActive
      ? currentTabs.findIndex((tab) => tab.path === currentActive)
      : -1;
    const remaining = currentTabs.filter((tab) => !uidsToRemove.has(tab.uid));
    setOpenFileTabs(remaining);

    if (
      currentActive &&
      currentTabs.some(
        (tab) => tab.path === currentActive && uidsToRemove.has(tab.uid)
      )
    ) {
      const fallback =
        remaining.length > 0
          ? remaining[Math.min(Math.max(activeIdx, 0), remaining.length - 1)]
          : null;
      setActiveFileTabPath(fallback ? fallback.path : null);
    }
  }, []);

  const promptForDirtyTabs = useCallback(
    (
      dirtyTargets: OpenFileTab[],
      config: {
        title: string;
        description: string;
        confirmSaveLabel: string;
        confirmDiscardLabel: string;
      }
    ): Promise<"save" | "discard" | "cancel"> => {
      if (dirtyTargets.length === 0) {
        return Promise.resolve("discard");
      }

      return new Promise((resolvePromise) => {
        setUnsavedPrompt({
          ...config,
          files: dirtyTargets.map((tab) => ({
            uid: tab.uid,
            path: tab.path,
            name: tab.name,
          })),
          resolve: (decision) => {
            if (decision === "cancel") {
              setUnsavedPrompt(null);
              resolvePromise("cancel");
              return;
            }
            if (decision === "discard") {
              setUnsavedPrompt(null);
              resolvePromise("discard");
              return;
            }
            void (async () => {
              let allSaved = true;
              for (const file of dirtyTargets) {
                const ok = await saveTab(file.uid);
                if (!ok) {
                  allSaved = false;
                  setActiveFileTabPath(file.path);
                  break;
                }
              }
              setUnsavedPrompt(null);
              resolvePromise(allSaved ? "save" : "cancel");
            })();
          },
        });
      });
    },
    [saveTab]
  );

  const requestCloseFileTab = useCallback(
    async (filePath: string) => {
      const target = tabsRef.current.find((tab) => tab.path === filePath);
      if (!target) return;

      if (!target.isDirty) {
        commitRemoveTabs(new Set([target.uid]));
        return;
      }

      const decision = await promptForDirtyTabs([target], {
        title: "Save changes before closing?",
        description: `Your edits to "${target.name}" haven't been saved yet. Save before closing the tab?`,
        confirmSaveLabel: "Save & Close",
        confirmDiscardLabel: "Discard",
      });

      if (decision !== "cancel") {
        commitRemoveTabs(new Set([target.uid]));
      }
    },
    [commitRemoveTabs, promptForDirtyTabs]
  );

  const requestCloseOtherTabs = useCallback(
    async (keepPath: string) => {
      const targets = tabsRef.current.filter((tab) => tab.path !== keepPath);
      if (targets.length === 0) return;

      const dirtyTargets = targets.filter((tab) => tab.isDirty);
      const decision = await promptForDirtyTabs(dirtyTargets, {
        title: "Save changes in other tabs?",
        description:
          "One or more other editor tabs contain unsaved changes. Save them before closing?",
        confirmSaveLabel: "Save & Close Others",
        confirmDiscardLabel: "Discard Others",
      });

      if (decision !== "cancel") {
        commitRemoveTabs(new Set(targets.map((tab) => tab.uid)));
      }
    },
    [commitRemoveTabs, promptForDirtyTabs]
  );

  const requestCloseAllTabs = useCallback(async () => {
    const targets = tabsRef.current;
    if (targets.length === 0) return;

    const dirtyTargets = targets.filter((tab) => tab.isDirty);
    const decision = await promptForDirtyTabs(dirtyTargets, {
      title: "Save changes before closing all tabs?",
      description:
        "You have unsaved changes in open editor files. Save them before closing all tabs?",
      confirmSaveLabel: "Save All & Close",
      confirmDiscardLabel: "Discard All",
    });

    if (decision !== "cancel") {
      commitRemoveTabs(new Set(targets.map((tab) => tab.uid)));
    }
  }, [commitRemoveTabs, promptForDirtyTabs]);

  const confirmWorkspaceTransition = useCallback(
    async (config: {
      title: string;
      description: string;
      confirmSaveLabel: string;
      confirmDiscardLabel: string;
    }): Promise<boolean> => {
      const dirtyTargets = tabsRef.current.filter((tab) => tab.isDirty);
      if (dirtyTargets.length === 0) return true;

      const decision = await promptForDirtyTabs(dirtyTargets, config);
      return decision !== "cancel";
    },
    [promptForDirtyTabs]
  );

  const resetFileTabs = useCallback(() => {
    Object.values(loadAbortsRef.current).forEach((c) => c.abort());
    loadAbortsRef.current = {};
    disposeAllTabModels();
    setOpenFileTabs([]);
    setActiveFileTabPath(null);
  }, []);

  const handleEntryRenamed = useCallback((oldPath: string, newPath: string) => {
    void loadVegaMonaco()
      .then((monaco) => {
        setOpenFileTabs((prev) =>
          prev.map((tab) => {
            const remapped = remapPrefixPath(tab.path, oldPath, newPath);
            if (remapped === tab.path) return tab;
            const nextName = pathBasename(remapped);
            const nextExt = pathExtension(nextName);
            const detected = detectMonacoLanguageClient(nextName, nextExt);

            const record = getTabModelRecord(tab.uid);
            if (
              record &&
              record.model.getLanguageId() !== detected.monacoLanguage
            ) {
              monaco.editor.setModelLanguage(
                record.model,
                detected.monacoLanguage
              );
            }

            return {
              ...tab,
              path: remapped,
              name: nextName,
              extension: nextExt,
              language: detected.displayLabel,
              monacoLanguage: detected.monacoLanguage,
            };
          })
        );
      })
      .catch(() => {
        // Fallback metadata remap if Monaco hadn't been loaded yet
        setOpenFileTabs((prev) =>
          prev.map((tab) => {
            const remapped = remapPrefixPath(tab.path, oldPath, newPath);
            if (remapped === tab.path) return tab;
            const nextName = pathBasename(remapped);
            const nextExt = pathExtension(nextName);
            const detected = detectMonacoLanguageClient(nextName, nextExt);
            return {
              ...tab,
              path: remapped,
              name: nextName,
              extension: nextExt,
              language: detected.displayLabel,
              monacoLanguage: detected.monacoLanguage,
            };
          })
        );
      });

    setActiveFileTabPath((prev) =>
      prev ? remapPrefixPath(prev, oldPath, newPath) : prev
    );
  }, []);

  const handleEntryDeleted = useCallback(
    (deletedPath: string) => {
      const uidsToRemove = new Set(
        tabsRef.current
          .filter((tab) => matchesPathOrDescendant(tab.path, deletedPath))
          .map((tab) => tab.uid)
      );
      commitRemoveTabs(uidsToRemove);
    },
    [commitRemoveTabs]
  );

  return {
    openFileTabs,
    activeFileTabPath,
    dirtyPaths,
    dirtyCount: dirtyPaths.size,
    cursorPosition,
    unsavedPrompt,
    setActiveFileTabPath,
    setCursorPosition,
    setTabDirty,
    openFile,
    saveTab,
    saveAllDirtyTabs,
    reloadTabFromDisk,
    requestCloseFileTab,
    requestCloseOtherTabs,
    requestCloseAllTabs,
    confirmWorkspaceTransition,
    resetFileTabs,
    handleEntryRenamed,
    handleEntryDeleted,
  };
}
