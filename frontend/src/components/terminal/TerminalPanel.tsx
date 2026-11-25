"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  ClipboardPaste,
  Copy,
  Eraser,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import {
  XtermSurface,
  type XtermSurfaceHandle,
} from "@/components/terminal/XtermSurface";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  TerminalPtyBackend,
  TerminalSessionSummary,
  TerminalShellInfo,
} from "@/types/terminal";

interface TerminalPanelProps {
  isBackendConnected: boolean;
  activeProjectDir: string | null;
  defaultProjectsDir: string | null;
  hasElectronBrowse: boolean;
  shells: TerminalShellInfo[];
  selectedShellId: string;
  ptySupported: boolean;
  ptyBackend: TerminalPtyBackend;
  ptyMessage: string | null;
  maxSessions: number;
  sessions: TerminalSessionSummary[];
  activeSessionId: string | null;
  activeSession: TerminalSessionSummary | null;
  pendingAction: boolean;
  loading: boolean;
  error: string | null;
  onSelectShell: (shellId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onCreateInFolder: () => void;
  onCloseSession: (sessionId: string) => void;
  onRestartSession: (sessionId: string) => void;
  onClearReplay: (sessionId: string) => void;
  onRefreshState: () => void;
  onSyncSession: (session: TerminalSessionSummary) => void;
  onUpdateCwd: (sessionId: string, cwd: string) => void;
  onClearError: () => void;
}

export function TerminalPanel({
  isBackendConnected,
  activeProjectDir,
  defaultProjectsDir,
  hasElectronBrowse,
  shells,
  selectedShellId,
  ptySupported,
  ptyBackend,
  ptyMessage,
  maxSessions,
  sessions,
  activeSessionId,
  activeSession,
  pendingAction,
  loading,
  error,
  onSelectShell,
  onSelectSession,
  onCreateSession,
  onCreateInFolder,
  onCloseSession,
  onRestartSession,
  onClearReplay,
  onRefreshState,
  onSyncSession,
  onUpdateCwd,
  onClearError,
}: TerminalPanelProps) {
  const surfaceMapRef = useRef<Map<string, XtermSurfaceHandle>>(new Map());
  const [wsNotice, setWsNotice] = useState<string | null>(null);

  const atSessionLimit = sessions.length >= maxSessions;
  const canLaunch =
    isBackendConnected && ptySupported && !pendingAction && !atSessionLimit;

  const getActiveHandle = (): XtermSurfaceHandle | null => {
    if (!activeSessionId) return null;
    return surfaceMapRef.current.get(activeSessionId) ?? null;
  };

  const handleCopy = async () => {
    await getActiveHandle()?.copySelection();
  };

  const handlePaste = async () => {
    await getActiveHandle()?.pasteClipboard();
  };

  const handleClear = () => {
    if (!activeSessionId) return;
    getActiveHandle()?.clearScreen();
    onClearReplay(activeSessionId);
  };

  const displayError = error ?? wsNotice;
  const defaultCwdLabel =
    activeProjectDir ?? defaultProjectsDir ?? "User home directory";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Terminal Header: Session Tabs, Shell Picker, CWD, and Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#06070c]/60 px-3 py-1.5 select-none">
        {/* Left: Tabs + New Session Controls */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {sessions.length > 0 && (
            <div className="vega-scroll flex max-w-full items-center gap-1 overflow-x-auto">
              {sessions.map((session) => {
                const isSelected = session.session_id === activeSessionId;
                return (
                  <div
                    key={session.session_id}
                    className={`group inline-flex h-6 shrink-0 items-center gap-1.5 rounded border pr-1 pl-2 font-mono text-[10.5px] transition-colors ${
                      isSelected
                        ? "border-[#7aa2ff]/40 bg-[#7aa2ff]/14 text-[#e8ebf7]"
                        : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.07] hover:text-[#e8ebf7]/90"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.session_id)}
                      className="inline-flex items-center gap-1.5 focus:outline-none"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          session.status === "running"
                            ? "bg-emerald-400"
                            : session.status === "exited"
                            ? session.exit_code === 0
                              ? "bg-amber-300"
                              : "bg-red-400"
                            : session.status === "error"
                            ? "bg-red-400"
                            : "bg-[#7aa2ff]"
                        }`}
                      />
                      <span className="max-w-[130px] truncate">
                        {session.title}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label={`Close ${session.title}`}
                      title="Terminate session"
                      onClick={() => onCloseSession(session.session_id)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-[#e8ebf7]/45 hover:bg-white/15 hover:text-[#e8ebf7]"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Shell Picker */}
          {shells.length > 0 && (
            <select
              aria-label="Terminal shell profile"
              value={selectedShellId}
              disabled={!isBackendConnected || pendingAction}
              onChange={(e) => onSelectShell(e.target.value)}
              className="h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/85 focus:outline-none disabled:opacity-50"
            >
              {shells.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.label}
                  {sh.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}

          {/* New Terminal Button */}
          <Tooltip
            label={
              !isBackendConnected
                ? "Backend disconnected"
                : !ptySupported
                ? ptyMessage ?? "PTY unavailable"
                : atSessionLimit
                ? `Maximum of ${maxSessions} open terminal sessions reached`
                : `New terminal in ${activeProjectDir ? "project root" : "default directory"}`
            }
            side="top"
          >
            <button
              type="button"
              aria-label="New Terminal Session"
              disabled={!canLaunch}
              onClick={onCreateSession}
              className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/35 bg-[#7aa2ff]/16 px-2 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/26 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingAction ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
              ) : (
                <Plus className="h-3 w-3 text-[#7aa2ff]" />
              )}
              <span>New</span>
            </button>
          </Tooltip>

          {hasElectronBrowse && (
            <Tooltip
              label="Open new terminal in a custom folder"
              side="top"
            >
              <button
                type="button"
                aria-label="New Terminal in Folder"
                disabled={!canLaunch}
                onClick={onCreateInFolder}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderOpen className="h-3 w-3 text-[#7aa2ff]" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Right: Active Session Metadata + Context Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {activeSession && (
            <>
              <span
                title={`Working directory: ${activeSession.cwd}`}
                className="hidden max-w-[230px] items-center gap-1 truncate rounded border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-[#e8ebf7]/70 lg:inline-flex"
              >
                <Folder className="h-3 w-3 shrink-0 text-[#7aa2ff]/80" />
                <span className="truncate">{activeSession.cwd}</span>
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  activeSession.status === "running"
                    ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-300"
                    : activeSession.status === "exited"
                    ? activeSession.exit_code === 0
                      ? "border-amber-400/35 bg-amber-500/12 text-amber-200"
                      : "border-red-400/35 bg-red-500/12 text-red-200"
                    : "border-white/15 bg-white/[0.04] text-[#e8ebf7]/65"
                }`}
              >
                <span>
                  {activeSession.status === "running"
                    ? `RUNNING (${activeSession.shell_id})`
                    : activeSession.status === "exited"
                    ? `EXITED (${activeSession.exit_code ?? 0})`
                    : activeSession.status.toUpperCase()}
                </span>
              </span>

              <Tooltip label="Restart active terminal session" side="top">
                <button
                  type="button"
                  aria-label="Restart Terminal"
                  disabled={!isBackendConnected || pendingAction}
                  onClick={() => onRestartSession(activeSession.session_id)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 font-mono text-[10px] text-[#e8ebf7]/75 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
                >
                  <RotateCw className="h-3 w-3 text-[#7aa2ff]" />
                  <span className="hidden sm:inline">Restart</span>
                </button>
              </Tooltip>

              <Tooltip label="Copy selection (Ctrl+Shift+C)" side="top">
                <button
                  type="button"
                  aria-label="Copy Terminal Selection"
                  onClick={() => void handleCopy()}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </Tooltip>

              <Tooltip label="Paste clipboard (Ctrl+Shift+V)" side="top">
                <button
                  type="button"
                  aria-label="Paste into Terminal"
                  disabled={activeSession.status !== "running"}
                  onClick={() => void handlePaste()}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
                >
                  <ClipboardPaste className="h-3 w-3" />
                </button>
              </Tooltip>

              <Tooltip label="Clear terminal buffer" side="top">
                <button
                  type="button"
                  aria-label="Clear Terminal Screen"
                  onClick={handleClear}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
                >
                  <Eraser className="h-3 w-3" />
                </button>
              </Tooltip>
            </>
          )}

          <Tooltip label="Refresh shell detection & sessions" side="top">
            <button
              type="button"
              aria-label="Refresh Terminal State"
              disabled={!isBackendConnected || loading}
              onClick={onRefreshState}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/65 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin text-[#7aa2ff]" : ""}`}
              />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Capability or Error Banner */}
      {(displayError || !ptySupported) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs text-red-100">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" />
            <span className="truncate">
              {displayError ??
                ptyMessage ??
                "PTY support is unavailable on this host."}
            </span>
          </div>
          {displayError && (
            <button
              type="button"
              aria-label="Dismiss terminal error"
              onClick={() => {
                setWsNotice(null);
                onClearError();
              }}
              className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Main xterm.js Viewport or Explicit Empty Launcher */}
      {sessions.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#06070c] p-4">
          <div className="flex max-w-lg items-start gap-3.5 rounded-xl border border-white/10 bg-[#08090f] px-4 py-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
              <TerminalIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-[#e8ebf7]">
                    Interactive PTY Terminal
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] text-[#e8ebf7]/55">
                    {ptyBackend}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#e8ebf7]/55">
                  Launch a shell anchored at{" "}
                  <span className="font-mono text-[#e8ebf7]/80">
                    {defaultCwdLabel}
                  </span>
                  . Active sessions persist across bottom panel switches and WebSocket reconnects.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={!canLaunch}
                  onClick={onCreateSession}
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-[#7aa2ff]/45 bg-[#7aa2ff]/20 px-3 font-mono text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingAction ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
                  ) : (
                    <TerminalIcon className="h-3 w-3 text-[#7aa2ff]" />
                  )}
                  <span>Launch Terminal</span>
                </button>

                {hasElectronBrowse && (
                  <button
                    type="button"
                    disabled={!canLaunch}
                    onClick={onCreateInFolder}
                    className="inline-flex h-7 items-center gap-1.5 rounded border border-white/12 bg-white/[0.04] px-2.5 font-sans text-[11px] text-[#e8ebf7]/80 hover:bg-white/[0.09] disabled:opacity-40"
                  >
                    <FolderOpen className="h-3 w-3 text-[#7aa2ff]" />
                    <span>Choose Folder…</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {sessions.map((session) => (
            <XtermSurface
              key={session.session_id}
              ref={(handle) => {
                if (handle) {
                  surfaceMapRef.current.set(session.session_id, handle);
                } else {
                  surfaceMapRef.current.delete(session.session_id);
                }
              }}
              sessionId={session.session_id}
              sessionStatus={session.status}
              active={session.session_id === activeSessionId}
              isBackendConnected={isBackendConnected}
              onSessionUpdate={onSyncSession}
              onCwdUpdate={onUpdateCwd}
              onWsError={setWsNotice}
            />
          ))}
        </div>
      )}
    </div>
  );
}
