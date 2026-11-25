/** VEGA Studio – TypeScript types for Phase 13 Native GitHub Integration. */

export type GitHubVisibility = "private" | "public";

export type GitHubOpKind =
  | "auth_login"
  | "fetch"
  | "pull"
  | "push"
  | "create_repo"
  | "publish";

export type GitHubOpStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface GitRemoteInfo {
  name: string;
  fetch_url: string;
  push_url: string;
  is_github: boolean;
  github_owner_repo: string | null;
}

export interface GitHubCliInfo {
  gh_available: boolean;
  gh_version: string | null;
  gh_executable: string | null;
  install_guide_url: string;
  unavailable_reason: string | null;
  authenticated: boolean;
  username: string | null;
  host: string;
  git_protocol: string | null;
  auth_message: string | null;
}

export interface GitHubOperationSummary {
  op_id: string;
  kind: GitHubOpKind;
  status: GitHubOpStatus;
  cancellable: boolean;
  project_dir: string | null;
  remote: string | null;
  branch: string | null;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  cancelled: boolean;
  error_message: string | null;
  device_code: string | null;
  verification_url: string | null;
  output_lines: string[];
  truncated_output: boolean;
}

export interface GitHubStatusResponse {
  cli: GitHubCliInfo;
  project_dir: string | null;
  is_git_repository: boolean;
  current_branch: string | null;
  is_unborn: boolean;
  is_detached: boolean;
  repo_state: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  remotes: GitRemoteInfo[];
  primary_remote: GitRemoteInfo | null;
  active_operation: GitHubOperationSummary | null;
  latest_operation: GitHubOperationSummary | null;
}

export interface GitHubOperationStateResponse {
  active_operation: GitHubOperationSummary | null;
  latest_operation: GitHubOperationSummary | null;
}

export interface GitHubCreateRepoResponse {
  url: string;
  remote_url: string;
  remote: GitRemoteInfo | null;
  operation: GitHubOperationSummary;
}

export interface GitHubPublishPreviewResponse {
  project_dir: string;
  project_name: string;
  suggested_repo_name: string;
  gh_available: boolean;
  authenticated: boolean;
  username: string | null;
  is_git_repository: boolean;
  is_unborn: boolean;
  is_detached: boolean;
  current_branch: string | null;
  head_commit: string | null;
  committed_ready: boolean;
  uncommitted_staged_count: number;
  uncommitted_unstaged_count: number;
  untracked_count: number;
  existing_remotes: GitRemoteInfo[];
  blockers: string[];
  warnings: string[];
}

export interface GitHubSyncPrecheckResponse {
  operation: "fetch" | "pull" | "push";
  project_dir: string;
  current_branch: string | null;
  target_remote: string | null;
  upstream: string | null;
  needs_upstream_setup: boolean;
  is_unborn: boolean;
  is_detached: boolean;
  ahead: number;
  behind: number;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  conflicted_count: number;
  dirty_paths: string[];
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export interface GitHubRemoteRepoDetail {
  owner_repo: string;
  url: string;
  ssh_url: string | null;
  visibility: string | null;
  description: string | null;
  default_branch: string | null;
  remote_branches: string[];
  current_branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}
