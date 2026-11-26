"use client";

import { type ComponentProps } from"react";
import { PanelRightClose, Sparkles } from"lucide-react";
import { NativeAiPanel } from"@/components/ai/NativeAiPanel";
import { Tooltip } from"@/components/ui/Tooltip";
import type { RightPanelTab } from"@/types/shell";

interface RightPanelProps {
  activeTab: RightPanelTab;
  width: number;
  onSelectTab: (tab: RightPanelTab) => void;
  onCollapse: () => void;
  nativeAiProps?: ComponentProps<typeof NativeAiPanel>;
}

export function RightPanel({
  activeTab,
  width,
  onSelectTab,
  onCollapse,
  nativeAiProps,
}: RightPanelProps) {
  return (
    <aside
      aria-label="VEGA Assistant Workspace"
      style={{ width: `${width}px` }}
      className="vega-panel-glass flex h-full min-h-0 shrink-0 flex-col border-l border-[#2D2D30] select-none"
    >
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[#2D2D30] bg-[#181818] px-2.5">
        <div
          role="tablist"
          aria-label="AI Workspace mode"
          className="inline-flex items-center gap-0.5 rounded-[6px] border border-[#2D2D30] bg-[#1F1F1F] p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "native-ai"}
            onClick={() => onSelectTab("native-ai")}
            className="inline-flex h-6 items-center gap-1.5 rounded-[4px] bg-[#7AA2FF]/16 px-2 text-[11px] font-medium text-[#F4F4F5] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
          >
          <Sparkles className="h-3 w-3 text-[#7AA2FF]" />
            <span>VEGA Assistant</span>
          </button>
        </div>

        <Tooltip
          label="Hide AI Workspace"
          shortcut="Ctrl+Shift+A"
          side="left"
        >
          <button
            type="button"
            aria-label="Hide Assistant Panel"
            onClick={onCollapse}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[#B4B4BC] transition-colors hover:bg-[#252527] hover:text-[#F4F4F5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF]/50"
          >
          <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {nativeAiProps ? (
          <NativeAiPanel {...nativeAiProps} />
        ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <span className="text-xs text-[#B4B4BC]">
              VEGA Assistant loading…
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
