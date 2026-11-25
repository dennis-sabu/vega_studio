export type DiagnosticStatus = "pass" | "warning" | "fail" | "not_checked";

export type DiagnosticCategory =
  | "sdk"
  | "toolchain"
  | "build_prerequisites"
  | "vega_config"
  | "upload_prerequisites";

export interface SdkConfig {
  sdk_root: string | null;
  toolchain_root: string | null;
  compiler_path: string | null;
  cross_compile_prefix: string;
  make_path: string | null;
  python_path: string | null;
  uploader_script: string | null;
  target_arch: string;
  target_machine: string;
  extra_path_entries: string[];
}

export interface SdkConfigStateResponse {
  config: SdkConfig;
  is_customized: boolean;
  updated_at: string | null;
  validation_warnings: string[];
}

export interface DiscoveredTool {
  name: string;
  path: string;
  source: string;
}

export interface SdkDiscoveryResult {
  platform_os: string;
  searched_locations: string[];
  sdk_root: string | null;
  toolchain_root: string | null;
  compiler_path: string | null;
  compiler_tools: DiscoveredTool[];
  make_path: string | null;
  python_path: string | null;
  uploader_script: string | null;
  suggested_config: SdkConfig;
  notes: string[];
}

export interface DiagnosticCheckResult {
  id: string;
  category: DiagnosticCategory;
  title: string;
  status: DiagnosticStatus;
  summary: string;
  detail: string | null;
  detected_path: string | null;
  detected_version: string | null;
  command: string | null;
  output: string | null;
  remediation: string | null;
}

export interface DiagnosticSummaryCounts {
  passed: number;
  warning: number;
  failed: number;
  not_checked: number;
  total: number;
}

export interface SdkDoctorReport {
  overall_status: DiagnosticStatus;
  checked_at: string | null;
  platform_os: string;
  platform_compatible: boolean;
  summary: DiagnosticSummaryCounts;
  config_used: SdkConfig;
  checks: DiagnosticCheckResult[];
  companion_tools: DiscoveredTool[];
}
