"use client";

import { Circle, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HealthResponse } from "@/lib/api";

interface StatusBarProps {
  isConnected: boolean;
  health: HealthResponse | null;
  error: string | null;
}

export function StatusBar({ isConnected, health, error }: StatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 select-none">
      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          title={
            isConnected
              ? `Connected to ${health?.service ?? "backend"} v${health?.version ?? "0.1.0"}`
              : error ?? "Backend unreachable"
          }
          className={
            isConnected
              ? "h-5 gap-1.5 rounded-sm border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-400"
              : "h-5 gap-1.5 rounded-sm border-red-500/30 bg-red-500/10 px-2 text-[11px] font-medium text-red-400"
          }
        >
          <Circle
            className={
              isConnected
                ? "h-2 w-2 fill-emerald-400 text-emerald-400"
                : "h-2 w-2 fill-red-400 text-red-400"
            }
          />
          {isConnected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span>
            {isConnected ? "Backend: Connected" : "Backend: Disconnected"}
          </span>
        </Badge>

        {health?.version && isConnected && (
          <span className="font-mono text-[11px] text-zinc-500">
            v{health.version}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-500">
        <span>VEGA Studio</span>
        <span>UTF-8</span>
      </div>
    </footer>
  );
}
