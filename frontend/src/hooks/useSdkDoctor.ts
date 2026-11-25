"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  discoverSdk,
  fetchSdkConfig,
  fetchSdkDiagnostics,
  resetSdkConfig,
  runSdkDiagnostics,
  updateSdkConfig,
} from "@/lib/api";
import type {
  SdkConfig,
  SdkConfigStateResponse,
  SdkDiscoveryResult,
  SdkDoctorReport,
} from "@/types/sdk";

interface UseSdkDoctorOptions {
  isBackendConnected: boolean;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export interface BrowseOutcome {
  supported: boolean;
  canceled: boolean;
  path: string | null;
}

export function useSdkDoctor({
  isBackendConnected,
  onLog,
}: UseSdkDoctorOptions) {
  const [configState, setConfigState] = useState<SdkConfigStateResponse | null>(
    null
  );
  const [report, setReport] = useState<SdkDoctorReport | null>(null);
  const [discovery, setDiscovery] = useState<SdkDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hasElectronBrowse, setHasElectronBrowse] = useState(false);

  const onLogRef = useRef(onLog);
  useEffect(() => {
    onLogRef.current = onLog;
  });

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const bridge =
        typeof window !== "undefined" ? window.vegaStudio : undefined;
      setHasElectronBrowse(Boolean(bridge?.selectDirectory && bridge?.selectFile));
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshState = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [cfg, diag] = await Promise.all([
        fetchSdkConfig(signal),
        fetchSdkDiagnostics(signal),
      ]);
      if (signal?.aborted) return;
      setConfigState(cfg);
      setReport(diag);
      setError(null);
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load SDK configuration & diagnostics.";
      setError(message);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isBackendConnected) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void refreshState(controller.signal);
      }
    });
    return () => controller.abort();
  }, [isBackendConnected, refreshState]);

  const browseDirectory = useCallback(
    async (title: string, defaultPath?: string): Promise<BrowseOutcome> => {
      const picker =
        typeof window !== "undefined"
          ? window.vegaStudio?.selectDirectory
          : undefined;
      if (!picker) {
        return { supported: false, canceled: true, path: null };
      }
      const res = await picker({ title, defaultPath });
      return { supported: true, canceled: res.canceled, path: res.path };
    },
    []
  );

  const browseFile = useCallback(
    async (title: string, defaultPath?: string): Promise<BrowseOutcome> => {
      const picker =
        typeof window !== "undefined"
          ? window.vegaStudio?.selectFile
          : undefined;
      if (!picker) {
        return { supported: false, canceled: true, path: null };
      }
      const res = await picker({ title, defaultPath });
      return { supported: true, canceled: res.canceled, path: res.path };
    },
    []
  );

  const runDiagnostics = useCallback(
    async (configOverride?: SdkConfig): Promise<SdkDoctorReport | null> => {
      if (!isBackendConnected) {
        setError(
          "FastAPI backend is disconnected. Start the backend before running SDK Doctor."
        );
        return null;
      }
      setRunningDiagnostics(true);
      setError(null);
      try {
        const result = await runSdkDiagnostics(configOverride);
        setReport(result);
        setFeedback(
          `Diagnostics finished: ${result.summary.passed} passed, ${result.summary.warning} warnings, ${result.summary.failed} failed.`
        );
        onLogRef.current?.(
          result.overall_status === "fail"
            ? "error"
            : result.overall_status === "warning"
            ? "warn"
            : "info",
          `SDK Doctor check: ${result.overall_status.toUpperCase()} (${result.summary.passed}/${result.summary.total} passed, ${result.summary.warning} warn, ${result.summary.failed} fail)`
        );
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to run SDK Doctor diagnostics.";
        setError(message);
        onLogRef.current?.("error", `SDK Doctor error: ${message}`);
        return null;
      } finally {
        setRunningDiagnostics(false);
      }
    },
    [isBackendConnected]
  );

  const runDiscovery = useCallback(
    async (applyToConfig = false): Promise<SdkDiscoveryResult | null> => {
      if (!isBackendConnected) {
        setError(
          "FastAPI backend is disconnected. Start the backend before running SDK discovery."
        );
        return null;
      }
      setDiscovering(true);
      setError(null);
      try {
        const result = await discoverSdk(applyToConfig);
        setDiscovery(result);
        if (applyToConfig) {
          await refreshState();
          setFeedback(
            "Discovered SDK & toolchain paths saved to application settings."
          );
          onLogRef.current?.(
            "info",
            "Auto-detected VEGA SDK paths applied to local configuration."
          );
        } else {
          setFeedback("Completed bounded SDK & toolchain discovery.");
        }
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to discover SDK paths.";
        setError(message);
        onLogRef.current?.("error", `SDK discovery error: ${message}`);
        return null;
      } finally {
        setDiscovering(false);
      }
    },
    [isBackendConnected, refreshState]
  );

  const saveConfig = useCallback(
    async (
      nextConfig: SdkConfig,
      options?: { runCheckAfter?: boolean }
    ): Promise<SdkConfigStateResponse | null> => {
      if (!isBackendConnected) {
        setError(
          "FastAPI backend is disconnected. Start the backend to save SDK settings."
        );
        return null;
      }
      setSavingConfig(true);
      setError(null);
      try {
        const updated = await updateSdkConfig(nextConfig);
        setConfigState(updated);
        if (options?.runCheckAfter) {
          await runDiagnostics();
        } else {
          const freshBaseline = await fetchSdkDiagnostics();
          setReport(freshBaseline);
          setFeedback("Saved SDK configuration.");
        }
        onLogRef.current?.("info", "Updated persistent VEGA SDK configuration.");
        return updated;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to save SDK configuration.";
        setError(message);
        onLogRef.current?.("error", `SDK config error: ${message}`);
        return null;
      } finally {
        setSavingConfig(false);
      }
    },
    [isBackendConnected, runDiagnostics]
  );

  const resetConfig = useCallback(async (): Promise<SdkConfigStateResponse | null> => {
    if (!isBackendConnected) {
      setError(
        "FastAPI backend is disconnected. Start the backend to reset SDK settings."
      );
      return null;
    }
    setSavingConfig(true);
    setError(null);
    try {
      const updated = await resetSdkConfig();
      setConfigState(updated);
      const baseline = await fetchSdkDiagnostics();
      setReport(baseline);
      setDiscovery(null);
      setFeedback("Reset SDK configuration to detected defaults.");
      onLogRef.current?.("info", "Reset VEGA SDK configuration to defaults.");
      return updated;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to reset SDK configuration.";
      setError(message);
      return null;
    } finally {
      setSavingConfig(false);
    }
  }, [isBackendConnected]);

  const clearFeedback = useCallback(() => {
    setError(null);
    setFeedback(null);
  }, []);

  return {
    configState,
    report,
    discovery,
    loading,
    runningDiagnostics,
    discovering,
    savingConfig,
    error,
    feedback,
    hasElectronBrowse,
    refreshState,
    browseDirectory,
    browseFile,
    runDiagnostics,
    runDiscovery,
    saveConfig,
    resetConfig,
    clearFeedback,
  };
}
