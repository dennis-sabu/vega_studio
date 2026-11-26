"use client";

import { useEffect, useState, type FormEvent } from"react";
import {
  AlertCircle,
  Clock,
  FolderOpen,
  Loader2,
  Trash2,
  X,
} from"lucide-react";
import type { DirectoryPickerOutcome } from"@/hooks/useWorkspace";
import type { RecentProjectEntry } from"@/types/project";

interface OpenProjectDialogProps {
  open: boolean;
  recentProjects: RecentProjectEntry[];
  defaultProjectsDir: string;
  isBackendConnected: boolean;
  isElectronBridge: boolean;
  pending: boolean;
  serverError: string | null;
  onClose: () => void;
  onBrowseProject: (defaultPath?: string) => Promise<DirectoryPickerOutcome>;
  onOpenProject: (projectDir: string) => Promise<void>;
  onForgetRecent: (projectDir: string) => Promise<void>;
}

export function OpenProjectDialog({
  open,
  recentProjects,
  defaultProjectsDir,
  isBackendConnected,
  isElectronBridge,
  pending,
  serverError,
  onClose,
  onBrowseProject,
  onOpenProject,
  onForgetRecent,
}: OpenProjectDialogProps) {
  const [manualPath, setManualPath] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    queueMicrotask(() => setLocalError(null));
    return () => {
      queueMicrotask(() => {
        if (prev && prev.isConnected) prev.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  const tryOpenPath = async (dirPath: string) => {
    setLocalError(null);
    const cleaned = dirPath.trim();
    if (!cleaned) {
      setLocalError("Please enter or select a VEGA project directory.");
      return;
    }
    if (!isBackendConnected) {
      setLocalError(
        "FastAPI backend is offline. Start the backend before opening a project."
      );
      return;
    }
    try {
      await onOpenProject(cleaned);
      setManualPath("");
      onClose();
    } catch {
      // Server error is displayed via serverError prop.
    }
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    setLocalError(null);
    try {
      const outcome = await onBrowseProject(defaultProjectsDir);
      if (!outcome.supported) {
        setLocalError(
          "Native folder picker requires Electron desktop mode. Enter the project folder path below."
        );
      } else if (!outcome.canceled && outcome.path) {
        setManualPath(outcome.path);
        await tryOpenPath(outcome.path);
      }
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to open folder picker."
      );
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void tryOpenPath(manualPath);
  };

  const displayedError = localError ?? serverError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-project-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
    >
      <div
        className="vega-glass flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#2D2D30] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#2D2D30] bg-[#252527] text-[#7AA2FF]">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="open-project-title"
                className="text-sm font-medium text-[#F4F4F5]"
              >
                Open VEGA Project
              </h2>
              <p className="text-[11px] text-[#B4B4BC]">
                Select a directory containing a valid vega-project.json file
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={pending}
            aria-label="Close Open Project dialog"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-40"
          >
          <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="vega-scroll space-y-4 overflow-y-auto p-5">
          {!isBackendConnected && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Backend service is disconnected. Start the backend to validate
                and open project folders.
              </span>
            </div>
          )}

          {displayedError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/12 p-3 text-xs text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{displayedError}</span>
            </div>
          )}

          {/* Path Picker Form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <label
              htmlFor="vega-open-project-path"
              className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-[#E4E4E7] uppercase"
            >
              Project Folder Path
            </label>
            <div className="flex gap-2">
              <input
                id="vega-open-project-path"
                type="text"
                autoFocus
                value={manualPath}
                onChange={(e) => {
                  setLocalError(null);
                  setManualPath(e.target.value);
                }}
                placeholder="Select or paste project directory path..."
                className="h-10 min-w-0 flex-1 rounded-xl border border-[#2D2D30] bg-[#181818] px-3 font-mono text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/50 focus:outline-none focus:ring-2 focus:ring-[#7AA2FF]/20"
              />
              <button
                type="button"
                disabled={browsing || pending}
                onClick={() => void handleBrowse()}
                title={
                  isElectronBridge
                    ? "Browse for a VEGA Studio project folder"
                    : "Native dialog available in Electron desktop mode"
                }
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[#2D2D30] bg-[#252527] px-3.5 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-50"
              >
              <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                <span>{browsing ? "Opening..." : "Browse..."}</span>
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={pending || !isBackendConnected || !manualPath.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#e8ebf7] px-4 text-xs font-semibold text-[#0D0D0F] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{pending ? "Opening..." : "Open Project"}</span>
              </button>
            </div>
          </form>

          {/* Recent Projects */}
          <div className="space-y-2 border-t border-[#2D2D30] pt-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#B4B4BC] uppercase">
                <Clock className="h-3 w-3" />
                <span>Recent Projects</span>
              </span>
              <span className="font-mono text-[10px] text-[#A1A1AA]">
                {recentProjects.length} saved
              </span>
            </div>

            {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-[#2D2D30] bg-[#181818] px-4 py-4 text-center text-xs text-[#B4B4BC]">
                No recent VEGA projects yet. Create a new project or browse to an
                existing folder.
              </div>
            ) : (
            <ul className="space-y-1.5">
                {recentProjects.map((item) => (
                  <li
                    key={item.project_dir}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#2D2D30] bg-[#181818] px-3 py-2.5"
                  >
                    <button
                      type="button"
                      disabled={pending || !isBackendConnected || !item.exists}
                      onClick={() => void tryOpenPath(item.project_dir)}
                      className="min-w-0 flex-1 text-left transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-[#F4F4F5]">
                          {item.name}
                        </span>
                        <span className="rounded border border-[#2D2D30] bg-[#252527] px-1.5 py-0.5 font-mono text-[9px] text-[#B4B4BC]">
                          {item.board}
                        </span>
                        {!item.exists && (
                        <span className="rounded border border-red-400/30 bg-red-500/15 px-1.5 py-0.5 font-mono text-[9px] text-red-300">
                            Missing
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[#B4B4BC]">
                        {item.project_dir}
                      </p>
                    </button>

                    <button
                      type="button"
                      aria-label={`Remove ${item.name} from recent projects`}
                      title="Remove from recent projects"
                      onClick={() => void onForgetRecent(item.project_dir)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#A1A1AA] transition-colors hover:bg-[#252527] hover:text-red-300"
                    >
                    <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end border-t border-[#2D2D30] bg-[#181818] px-5 py-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-full border border-[#2D2D30] bg-[#252527] px-4 text-xs font-medium text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-45"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
