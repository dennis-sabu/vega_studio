"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from"react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  X,
} from"lucide-react";
import { DeleteConfirmDialog } from"@/components/explorer/DeleteConfirmDialog";
import {
  ExplorerContextMenu,
  type ContextMenuState,
} from"@/components/explorer/ExplorerContextMenu";
import { FileIcon } from"@/components/explorer/FileIcon";
import { Tooltip } from"@/components/ui/Tooltip";
import type { ExplorerFeedback } from"@/hooks/useFileExplorer";
import type { EntryKind, FileNode } from"@/types/explorer";
import type { WorkspaceSummary } from"@/types/project";
import { formatBoardDisplayLabel } from"@/types/board";

interface FileExplorerProps {
  project: WorkspaceSummary;
  childrenByPath: Record<string, FileNode[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  dirErrors: Record<string, string>;
  truncatedDirs: Record<string, number>;
  selectedPath: string | null;
  dirtyPaths?: Set<string>;
  showHidden: boolean;
  actionPending: boolean;
  feedback: ExplorerFeedback | null;
  onSelectPath: (path: string | null) => void;
  onOpenFile: (node: FileNode) => void;
  onToggleExpand: (dirPath: string) => Promise<void>;
  onExpandDirectory: (dirPath: string) => Promise<void>;
  onCollapseDirectory: (dirPath: string) => void;
  onRefreshAll: () => Promise<void>;
  onRefreshDirectory: (dirPath: string) => Promise<unknown>;
  onToggleHidden: () => void;
  onCreateEntry: (
    parentPath: string,
    name: string,
    kind: EntryKind
  ) => Promise<unknown>;
  onRenameEntry: (targetPath: string, newName: string) => Promise<unknown>;
  onDeleteEntry: (targetPath: string, recursive: boolean) => Promise<unknown>;
  onClearFeedback: () => void;
  onSwitchProject: () => void;
  onCloseProject: () => void;
}

interface InlineDraft {
  mode: "create" |"rename";
  parentPath: string;
  kind: EntryKind;
  targetNode?: FileNode;
  value: string;
  error: string | null;
}

const INVALID_CHARS = /[<>: "/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function validateNameClient(raw: string): string | null {
  const name = raw.trim();
  if (!name) return"Name cannot be empty.";
  if (name.length > 128) return"Name must be 128 characters or fewer.";
  if (name === "." || name === ".." || name.includes("..")) {
    return"Name cannot contain '..' or '.' segments.";
  }
  if (INVALID_CHARS.test(name)) return"Invalid filesystem characters.";
  if (name.endsWith(".") || name.endsWith("")) {
    return"Name cannot end with a period or space.";
  }
  if (RESERVED_NAMES.has(name.split(".")[0].toUpperCase())) {
    return `'${name}' is a reserved system name.`;
  }
  if (name === ".vega-studio") {
    return"Reserved for internal IDE metadata.";
  }
  return null;
}

export function FileExplorer({
  project,
  childrenByPath,
  expandedPaths,
  loadingPaths,
  dirErrors,
  truncatedDirs,
  selectedPath,
  dirtyPaths,
  showHidden,
  actionPending,
  feedback,
  onSelectPath,
  onOpenFile,
  onToggleExpand,
  onExpandDirectory,
  onCollapseDirectory,
  onRefreshAll,
  onRefreshDirectory,
  onToggleHidden,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onClearFeedback,
  onSwitchProject,
  onCloseProject,
}: FileExplorerProps) {
  const [draft, setDraft] = useState<InlineDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  const draftActiveKey = draft
    ? `${draft.mode}:${draft.parentPath ?? ""}:${draft.targetNode?.path ?? ""}`
    : null;

  useEffect(() => {
    if (!draftActiveKey) return;
    queueMicrotask(() => {
      draftInputRef.current?.focus();
      draftInputRef.current?.select();
    });
  }, [draftActiveKey]);

  // Flat list of visible nodes for keyboard Up/Down navigation
  const visibleNodes = useMemo(() => {
    const out: FileNode[] = [];
    const visit = (dirPath: string) => {
      const children = childrenByPath[dirPath] ?? [];
      for (const node of children) {
        out.push(node);
        if (node.kind === "dir" && expandedPaths.has(node.path)) {
          visit(node.path);
        }
      }
    };
    visit("");
    return out;
  }, [childrenByPath, expandedPaths]);

  const nodeByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    for (const list of Object.values(childrenByPath)) {
      for (const node of list) {
        map.set(node.path, node);
      }
    }
    return map;
  }, [childrenByPath]);

  const resolveCreationParent = useCallback((): string => {
    if (!selectedPath) return"";
    const selectedNode = nodeByPath.get(selectedPath);
    if (!selectedNode) return"";
    if (selectedNode.kind === "dir") return selectedNode.path;
    const slash = selectedNode.path.lastIndexOf("/");
    return slash === -1 ? "" : selectedNode.path.slice(0, slash);
  }, [nodeByPath, selectedPath]);

  const beginCreate = useCallback(
    async (kind: EntryKind, explicitParent?: string) => {
      const parentPath =
        explicitParent !== undefined ? explicitParent : resolveCreationParent();
      if (parentPath !== "") {
        await onExpandDirectory(parentPath);
      }
      setDraft({
        mode: "create",
        parentPath,
        kind,
        value: "",
        error: null,
      });
    },
    [onExpandDirectory, resolveCreationParent]
  );

  const beginRename = useCallback((node: FileNode) => {
    if (node.path === "vega-project.json") return;
    const slash = node.path.lastIndexOf("/");
    setDraft({
      mode: "rename",
      parentPath: slash === -1 ? "" : node.path.slice(0, slash),
      kind: node.kind,
      targetNode: node,
      value: node.name,
      error: null,
    });
  }, []);

  const beginDelete = useCallback((node: FileNode) => {
    if (node.path === "vega-project.json") return;
    setDeleteError(null);
    setDeleteTarget(node);
  }, []);

  const commitDraft = useCallback(async () => {
    if (!draft || actionPending) return;
    const trimmed = draft.value.trim();
    const clientErr = validateNameClient(trimmed);
    if (clientErr) {
      setDraft((prev) => (prev ? { ...prev, error: clientErr } : null));
      return;
    }

    if (draft.mode === "rename" && draft.targetNode) {
      if (trimmed === draft.targetNode.name) {
        setDraft(null);
        return;
      }
      try {
        await onRenameEntry(draft.targetNode.path, trimmed);
        setDraft(null);
      } catch (err: unknown) {
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                error: err instanceof Error ? err.message : "Rename failed.",
              }
            : null
        );
      }
      return;
    }

    try {
      await onCreateEntry(draft.parentPath, trimmed, draft.kind);
      setDraft(null);
    } catch (err: unknown) {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "Creation failed.",
            }
          : null
      );
    }
  }, [actionPending, draft, onCreateEntry, onRenameEntry]);

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (draft) return; // Inline input handles keys when open
    if (visibleNodes.length === 0) return;

    const currentIdx = selectedPath
      ? visibleNodes.findIndex((n) => n.path === selectedPath)
      : -1;
    const current = currentIdx >= 0 ? visibleNodes[currentIdx] : null;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = visibleNodes[Math.min(visibleNodes.length - 1, currentIdx + 1)];
      if (next) onSelectPath(next.path);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev =
        currentIdx <= 0 ? visibleNodes[0] : visibleNodes[currentIdx - 1];
      if (prev) onSelectPath(prev.path);
    } else if (event.key === "ArrowRight" && current) {
      event.preventDefault();
      if (current.kind === "dir") {
        if (!expandedPaths.has(current.path)) {
          void onExpandDirectory(current.path);
        } else {
          const children = childrenByPath[current.path];
          if (children && children[0]) onSelectPath(children[0].path);
        }
      }
    } else if (event.key === "ArrowLeft" && current) {
      event.preventDefault();
      if (current.kind === "dir" && expandedPaths.has(current.path)) {
        onCollapseDirectory(current.path);
      } else if (current.path.includes("/")) {
        const parent = current.path.slice(0, current.path.lastIndexOf("/"));
        onSelectPath(parent);
      }
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      if (current.kind === "dir") {
        void onToggleExpand(current.path);
      } else if (current.accessible) {
        onOpenFile(current);
      }
    } else if (event.key === "F2" && current) {
      event.preventDefault();
      beginRename(current);
    } else if (event.key === "Delete" && current) {
      event.preventDefault();
      beginDelete(current);
    }
  };

  const renderInlineCreateRow = (depth: number): ReactNode => {
    if (!draft || draft.mode !== "create") return null;
    return (
      <div
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className="my-0.5 pr-2"
      >
      <div className="flex items-center gap-1.5 rounded-md border border-[#7AA2FF]/45 bg-[#1F1F1F] px-2 py-1">
          <FileIcon
            name={draft.value || (draft.kind === "dir" ? "folder" : "file")}
            kind={draft.kind}
            extension={
              draft.value.includes(".")
                ? `.${draft.value.split(".").pop()}`
                : ""
            }
          />
          <input
            ref={draftInputRef}
            type="text"
            value={draft.value}
            disabled={actionPending}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, value: e.target.value, error: null } : null
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitDraft();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
              }
            }}
            onBlur={() => {
              if (!draft.value.trim()) setDraft(null);
            }}
            placeholder={
              draft.kind === "dir" ? "New folder name..." : "New file name..."
            }
            aria-label={
              draft.kind === "dir" ? "New folder name" : "New file name"
            }
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[#F4F4F5] placeholder:text-[#8E8E98] focus:outline-none"
          />
        </div>
        {draft.error && (
        <p className="mt-1 px-1 text-[10px] text-red-300">{draft.error}</p>
        )}
      </div>
    );
  };

  const renderBranch = (dirPath: string, depth: number): ReactNode => {
    const entries = childrenByPath[dirPath];
    const isLoading = loadingPaths.has(dirPath);
    const err = dirErrors[dirPath];
    const truncatedTotal = truncatedDirs[dirPath];

    return (
      <div role={depth === 0 ? undefined : "group"}>
        {draft?.mode === "create" &&
          draft.parentPath === dirPath &&
          renderInlineCreateRow(depth)}

        {err && (
          <div
            style={dirPath === "" ? undefined : { paddingLeft: `${depth * 14 + 12}px` }}
            className={
              dirPath === ""
                ? "mx-2 my-2 rounded-[6px] border border-red-400/25 bg-red-500/[0.08] p-2.5 text-[11px] text-red-200/90"
                : "flex items-center justify-between gap-2 py-1 pr-2 text-[11px] text-red-300"
            }
          >
          <span className="block leading-snug">{err}</span>
            <button
              type="button"
              onClick={() =>
                dirPath === ""
                  ? void onRefreshAll()
                  : void onRefreshDirectory(dirPath)
              }
              className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-[5px] border border-[#2D2D30] bg-[#252527] px-2 text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
            >
            <RefreshCw className="h-2.5 w-2.5 text-[#7AA2FF]" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoading && !entries && (
          <div
            style={{ paddingLeft: `${depth * 14 + 14}px` }}
            className="flex items-center gap-1.5 py-1.5 font-mono text-[11px] text-[#B4B4BC]"
          >
          <Loader2 className="h-3 w-3 animate-spin" />
            <span>Loading...</span>
          </div>
        )}

        {entries && entries.length === 0 && !isLoading && !err && (
          <div
            style={{ paddingLeft: `${depth * 14 + 22}px` }}
            className="py-1 font-mono text-[10px] text-[#A1A1AA] italic"
          >
            Empty directory
          </div>
        )}

        {entries?.map((node) => {
          const isDir = node.kind === "dir";
          const isExpanded = isDir && expandedPaths.has(node.path);
          const isSelected = selectedPath === node.path;
          const isRenaming =
            draft?.mode === "rename" && draft.targetNode?.path === node.path;

          return (
            <div key={node.path}>
              {isRenaming ? (
                <div
                  style={{ paddingLeft: `${depth * 14 + 10}px` }}
                  className="my-0.5 pr-2"
                >
                <div className="flex items-center gap-1.5 rounded-md border border-[#7AA2FF]/45 bg-[#1F1F1F] px-2 py-1">
                    <FileIcon
                      name={draft.value || node.name}
                      kind={node.kind}
                      extension={node.extension}
                    />
                    <input
                      ref={draftInputRef}
                      type="text"
                      value={draft.value}
                      disabled={actionPending}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? { ...prev, value: e.target.value, error: null }
                            : null
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitDraft();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setDraft(null);
                        }
                      }}
                      onBlur={() => setDraft(null)}
                      aria-label={`Rename ${node.name}`}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[#F4F4F5] focus:outline-none"
                    />
                  </div>
                  {draft.error && (
                  <p className="mt-1 px-1 text-[10px] text-red-300">
                      {draft.error}
                    </p>
                  )}
                </div>
              ) : (
                <div
                  role="treeitem"
                  aria-selected={isSelected}
                  aria-expanded={isDir ? isExpanded : undefined}
                  style={{ paddingLeft: `${depth * 14 + 8}px` }}
                  onClick={() => {
                    onSelectPath(node.path);
                    treeRef.current?.focus();
                    if (isDir) {
                      void onToggleExpand(node.path);
                    } else if (node.accessible) {
                      onOpenFile(node);
                    }
                  }}
                  onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectPath(node.path);
                    setContextMenu({ x: e.clientX, y: e.clientY, node });
                  }}
                  title={node.error ?? node.path}
                  className={`group relative flex h-[26px] cursor-pointer items-center justify-between gap-1 rounded-[4px] pr-1.5 text-[12px] transition-colors ${
                    isSelected
                      ? "bg-[#2C2C30] text-[#F4F4F5] shadow-[inset_2px_0_0_#7AA2FF]"
                      : "text-[#F4F4F5] hover:bg-[#2D2D31]/55 hover:text-[#F4F4F5]"
                  } ${!node.accessible ? "opacity-60" : ""}`}
                >
                  {/* Subtle indentation guide lines */}
                  {depth > 0 &&
                    Array.from({ length: depth }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        style={{ left: `${i * 14 + 14}px` }}
                        className="pointer-events-none absolute inset-y-0 w-px bg-[#2C2C30]/80"
                      />
                    ))}

                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {isDir ? (
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#B4B4BC]">
                        {loadingPaths.has(node.path) ? (
                        <Loader2 className="h-3 w-3 animate-spin text-[#7AA2FF]" />
                        ) : isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                    ) : (
                    <span className="w-4 shrink-0" />
                    )}

                    <FileIcon
                      name={node.name}
                      kind={node.kind}
                      extension={node.extension}
                      expanded={isExpanded}
                      accessible={node.accessible}
                    />

                    <span className="truncate font-mono text-[11.5px]">
                      {node.name}
                    </span>

                    {dirtyPaths &&
                      (node.kind === "file"
                        ? dirtyPaths.has(node.path)
                        : Array.from(dirtyPaths).some((dp) =>
                            dp.startsWith(`${node.path}/`)
                          )) && (
                        <span
                          aria-label="Unsaved modifications"
                          title="Modified in editor"
                          className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300"
                        />
                      )}
                  </div>

                  <button
                    type="button"
                    aria-label={`Actions for ${node.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onSelectPath(node.path);
                      setContextMenu({
                        x: rect.right,
                        y: rect.bottom + 2,
                        node,
                      });
                    }}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#B4B4BC] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#2D2D31] hover:text-[#F4F4F5] focus-visible:opacity-100"
                  >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isDir && isExpanded && renderBranch(node.path, depth + 1)}
            </div>
          );
        })}

        {truncatedTotal !== undefined && (
          <div
            style={{ paddingLeft: `${depth * 14 + 22}px` }}
            className="py-1 pr-2 font-mono text-[10px] text-amber-300/80"
          >
            Showing 500 of {truncatedTotal} entries
          </div>
        )}
      </div>
    );
  };

  return (
  <div className="flex min-h-0 flex-1 flex-col">
      {/* Active Project Root Bar + Explorer Action Buttons */}
      <div className="shrink-0 border-b border-[#2D2D30] bg-[#1F1F1F] px-2.5 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => onSelectPath(null)}
            title={project.project_dir}
            className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[#252527]"
          >
          <span className="truncate font-mono text-[11px] font-semibold text-[#F4F4F5]">
              {project.project.name}
            </span>
            <span className="shrink-0 rounded-[4px] border border-[#2D2D30] bg-[#252527] px-1.5 py-0.5 font-mono text-[9.5px] text-[#7AA2FF]">
              {formatBoardDisplayLabel(null, project.project.target.board, {
                short: true,
              })}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip label="New File" side="bottom">
              <button
                type="button"
                aria-label="New File"
                disabled={actionPending}
                onClick={() => void beginCreate("file")}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
              >
              <FilePlus className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            <Tooltip label="New Folder" side="bottom">
              <button
                type="button"
                aria-label="New Folder"
                disabled={actionPending}
                onClick={() => void beginCreate("dir")}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
              >
              <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            <Tooltip
              label={showHidden ? "Hide Dotfiles" : "Show Dotfiles"}
              side="bottom"
            >
              <button
                type="button"
                aria-label={showHidden ? "Hide Dotfiles" : "Show Dotfiles"}
                aria-pressed={showHidden}
                onClick={onToggleHidden}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
              >
                {showHidden ? (
                <Eye className="h-3.5 w-3.5" />
                ) : (
                <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
            </Tooltip>

            <Tooltip label="Refresh Explorer" side="bottom">
              <button
                type="button"
                aria-label="Refresh Explorer"
                onClick={() => void onRefreshAll()}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingPaths.size > 0 ? "animate-spin text-[#7AA2FF]" : ""}`}
                />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Inline Feedback Banner */}
      {feedback && (
        <div
          className={`mx-2 mt-2 flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
            feedback.kind === "error"
              ? "border-red-400/30 bg-red-500/12 text-red-200"
              : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
          }`}
        >
        <span className="flex items-start gap-1.5">
            {feedback.kind === "error" ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span className="leading-snug">{feedback.message}</span>
          </span>
          <button
            type="button"
            aria-label="Dismiss explorer feedback"
            onClick={onClearFeedback}
            className="shrink-0 rounded p-0.5 hover:bg-[#2D2D31]"
          >
          <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Hierarchical Tree Container */}
      <div
        ref={treeRef}
        role="tree"
        aria-label={`${project.project.name} files`}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onSelectPath(null);
            setContextMenu({ x: e.clientX, y: e.clientY, node: null });
          }
        }}
        className="vega-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2 focus:outline-none"
      >
        {renderBranch("", 0)}
      </div>

      {/* Compact Footer Controls for Project Switching / Closing */}
      <div className="flex shrink-0 items-center justify-between gap-1.5 border-t border-[#2D2D30] bg-[#181818] px-2.5 py-2">
        <button
          type="button"
          onClick={onSwitchProject}
          className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-2 text-[11px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
        >
        <FolderOpen className="h-3 w-3 text-[#7AA2FF]" />
          <span>Switch</span>
        </button>
        <button
          type="button"
          onClick={onCloseProject}
          className="inline-flex h-6 items-center justify-center rounded border border-[#2D2D30] bg-transparent px-2.5 text-[11px] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
        >
          Close
        </button>
      </div>

      <ExplorerContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onNewFile={(parentPath) => void beginCreate("file", parentPath)}
        onNewFolder={(parentPath) => void beginCreate("dir", parentPath)}
        onOpenFile={onOpenFile}
        onRename={beginRename}
        onDelete={beginDelete}
        onRefresh={(dirPath) => void onRefreshDirectory(dirPath)}
      />

      <DeleteConfirmDialog
        target={deleteTarget}
        pending={actionPending}
        errorMessage={deleteError}
        unsavedFilesCount={
          deleteTarget && dirtyPaths
            ? Array.from(dirtyPaths).filter(
                (dp) =>
                  dp === deleteTarget.path ||
                  dp.startsWith(`${deleteTarget.path}/`)
              ).length
            : 0
        }
        onCancel={() => {
          setDeleteError(null);
          setDeleteTarget(null);
        }}
        onConfirm={async (recursive) => {
          if (!deleteTarget) return;
          try {
            await onDeleteEntry(deleteTarget.path, recursive);
            setDeleteTarget(null);
          } catch (err: unknown) {
            setDeleteError(
              err instanceof Error ? err.message : "Delete failed."
            );
          }
        }}
      />
    </div>
  );
}
