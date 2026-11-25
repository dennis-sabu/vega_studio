"use client";

import { Cpu, Wifi, WifiOff } from "lucide-react";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { Badge } from "@/components/ui/badge";
import { useBackendHealth } from "@/hooks/useBackendHealth";

// Created once instead of on every health-poll render.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

export default function HomePage() {
  const { isConnected, health, lastChecked, error } = useBackendHealth();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      <Toolbar />

      <main className="flex flex-1 flex-col items-center justify-center bg-zinc-900 p-8">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950/60 px-8 py-10 text-center shadow-lg">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-emerald-400">
            <Cpu className="h-6 w-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              VEGA Studio — Phase 1 Foundation
            </h1>
            <p className="text-xs text-zinc-400">
              Desktop IDE shell ready. Backend health is monitored automatically.
            </p>
          </div>

          <Badge
            variant="outline"
            className={
              isConnected
                ? "mt-1 h-7 gap-2 rounded-md border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-400"
                : "mt-1 h-7 gap-2 rounded-md border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-400"
            }
          >
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            <span>
              {isConnected ? "Backend: Connected" : "Backend: Disconnected"}
            </span>
          </Badge>

          <p className="font-mono text-[11px] text-zinc-500">
            {isConnected && health
              ? `${health.service} (${health.version})`
              : error ?? "Waiting for backend at http://127.0.0.1:8765"}
          </p>

          {lastChecked && (
            <p className="font-mono text-[10px] text-zinc-600">
              Last checked: {TIME_FORMAT.format(lastChecked)}
            </p>
          )}
        </div>
      </main>

      <StatusBar isConnected={isConnected} health={health} error={error} />
    </div>
  );
}
