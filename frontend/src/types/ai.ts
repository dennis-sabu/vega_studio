/** VEGA Studio – TypeScript types for Phase 15 Native VEGA AI Assistant. */

export type AIProviderId = "openai" | "groq" | "openai_compatible";
export type AIRole = "user" | "assistant" | "system";
export type AIContextKind =
  | "selection"
  | "file"
  | "build_error"
  | "build_output"
  | "serial_output"
  | "terminal_output"
  | "git_status"
  | "board_sdk"
  | "project_summary";
export type AIConversationStatus = "idle" | "streaming" | "cancelled" | "error";
export type AICodeApplyMode = "insert_at_cursor" | "replace_selection" | "replace_file";

export interface AIProviderProfileConfig {
  model: string;
  base_url: string | null;
}

export interface AIConfig {
  active_provider: AIProviderId;
  providers: Record<AIProviderId, AIProviderProfileConfig>;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  allow_context_tools: boolean;
  auto_include_workspace_summary: boolean;
}

export interface AICredentialStatus {
  provider_id: AIProviderId;
  has_api_key: boolean;
  key_hint: string | null;
  persistence_mode: "os_keyring" | "session_memory" | "none";
}

export interface AISecureStorageInfo {
  os_storage_available: boolean;
  backend_name: string;
  detail: string;
}

export interface AIProviderStatusInfo {
  id: AIProviderId;
  label: string;
  description: string;
  default_base_url: string;
  requires_base_url: boolean;
  api_key_optional: boolean;
  supports_streaming: boolean;
  supports_tools: boolean;
  recommended_models: string[];
  configured_model: string;
  configured_base_url: string | null;
  credential: AICredentialStatus;
  ready: boolean;
  status_reason: string | null;
}

export interface AIProvidersStateResponse {
  config: AIConfig;
  storage: AISecureStorageInfo;
  providers: AIProviderStatusInfo[];
  updated_at: string | null;
}

export interface AIConnectionTestResponse {
  ok: boolean;
  provider_id: AIProviderId;
  endpoint: string;
  model: string;
  latency_ms: number;
  message: string;
  error_code: string | null;
  discovered_models: string[];
}

export interface AIContextAttachment {
  kind: AIContextKind;
  title: string;
  relative_path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  language?: string | null;
  snippet?: string | null;
  truncated?: boolean;
}

export interface AIToolTraceItem {
  call_id: string;
  name: string;
  arguments_preview: string;
  status: "running" | "completed" | "denied" | "error";
  output_preview: string | null;
  truncated: boolean;
}

export interface AIUsageInfo {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface AIMessageItem {
  id: string;
  seq: number;
  role: AIRole;
  content: string;
  attachments: AIContextAttachment[];
  tool_traces: AIToolTraceItem[];
  provider_id: AIProviderId | null;
  model: string | null;
  finish_reason: string | null;
  usage: AIUsageInfo | null;
  error_message: string | null;
  created_at: string;
  is_streaming: boolean;
}

export interface AIConversationSummary {
  conversation_id: string;
  title: string;
  project_dir: string | null;
  project_name: string | null;
  provider_id: AIProviderId | null;
  model: string | null;
  allow_tools: boolean;
  status: AIConversationStatus;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

export interface AIConversationDetailResponse {
  conversation: AIConversationSummary;
  messages: AIMessageItem[];
}

export interface AIConversationListResponse {
  conversations: AIConversationSummary[];
}

export interface AIContextPreviewResponse {
  project_dir: string | null;
  project_name: string | null;
  board_id: string | null;
  summary_sections: string[];
  included_attachments: AIContextAttachment[];
  excluded_warnings: string[];
  estimated_chars: number;
  redacted_secrets_count: number;
}

export interface AICodeApplyValidateResponse {
  allowed: boolean;
  normalized_relative_path: string;
  exists: boolean;
  is_protected: boolean;
  reason: string | null;
  current_excerpt: string | null;
}

export interface PendingCodeApplyProposal {
  code: string;
  language: string;
  mode: AICodeApplyMode;
}
