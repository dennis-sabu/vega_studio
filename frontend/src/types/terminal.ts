export type TerminalStatus =
  | "starting"
  | "running"
  | "exited"
  | "error"
  | "closed";

export type TerminalPtyBackend = "posix_pty" | "winpty_conpty" | "unavailable";

export interface TerminalShellInfo {
  id: string;
  label: string;
  executable: string;
  default_args: string[];
  available: boolean;
  is_default: boolean;
}

export interface TerminalShellsResponse {
  platform_os: string;
  pty_backend: TerminalPtyBackend;
  pty_supported: boolean;
  pty_message: string | null;
  default_shell_id: string | null;
  shells: TerminalShellInfo[];
}

export interface TerminalSessionCreatePayload {
  shell_id?: string | null;
  cwd?: string | null;
  project_dir?: string | null;
  cols?: number;
  rows?: number;
  title?: string | null;
}

export interface TerminalResizePayload {
  cols: number;
  rows: number;
}

export interface TerminalSessionSummary {
  session_id: string;
  title: string;
  shell_id: string;
  shell_label: string;
  executable: string;
  initial_cwd: string;
  cwd: string;
  project_dir: string | null;
  cols: number;
  rows: number;
  pid: number | null;
  status: TerminalStatus;
  exit_code: number | null;
  error_message: string | null;
  created_at: string;
  exited_at: string | null;
  last_activity_at: string;
  output_bytes: number;
  buffer_bytes: number;
  buffer_truncated: boolean;
}

export interface TerminalSessionListResponse {
  max_sessions: number;
  pty_backend: TerminalPtyBackend;
  pty_supported: boolean;
  sessions: TerminalSessionSummary[];
}

export interface TerminalSessionStateResponse {
  session: TerminalSessionSummary;
  replay: string;
}

export interface TerminalCloseResponse {
  closed: boolean;
  session_id: string;
}

export type TerminalWsServerEvent =
  | {
      type: "snapshot";
      session: TerminalSessionSummary;
      replay: string;
    }
  | {
      type: "output";
      seq: number;
      data: string;
      cwd?: string;
    }
  | {
      type: "state";
      session: TerminalSessionSummary;
      reset?: boolean;
    }
  | {
      type: "exited";
      session: TerminalSessionSummary;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "ping";
    }
  | {
      type: "pong";
    };
