"use client";

import { useEffect, useRef, useState } from "react";
import { fetchHealth, type HealthResponse } from "@/lib/api";

export type BackendConnectionStatus = "connected" | "disconnected";

export interface UseBackendHealthOptions {
  onStatusChange?: (connected: boolean, detail: string) => void;
}

export interface UseBackendHealthResult {
  isConnected: boolean;
  status: BackendConnectionStatus;
  health: HealthResponse | null;
  lastChecked: Date | null;
  error: string | null;
}

const REQUEST_TIMEOUT_MS = 2000;
// Poll quickly while connected, back off while the backend is down so a
// disconnected backend does not hammer the UI thread (or the logs) forever.
const CONNECTED_INTERVAL_MS = 5000;
const DISCONNECTED_INTERVAL_MS = 1500;
const MAX_BACKOFF_MS = 10000;

interface HealthState {
  isConnected: boolean;
  health: HealthResponse | null;
  lastChecked: Date | null;
  error: string | null;
}

const INITIAL_STATE: HealthState = {
  isConnected: false,
  health: null,
  lastChecked: null,
  error: null,
};

export function useBackendHealth(
  options?: UseBackendHealthOptions
): UseBackendHealthResult {
  const [state, setState] = useState<HealthState>(INITIAL_STATE);
  const onStatusChangeRef = useRef(options?.onStatusChange);
  const lastReportedRef = useRef<boolean | null>(null);

  useEffect(() => {
    onStatusChangeRef.current = options?.onStatusChange;
  });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let failures = 0;

    const schedule = (delayMs: number): void => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void pollHealth();
      }, delayMs);
    };

    async function pollHealth(): Promise<void> {
      if (!active || inFlight) return;

      // No point polling while the window is hidden (minimized / background).
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      inFlight = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const data = await fetchHealth(controller.signal);
        if (!active) return;

        failures = 0;
        const healthy = data.status === "ok";
        if (lastReportedRef.current !== healthy) {
          lastReportedRef.current = healthy;
          onStatusChangeRef.current?.(
            healthy,
            healthy
              ? `Connected to ${data.service} v${data.version}`
              : `Unexpected health status: ${data.status}`
          );
        }
        setState({
          isConnected: healthy,
          health: data,
          lastChecked: new Date(),
          error: healthy ? null : `Unexpected health status: ${data.status}`,
        });
        schedule(CONNECTED_INTERVAL_MS);
      } catch (err: unknown) {
        if (!active) return;

        failures += 1;
        const nextError =
          err instanceof Error
            ? err.name === "AbortError"
              ? "Request timed out"
              : err.message
            : "Backend unreachable";
        if (lastReportedRef.current !== false) {
          lastReportedRef.current = false;
          onStatusChangeRef.current?.(false, nextError);
        }
        setState({
          isConnected: false,
          health: null,
          lastChecked: new Date(),
          error: nextError,
        });

        const backoff = Math.min(
          DISCONNECTED_INTERVAL_MS * 2 ** Math.min(failures - 1, 3),
          MAX_BACKOFF_MS
        );
        schedule(backoff);
      } finally {
        clearTimeout(timeoutId);
        inFlight = false;
      }
    }

    // Check immediately, then keep polling.
    void pollHealth();

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        failures = 0;
        void pollHealth();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return {
    isConnected: state.isConnected,
    status: state.isConnected ? "connected" : "disconnected",
    health: state.health,
    lastChecked: state.lastChecked,
    error: state.error,
  };
}
