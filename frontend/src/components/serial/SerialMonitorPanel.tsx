"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Clock,
  CornerDownLeft,
  Loader2,
  Plug,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Trash2,
  Unplug,
  Usb,
  X,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  VALID_BAUD_RATES,
  type LineEnding,
  type SerialDataBits,
  type SerialLogLine,
  type SerialParity,
  type SerialStatus,
  type SerialStopBits,
} from "@/types/serial";
import type { DeviceListResponse, SerialDeviceInfo } from "@/types/upload";

interface SerialMonitorPanelProps {
  isBackendConnected: boolean;
  status: SerialStatus;
  pyserialAvailable: boolean;
  deviceInfo: DeviceListResponse | null;
  devices: SerialDeviceInfo[];
  selectedPort: string;
  activePort: string | null;
  baudRate: number;
  dataBits: SerialDataBits;
  parity: SerialParity;
  stopBits: SerialStopBits;
  lineEnding: LineEnding;
  showTimestamps: boolean;
  autoScroll: boolean;
  sendText: string;
  txHistory: string[];
  logs: SerialLogLine[];
  truncatedLogs: boolean;
  rxCount: number;
  txCount: number;
  refreshingDevices: boolean;
  connecting: boolean;
  disconnecting: boolean;
  sending: boolean;
  error: string | null;
  onSelectPort: (port: string) => void;
  onChangeBaudRate: (baud: number) => void;
  onChangeDataBits: (bits: SerialDataBits) => void;
  onChangeParity: (parity: SerialParity) => void;
  onChangeStopBits: (stopBits: SerialStopBits) => void;
  onChangeLineEnding: (ending: LineEnding) => void;
  onToggleTimestamps: () => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onSendTextChange: (text: string) => void;
  onRefreshDevices: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: () => void;
  onClearOutput: () => void;
  onClearError: () => void;
  onOpenSdkDoctor: () => void;
  onAnalyzeSerialInAi?: (recentLinesText: string, portLabel: string) => void;
}

const LOG_TIME = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${LOG_TIME.format(d)}.${ms}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_BADGE: Record<SerialStatus, { label: string; cls: string }> = {
  disconnected: {
    label: "DISCONNECTED",
    cls: "border-white/15 bg-white/[0.04] text-[#e8ebf7]/60",
  },
  connecting: {
    label: "CONNECTING",
    cls: "border-[#7aa2ff]/40 bg-[#7aa2ff]/18 text-[#7aa2ff]",
  },
  connected: {
    label: "CONNECTED",
    cls: "border-emerald-400/35 bg-emerald-500/12 text-emerald-300",
  },
  disconnecting: {
    label: "CLOSING",
    cls: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  },
  error: {
    label: "ERROR",
    cls: "border-red-400/35 bg-red-500/12 text-red-200",
  },
};

const PARITY_LABELS: Record<SerialParity, string> = {
  N: "None",
  E: "Even",
  O: "Odd",
  M: "Mark",
  S: "Space",
};

export function SerialMonitorPanel({
  isBackendConnected,
  status,
  pyserialAvailable,
  deviceInfo,
  devices,
  selectedPort,
  activePort,
  baudRate,
  dataBits,
  parity,
  stopBits,
  lineEnding,
  showTimestamps,
  autoScroll,
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
  onSelectPort,
  onChangeBaudRate,
  onChangeDataBits,
  onChangeParity,
  onChangeStopBits,
  onChangeLineEnding,
  onToggleTimestamps,
  onAutoScrollChange,
  onSendTextChange,
  onRefreshDevices,
  onConnect,
  onDisconnect,
  onSend,
  onClearOutput,
  onClearError,
  onOpenSdkDoctor,
  onAnalyzeSerialInAi,
}: SerialMonitorPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [showFramingBar, setShowFramingBar] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const isSessionActive =
    status === "connected" || status === "connecting" || status === "disconnecting";
  const isConnected = status === "connected";
  const isBusy = connecting || disconnecting;
  const badge = STATUS_BADGE[status];

  const canConnect =
    isBackendConnected &&
    !isSessionActive &&
    !isBusy &&
    selectedPort.trim().length > 0;

  const canSend =
    isBackendConnected &&
    isConnected &&
    !sending &&
    (sendText.length > 0 || lineEnding !== "none");

  // Auto-scroll live output when enabled
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length, autoScroll]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 24;
    if (atBottom !== autoScroll) {
      onAutoScrollChange(atBottom);
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canSend) {
        setHistoryIndex(-1);
        onSend();
      }
      return;
    }

    if (e.key === "ArrowUp" && txHistory.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(historyIndex + 1, txHistory.length - 1);
      setHistoryIndex(nextIdx);
      onSendTextChange(txHistory[nextIdx] ?? "");
      return;
    }

    if (e.key === "ArrowDown" && historyIndex >= 0) {
      e.preventDefault();
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      onSendTextChange(nextIdx >= 0 ? txHistory[nextIdx] ?? "" : "");
    }
  };

  const framingLabel = `${dataBits}${parity}${stopBits}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top Serial Connection & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#06070c]/55 px-3 py-1.5 select-none">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${badge.cls}`}
          >
            {status === "connecting" || status === "disconnecting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isConnected
                    ? "bg-emerald-400"
                    : status === "error"
                    ? "bg-red-400"
                    : "bg-[#e8ebf7]/40"
                }`}
              />
            )}
            <span>{badge.label}</span>
          </span>

          {activePort && (
            <span className="hidden items-center gap-1.5 font-mono text-[10.5px] text-[#e8ebf7]/70 sm:inline-flex">
              <span className="max-w-[140px] truncate">{activePort}</span>
              <span className="text-white/20">·</span>
              <span>{baudRate}</span>
              <span className="text-white/20">·</span>
              <span>{framingLabel}</span>
            </span>
          )}
        </div>

        {/* Right Connection & Display Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Discovered ports dropdown */}
          {devices.length > 0 && (
            <select
              aria-label="Discovered serial ports"
              value={
                devices.some((d) => d.port === selectedPort) ? selectedPort : ""
              }
              disabled={isSessionActive || isBusy}
              onChange={(e) => {
                if (e.target.value) {
                  onSelectPort(e.target.value);
                }
              }}
              className="h-6 max-w-[155px] rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/85 focus:outline-none disabled:opacity-50"
            >
              <option value="">Detected ports ({devices.length})</option>
              {devices.map((d) => (
                <option key={d.port} value={d.port}>
                  {d.display_name}
                </option>
              ))}
            </select>
          )}

          {/* Manual / active port input */}
          <div className="relative flex items-center">
            <Usb className="pointer-events-none absolute left-1.5 h-3 w-3 text-[#7aa2ff]/70" />
            <input
              type="text"
              aria-label="Serial monitor port"
              value={selectedPort}
              disabled={isSessionActive || isBusy}
              onChange={(e) => onSelectPort(e.target.value)}
              placeholder="/dev/ttyUSB0 or COM3"
              className="h-6 w-36 rounded border border-white/10 bg-[#0b0e17] pr-2 pl-6 font-mono text-[10.5px] text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/45 focus:outline-none disabled:opacity-55"
            />
          </div>

          <Tooltip label="Refresh serial ports" side="top">
            <button
              type="button"
              aria-label="Refresh serial ports"
              disabled={!isBackendConnected || refreshingDevices}
              onClick={onRefreshDevices}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3 w-3 ${refreshingDevices ? "animate-spin text-[#7aa2ff]" : ""}`}
              />
            </button>
          </Tooltip>

          {/* Baud Rate */}
          <select
            aria-label="Serial baud rate"
            value={baudRate}
            disabled={isSessionActive || isBusy}
            onChange={(e) => onChangeBaudRate(Number(e.target.value))}
            className="h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7]/85 focus:outline-none disabled:opacity-50"
          >
            {VALID_BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate} baud
              </option>
            ))}
          </select>

          {/* Framing drawer toggle (Data bits / Parity / Stop bits) */}
          <Tooltip label="Configure data bits, parity, and stop bits" side="top">
            <button
              type="button"
              aria-label="Serial framing parameters"
              aria-expanded={showFramingBar}
              onClick={() => setShowFramingBar((prev) => !prev)}
              className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] transition-colors ${
                showFramingBar
                  ? "border-[#7aa2ff]/40 bg-[#7aa2ff]/15 text-[#e8ebf7]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/70 hover:bg-white/[0.08] hover:text-[#e8ebf7]"
              }`}
            >
              <SlidersHorizontal className="h-3 w-3 text-[#7aa2ff]" />
              <span>{framingLabel}</span>
            </button>
          </Tooltip>

          {/* Connect / Disconnect Action */}
          {isConnected ? (
            <button
              type="button"
              disabled={!isBackendConnected || isBusy}
              onClick={onDisconnect}
              className="inline-flex h-6 items-center gap-1 rounded border border-red-400/45 bg-red-500/20 px-2.5 font-mono text-[10.5px] font-medium text-red-100 hover:bg-red-500/30 disabled:opacity-45"
            >
              {disconnecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Unplug className="h-3 w-3" />
              )}
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!canConnect}
              onClick={onConnect}
              className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-2.5 font-mono text-[10.5px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {connecting || status === "connecting" ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
              ) : (
                <Plug className="h-3 w-3 text-[#7aa2ff]" />
              )}
              <span>Connect</span>
            </button>
          )}

          {/* Timestamps toggle */}
          <Tooltip
            label={showTimestamps ? "Hide timestamps" : "Show timestamps"}
            side="top"
          >
            <button
              type="button"
              aria-label="Toggle serial timestamps"
              aria-pressed={showTimestamps}
              onClick={onToggleTimestamps}
              className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                showTimestamps
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/15 text-[#7aa2ff]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45 hover:text-[#e8ebf7]"
              }`}
            >
              <Clock className="h-3 w-3" />
            </button>
          </Tooltip>

          {/* Auto-scroll toggle */}
          <Tooltip
            label={
              autoScroll
                ? "Auto-scrolling incoming serial output"
                : "Enable auto-scroll"
            }
            side="top"
          >
            <button
              type="button"
              aria-label="Toggle serial auto-scroll"
              aria-pressed={autoScroll}
              onClick={() => {
                const next = !autoScroll;
                onAutoScrollChange(next);
                if (next && scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTop =
                    scrollContainerRef.current.scrollHeight;
                }
              }}
              className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                autoScroll
                  ? "border-[#7aa2ff]/35 bg-[#7aa2ff]/15 text-[#7aa2ff]"
                  : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/45 hover:text-[#e8ebf7]"
              }`}
            >
              <ArrowDownToLine className="h-3 w-3" />
            </button>
          </Tooltip>

          {/* Clear output */}
          <Tooltip label="Clear serial monitor output" side="top">
            <button
              type="button"
              aria-label="Clear serial output"
              disabled={logs.length === 0}
              onClick={onClearOutput}
              className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 font-mono text-[10px] text-[#e8ebf7]/60 hover:bg-white/[0.08] hover:text-[#e8ebf7] disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              <span>Clear</span>
            </button>
          </Tooltip>

          {onAnalyzeSerialInAi && (
            <Tooltip
              label="Send last 35 serial lines to Native VEGA AI"
              side="top"
            >
              <button
                type="button"
                disabled={logs.length === 0}
                onClick={() => {
                  const recent = logs
                    .slice(-35)
                    .map((l) => `[${l.stream}] ${l.text}`)
                    .join("\n")
                    .slice(0, 6000);
                  onAnalyzeSerialInAi(
                    recent,
                    activePort || selectedPort || "UART"
                  );
                }}
                className="inline-flex h-6 items-center gap-1 rounded border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 px-2 font-mono text-[10px] text-[#e8ebf7] hover:bg-[#7aa2ff]/22 disabled:opacity-40"
              >
                <Sparkles className="h-2.5 w-2.5 text-[#7aa2ff]" />
                <span className="hidden md:inline">Analyze AI</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Collapsible Framing Options Strip (Data bits / Parity / Stop bits) */}
      {showFramingBar && (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-[#070910]/85 px-3 py-1.5 text-[11px] select-none">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[#e8ebf7]/50 uppercase">
            UART Framing
          </span>

          <label className="flex items-center gap-1.5 text-[#e8ebf7]/70">
            <span>Data bits</span>
            <select
              aria-label="Serial data bits"
              value={dataBits}
              disabled={isSessionActive || isBusy}
              onChange={(e) =>
                onChangeDataBits(Number(e.target.value) as SerialDataBits)
              }
              className="h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7] focus:outline-none disabled:opacity-50"
            >
              <option value={5}>5</option>
              <option value={6}>6</option>
              <option value={7}>7</option>
              <option value={8}>8</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[#e8ebf7]/70">
            <span>Parity</span>
            <select
              aria-label="Serial parity"
              value={parity}
              disabled={isSessionActive || isBusy}
              onChange={(e) => onChangeParity(e.target.value as SerialParity)}
              className="h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7] focus:outline-none disabled:opacity-50"
            >
              {(Object.keys(PARITY_LABELS) as SerialParity[]).map((code) => (
                <option key={code} value={code}>
                  {PARITY_LABELS[code]} ({code})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[#e8ebf7]/70">
            <span>Stop bits</span>
            <select
              aria-label="Serial stop bits"
              value={stopBits}
              disabled={isSessionActive || isBusy}
              onChange={(e) => onChangeStopBits(e.target.value as SerialStopBits)}
              className="h-6 rounded border border-white/10 bg-[#0b0e17] px-1.5 font-mono text-[10.5px] text-[#e8ebf7] focus:outline-none disabled:opacity-50"
            >
              <option value="1">1</option>
              <option value="1.5">1.5</option>
              <option value="2">2</option>
            </select>
          </label>

          {isSessionActive && (
            <span className="text-[10.5px] text-[#e8ebf7]/45">
              Disconnect to modify port framing parameters.
            </span>
          )}
        </div>
      )}

      {/* Missing PySerial or Connection Error Strip */}
      {(!pyserialAvailable || error) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 text-xs ${
            error
              ? "border-red-400/25 bg-red-500/10 text-red-100"
              : "border-amber-400/25 bg-amber-500/10 text-amber-100"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {error ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            )}
            <span className="truncate">
              {error ??
                "PySerial is not installed in the backend Python environment (backend/.venv). Install pyserial to open live UART connections."}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!pyserialAvailable && (
              <button
                type="button"
                onClick={onOpenSdkDoctor}
                className="inline-flex h-6 items-center gap-1 rounded border border-white/15 bg-white/[0.08] px-2 text-[11px] font-medium text-[#e8ebf7] hover:bg-white/15"
              >
                <Stethoscope className="h-3 w-3 text-[#7aa2ff]" />
                <span>Open SDK Doctor</span>
              </button>
            )}
            {error && (
              <button
                type="button"
                aria-label="Dismiss serial error"
                onClick={onClearError}
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Device Discovery Permission Warnings (Linux dialout/uucp) */}
      {deviceInfo && deviceInfo.warnings.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-500/[0.07] px-3 py-1 text-[11px] text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span className="truncate">{deviceInfo.warnings[0]}</span>
        </div>
      )}

      {/* Scrollable Serial Console Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="vega-scroll min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="flex h-full min-h-[72px] items-center justify-center font-sans">
            <div className="flex max-w-xl items-start gap-3 rounded-xl border border-white/8 bg-[#08090f] px-4 py-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#7aa2ff]">
                <Usb className="h-3.5 w-3.5" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#e8ebf7]">
                  {isConnected
                    ? `Listening on ${activePort ?? selectedPort} (${baudRate} baud · ${framingLabel})`
                    : "UART Serial Monitor Ready"}
                </p>
                <p className="text-[11px] leading-relaxed text-[#e8ebf7]/55">
                  {isConnected
                    ? "Incoming firmware UART output and transmitted commands appear here in real time."
                    : "Select a discovered USB-UART port or enter a device path (such as /dev/ttyUSB0 or COM3), configure baud rate and framing, then click Connect."}
                </p>
                {deviceInfo && deviceInfo.notes.length > 0 && (
                  <p className="text-[10.5px] text-[#e8ebf7]/45">
                    {deviceInfo.notes[0]}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {truncatedLogs && (
              <div className="mb-1.5 rounded border border-amber-400/20 bg-amber-500/[0.06] px-2 py-1 text-[10.5px] text-amber-200">
                Buffer capped at the most recent 5,000 lines; older serial output was trimmed.
              </div>
            )}
            {logs.map((line) => (
              <div
                key={line.seq}
                className={`flex items-baseline gap-2 rounded px-1.5 py-0.5 hover:bg-white/[0.03] ${
                  line.stream === "error"
                    ? "text-red-300"
                    : line.stream === "tx"
                    ? "text-[#7aa2ff]"
                    : line.stream === "system"
                    ? "text-[#e8ebf7]/55 italic"
                    : "text-[#e8ebf7]/90"
                }`}
              >
                {showTimestamps && (
                  <span className="shrink-0 text-[10px] text-[#e8ebf7]/30 select-none">
                    {formatTimestamp(line.timestamp)}
                  </span>
                )}
                {line.stream === "tx" && (
                  <span className="shrink-0 rounded bg-[#7aa2ff]/15 px-1 text-[9.5px] font-semibold text-[#7aa2ff] select-none">
                    TX
                  </span>
                )}
                <span className="min-w-0 whitespace-pre-wrap break-all">
                  {line.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom TX Input & Counters Bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] bg-[#06070c]/75 px-3 py-1.5">
        <div className="relative flex min-w-[200px] flex-1 items-center">
          <input
            type="text"
            aria-label="Serial transmit input"
            value={sendText}
            disabled={!isConnected || !isBackendConnected || sending}
            onChange={(e) => {
              setHistoryIndex(-1);
              onSendTextChange(e.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              isConnected
                ? "Type command to send over UART (Enter to transmit, Up/Down for history)…"
                : "Connect to a serial port to transmit data…"
            }
            className="h-7 w-full rounded border border-white/10 bg-[#0b0e17] pr-7 pl-2.5 font-mono text-[11px] text-[#e8ebf7] placeholder:text-[#e8ebf7]/30 focus:border-[#7aa2ff]/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          />
          <CornerDownLeft className="pointer-events-none absolute right-2 h-3 w-3 text-[#e8ebf7]/30" />
        </div>

        <select
          aria-label="Serial line ending"
          value={lineEnding}
          disabled={!isBackendConnected}
          onChange={(e) => onChangeLineEnding(e.target.value as LineEnding)}
          className="h-7 rounded border border-white/10 bg-[#0b0e17] px-2 font-mono text-[10.5px] text-[#e8ebf7]/85 focus:outline-none"
        >
          <option value="none">No line ending</option>
          <option value="lf">NL (LF \n)</option>
          <option value="cr">CR (\r)</option>
          <option value="crlf">Both (CRLF \r\n)</option>
        </select>

        <button
          type="button"
          aria-label="Send serial data"
          disabled={!canSend}
          onClick={() => {
            setHistoryIndex(-1);
            onSend();
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-3 font-mono text-[11px] font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#7aa2ff]" />
          ) : (
            <Send className="h-3 w-3 text-[#7aa2ff]" />
          )}
          <span>Send</span>
        </button>

        {/* Byte counters */}
        <div className="hidden items-center gap-2 font-mono text-[10px] text-[#e8ebf7]/50 sm:flex">
          <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
            RX {formatBytes(rxCount)}
          </span>
          <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[#7aa2ff]/80">
            TX {formatBytes(txCount)}
          </span>
        </div>
      </div>
    </div>
  );
}
