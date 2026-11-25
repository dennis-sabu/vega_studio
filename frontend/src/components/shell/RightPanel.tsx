"use client";

import { ArrowUp, PanelRightClose, Sparkles, TerminalSquare } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RightPanelTab } from "@/types/shell";

interface RightPanelProps {
  activeTab: RightPanelTab;
  width: number;
  onSelectTab: (tab: RightPanelTab) => void;
  onCollapse: () => void;
}

export function RightPanel({
  activeTab,
  width,
  onSelectTab,
  onCollapse,
}: RightPanelProps) {
  return (
    <aside
      aria-label="Assistant panel"
      style={{ width: `${width}px` }}
      className="vega-panel-glass flex h-full min-h-0 shrink-0 flex-col border-l border-white/[0.08] select-none"
    >
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#070910]/70 px-2.5">
        <div
          role="tablist"
          aria-label="Assistant modes"
          className="flex items-center gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "native-ai"}
            onClick={() => onSelectTab("native-ai")}
            className={`inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              activeTab === "native-ai"
                ? "bg-white/10 text-[#e8ebf7]"
                : "text-[#e8ebf7]/45 hover:bg-white/[0.05] hover:text-[#e8ebf7]/80"
            }`}
          >
            <Sparkles className="h-3 w-3 text-[#7aa2ff]" />
            <span>Native AI</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "opencode"}
            onClick={() => onSelectTab("opencode")}
            className={`inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              activeTab === "opencode"
                ? "bg-white/10 text-[#e8ebf7]"
                : "text-[#e8ebf7]/45 hover:bg-white/[0.05] hover:text-[#e8ebf7]/80"
            }`}
          >
            <TerminalSquare className="h-3 w-3 text-[#e8ebf7]/60" />
            <span>OpenCode</span>
          </button>
        </div>

        <Tooltip label="Hide Assistant Panel" shortcut="Ctrl+Shift+A" side="left">
          <button
            type="button"
            aria-label="Hide Assistant Panel"
            onClick={onCollapse}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[#e8ebf7]/45 transition-colors hover:bg-white/[0.07] hover:text-[#e8ebf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Body */}
      <div className="vega-scroll flex flex-1 flex-col justify-between gap-4 overflow-y-auto p-3.5">
        <div className="rounded-xl border border-white/8 bg-[#08090f] p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
              {activeTab === "native-ai"
                ? "API-Based Assistant"
                : "OpenCode CLI Agent"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#e8ebf7]/50">
              {activeTab === "native-ai" ? "Phase 12" : "Phase 11"}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[#e8ebf7]/60">
            {activeTab === "native-ai"
              ? "Project-aware code assistance, diff review, and permission-gated workspace tools will live in this dock."
              : "Dedicated PTY terminal running the actual OpenCode CLI inside your active project directory will launch independently here."}
          </p>
        </div>

        {/* Scoped Disabled Composer Preview (DESIGN_SYSTEM.md 24px glass card) */}
        <div
          aria-disabled="true"
          className="vega-glass rounded-[20px] p-3 opacity-55"
          style={{ ["--blur" as string]: "8px", ["--tint" as string]: "0.6" }}
        >
          <p className="px-1 pb-3 text-xs text-[#e8ebf7]/45">
            {activeTab === "native-ai"
              ? "Ask about ARIES V3 project... (Phase 12)"
              : "OpenCode CLI inactive (Phase 11)"}
          </p>
          <div className="flex items-center justify-between">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#e8ebf7]/45">
              Workspace Context
            </span>
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[#e8ebf7]/40"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
