"use client";

import { useRef, type KeyboardEvent } from "react";
import {
  BookOpen,
  Cpu,
  Files,
  GitBranch,
  Settings,
  Stethoscope,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { PrimaryNavSection } from "@/types/shell";

interface PrimaryNavProps {
  activeNav: PrimaryNavSection;
  sidebarOpen: boolean;
  isWorkspaceMode: boolean;
  settingsOpen: boolean;
  onSelectNav: (section: PrimaryNavSection) => void;
  onToggleSettings: () => void;
}

interface NavItem {
  id: PrimaryNavSection;
  label: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: "explorer", label: "Explorer", shortcut: "Ctrl+Shift+E", icon: Files },
  { id: "git", label: "Source Control", shortcut: "Ctrl+Shift+G", icon: GitBranch },
  { id: "examples", label: "Examples & Docs", icon: BookOpen },
  { id: "sdk", label: "SDK & Doctor", icon: Stethoscope },
  { id: "tools", label: "Project & Board Tools", icon: Cpu },
];

export function PrimaryNav({
  activeNav,
  sidebarOpen,
  isWorkspaceMode,
  settingsOpen,
  onSelectNav,
  onToggleSettings,
}: PrimaryNavProps) {
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + delta + NAV_ITEMS.length) % NAV_ITEMS.length;
    btnRefs.current[nextIndex]?.focus();
  };

  return (
    <aside
      aria-label="Primary IDE navigation"
      className="vega-chrome-glass relative z-20 flex w-12 shrink-0 flex-col items-center justify-between border-r border-white/[0.08] py-2 select-none"
    >
      <nav
        aria-label="IDE activity sections"
        className="flex flex-col items-center gap-1"
      >
        {NAV_ITEMS.map(({ id, label, shortcut, icon: Icon }, idx) => {
          const isActive = isWorkspaceMode && activeNav === id && sidebarOpen;
          const isSelectedWhileCollapsed =
            isWorkspaceMode && activeNav === id && !sidebarOpen;

          return (
            <Tooltip key={id} label={label} shortcut={shortcut} side="right">
              <button
                ref={(el) => {
                  btnRefs.current[idx] = el;
                }}
                type="button"
                aria-label={label}
                aria-pressed={isActive}
                onClick={() => onSelectNav(id)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
                  isActive
                    ? "bg-white/10 text-[#e8ebf7]"
                    : isSelectedWhileCollapsed
                      ? "bg-white/[0.04] text-[#7aa2ff]"
                      : "text-[#e8ebf7]/45 hover:bg-white/[0.06] hover:text-[#e8ebf7]/80"
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -left-1.5 top-2 bottom-2 w-0.5 rounded-r bg-[#7aa2ff]"
                  />
                )}
                <Icon className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex flex-col items-center gap-1">
        <Tooltip label="Appearance & Shell Settings" side="right">
          <button
            type="button"
            onClick={onToggleSettings}
            aria-label="Appearance & Shell Settings"
            aria-pressed={settingsOpen}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              settingsOpen
                ? "bg-white/12 text-[#e8ebf7]"
                : "text-[#e8ebf7]/55 hover:bg-white/[0.06] hover:text-[#e8ebf7]"
            }`}
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
