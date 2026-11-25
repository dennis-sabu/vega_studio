export type GitFileStatusCode =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "unmerged"
  | "untracked";

export type GitRepoState =
  | "clean"
  | "dirty"
  | "unborn"
  | "detached"
  | "merging"
  | "rebasing"
  | "cherry_picking"
  | "not_a_repo"
  | "git_unavailable";

export interface GitFileChange {
  path: string;
  orig_path: string | null;
  status: GitFileStatusCode;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  xy: string;
}

export interface GitInfoResponse {
  git_available: boolean;
  git_version: string | null;
  git_executable: string | null;
  install_guide_url: string;
  unavailable_reason: string | null;
  project_dir: string | null;
  is_repository: boolean;
  repo_root: string | null;
  has_parent_repo: boolean;
  parent_repo_root: string | null;
  identity_configured: boolean;
  user_name: string | null;
  user_email: string | null;
}

export interface GitStatusResponse {
  git_available: boolean;
  git_version: string | null;
  project_dir: string;
  is_repository: boolean;
  repo_root: string | null;
  has_parent_repo: boolean;
  parent_repo_root: string | null;
  repo_state: GitRepoState;
  current_branch: string | null;
  head_commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  is_unborn: boolean;
  is_detached: boolean;
  staged_files: GitFileChange[];
  unstaged_files: GitFileChange[];
  untracked_files: GitFileChange[];
  conflicted_files: GitFileChange[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  identity_configured: boolean;
  user_name: string | null;
  user_email: string | null;
  warnings: string[];
}

export interface GitCommitResponse {
  commit_hash: string;
  short_hash: string;
  branch: string | null;
  summary: string;
  status: GitStatusResponse;
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  commit_hash: string;
  short_hash: string;
  subject: string;
  committer_date: string | null;
}

export interface GitBranchesResponse {
  current_branch: string | null;
  is_detached: boolean;
  is_unborn: boolean;
  branches: GitBranchInfo[];
}

export interface GitSwitchPrecheckResponse {
  target_branch: string;
  has_uncommitted_changes: boolean;
  potentially_affected_files: string[];
  dirty_files: string[];
  warning: string | null;
}

export interface GitBranchActionResponse {
  active_branch: string | null;
  status: GitStatusResponse;
  branches: GitBranchInfo[];
}

export interface GitCommitSummary {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  subject: string;
  parents: string[];
}

export interface GitHistoryResponse {
  branch: string | null;
  limit: number;
  offset: number;
  has_more: boolean;
  commits: GitCommitSummary[];
}

export interface GitCommitFileStat {
  path: string;
  orig_path: string | null;
  status: GitFileStatusCode;
  insertions: number | null;
  deletions: number | null;
  is_binary: boolean;
}

export interface GitCommitDetailResponse {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  subject: string;
  body: string;
  parents: string[];
  files: GitCommitFileStat[];
  total_insertions: number;
  total_deletions: number;
  unified_diff: string;
  diff_truncated: boolean;
  diff_bytes: number;
}

export interface GitDiffResponse {
  path: string;
  change_type: GitFileStatusCode;
  staged: boolean;
  commit: string | null;
  is_binary: boolean;
  too_large: boolean;
  truncated: boolean;
  total_bytes: number;
  added_lines: number;
  removed_lines: number;
  unified_diff: string;
  original_content: string | null;
  modified_content: string | null;
  note: string | null;
}

export type GitConfirmDialogState =
  | {
      kind: "discard";
      paths: string[];
    }
  | {
      kind: "delete_untracked";
      paths: string[];
    }
  | {
      kind: "switch_warning";
      branchName: string;
      precheck: GitSwitchPrecheckResponse;
    };
