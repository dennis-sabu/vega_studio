import type { ProjectTarget, WorkspaceSummary } from "./project";

export type BoardSupportStatus = "supported" | "preview" | "deprecated";
export type CompatibilityStatus = "compatible" | "warning" | "incompatible";

export interface BoardBuildProfile {
  cross_compile_prefix: string;
  expected_arch: string;
  expected_machine: string;
  build_system: string;
}

export interface BoardUploadProfile {
  method: string;
  uploader_name: string;
  requires_port: boolean;
  artifact_extensions: string[];
  command_convention_verified: boolean;
  notes: string;
}

export interface BoardProfile {
  id: string;
  name: string;
  vendor: string;
  family: string;
  status: BoardSupportStatus;
  architecture: string;
  core: string;
  cpu_frequency_mhz: number;
  isa: string;
  machine: string;
  sram_kb: number;
  sensors: string[];
  summary: string;
  build: BoardBuildProfile;
  upload?: BoardUploadProfile | null;
}

export interface BoardListResponse {
  boards: BoardProfile[];
}

export interface CompatibilityCheckItem {
  id: string;
  label: string;
  status: CompatibilityStatus;
  detail: string;
}

export interface BoardCompatibilityReport {
  board_id: string;
  board_name: string;
  status: CompatibilityStatus;
  compatible: boolean;
  checks: CompatibilityCheckItem[];
  warnings: string[];
  issues: string[];
}

export interface ProjectBoardStatusResponse {
  project_dir: string;
  selected_board_id: string | null;
  board_supported: boolean;
  board: BoardProfile | null;
  project_target: ProjectTarget;
  compatibility: BoardCompatibilityReport | null;
  warnings: string[];
}

export interface SelectProjectBoardResponse {
  ok: boolean;
  workspace: WorkspaceSummary;
  board_status: ProjectBoardStatusResponse;
  message: string;
}
