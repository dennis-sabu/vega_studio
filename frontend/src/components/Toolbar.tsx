"use client";

import { memo } from "react";
import { Cpu, FolderOpen, Hammer, Play, Settings } from "lucide-react";

interface ToolbarButtonPlaceholder {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PLACEHOLDER_ACTIONS: ToolbarButtonPlaceholder[] = [
  { label: "Open Project", icon: FolderOpen },
  { label: "Build", icon: Hammer },
  { label: "Run", icon: Play },
];

// No props: memo keeps the toolbar from re-rendering on every health poll.
export const Toolbar = memo(function Toolbar() {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-zinc-100">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-emerald-400">
            <Cpu className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            VEGA Studio
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <nav
          aria-label="IDE toolbar actions"
          className="flex items-center gap-1"
        >
          {PLACEHOLDER_ACTIONS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled
              title={`${label} (coming in a future phase)`}
              className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-zinc-500 opacity-60 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed"
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
          Phase 1
        </span>
        <button
          type="button"
          disabled
          title="Settings (coming in a future phase)"
          aria-label="Settings"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 opacity-60 disabled:cursor-not-allowed"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
});
