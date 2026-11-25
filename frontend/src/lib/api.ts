import type {
  BoardCompatibilityReport,
  BoardListResponse,
  BoardProfile,
  ProjectBoardStatusResponse,
  SelectProjectBoardResponse,
} from "@/types/board";
import type {
  BuildHistoryResponse,
  BuildRequestPayload,
  BuildStateResponse,
  BuildSummary,
} from "@/types/build";
import type {
  CreateEntryPayload,
  DeleteEntryPayload,
  DirectoryListingResponse,
  EntryOperationResponse,
  FileReadResponse,
  FileStatResponse,
  FileWritePayload,
  FileWriteResponse,
  RenameEntryPayload,
} from "@/types/explorer";
import type {
  GitBranchActionResponse,
  GitBranchesResponse,
  GitCommitDetailResponse,
  GitCommitResponse,
  GitDiffResponse,
  GitHistoryResponse,
  GitInfoResponse,
  GitStatusResponse,
  GitSwitchPrecheckResponse,
} from "@/types/git";
import type {
  CreateProjectPayload,
  OpenProjectPayload,
  WorkspaceStateResponse,
  WorkspaceSummary,
} from "@/types/project";
import type {
  SdkConfig,
  SdkConfigStateResponse,
  SdkDiscoveryResult,
  SdkDoctorReport,
} from "@/types/sdk";
import type {
  SerialConnectRequestPayload,
  SerialSendRequestPayload,
  SerialStateResponse,
} from "@/types/serial";
import type {
  TerminalCloseResponse,
  TerminalResizePayload,
  TerminalSessionCreatePayload,
  TerminalSessionListResponse,
  TerminalSessionStateResponse,
  TerminalSessionSummary,
  TerminalShellsResponse,
} from "@/types/terminal";
import type {
  DeviceListResponse,
  UploadHistoryResponse,
  UploadPreflightRequestPayload,
  UploadPreflightResponse,
  UploadRequestPayload,
  UploadStateResponse,
  UploadSummary,
} from "@/types/upload";

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
  selectFile?: (
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

export async function fetchFileContent(
  projectDir: string,
  relativePath: string,
  signal?: AbortSignal
): Promise<FileReadResponse> {
  const params = new URLSearchParams({
    project_dir: projectDir,
    path: relativePath,
  });
  return apiFetch<FileReadResponse>(
    `/api/explorer/file?${params.toString()}`,
    { signal }
  );
}

export async function saveFileContent(
  payload: FileWritePayload
): Promise<FileWriteResponse> {
  return apiFetch<FileWriteResponse>("/api/explorer/file", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchSdkConfig(
  signal?: AbortSignal
): Promise<SdkConfigStateResponse> {
  return apiFetch<SdkConfigStateResponse>("/api/sdk/config", { signal });
}

export async function updateSdkConfig(
  config: SdkConfig
): Promise<SdkConfigStateResponse> {
  return apiFetch<SdkConfigStateResponse>("/api/sdk/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function resetSdkConfig(): Promise<SdkConfigStateResponse> {
  return apiFetch<SdkConfigStateResponse>("/api/sdk/config/reset", {
    method: "POST",
  });
}

export async function discoverSdk(
  applyToConfig = false
): Promise<SdkDiscoveryResult> {
  return apiFetch<SdkDiscoveryResult>("/api/sdk/discover", {
    method: "POST",
    body: JSON.stringify({ apply_to_config: applyToConfig }),
  });
}

export async function fetchSdkDiagnostics(
  signal?: AbortSignal
): Promise<SdkDoctorReport> {
  return apiFetch<SdkDoctorReport>("/api/sdk/diagnostics", { signal });
}

export async function runSdkDiagnostics(
  configOverride?: SdkConfig
): Promise<SdkDoctorReport> {
  return apiFetch<SdkDoctorReport>("/api/sdk/diagnostics/run", {
    method: "POST",
    body: JSON.stringify({ config_override: configOverride ?? null }),
  });
}

export function getBuildWsUrl(buildId: string): string {
  const baseUrl = getBackendUrl().replace(/\/+$/, "");
  const wsBase = baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/build/ws/${encodeURIComponent(buildId)}`;
}

export async function startFirmwareBuild(
  payload: BuildRequestPayload
): Promise<BuildSummary> {
  return apiFetch<BuildSummary>("/api/build/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cleanFirmwareBuild(
  payload: BuildRequestPayload
): Promise<BuildSummary> {
  return apiFetch<BuildSummary>("/api/build/clean", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelFirmwareBuild(
  buildId?: string
): Promise<BuildSummary> {
  const path = buildId
    ? `/api/build/${encodeURIComponent(buildId)}/cancel`
    : "/api/build/cancel";
  return apiFetch<BuildSummary>(path, { method: "POST" });
}

export async function fetchBuildState(
  signal?: AbortSignal
): Promise<BuildStateResponse> {
  return apiFetch<BuildStateResponse>("/api/build/state", { signal });
}

export async function fetchBuildHistory(
  signal?: AbortSignal
): Promise<BuildHistoryResponse> {
  return apiFetch<BuildHistoryResponse>("/api/build/history", { signal });
}

export async function clearBuildHistory(): Promise<BuildHistoryResponse> {
  return apiFetch<BuildHistoryResponse>("/api/build/history", {
    method: "DELETE",
  });
}

export async function clearBuildOutput(): Promise<BuildStateResponse> {
  return apiFetch<BuildStateResponse>("/api/build/output/clear", {
    method: "POST",
  });
}

export async function fetchBoards(
  signal?: AbortSignal
): Promise<BoardListResponse> {
  return apiFetch<BoardListResponse>("/api/boards", { signal });
}

export async function fetchBoardDetail(
  boardId: string,
  signal?: AbortSignal
): Promise<BoardProfile> {
  return apiFetch<BoardProfile>(`/api/boards/${encodeURIComponent(boardId)}`, {
    signal,
  });
}

export async function fetchProjectBoardStatus(
  projectDir: string,
  signal?: AbortSignal
): Promise<ProjectBoardStatusResponse> {
  const params = new URLSearchParams({ project_dir: projectDir });
  return apiFetch<ProjectBoardStatusResponse>(
    `/api/boards/project/status?${params.toString()}`,
    { signal }
  );
}

export async function selectProjectBoard(
  projectDir: string,
  boardId: string
): Promise<SelectProjectBoardResponse> {
  return apiFetch<SelectProjectBoardResponse>("/api/boards/project/select", {
    method: "POST",
    body: JSON.stringify({
      project_dir: projectDir,
      board_id: boardId,
    }),
  });
}

export async function validateBoardCompatibility(
  boardId: string
): Promise<BoardCompatibilityReport> {
  return apiFetch<BoardCompatibilityReport>("/api/boards/compatibility", {
    method: "POST",
    body: JSON.stringify({ board_id: boardId }),
  });
}

export function getUploadWsUrl(uploadId: string): string {
  const baseUrl = getBackendUrl().replace(/\/+$/, "");
  const wsBase = baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/upload/ws/${encodeURIComponent(uploadId)}`;
}

export async function fetchUploadDevices(
  signal?: AbortSignal
): Promise<DeviceListResponse> {
  return apiFetch<DeviceListResponse>("/api/upload/devices", { signal });
}

export async function runUploadPreflight(
  payload: UploadPreflightRequestPayload,
  signal?: AbortSignal
): Promise<UploadPreflightResponse> {
  return apiFetch<UploadPreflightResponse>("/api/upload/preflight", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export async function startFirmwareUpload(
  payload: UploadRequestPayload
): Promise<UploadSummary> {
  return apiFetch<UploadSummary>("/api/upload/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelFirmwareUpload(
  uploadId?: string
): Promise<UploadSummary> {
  const path = uploadId
    ? `/api/upload/${encodeURIComponent(uploadId)}/cancel`
    : "/api/upload/cancel";
  return apiFetch<UploadSummary>(path, { method: "POST" });
}

export async function fetchUploadState(
  signal?: AbortSignal
): Promise<UploadStateResponse> {
  return apiFetch<UploadStateResponse>("/api/upload/state", { signal });
}

export async function fetchUploadHistory(
  signal?: AbortSignal
): Promise<UploadHistoryResponse> {
  return apiFetch<UploadHistoryResponse>("/api/upload/history", { signal });
}

export async function clearUploadHistory(): Promise<UploadHistoryResponse> {
  return apiFetch<UploadHistoryResponse>("/api/upload/history", {
    method: "DELETE",
  });
}

export async function clearUploadOutput(): Promise<UploadStateResponse> {
  return apiFetch<UploadStateResponse>("/api/upload/output/clear", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Phase 10: Serial Monitor
// ---------------------------------------------------------------------------

export function getSerialWsUrl(): string {
  const baseUrl = getBackendUrl().replace(/\/+$/, "");
  const wsBase = baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/serial/ws`;
}

export async function fetchSerialDevices(
  signal?: AbortSignal
): Promise<DeviceListResponse> {
  return apiFetch<DeviceListResponse>("/api/serial/devices", { signal });
}

export async function fetchSerialState(
  signal?: AbortSignal
): Promise<SerialStateResponse> {
  return apiFetch<SerialStateResponse>("/api/serial/state", { signal });
}

export async function connectSerial(
  payload: SerialConnectRequestPayload
): Promise<SerialStateResponse> {
  return apiFetch<SerialStateResponse>("/api/serial/connect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectSerial(): Promise<SerialStateResponse> {
  return apiFetch<SerialStateResponse>("/api/serial/disconnect", {
    method: "POST",
  });
}

export async function sendSerialData(
  payload: SerialSendRequestPayload
): Promise<SerialStateResponse> {
  return apiFetch<SerialStateResponse>("/api/serial/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clearSerialOutput(): Promise<SerialStateResponse> {
  return apiFetch<SerialStateResponse>("/api/serial/output/clear", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Phase 11: Integrated Terminal
// ---------------------------------------------------------------------------

export function getTerminalWsUrl(sessionId: string): string {
  const baseUrl = getBackendUrl().replace(/\/+$/, "");
  const wsBase = baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/terminal/ws/${encodeURIComponent(sessionId)}`;
}

export async function fetchTerminalShells(
  signal?: AbortSignal
): Promise<TerminalShellsResponse> {
  return apiFetch<TerminalShellsResponse>("/api/terminal/shells", { signal });
}

export async function fetchTerminalSessions(
  signal?: AbortSignal
): Promise<TerminalSessionListResponse> {
  return apiFetch<TerminalSessionListResponse>("/api/terminal/sessions", {
    signal,
  });
}

export async function createTerminalSession(
  payload: TerminalSessionCreatePayload
): Promise<TerminalSessionStateResponse> {
  return apiFetch<TerminalSessionStateResponse>("/api/terminal/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTerminalSessionState(
  sessionId: string,
  signal?: AbortSignal
): Promise<TerminalSessionStateResponse> {
  return apiFetch<TerminalSessionStateResponse>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}`,
    { signal }
  );
}

export async function resizeTerminalSession(
  sessionId: string,
  payload: TerminalResizePayload
): Promise<TerminalSessionSummary> {
  return apiFetch<TerminalSessionSummary>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}/resize`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function restartTerminalSession(
  sessionId: string
): Promise<TerminalSessionStateResponse> {
  return apiFetch<TerminalSessionStateResponse>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}/restart`,
    { method: "POST" }
  );
}

export async function clearTerminalReplay(
  sessionId: string
): Promise<TerminalSessionSummary> {
  return apiFetch<TerminalSessionSummary>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}/clear`,
    { method: "POST" }
  );
}

export async function closeTerminalSession(
  sessionId: string
): Promise<TerminalCloseResponse> {
  return apiFetch<TerminalCloseResponse>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Phase 12: Native Git Integration
// ---------------------------------------------------------------------------

export async function fetchGitInfo(
  projectDir?: string,
  signal?: AbortSignal
): Promise<GitInfoResponse> {
  const qs = projectDir
    ? `?${new URLSearchParams({ project_dir: projectDir }).toString()}`
    : "";
  return apiFetch<GitInfoResponse>(`/api/git/info${qs}`, { signal });
}

export async function fetchGitStatus(
  projectDir: string,
  signal?: AbortSignal
): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ project_dir: projectDir });
  return apiFetch<GitStatusResponse>(`/api/git/status?${params.toString()}`, {
    signal,
  });
}

export async function refreshGitStatus(
  projectDir: string
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/refresh", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir }),
  });
}

export async function initGitRepository(
  projectDir: string
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/init", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir }),
  });
}

export async function stageGitPaths(
  projectDir: string,
  paths: string[]
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/stage", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, paths }),
  });
}

export async function stageAllGitChanges(
  projectDir: string
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/stage-all", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir }),
  });
}

export async function unstageGitPaths(
  projectDir: string,
  paths: string[]
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/unstage", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, paths }),
  });
}

export async function unstageAllGitChanges(
  projectDir: string
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/unstage-all", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir }),
  });
}

export async function discardGitChanges(
  projectDir: string,
  paths: string[],
  confirm: boolean
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/discard", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, paths, confirm }),
  });
}

export async function deleteUntrackedGitFiles(
  projectDir: string,
  paths: string[],
  confirm: boolean
): Promise<GitStatusResponse> {
  return apiFetch<GitStatusResponse>("/api/git/delete-untracked", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, paths, confirm }),
  });
}

export async function commitGitChanges(
  projectDir: string,
  message: string
): Promise<GitCommitResponse> {
  return apiFetch<GitCommitResponse>("/api/git/commit", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, message }),
  });
}

export async function fetchGitBranches(
  projectDir: string,
  signal?: AbortSignal
): Promise<GitBranchesResponse> {
  const params = new URLSearchParams({ project_dir: projectDir });
  return apiFetch<GitBranchesResponse>(
    `/api/git/branches?${params.toString()}`,
    { signal }
  );
}

export async function precheckGitBranchSwitch(
  projectDir: string,
  name: string
): Promise<GitSwitchPrecheckResponse> {
  const params = new URLSearchParams({ project_dir: projectDir, name });
  return apiFetch<GitSwitchPrecheckResponse>(
    `/api/git/branches/precheck?${params.toString()}`
  );
}

export async function switchGitBranch(
  projectDir: string,
  name: string
): Promise<GitBranchActionResponse> {
  return apiFetch<GitBranchActionResponse>("/api/git/branches/switch", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, name }),
  });
}

export async function createGitBranch(
  projectDir: string,
  name: string,
  checkout: boolean = true
): Promise<GitBranchActionResponse> {
  return apiFetch<GitBranchActionResponse>("/api/git/branches/create", {
    method: "POST",
    body: JSON.stringify({ project_dir: projectDir, name, checkout }),
  });
}

export async function fetchGitHistory(
  projectDir: string,
  limit: number = 25,
  offset: number = 0,
  signal?: AbortSignal
): Promise<GitHistoryResponse> {
  const params = new URLSearchParams({
    project_dir: projectDir,
    limit: String(limit),
    offset: String(offset),
  });
  return apiFetch<GitHistoryResponse>(
    `/api/git/history?${params.toString()}`,
    { signal }
  );
}

export async function fetchGitCommitDetail(
  projectDir: string,
  commitHash: string,
  signal?: AbortSignal
): Promise<GitCommitDetailResponse> {
  const params = new URLSearchParams({ project_dir: projectDir });
  return apiFetch<GitCommitDetailResponse>(
    `/api/git/commit/${encodeURIComponent(commitHash)}?${params.toString()}`,
    { signal }
  );
}

export async function fetchGitDiff(
  projectDir: string,
  path: string,
  options?: {
    staged?: boolean;
    commit?: string | null;
    signal?: AbortSignal;
  }
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({
    project_dir: projectDir,
    path,
    staged: String(Boolean(options?.staged)),
  });
  if (options?.commit) {
    params.set("commit", options.commit);
  }
  return apiFetch<GitDiffResponse>(`/api/git/diff?${params.toString()}`, {
    signal: options?.signal,
  });
}
