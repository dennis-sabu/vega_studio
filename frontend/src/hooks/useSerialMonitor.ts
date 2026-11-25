"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSerialOutput,
  connectSerial,
  disconnectSerial,
  fetchSerialDevices,
  fetchSerialState,
  getSerialWsUrl,
  sendSerialData,
} from "@/lib/api";
import {
  VALID_BAUD_RATES,
  type LineEnding,
  type SerialDataBits,
  type SerialLogLine,
  type SerialParity,
  type SerialStateResponse,
  type SerialStatus,
  type SerialStopBits,
  type SerialWsEvent,
} from "@/types/serial";
import type { DeviceListResponse } from "@/types/upload";

const MAX_CLIENT_SERIAL_LOGS = 5000;
const MAX_TX_HISTORY = 50;
const PREFS_STORAGE_KEY = "vega-studio:serial-monitor-prefs:v1";

interface SerialPrefs {
  baudRate: number;
  dataBits: SerialDataBits;
  parity: SerialParity;
  stopBits: SerialStopBits;
  lineEnding: LineEnding;
  showTimestamps: boolean;
  autoScroll: boolean;
}

const DEFAULT_PREFS: SerialPrefs = {
  baudRate: 115200,
  dataBits: 8,
  parity: "N",
  stopBits: "1",
  lineEnding: "lf",
  showTimestamps: true,
  autoScroll: true,
};

function sanitizePrefs(raw: Partial<SerialPrefs>): SerialPrefs {
  const baudRate =
    typeof raw.baudRate === "number" &&
    (VALID_BAUD_RATES as readonly number[]).includes(raw.baudRate)
      ? raw.baudRate
      : DEFAULT_PREFS.baudRate;

  const dataBits =
    raw.dataBits === 5 ||
    raw.dataBits === 6 ||
    raw.dataBits === 7 ||
    raw.dataBits === 8
      ? raw.dataBits
      : DEFAULT_PREFS.dataBits;

  const parity =
    raw.parity === "N" ||
    raw.parity === "E" ||
    raw.parity === "O" ||
    raw.parity === "M" ||
    raw.parity === "S"
      ? raw.parity
      : DEFAULT_PREFS.parity;

  const stopBits =
    raw.stopBits === "1" || raw.stopBits === "1.5" || raw.stopBits === "2"
      ? raw.stopBits
      : DEFAULT_PREFS.stopBits;

  const lineEnding =
    raw.lineEnding === "none" ||
    raw.lineEnding === "lf" ||
    raw.lineEnding === "cr" ||
    raw.lineEnding === "crlf"
      ? raw.lineEnding
      : DEFAULT_PREFS.lineEnding;

  const showTimestamps =
    typeof raw.showTimestamps === "boolean"
      ? raw.showTimestamps
      : DEFAULT_PREFS.showTimestamps;

  const autoScroll =
    typeof raw.autoScroll === "boolean"
      ? raw.autoScroll
      : DEFAULT_PREFS.autoScroll;

  return {
    baudRate,
    dataBits,
    parity,
    stopBits,
    lineEnding,
    showTimestamps,
    autoScroll,
  };
}

interface UseSerialMonitorOptions {
  isBackendConnected: boolean;
  defaultPortHint?: string;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useSerialMonitor({
  isBackendConnected,
  defaultPortHint,
  onLog,
}: UseSerialMonitorOptions) {
  const [status, setStatus] = useState<SerialStatus>("disconnected");
  const [pyserialAvailable, setPyserialAvailable] = useState<boolean>(true);
  const [deviceInfo, setDeviceInfo] = useState<DeviceListResponse | null>(null);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [activePort, setActivePort] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<SerialPrefs>(DEFAULT_PREFS);
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  const [sendText, setSendText] = useState<string>("");
  const [txHistory, setTxHistory] = useState<string[]>([]);
  const [logs, setLogs] = useState<SerialLogLine[]>([]);
  const [truncatedLogs, setTruncatedLogs] = useState<boolean>(false);
  const [rxCount, setRxCount] = useState<number>(0);
  const [txCount, setTxCount] = useState<number>(0);

  const [refreshingDevices, setRefreshingDevices] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const shouldConnectWsRef = useRef<boolean>(false);
  const onLogRef = useRef(onLog);
  const selectedPortRef = useRef(selectedPort);
  const prefsRef = useRef(prefs);
  const attachWebSocketRef = useRef<() => void>(() => {});

  useEffect(() => {
    onLogRef.current = onLog;
    selectedPortRef.current = selectedPort;
    prefsRef.current = prefs;
    shouldConnectWsRef.current = isBackendConnected;
  });

  // Hydrate persisted user serial preferences safely after mount
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SerialPrefs>;
          setPrefs(sanitizePrefs(parsed));
        }
      } catch {
        // Ignore storage errors cleanly.
      }
      setPrefsHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage quota errors cleanly.
    }
  }, [prefs, prefsHydrated]);

  // Sync default port hint only if the user has not chosen a port yet
  useEffect(() => {
    if (!defaultPortHint || selectedPortRef.current.trim()) return;
    queueMicrotask(() => {
      if (!selectedPortRef.current.trim() && defaultPortHint) {
        setSelectedPort(defaultPortHint);
      }
    });
  }, [defaultPortHint]);

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

  const applyServerState = useCallback((state: SerialStateResponse) => {
    setStatus(state.status);
    setPyserialAvailable(state.pyserial_available);
    setActivePort(state.port);
    setRxCount(state.rx_count);
    setTxCount(state.tx_count);
    setTruncatedLogs(state.truncated_logs);
    setError(state.error_message);
    if (state.config?.port) {
      setSelectedPort(state.config.port);
      setPrefs((prev) => ({
        ...prev,
        baudRate: state.config!.baud_rate,
        dataBits: state.config!.data_bits,
        parity: state.config!.parity,
        stopBits: state.config!.stop_bits,
      }));
    }
    if (Array.isArray(state.logs) && state.logs.length > 0) {
      setLogs(state.logs.slice(-MAX_CLIENT_SERIAL_LOGS));
    } else if (state.log_line_count === 0) {
      setLogs([]);
    }
  }, []);

  const attachWebSocket = useCallback(() => {
    if (!shouldConnectWsRef.current || typeof WebSocket === "undefined") return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearReconnectTimer();
    const ws = new WebSocket(getSerialWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (wsRef.current !== ws) return;
      let msg: SerialWsEvent;
      try {
        msg = JSON.parse(event.data) as SerialWsEvent;
      } catch {
        return;
      }

      if (msg.type === "snapshot") {
        setStatus(msg.state.status);
        setPyserialAvailable(msg.state.pyserial_available);
        setActivePort(msg.state.port);
        setRxCount(msg.state.rx_count);
        setTxCount(msg.state.tx_count);
        setTruncatedLogs(msg.state.truncated_logs);
        setError(msg.state.error_message);
        if (msg.state.config?.port) {
          setSelectedPort(msg.state.config.port);
          setPrefs((prev) => ({
            ...prev,
            baudRate: msg.state.config!.baud_rate,
            dataBits: msg.state.config!.data_bits,
            parity: msg.state.config!.parity,
            stopBits: msg.state.config!.stop_bits,
          }));
        }
        setLogs(msg.logs.slice(-MAX_CLIENT_SERIAL_LOGS));
      } else if (msg.type === "log") {
        if (typeof msg.rx_count === "number") setRxCount(msg.rx_count);
        if (typeof msg.tx_count === "number") setTxCount(msg.tx_count);
        setLogs((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].seq >= msg.line.seq) {
            return prev;
          }
          const next = [...prev, msg.line];
          if (next.length > MAX_CLIENT_SERIAL_LOGS) {
            setTruncatedLogs(true);
            return next.slice(-MAX_CLIENT_SERIAL_LOGS);
          }
          return next;
        });
      } else if (msg.type === "status") {
        setStatus(msg.status);
        setError(msg.error_message);
        if (msg.port !== undefined) {
          setActivePort(msg.port);
        }
        if (msg.config?.port) {
          setSelectedPort(msg.config.port);
        }
      } else if (msg.type === "cleared") {
        setLogs([]);
        setTruncatedLogs(false);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!shouldConnectWsRef.current) return;

      const attempt = reconnectAttemptRef.current;
      reconnectAttemptRef.current = Math.min(attempt + 1, 5);
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 15000);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (shouldConnectWsRef.current) {
          attachWebSocketRef.current();
        }
      }, delayMs);
    };

    ws.onerror = () => {
      // Refresh state on transient socket errors without disrupting backend session
      if (!shouldConnectWsRef.current) return;
      void fetchSerialState()
        .then(applyServerState)
        .catch(() => {});
    };
  }, [applyServerState, clearReconnectTimer]);

  const refreshDevices = useCallback(
    async (signal?: AbortSignal) => {
      if (!isBackendConnected) return;
      setRefreshingDevices(true);
      try {
        const res = await fetchSerialDevices(signal);
        if (signal?.aborted) return;
        setDeviceInfo(res);
        if (!selectedPortRef.current.trim() && res.devices.length === 1) {
          setSelectedPort(res.devices[0].port);
        }
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
      } finally {
        if (!signal?.aborted) {
          setRefreshingDevices(false);
        }
      }
    },
    [isBackendConnected]
  );

  // Sync serial state, devices, and WS subscription when backend connects/disconnects
  useEffect(() => {
    if (!isBackendConnected) {
      closeSocket();
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      attachWebSocket();
      void Promise.all([
        fetchSerialState(controller.signal),
        fetchSerialDevices(controller.signal),
      ])
        .then(([state, dev]) => {
          if (controller.signal.aborted) return;
          applyServerState(state);
          setDeviceInfo(dev);
          if (!selectedPortRef.current.trim() && dev.devices.length === 1) {
            setSelectedPort(dev.devices[0].port);
          }
        })
        .catch(() => {});
    });

    return () => {
      controller.abort();
      closeSocket();
    };
  }, [applyServerState, attachWebSocket, closeSocket, isBackendConnected]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!isBackendConnected) {
      setError("FastAPI backend is disconnected.");
      return false;
    }
    const targetPort = selectedPortRef.current.trim();
    if (!targetPort) {
      setError("Select or enter a serial port (e.g. /dev/ttyUSB0 or COM3).");
      return false;
    }

    setConnecting(true);
    setError(null);
    const currentPrefs = prefsRef.current;

    try {
      const state = await connectSerial({
        port: targetPort,
        baud_rate: currentPrefs.baudRate,
        data_bits: currentPrefs.dataBits,
        parity: currentPrefs.parity,
        stop_bits: currentPrefs.stopBits,
      });
      applyServerState(state);
      attachWebSocket();
      onLogRef.current?.(
        "info",
        `Serial monitor connected to ${targetPort} at ${currentPrefs.baudRate} baud.`
      );
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to open serial port connection.";
      setError(message);
      onLogRef.current?.("error", `Serial connect failed: ${message}`);
      void fetchSerialState()
        .then(applyServerState)
        .catch(() => {});
      return false;
    } finally {
      setConnecting(false);
    }
  }, [applyServerState, attachWebSocket, isBackendConnected]);

  const disconnect = useCallback(async (): Promise<boolean> => {
    if (!isBackendConnected) return false;
    setDisconnecting(true);
    setError(null);
    try {
      const state = await disconnectSerial();
      applyServerState(state);
      onLogRef.current?.("info", "Serial monitor disconnected.");
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to disconnect serial port.";
      setError(message);
      return false;
    } finally {
      setDisconnecting(false);
    }
  }, [applyServerState, isBackendConnected]);

  const send = useCallback(
    async (explicitText?: string): Promise<boolean> => {
      if (!isBackendConnected) {
        setError("FastAPI backend is disconnected.");
        return false;
      }
      if (status !== "connected") {
        setError("Connect to a serial port before sending data.");
        return false;
      }

      const payloadText = explicitText !== undefined ? explicitText : sendText;
      const ending = prefsRef.current.lineEnding;
      if (payloadText.length === 0 && ending === "none") {
        setError("Enter text or select a line ending to transmit.");
        return false;
      }

      setSending(true);
      setError(null);
      try {
        const state = await sendSerialData({
          data: payloadText,
          line_ending: ending,
        });
        setTxCount(state.tx_count);
        setRxCount(state.rx_count);
        if (explicitText === undefined) {
          setSendText("");
        }
        if (payloadText.length > 0) {
          setTxHistory((prev) => {
            const filtered = prev.filter((item) => item !== payloadText);
            return [payloadText, ...filtered].slice(0, MAX_TX_HISTORY);
          });
        }
        return true;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to transmit data over serial port.";
        setError(message);
        void fetchSerialState()
          .then(applyServerState)
          .catch(() => {});
        return false;
      } finally {
        setSending(false);
      }
    },
    [applyServerState, isBackendConnected, sendText, status]
  );

  const clearOutput = useCallback(async () => {
    if (!isBackendConnected) {
      setLogs([]);
      setTruncatedLogs(false);
      return;
    }
    try {
      const state = await clearSerialOutput();
      setLogs(state.logs);
      setTruncatedLogs(state.truncated_logs);
    } catch {
      setLogs([]);
      setTruncatedLogs(false);
    }
  }, [isBackendConnected]);

  const updatePort = useCallback((port: string) => {
    setSelectedPort(port);
    setError(null);
  }, []);

  const updateBaudRate = useCallback((baudRate: number) => {
    setPrefs((prev) => ({ ...prev, baudRate }));
  }, []);

  const updateDataBits = useCallback((dataBits: SerialDataBits) => {
    setPrefs((prev) => ({ ...prev, dataBits }));
  }, []);

  const updateParity = useCallback((parity: SerialParity) => {
    setPrefs((prev) => ({ ...prev, parity }));
  }, []);

  const updateStopBits = useCallback((stopBits: SerialStopBits) => {
    setPrefs((prev) => ({ ...prev, stopBits }));
  }, []);

  const updateLineEnding = useCallback((lineEnding: LineEnding) => {
    setPrefs((prev) => ({ ...prev, lineEnding }));
  }, []);

  const toggleTimestamps = useCallback(() => {
    setPrefs((prev) => ({ ...prev, showTimestamps: !prev.showTimestamps }));
  }, []);

  const setAutoScroll = useCallback((autoScroll: boolean) => {
    setPrefs((prev) => ({ ...prev, autoScroll }));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    attachWebSocketRef.current = attachWebSocket;
  }, [attachWebSocket]);

  return {
    status,
    pyserialAvailable,
    deviceInfo,
    devices: deviceInfo?.devices ?? [],
    selectedPort,
    activePort,
    baudRate: prefs.baudRate,
    dataBits: prefs.dataBits,
    parity: prefs.parity,
    stopBits: prefs.stopBits,
    lineEnding: prefs.lineEnding,
    showTimestamps: prefs.showTimestamps,
    autoScroll: prefs.autoScroll,
    sendText,
    txHistory,
    logs,
    truncatedLogs,
    rxCount,
    txCount,
    refreshingDevices,
    connecting,
    disconnecting,
    sending,
    error,
    isConnected: status === "connected",
    updatePort,
    updateBaudRate,
    updateDataBits,
    updateParity,
    updateStopBits,
    updateLineEnding,
    toggleTimestamps,
    setAutoScroll,
    setSendText,
    refreshDevices,
    connect,
    disconnect,
    send,
    clearOutput,
    clearError,
  };
}
