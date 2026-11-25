"use client";

import { type ComponentProps } from "react";
import { PanelRightClose, Sparkles, TerminalSquare } from "lucide-react";
import { NativeAiPanel } from "@/components/ai/NativeAiPanel";
import { OpenCodePanel } from "@/components/opencode/OpenCodePanel";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RightPanelTab } from "@/types/shell";

interface RightPanelProps {
  activeTab: RightPanelTab;
  width: number;
  onSelectTab: (tab: RightPanelTab) => void;
  onCollapse: () => void;
  nativeAiProps?: ComponentProps<typeof NativeAiPanel>;
  opencodeProps?: ComponentProps<typeof OpenCodePanel>;
}

export function RightPanel({
  activeTab,
  width,
  onSelectTab,
  onCollapse,
  nativeAiProps,
  opencodeProps,
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
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {activeTab === "opencode" ? (
          opencodeProps ? (
            <OpenCodePanel {...opencodeProps} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <span className="text-xs text-[#e8ebf7]/40">OpenCode loading…</span>
            </div>
          )
        ) : nativeAiProps ? (
          <NativeAiPanel {...nativeAiProps} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <span className="text-xs text-[#e8ebf7]/40">VEGA AI Assistant loading…</span>
          </div>
        )}
      </div>
    </aside>
  );
}
