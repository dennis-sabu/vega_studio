export type SerialStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

export type SerialStream = "rx" | "tx" | "system" | "error";
export type SerialDataBits = 5 | 6 | 7 | 8;
export type SerialParity = "N" | "E" | "O" | "M" | "S";
export type SerialStopBits = "1" | "1.5" | "2";
export type LineEnding = "none" | "lf" | "cr" | "crlf";

export const VALID_BAUD_RATES = [
  300,
  1200,
  2400,
  4800,
  9600,
  19200,
  38400,
  57600,
  115200,
  230400,
  460800,
  921600,
] as const;

export interface SerialConfig {
  port: string | null;
  baud_rate: number;
  data_bits: SerialDataBits;
  parity: SerialParity;
  stop_bits: SerialStopBits;
}

export interface SerialConnectRequestPayload {
  port: string;
  baud_rate: number;
  data_bits: SerialDataBits;
  parity: SerialParity;
  stop_bits: SerialStopBits;
}

export interface SerialSendRequestPayload {
  data: string;
  line_ending: LineEnding;
}

export interface SerialLogLine {
  seq: number;
  timestamp: string;
  stream: SerialStream;
  text: string;
}

export interface SerialStateResponse {
  status: SerialStatus;
  pyserial_available: boolean;
  port: string | null;
  baud_rate: number | null;
  config: SerialConfig | null;
  error_message: string | null;
  rx_count: number;
  tx_count: number;
  log_line_count: number;
  truncated_logs: boolean;
  logs: SerialLogLine[];
}

export type SerialWsEvent =
  | {
      type: "snapshot";
      state: SerialStateResponse;
      logs: SerialLogLine[];
    }
  | {
      type: "log";
      line: SerialLogLine;
      rx_count?: number;
      tx_count?: number;
    }
  | {
      type: "status";
      status: SerialStatus;
      error_message: string | null;
      port?: string | null;
      baud_rate?: number | null;
      config?: SerialConfig | null;
    }
  | {
      type: "cleared";
    }
  | {
      type: "ping";
    };
