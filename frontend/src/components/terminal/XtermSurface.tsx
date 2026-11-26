"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { resolveTerminalFontCss } from "@/hooks/useTerminalSettings";
import { getTerminalWsUrl } from "@/lib/api";
import {
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalSessionSummary,
  type TerminalSettings,
  type TerminalStatus,
  type TerminalWsServerEvent,
} from "@/types/terminal";

export interface XtermSurfaceHandle {
  focusTerminal: () => void;
  fitTerminal: () => void;
  copySelection: () => Promise<boolean>;
  getSelectionText: () => string;
  pasteClipboard: () => Promise<boolean>;
  clearScreen: () => void;
}

interface XtermSurfaceProps {
  sessionId: string;
  sessionStatus: TerminalStatus;
  active: boolean;
  isBackendConnected: boolean;
  terminalSettings?: TerminalSettings;
  onSessionUpdate: (session: TerminalSessionSummary) => void;
  onCwdUpdate: (sessionId: string, cwd: string) => void;
  onWsError?: (message: string) => void;
}

const VEGA_XTERM_THEME = {
  background: "#181818",
  foreground: "#F4F4F5",
  cursor: "#7AA2FF",
  cursorAccent: "#181818",
  selectionBackground: "rgba(38, 79, 120, 0.72)",
  selectionForeground: "#FFFFFF",
  black: "#1F1F22",
  red: "#F87171",
  green: "#4ADE80",
  yellow: "#FACC15",
  blue: "#60A5FA",
  magenta: "#C084FC",
  cyan: "#22D3EE",
  white: "#F4F4F5",
  brightBlack: "#8E8E98",
  brightRed: "#FCA5A5",
  brightGreen: "#86EFAC",
  brightYellow: "#FEF08A",
  brightBlue: "#93C5FD",
  brightMagenta: "#D8B4FE",
  brightCyan: "#67E8F9",
  brightWhite: "#FFFFFF",
};

export const XtermSurface = forwardRef<XtermSurfaceHandle, XtermSurfaceProps>(
  function XtermSurface(
    {
      sessionId,
      sessionStatus,
      active,
      isBackendConnected,
      terminalSettings = DEFAULT_TERMINAL_SETTINGS,
      onSessionUpdate,
      onCwdUpdate,
      onWsError,
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null
    );
    const reconnectAttemptRef = useRef<number>(0);
    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const mountedRef = useRef<boolean>(false);

    const [ready, setReady] = useState(false);

    const activeRef = useRef(active);
    const statusRef = useRef(sessionStatus);
    const backendConnectedRef = useRef(isBackendConnected);
    const terminalSettingsRef = useRef(terminalSettings);
    const onSessionUpdateRef = useRef(onSessionUpdate);
    const onCwdUpdateRef = useRef(onCwdUpdate);
    const onWsErrorRef = useRef(onWsError);
    const connectSocketRef = useRef<() => void>(() => {});

    useEffect(() => {
      activeRef.current = active;
      statusRef.current = sessionStatus;
      backendConnectedRef.current = isBackendConnected;
      terminalSettingsRef.current = terminalSettings;
      onSessionUpdateRef.current = onSessionUpdate;
      onCwdUpdateRef.current = onCwdUpdate;
      onWsErrorRef.current = onWsError;
    });

    const sendJson = useCallback((payload: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // Ignore transient write failures cleanly.
      }
    }, []);

    const performFit = useCallback(() => {
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      const host = hostRef.current;
      if (!term || !fitAddon || !host || !activeRef.current) return;
      if (host.clientWidth < 40 || host.clientHeight < 24) return;

      try {
        fitAddon.fit();
      } catch {
        return;
      }

      const cols = Math.max(20, Math.min(500, term.cols));
      const rows = Math.max(5, Math.min(200, term.rows));
      const prev = lastSentSizeRef.current;
      if (!prev || prev.cols !== cols || prev.rows !== rows) {
        lastSentSizeRef.current = { cols, rows };
        sendJson({ type: "resize", cols, rows });
      }
    }, [sendJson]);

    useImperativeHandle(
      ref,
      () => ({
        focusTerminal() {
          termRef.current?.focus();
        },
        fitTerminal() {
          performFit();
        },
        async copySelection() {
          const term = termRef.current;
          if (!term) return false;
          const text = term.getSelection();
          if (!text || typeof navigator === "undefined" || !navigator.clipboard) {
            return false;
          }
          try {
            await navigator.clipboard.writeText(text);
            term.focus();
            return true;
          } catch {
            return false;
          }
        },
        getSelectionText() {
          return termRef.current?.getSelection() ?? "";
        },
        async pasteClipboard() {
          const term = termRef.current;
          if (
            !term ||
            typeof navigator === "undefined" ||
            !navigator.clipboard
          ) {
            return false;
          }
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              term.paste(text);
            }
            term.focus();
            return true;
          } catch {
            return false;
          }
        },
        clearScreen() {
          termRef.current?.clear();
          termRef.current?.focus();
        },
      }),
      [performFit]
    );

    const clearReconnectTimer = useCallback(() => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }, []);

    const closeSocket = useCallback(() => {
      clearReconnectTimer();
      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        try {
          ws.close();
        } catch {
          // Ignore close errors cleanly.
        }
      }
    }, [clearReconnectTimer]);

    const connectSocket = useCallback(() => {
      if (
        !mountedRef.current ||
        !backendConnectedRef.current ||
        typeof WebSocket === "undefined"
      ) {
        return;
      }
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      clearReconnectTimer();
      const ws = new WebSocket(getTerminalWsUrl(sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        reconnectAttemptRef.current = 0;
        lastSentSizeRef.current = null;
        performFit();
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        onWsErrorRef.current?.(
          "Terminal WebSocket connection interrupted — attempting reconnect."
        );
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (wsRef.current !== ws) return;
        let msg: TerminalWsServerEvent;
        try {
          msg = JSON.parse(event.data) as TerminalWsServerEvent;
        } catch {
          return;
        }

        const term = termRef.current;
        if (msg.type === "snapshot") {
          onSessionUpdateRef.current(msg.session);
          if (term) {
            term.reset();
            if (msg.replay) {
              term.write(msg.replay);
            }
          }
          performFit();
        } else if (msg.type === "output") {
          if (term && msg.data) {
            term.write(msg.data);
          }
          if (msg.cwd) {
            onCwdUpdateRef.current(sessionId, msg.cwd);
          }
        } else if (msg.type === "state") {
          if (msg.reset && term) {
            term.reset();
            lastSentSizeRef.current = null;
            performFit();
          }
          onSessionUpdateRef.current(msg.session);
        } else if (msg.type === "exited") {
          onSessionUpdateRef.current(msg.session);
        } else if (msg.type === "error") {
          onWsErrorRef.current?.(msg.message);
        }
      };

      ws.onclose = (closeEvent) => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        if (
          !mountedRef.current ||
          !backendConnectedRef.current ||
          closeEvent.code === 4004 ||
          statusRef.current === "exited" ||
          statusRef.current === "closed"
        ) {
          return;
        }

        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current = Math.min(attempt + 1, 5);
        const delayMs = Math.min(800 * Math.pow(2, attempt), 10000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocketRef.current();
        }, delayMs);
      };
    }, [clearReconnectTimer, performFit, sessionId]);

    useEffect(() => {
      connectSocketRef.current = connectSocket;
    }, [connectSocket]);

    // Initialize bundled client-only xterm.js + addons once per mounted session
    useEffect(() => {
      mountedRef.current = true;
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      let dataDisposable: { dispose: () => void } | null = null;
      let termInstance: Terminal | null = null;

      void (async () => {
        try {
          const [{ Terminal: XTerm }, { FitAddon: XFit }, { WebLinksAddon: XWebLinks }] =
            await Promise.all([
              import("@xterm/xterm"),
              import("@xterm/addon-fit"),
              import("@xterm/addon-web-links"),
            ]);

          if (disposed || !hostRef.current) return;

          const cfg = terminalSettingsRef.current;
          const primaryFont =
            cfg.fontFamily === "jetbrains-mono"
              ? "JetBrains Mono"
              : cfg.fontFamily === "geist-mono"
                ? "Geist Mono"
                : null;
          try {
            if (typeof document !== "undefined" && document.fonts) {
              if (primaryFont) {
                await document.fonts.load(`400 ${cfg.fontSize}px "${primaryFont}"`);
              }
              await document.fonts.ready;
            }
          } catch {
            // Proceed cleanly with configured fallback stack if font loader throws.
          }

          if (disposed || !hostRef.current) return;

          const term = new XTerm({
            cursorBlink: cfg.cursorBlink,
            cursorStyle: cfg.cursorStyle,
            fontSize: cfg.fontSize,
            lineHeight: cfg.lineHeight,
            scrollback: 5000,
            fontFamily: resolveTerminalFontCss(cfg.fontFamily),
            theme: VEGA_XTERM_THEME,
            convertEol: true,
          });
          // xterm.js 6 fires onBell for \x07 BEL bytes; suppress the system
          // bell entirely so Windows ConPTY DA responses don't produce a sound.
          term.onBell(() => { /* no-op: bell suppressed */ });

          const fitAddon = new XFit();
          const webLinksAddon = new XWebLinks((_event, uri) => {
            if (uri.startsWith("https://") || uri.startsWith("http://")) {
              window.open(uri, "_blank", "noopener,noreferrer");
            }
          });

          term.loadAddon(fitAddon);
          term.loadAddon(webLinksAddon);
          term.open(hostRef.current);

          // Ctrl+Shift+C (or Ctrl+C when text is selected) copies; Ctrl+Shift+V pastes
          term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
            if (ev.type !== "keydown") return true;
            const mod = ev.ctrlKey || ev.metaKey;
            if (!mod) return true;
            const k = ev.key.toLowerCase();

            if (k === "c" && (ev.shiftKey || term.hasSelection())) {
              const sel = term.getSelection();
              if (sel && navigator.clipboard) {
                void navigator.clipboard.writeText(sel).catch(() => {});
              }
              return false;
            }

            if (k === "v" && ev.shiftKey && navigator.clipboard) {
              void navigator.clipboard
                .readText()
                .then((text) => {
                  if (text) term.paste(text);
                })
                .catch(() => {});
              return false;
            }

            return true;
          });

          dataDisposable = term.onData((data) => {
            if (statusRef.current !== "running") return;
            sendJson({ type: "input", data });
          });

          termInstance = term;
          termRef.current = term;
          fitAddonRef.current = fitAddon;
          setReady(true);

          resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => performFit());
          });
          resizeObserver.observe(hostRef.current);

          requestAnimationFrame(() => {
            performFit();
            if (activeRef.current) {
              term.focus();
            }
          });

          connectSocketRef.current();
        } catch (err: unknown) {
          if (!disposed) {
            onWsErrorRef.current?.(
              err instanceof Error
                ? `Failed to initialize terminal: ${err.message}`
                : "Failed to initialize terminal surface."
            );
          }
        }
      })();

      return () => {
        disposed = true;
        mountedRef.current = false;
        closeSocket();
        resizeObserver?.disconnect();
        dataDisposable?.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
        termInstance?.dispose();
      };
    }, [closeSocket, performFit, sendJson, sessionId]);

    // Sync WebSocket connection if backend state flips
    useEffect(() => {
      if (!ready) return;
      if (isBackendConnected) {
        connectSocket();
      } else {
        closeSocket();
      }
    }, [closeSocket, connectSocket, isBackendConnected, ready]);

    // Apply live typography & cursor updates without disconnecting PTY
    useEffect(() => {
      if (!ready) return;
      const term = termRef.current;
      if (!term) return;

      term.options.fontFamily = resolveTerminalFontCss(
        terminalSettings.fontFamily
      );
      term.options.fontSize = terminalSettings.fontSize;
      term.options.lineHeight = terminalSettings.lineHeight;
      term.options.cursorStyle = terminalSettings.cursorStyle;
      term.options.cursorBlink = terminalSettings.cursorBlink;

      const primaryFont =
        terminalSettings.fontFamily === "jetbrains-mono"
          ? "JetBrains Mono"
          : terminalSettings.fontFamily === "geist-mono"
            ? "Geist Mono"
            : null;
      void (async () => {
        try {
          if (primaryFont && typeof document !== "undefined" && document.fonts) {
            await document.fonts.load(
              `400 ${terminalSettings.fontSize}px "${primaryFont}"`
            );
          }
        } catch {
          // Ignore font load errors.
        }
        if (mountedRef.current) {
          requestAnimationFrame(() => performFit());
        }
      })();
    }, [
      performFit,
      ready,
      terminalSettings.cursorBlink,
      terminalSettings.cursorStyle,
      terminalSettings.fontFamily,
      terminalSettings.fontSize,
      terminalSettings.lineHeight,
    ]);

    // Refit and focus smoothly when switching between terminal tabs
    useEffect(() => {
      if (!active || !ready) return;
      const raf = requestAnimationFrame(() => {
        performFit();
        termRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }, [active, performFit, ready]);

    return (
      <div
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#181818] ${
          active ? "flex" : "hidden"
        }`}
      >
        {!ready && (
          <div className="flex flex-1 items-center justify-center gap-2 font-mono text-xs text-[#F4F4F5]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7AA2FF]" />
            <span>Initializing xterm.js surface…</span>
          </div>
        )}
        <div
          ref={hostRef}
          onClick={() => termRef.current?.focus()}
          className={`vega-xterm-host h-full w-full overflow-hidden ${
            ready ? "block" : "hidden"
          }`}
        />
      </div>
    );
  }
);
