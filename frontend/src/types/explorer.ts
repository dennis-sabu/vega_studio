export type EntryKind = "file" | "dir";

export interface FileNode {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  extension: string;
  has_children: boolean;
  accessible: boolean;
  error: string | null;
}

export interface DirectoryListingResponse {
  project_dir: string;
  relative_path: string;
  entries: FileNode[];
  truncated: boolean;
  total_count: number;
}

export interface FileStatResponse {
  name: string;
  relative_path: string;
  size: number;
  extension: string;
  language: string;
  is_binary: boolean;
  modified_at: string;
}

export interface CreateEntryPayload {
  project_dir: string;
  parent_path: string;
  name: string;
  kind: EntryKind;
}

export interface RenameEntryPayload {
  project_dir: string;
  target_path: string;
  new_name: string;
}

export interface DeleteEntryPayload {
  project_dir: string;
  target_path: string;
  recursive: boolean;
}

export interface EntryOperationResponse {
  ok: boolean;
  action: "create" | "rename" | "delete";
  relative_path: string;
  previous_path?: string | null;
  node: FileNode | null;
  message: string;
}

export interface OpenFileTab {
  path: string;
  name: string;
  extension: string;
  stat: FileStatResponse | null;
  loading: boolean;
  error: string | null;
}
