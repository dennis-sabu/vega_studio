"use client";

import { useEffect, useRef, useState } from"react";
import { createPortal } from"react-dom";
import {
  AlertCircle,
  ClipboardPaste,
  Copy,
  Eraser,
  Folder,
  FolderOpen,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from"lucide-react";
import {
  XtermSurface,
  type XtermSurfaceHandle,
} from"@/components/terminal/XtermSurface";
import { Tooltip } from"@/components/ui/Tooltip";
import {
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalPtyBackend,
  type TerminalSessionSummary,
  type TerminalSettings,
  type TerminalShellInfo,
} from"@/types/terminal";

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
  initialLoaded?: boolean;
  error: string | null;
  terminalSettings?: TerminalSettings;
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
  onAnalyzeSelectionInAi?: (selectedText: string, sessionLabel: string) => void;
  onOpenTerminalSettings?: () => void;
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
  initialLoaded = true,
  error,
  terminalSettings = DEFAULT_TERMINAL_SETTINGS,
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
  onAnalyzeSelectionInAi,
  onOpenTerminalSettings,
}: TerminalPanelProps) {
  const surfaceMapRef = useRef<Map<string, XtermSurfaceHandle>>(new Map());
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowDropdownRef = useRef<HTMLDivElement | null>(null);
  const [wsNotice, setWsNotice] = useState<string | null>(null);
  const [overflowCoords, setOverflowCoords] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  useEffect(() => {
    if (!overflowCoords) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        !overflowMenuRef.current?.contains(target) &&
        !overflowDropdownRef.current?.contains(target)
      ) {
        setOverflowCoords(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowCoords(null);
    };
    const handleResize = () => setOverflowCoords(null);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [overflowCoords]);

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
  const selectedShellLabel =
    shells.find((s) => s.id === selectedShellId)?.label ?? "Default shell";
  const isStartingAutoShell =
    sessions.length === 0 &&
    (pendingAction ||
      (isBackendConnected &&
        ptySupported &&
        terminalSettings.autoLaunch &&
        !initialLoaded &&
        !displayError));

  return (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#181818]">
      {/* Compact Terminal Header: Session Tabs, Shell Picker & Primary Actions */}
      <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-[#2D2D30] bg-[#181818] px-2.5 py-1 select-none">
        {/* Left: Sessions + Shell Profile + New */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {sessions.length > 0 && (
          <div className="vega-no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
              {sessions.map((session) => {
                const isSelected = session.session_id === activeSessionId;
                return (
                  <div
                    key={session.session_id}
                    className={`group inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[5px] border pr-1 pl-2 font-mono text-[10.5px] transition-colors ${
                      isSelected
                        ? "border-[#7AA2FF]/35 bg-[#7AA2FF]/12 text-[#F4F4F5]"
                        : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
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
                                : "bg-[#7AA2FF]"
                        }`}
                      />
                      <span className="max-w-[125px] truncate">
                        {session.title}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label={`Close ${session.title}`}
                      title="Terminate session"
                      onClick={() => onCloseSession(session.session_id)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[#B4B4BC] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
                    >
                    <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {shells.length > 0 && (
            <select
              aria-label="Terminal shell profile"
              value={selectedShellId}
              disabled={!isBackendConnected || pendingAction}
              onChange={(e) => onSelectShell(e.target.value)}
              className="h-6 shrink-0 rounded-[5px] border border-[#2D2D30] bg-[#181818] px-1.5 font-mono text-[10.5px] text-[#F4F4F5] focus:border-[#7AA2FF]/45 focus:outline-none disabled:opacity-50"
            >
              {shells.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.label}
                  {sh.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}

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
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-2 font-mono text-[10.5px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/24 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingAction ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#7AA2FF]" />
              ) : (
              <Plus className="h-3 w-3 text-[#7AA2FF]" />
              )}
              <span>New</span>
            </button>
          </Tooltip>
        </div>

        {/* Right: Active CWD, Status, Primary Controls & Overflow Menu */}
        <div className="flex shrink-0 items-center gap-1">
          {activeSession && (
            <>
              <span
                title={`Working directory: ${activeSession.cwd}`}
                className="hidden max-w-[210px] items-center gap-1 truncate rounded-[4px] border border-[#2D2D30] bg-[#141414] px-2 py-0.5 font-mono text-[10px] text-[#E4E4E7] lg:inline-flex"
              >
              <Folder className="h-3 w-3 shrink-0 text-[#7AA2FF]" />
              <span className="truncate">{activeSession.cwd}</span>
              </span>

              <span
                className={`inline-flex h-6 items-center gap-1.5 rounded-[4px] border px-2 font-mono text-[10px] font-medium ${
                  activeSession.status === "running"
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
                    : activeSession.status === "exited"
                      ? activeSession.exit_code === 0
                        ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                        : "border-red-400/25 bg-red-500/10 text-red-200"
                      : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7]"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    activeSession.status === "running"
                      ? "bg-emerald-400"
                      : activeSession.status === "exited"
                        ? "bg-amber-300"
                        : "bg-red-400"
                  }`}
                />
                <span>
                  {activeSession.status === "running"
                    ? activeSession.shell_id
                    : activeSession.status === "exited"
                      ? `exited (${activeSession.exit_code ?? 0})`
                      : activeSession.status}
                </span>
              </span>

              <Tooltip label="Restart active terminal session" side="top">
                <button
                  type="button"
                  aria-label="Restart Terminal"
                  disabled={!isBackendConnected || pendingAction}
                  onClick={() => onRestartSession(activeSession.session_id)}
                  className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-[#2D2D30] bg-[#252527] px-2 font-mono text-[10px] text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
                >
                <RotateCw className="h-3 w-3 text-[#7AA2FF]" />
                <span className="hidden sm:inline">Restart</span>
                </button>
              </Tooltip>

              <Tooltip label="Clear terminal buffer" side="top">
                <button
                  type="button"
                  aria-label="Clear Terminal Screen"
                  onClick={handleClear}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5]"
                >
                <Eraser className="h-3 w-3" />
                </button>
              </Tooltip>
            </>
          )}

          {/* Overflow Menu for secondary terminal actions */}
          <div ref={overflowMenuRef} className="relative">
            <Tooltip label="Terminal actions & settings" side="top">
              <button
                type="button"
                aria-label="Terminal Actions Menu"
                aria-expanded={Boolean(overflowCoords)}
                onClick={(e) => {
                  if (overflowCoords) {
                    setOverflowCoords(null);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const menuW = 208;
                  const left = Math.max(
                    8,
                    Math.min(rect.right - menuW, window.innerWidth - menuW - 8)
                  );
                  const bottom = Math.max(8, window.innerHeight - rect.top + 6);
                  setOverflowCoords({ left, bottom });
                }}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-[5px] border transition-colors ${
                  overflowCoords
                    ? "border-[#7AA2FF]/35 bg-[#7AA2FF]/14 text-[#F4F4F5]"
                    : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                }`}
              >
              <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            {overflowCoords &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={overflowDropdownRef}
                  role="menu"
                  aria-label="Terminal actions"
                  style={{
                    left: `${overflowCoords.left}px`,
                    bottom: `${overflowCoords.bottom}px`,
                  }}
                  className="vega-tweaks-glass fixed z-[110] w-52 rounded-[10px] border border-[#2D2D30] p-1 shadow-2xl"
                >
                  {activeSession && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOverflowCoords(null);
                          void handleCopy();
                        }}
                        className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
                      >
                      <Copy className="h-3.5 w-3.5 text-[#7AA2FF]" />
                        <span>Copy Selection</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        disabled={activeSession.status !== "running"}
                        onClick={() => {
                          setOverflowCoords(null);
                          void handlePaste();
                        }}
                        className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
                      >
                      <ClipboardPaste className="h-3.5 w-3.5 text-[#7AA2FF]" />
                        <span>Paste Clipboard</span>
                      </button>

                      {onAnalyzeSelectionInAi && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOverflowCoords(null);
                            const sel =
                              getActiveHandle()?.getSelectionText().trim() ?? "";
                            if (!sel) {
                              setWsNotice(
                                "Select terminal text first before analyzing in VEGA Assistant."
                              );
                              return;
                            }
                            setWsNotice(null);
                            onAnalyzeSelectionInAi(
                              sel.slice(0, 6000),
                              `${activeSession.shell_id} (${activeSession.title})`
                            );
                          }}
                          className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
                        >
                        <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
                          <span>Analyze Selection in AI</span>
                        </button>
                      )}

                      <div className="my-1 h-px bg-[#2C2C30]" />
                    </>
                  )}

                  {hasElectronBrowse && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canLaunch}
                      onClick={() => {
                        setOverflowCoords(null);
                        onCreateInFolder();
                      }}
                      className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
                    >
                    <FolderOpen className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>New Session in Folder…</span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    disabled={!isBackendConnected || loading}
                    onClick={() => {
                      setOverflowCoords(null);
                      onRefreshState();
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5] disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 text-[#7AA2FF] ${
                        loading ? "animate-spin" : ""
                      }`}
                    />
                    <span>Refresh Shells</span>
                  </button>

                  {onOpenTerminalSettings && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOverflowCoords(null);
                        onOpenTerminalSettings();
                      }}
                      className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[11.5px] text-[#F4F4F5] hover:bg-[#252527] hover:text-[#F4F4F5]"
                    >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[#7AA2FF]" />
                      <span>Terminal Font &amp; Settings…</span>
                    </button>
                  )}
                </div>,
                document.body
              )}
          </div>
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
          <div className="flex shrink-0 items-center gap-1.5">
            {isBackendConnected && ptySupported && sessions.length === 0 && (
              <button
                type="button"
                disabled={!canLaunch}
                onClick={onCreateSession}
                className="inline-flex h-5 items-center rounded-[4px] border border-[#2D2D30] bg-[#252527] px-2 text-[10.5px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
              >
                Retry Launch
              </button>
            )}
            {displayError && (
              <button
                type="button"
                aria-label="Dismiss terminal error"
                onClick={() => {
                  setWsNotice(null);
                  onClearError();
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] hover:bg-[#2D2D31]"
              >
              <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Direct Interactive Terminal Viewport */}
      {sessions.length === 0 ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#181818] px-4 text-center">
          {isStartingAutoShell ? (
          <div className="flex items-center gap-2 font-mono text-[12px] text-[#F4F4F5]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
              <span>
                Starting {selectedShellLabel} in{""}
                <span className="text-[#F4F4F5]">{defaultCwdLabel}</span>…
              </span>
            </div>
          ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="font-mono text-[11.5px] text-[#E4E4E7]">
                {!isBackendConnected
                  ? "Backend disconnected — reconnect engine to start shell."
                  : !ptySupported
                    ? `PTY backend (${ptyBackend}) unavailable.`
                    : `No active shell (${defaultCwdLabel})`}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canLaunch}
                  onClick={onCreateSession}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-2.5 font-mono text-[11px] font-medium text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/24 disabled:cursor-not-allowed disabled:opacity-40"
                >
                <TerminalIcon className="h-3 w-3 text-[#7AA2FF]" />
                  <span>Start {selectedShellLabel}</span>
                </button>

                {hasElectronBrowse && (
                  <button
                    type="button"
                    disabled={!canLaunch}
                    onClick={onCreateInFolder}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#2D2D30] bg-[#252527] px-2.5 text-[11px] text-[#F4F4F5] transition-colors hover:bg-[#252527] disabled:opacity-40"
                  >
                  <FolderOpen className="h-3 w-3 text-[#7AA2FF]" />
                    <span>Choose Folder…</span>
                  </button>
                )}
              </div>
            </div>
          )}
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
              terminalSettings={terminalSettings}
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
