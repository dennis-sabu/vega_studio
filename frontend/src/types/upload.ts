export type UploadStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type UploadStream = "stdout" | "stderr" | "system";
export type UploadCheckStatus = "pass" | "warning" | "fail";
export type UploadInvocationMode =
  | "auto"
  | "positional_port_file"
  | "positional_file_port"
  | "flagged_port_file";

export interface SerialDeviceInfo {
  port: string;
  display_name: string;
  description: string;
  hardware_id: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  vendor_id: string | null;
  product_id: string | null;
  stable_path: string | null;
  transport: string;
  accessible: boolean | null;
}

export interface DeviceListResponse {
  platform_os: string;
  discovery_method: string;
  discovery_supported: boolean;
  devices: SerialDeviceInfo[];
  warnings: string[];
  notes: string[];
}

export interface FirmwareArtifactInfo {
  relative_path: string;
  name: string;
  extension: string;
  size_bytes: number;
  modified_at: string;
  stale: boolean;
  stale_reason: string | null;
}

export interface UploadPreflightCheck {
  id: string;
  label: string;
  status: UploadCheckStatus;
  detail: string;
  remediation: string | null;
}

export interface UploadPreflightRequestPayload {
  project_dir: string;
  port?: string | null;
  artifact_path?: string | null;
  invocation_mode?: UploadInvocationMode;
}

export interface UploadPreflightResponse {
  ready: boolean;
  project_dir: string;
  project_name: string;
  board_id: string | null;
  board_name: string | null;
  board_supported: boolean;
  uploader_path: string | null;
  python_path: string | null;
  command_convention_verified: boolean;
  contract_source: string;
  resolved_invocation_mode: string;
  command_preview: string[];
  artifacts: FirmwareArtifactInfo[];
  selected_artifact: FirmwareArtifactInfo | null;
  artifact_ambiguous: boolean;
  devices: SerialDeviceInfo[];
  selected_port: string | null;
  port_verified_connected: boolean;
  checks: UploadPreflightCheck[];
  warnings: string[];
  blocking_issues: string[];
  needs_build: boolean;
  needs_sdk_doctor: boolean;
  needs_board_manager: boolean;
}

export interface UploadRequestPayload {
  project_dir: string;
  port?: string | null;
  artifact_path?: string | null;
  invocation_mode?: UploadInvocationMode;
  timeout_seconds?: number;
  allow_stale_artifact?: boolean;
  strict_port_check?: boolean;
}

export interface UploadLogLine {
  seq: number;
  timestamp: string;
  stream: UploadStream;
  text: string;
}

export interface UploadSummary {
  upload_id: string;
  project_dir: string;
  project_name: string;
  board_id: string;
  board_name: string;
  artifact_path: string;
  artifact_size_bytes: number;
  port: string;
  invocation_mode: string;
  command_preview: string[];
  command_convention_verified: boolean;
  status: UploadStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  cancelled: boolean;
  timed_out: boolean;
  error_message: string | null;
  progress_percent: number | null;
  progress_indeterminate: boolean;
  log_line_count: number;
  truncated_logs: boolean;
}

export interface UploadStateResponse {
  active_upload: UploadSummary | null;
  latest_upload: UploadSummary | null;
  logs: UploadLogLine[];
}

export interface UploadHistoryResponse {
  history: UploadSummary[];
}

export type UploadWsEvent =
  | {
      type: "snapshot";
      upload: UploadSummary;
      logs: UploadLogLine[];
    }
  | {
      type: "log";
      line: UploadLogLine;
    }
  | {
      type: "progress";
      upload: UploadSummary;
    }
  | {
      type: "completed";
      upload: UploadSummary;
    }
  | {
      type: "ping";
    };
