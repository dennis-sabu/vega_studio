import type {
  CreateEntryPayload,
  DeleteEntryPayload,
  DirectoryListingResponse,
  EntryOperationResponse,
  FileStatResponse,
  RenameEntryPayload,
} from "@/types/explorer";
import type {
  CreateProjectPayload,
  OpenProjectPayload,
  WorkspaceStateResponse,
  WorkspaceSummary,
} from "@/types/project";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

export interface BackendInfo {
  service?: string;
  version?: string;
  env?: string;
  host?: string;
  port?: number;
  [key: string]: unknown;
}

export interface PlatformInfo {
  python_version?: string;
  os?: string;
  os_version?: string;
  architecture?: string;
  [key: string]: unknown;
}

export interface StatusResponse {
  status: string;
  backend: BackendInfo;
  platform: PlatformInfo;
}

export interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
}

export interface SelectDirectoryResult {
  canceled: boolean;
  path: string | null;
}

export interface VegaStudioBridge {
  getBackendUrl?: () => string;
  getVersion?: () => string;
  getPlatform?: () => string;
  selectDirectory?: (
    options?: SelectDirectoryOptions
  ) => Promise<SelectDirectoryResult>;
  getDefaultProjectsDir?: () => Promise<string>;
}

declare global {
  interface Window {
    vegaStudio?: VegaStudioBridge;
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8765";

export function getBackendUrl(): string {
  if (typeof window !== "undefined" && window.vegaStudio?.getBackendUrl) {
    return window.vegaStudio.getBackendUrl();
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND_URL;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const baseUrl = getBackendUrl().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detailMessage = `Request failed with status ${response.status}`;
    try {
      const errBody = (await response.json()) as { detail?: unknown };
      if (typeof errBody.detail === "string" && errBody.detail.trim()) {
        detailMessage = errBody.detail;
      }
    } catch {
      // Fall back to default HTTP error message.
    }
    throw new ApiError(detailMessage, response.status);
  }

  return (await response.json()) as T;
}

export async function fetchHealth(
  signal?: AbortSignal
): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health", { signal });
}

export async function fetchStatus(
  signal?: AbortSignal
): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status", { signal });
}

export async function fetchWorkspaceState(
  signal?: AbortSignal
): Promise<WorkspaceStateResponse> {
  return apiFetch<WorkspaceStateResponse>("/api/workspace", { signal });
}

export async function createProject(
  payload: CreateProjectPayload
): Promise<WorkspaceSummary> {
  return apiFetch<WorkspaceSummary>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function openProject(
  payload: OpenProjectPayload
): Promise<WorkspaceSummary> {
  return apiFetch<WorkspaceSummary>("/api/projects/open", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function closeWorkspace(): Promise<WorkspaceStateResponse> {
  return apiFetch<WorkspaceStateResponse>("/api/workspace/close", {
    method: "POST",
  });
}

export async function removeRecentProject(
  projectDir: string
): Promise<WorkspaceStateResponse> {
  return apiFetch<WorkspaceStateResponse>("/api/projects/recent/remove", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir }),
  });
}

export async function fetchDirectoryTree(
  projectDir: string,
  relativePath = "",
  showHidden = true,
  signal?: AbortSignal
): Promise<DirectoryListingResponse> {
  const params = new URLSearchParams({
    project_dir: projectDir,
    path: relativePath,
    show_hidden: String(showHidden),
  });
  return apiFetch<DirectoryListingResponse>(
    `/api/explorer/tree?${params.toString()}`,
    { signal }
  );
}

export async function fetchFileStat(
  projectDir: string,
  relativePath: string,
  signal?: AbortSignal
): Promise<FileStatResponse> {
  const params = new URLSearchParams({
    project_dir: projectDir,
    path: relativePath,
  });
  return apiFetch<FileStatResponse>(
    `/api/explorer/stat?${params.toString()}`,
    { signal }
  );
}

export async function createExplorerEntry(
  payload: CreateEntryPayload
): Promise<EntryOperationResponse> {
  return apiFetch<EntryOperationResponse>("/api/explorer/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function renameExplorerEntry(
  payload: RenameEntryPayload
): Promise<EntryOperationResponse> {
  return apiFetch<EntryOperationResponse>("/api/explorer/rename", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteExplorerEntry(
  payload: DeleteEntryPayload
): Promise<EntryOperationResponse> {
  return apiFetch<EntryOperationResponse>("/api/explorer/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
