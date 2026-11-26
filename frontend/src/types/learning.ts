/** VEGA Studio – TypeScript types for Phase 16 Firmware Examples, Documentation & Guided Learning. */
import type { WorkspaceSummary } from "@/types/project";

export type ExampleVerificationStatus =
  | "template_verified"
  | "conceptual"
  | "sdk_discovered";

export type ExampleDifficulty = "beginner" | "intermediate" | "advanced";
export type ExampleSource = "builtin" | "local_sdk";

export type DocBadge =
  | "ide_verified"
  | "hardware_specs_verified"
  | "conceptual"
  | "external_reference";

export type IdeActionId =
  | "new_project"
  | "open_project"
  | "open_sdk_doctor"
  | "open_sdk_settings"
  | "open_board_manager"
  | "open_build"
  | "open_upload"
  | "open_serial"
  | "open_terminal"
  | "open_git"
  | "open_native_ai"
  | "open_examples";

export interface ExampleSummary {
  id: string;
  title: string;
  category: string;
  difficulty: ExampleDifficulty;
  verification_status: ExampleVerificationStatus;
  verification_note: string;
  source: ExampleSource;
  origin_label: string;
  short_description: string;
  compatible_boards: string[];
  required_sdk: string;
  tags: string[];
  file_count: number;
  entry_file: string | null;
}

export interface ExampleFileInfo {
  relative_path: string;
  size_bytes: number;
  language: string;
  is_binary: boolean;
}

export interface ExampleDetailResponse {
  example: ExampleSummary;
  long_description: string;
  learning_objectives: string[];
  prerequisites: string[];
  board_compatibility_note: string;
  files: ExampleFileInfo[];
  readme_content: string | null;
  related_doc_slugs: string[];
}

export interface ExampleFileContentResponse {
  example_id: string;
  relative_path: string;
  content: string;
  language: string;
  size_bytes: number;
  truncated: boolean;
}

export interface ExampleCatalogResponse {
  examples: ExampleSummary[];
  categories: string[];
  sdk_root_configured: boolean;
  sdk_examples_count: number;
  validation_warnings: string[];
}

export interface ExampleValidationResponse {
  example_id: string;
  valid: boolean;
  compatible: boolean;
  target_board_id: string;
  board_supported: boolean;
  sdk_ready_note: string;
  issues: string[];
  warnings: string[];
  planned_files: string[];
}

export interface CreateProjectFromExamplePayload {
  example_id: string;
  project_name: string;
  parent_dir: string;
  board_id: string;
  description?: string | null;
  confirm_overwrite?: boolean;
}

export type CreateProjectFromExampleResponse = WorkspaceSummary;

export interface DocLinkRef {
  label: string;
  url: string;
  external: boolean;
}

export interface DocIdeActionRef {
  label: string;
  action_id: IdeActionId;
}

export interface DocPageSummary {
  slug: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  badge: DocBadge;
  estimated_minutes: number;
  related_example_ids: string[];
}

export interface DocPageDetailResponse {
  doc: DocPageSummary;
  markdown_content: string;
  related_slugs: string[];
  external_links: DocLinkRef[];
  ide_actions: DocIdeActionRef[];
}

export interface DocSearchResult {
  slug: string;
  title: string;
  category: string;
  summary: string;
  badge: DocBadge;
  snippet: string;
  score: number;
}

export interface GuidedWorkflowStep {
  step_number: number;
  title: string;
  detail: string;
  doc_slug: string | null;
  ide_action: DocIdeActionRef | null;
}

export interface GuidedWorkflowSummary {
  id: string;
  title: string;
  description: string;
  difficulty: ExampleDifficulty;
  estimated_minutes: number;
  steps: GuidedWorkflowStep[];
}

export interface DocCatalogResponse {
  docs: DocPageSummary[];
  categories: string[];
  guides: GuidedWorkflowSummary[];
}

export interface DocSearchResponse {
  query: string;
  results: DocSearchResult[];
}
