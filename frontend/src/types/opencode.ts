/** VEGA Studio – TypeScript types for Phase 14 OpenCode CLI Integration. */

export type OpenCodePermissionMode =
  | "ask_all"
  | "workspace_assisted"
  | "read_only";

export type OpenCodeSessionStatus =
  | "creating"
  | "idle"
  | "running"
  | "waiting_permission"
  | "interrupted"
  | "completed"
  | "error"
  | "closed"
  | "unavailable";

export type OpenCodePermissionDecision = "once" | "always" | "reject";
export type OpenCodeToolStatus = "streaming" | "running" | "completed" | "error";
export type OpenCodeMessageRole = "user" | "assistant" | "system" | "tool" | "error";

export interface OpenCodeConfig {
  executable_path: string | null;
  default_permission_mode: OpenCodePermissionMode;
  default_model: string | null;
  startup_timeout_seconds: number;
}

export interface OpenCodeModelOption {
  id: string;
  name: string;
  provider_id: string | null;
}

export interface OpenCodeInfoResponse {
  available: boolean;
  version: string | null;
  executable_path: string | null;
  configured_executable_path: string | null;
  executable_source: "configured" | "discovered" | "missing";
  unavailable_reason: string | null;
  install_guide_url: string;
  server_running: boolean;
  server_url: string | null;
  server_pid: number | null;
  active_sessions_count: number;
  max_active_sessions: number;
  sandbox_notice: string;
  available_models: OpenCodeModelOption[];
}

export interface OpenCodeConfigStateResponse {
  config: OpenCodeConfig;
  info: OpenCodeInfoResponse;
  updated_at: string | null;
}

export interface OpenCodeContextAttachment {
  kind: "selection" | "file" | "build_error" | "serial_note";
  title: string;
  relative_path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  language?: string | null;
  snippet?: string | null;
  truncated?: boolean;
}

export interface OpenCodeToolEvent {
  tool_id: string;
  name: string;
  status: OpenCodeToolStatus;
  input_preview: string | null;
  output_preview: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface OpenCodeMessageItem {
  id: string;
  role: OpenCodeMessageRole;
  text: string;
  reasoning?: string | null;
  tools: OpenCodeToolEvent[];
  contexts: OpenCodeContextAttachment[];
  created_at: string;
  completed_at: string | null;
  is_streaming: boolean;
}

export interface OpenCodePermissionRequestInfo {
  request_id: string;
  session_id: string;
  opencode_session_id: string;
  action: string;
  resources: string[];
  message: string | null;
  metadata: Record<string, unknown>;
  is_sensitive: boolean;
  sensitivity_reasons: string[];
  created_at: string;
  status: "pending" | "approved_once" | "approved_always" | "rejected";
}

export interface OpenCodeSessionSummary {
  session_id: string;
  opencode_session_id: string | null;
  title: string;
  project_dir: string;
  project_name: string;
  status: OpenCodeSessionStatus;
  permission_mode: OpenCodePermissionMode;
  model: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  pending_permissions_count: number;
  message_count: number;
  recoverable: boolean;
}

export interface OpenCodeSessionDetailResponse {
  session: OpenCodeSessionSummary;
  messages: OpenCodeMessageItem[];
  pending_permissions: OpenCodePermissionRequestInfo[];
  truncated_messages: boolean;
}

export interface OpenCodeSessionListResponse {
  sessions: OpenCodeSessionSummary[];
  active_count: number;
  max_active_sessions: number;
}
