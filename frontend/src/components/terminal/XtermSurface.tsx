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
import { getTerminalWsUrl } from "@/lib/api";
import type {
  TerminalSessionSummary,
  TerminalStatus,
  TerminalWsServerEvent,
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
  onSessionUpdate: (session: TerminalSessionSummary) => void;
  onCwdUpdate: (sessionId: string, cwd: string) => void;
  onWsError?: (message: string) => void;
}

const VEGA_XTERM_THEME = {
  background: "#06070c",
  foreground: "#e8ebf7",
  cursor: "#7aa2ff",
  cursorAccent: "#06070c",
  selectionBackground: "rgba(122, 162, 255, 0.28)",
  selectionForeground: "#ffffff",
  black: "#151821",
  red: "#f87171",
  green: "#6ee7b7",
  yellow: "#fcd34d",
  blue: "#7aa2ff",
  magenta: "#c084fc",
  cyan: "#67e8f9",
  white: "#e8ebf7",
  brightBlack: "#5c647d",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#ffffff",
};

export const XtermSurface = forwardRef<XtermSurfaceHandle, XtermSurfaceProps>(
  function XtermSurface(
    {
      sessionId,
      sessionStatus,
      active,
      isBackendConnected,
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
    const onSessionUpdateRef = useRef(onSessionUpdate);
    const onCwdUpdateRef = useRef(onCwdUpdate);
    const onWsErrorRef = useRef(onWsError);
    const connectSocketRef = useRef<() => void>(() => {});

    useEffect(() => {
      activeRef.current = active;
      statusRef.current = sessionStatus;
      backendConnectedRef.current = isBackendConnected;
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
        const [{ Terminal: XTerm }, { FitAddon: XFit }, { WebLinksAddon: XWebLinks }] =
          await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-web-links"),
          ]);

        if (disposed || !hostRef.current) return;

        const term = new XTerm({
          cursorBlink: true,
          fontSize: 12.5,
          lineHeight: 1.25,
          scrollback: 5000,
          fontFamily:
            'var(--font-mono), "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          theme: VEGA_XTERM_THEME,
          convertEol: false,
        });

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
              return false;
            }
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
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#06070c] ${
          active ? "flex" : "hidden"
        }`}
      >
        {!ready && (
          <div className="flex flex-1 items-center justify-center gap-2 font-mono text-xs text-[#e8ebf7]/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
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
