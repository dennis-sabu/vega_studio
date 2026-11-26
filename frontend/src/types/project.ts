export type ProjectTemplate = "minimal" | "empty";

export interface ProjectTarget {
  board: string | null;
  arch: string;
  machine: string;
}

export interface ProjectBuildConfig {
  system: "vega-sdk-make";
  makefile: string;
  sourceDir: string;
  includeDir: string;
}

export interface VegaProjectMetadata {
  schemaVersion: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  target: ProjectTarget;
  build: ProjectBuildConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEntrySummary {
  name: string;
  kind: "dir" | "file";
}

export interface WorkspaceSummary {
  project: VegaProjectMetadata;
  project_dir: string;
  structure_valid: boolean;
  warnings: string[];
  top_level_entries: ProjectEntrySummary[];
  has_metadata?: boolean;
  detected_indicators?: string[];
}

export interface UpdateWorkspaceConfigPayload {
  default_projects_dir: string | null;
}

export interface RecentProjectEntry {
  name: string;
  project_dir: string;
  board: string;
  schema_version: string;
  last_opened_at: string;
  exists: boolean;
}

export interface WorkspaceStateResponse {
  active_project: WorkspaceSummary | null;
  recent_projects: RecentProjectEntry[];
  default_projects_dir: string;
  warning: string | null;
}

export interface CreateProjectPayload {
  name: string;
  parent_dir: string;
  description: string;
  template: ProjectTemplate;
}

export interface OpenProjectPayload {
  project_dir: string;
}
