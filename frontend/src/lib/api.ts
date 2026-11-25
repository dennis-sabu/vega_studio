export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

export interface StatusResponse {
  status: string;
  backend: Record<string, unknown>;
  platform: Record<string, unknown>;
}

export interface VegaStudioBridge {
  getBackendUrl?: () => string;
  getVersion?: () => string;
  getPlatform?: () => string;
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
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(
      `Request failed with status ${response.status}`,
      response.status
    );
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
