export type BuildOperation = "build" | "clean" | "rebuild";
export type BuildMode = "default" | "debug" | "release";
export type BuildStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";
export type BuildDiagnosticSeverity = "error" | "warning";
export type BuildStream = "stdout" | "stderr" | "system";

export interface BuildDiagnostic {
  id: string;
  severity: BuildDiagnosticSeverity;
  message: string;
  file_path: string | null;
  relative_path: string | null;
  line: number | null;
  column: number | null;
  raw_line: string;
}

export interface BuildLogLine {
  seq: number;
  timestamp: string;
  stream: BuildStream;
  text: string;
}

export interface BuildRequestPayload {
  project_dir: string;
  operation?: BuildOperation;
  target?: string | null;
  clean_target?: string;
  mode?: BuildMode;
  timeout_seconds?: number;
  env_overrides?: Record<string, string>;
}

export interface BuildSummary {
  build_id: string;
  project_dir: string;
  project_name: string;
  operation: BuildOperation;
  target: string | null;
  mode: BuildMode;
  makefile_path: string;
  command_preview: string[];
  status: BuildStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  cancelled: boolean;
  timed_out: boolean;
  error_message: string | null;
  error_count: number;
  warning_count: number;
  log_line_count: number;
  truncated_logs: boolean;
}

export interface BuildStateResponse {
  active_build: BuildSummary | null;
  latest_build: BuildSummary | null;
  logs: BuildLogLine[];
  diagnostics: BuildDiagnostic[];
}

export interface BuildHistoryResponse {
  history: BuildSummary[];
}

export type BuildWsEvent =
  | {
      type: "snapshot";
      build: BuildSummary;
      logs: BuildLogLine[];
      diagnostics: BuildDiagnostic[];
    }
  | {
      type: "log";
      line: BuildLogLine;
    }
  | {
      type: "diagnostic";
      diagnostic: BuildDiagnostic;
    }
  | {
      type: "completed";
      build: BuildSummary;
    }
  | {
      type: "ping";
    };
