"use client";

import { useEffect } from"react";
import { createPortal } from"react-dom";
import {
  Edit3,
  FilePlus,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
} from"lucide-react";
import type { FileNode } from"@/types/explorer";

export interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode | null; // null = project root
}

interface ExplorerContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onOpenFile: (node: FileNode) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onRefresh: (dirPath: string) => void;
}

export function ExplorerContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onOpenFile,
  onRename,
  onDelete,
  onRefresh,
}: ExplorerContextMenuProps) {
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onPointerDown = () => onClose();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const node = menu.node;
  const isRoot = node === null;
  const isDir = isRoot || node.kind === "dir";
  const targetDir = isRoot
    ? ""
    : node.kind === "dir"
      ? node.path
      : node.path.includes("/")
        ? node.path.slice(0, node.path.lastIndexOf("/"))
        : "";
  const isManifest = node?.path === "vega-project.json";

  const clampedLeft =
    typeof window !== "undefined"
      ? Math.min(menu.x, window.innerWidth - 208)
      : menu.x;
  const clampedTop =
    typeof window !== "undefined"
      ? Math.min(menu.y, window.innerHeight - 230)
      : menu.y;

  const menuNode = (
    <div
      role="menu"
      aria-label="Explorer actions"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: `${Math.max(8, clampedLeft)}px`, top: `${Math.max(8, clampedTop)}px` }}
      className="vega-glass fixed z-[110] w-48 rounded-xl border border-[#2D2D30] p-1.5 text-xs shadow-2xl"
    >
      {node && node.kind === "file" && (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={!node.accessible}
            onClick={() => {
              onOpenFile(node);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#F4F4F5] hover:bg-[#2D2D31] disabled:opacity-40"
          >
          <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
            <span>Open in Workspace</span>
          </button>
          <div className="my-1 h-px bg-[#2C2C30]" />
        </>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNewFile(targetDir);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
      >
      <FilePlus className="h-3.5 w-3.5 text-[#7AA2FF]" />
        <span>New File...</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNewFolder(targetDir);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
      >
      <FolderPlus className="h-3.5 w-3.5 text-[#7AA2FF]" />
        <span>New Folder...</span>
      </button>

      {isDir && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onRefresh(targetDir);
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
        >
        <RefreshCw className="h-3.5 w-3.5 text-[#E4E4E7]" />
          <span>Refresh</span>
        </button>
      )}

      {!isRoot && node && (
        <>
        <div className="my-1 h-px bg-[#2C2C30]" />
          <button
            type="button"
            role="menuitem"
            disabled={isManifest}
            title={
              isManifest
                ? "Required VEGA Studio project manifest"
                : "Rename (F2)"
            }
            onClick={() => {
              onRename(node);
              onClose();
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:cursor-not-allowed disabled:opacity-40"
          >
          <span className="flex items-center gap-2">
            <Edit3 className="h-3.5 w-3.5 text-[#E4E4E7]" />
              <span>Rename</span>
            </span>
            <span className="font-mono text-[10px] text-[#A1A1AA]">F2</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={isManifest}
            title={
              isManifest
                ? "Required VEGA Studio project manifest"
                : "Delete (Del)"
            }
            onClick={() => {
              onDelete(node);
              onClose();
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-red-200 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
          <span className="flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </span>
            <span className="font-mono text-[10px] text-red-200/85">Del</span>
          </button>
        </>
      )}
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(menuNode, document.body)
    : null;
}
