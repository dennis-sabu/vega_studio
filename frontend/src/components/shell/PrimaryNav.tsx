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
      className={`relative z-20 flex w-11 shrink-0 flex-col items-center justify-between border-r py-2 select-none ${
        isWorkspaceMode
          ? "border-[#2B2B2E] bg-[#181818]"
          : "vega-chrome-glass border-white/[0.14]"
      }`}
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
                className={`relative flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] ${
                  isActive
                    ? "bg-[#262629] text-[#F4F4F5]"
                    : isSelectedWhileCollapsed
                      ? "bg-[#222224] text-[#7AA2FF]"
                      : "text-[#A1A1AA] hover:bg-[#252528] hover:text-[#F4F4F5]"
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -left-1.5 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[#7AA2FF]"
                  />
                )}
                <Icon className="h-[17px] w-[17px]" />
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
            className={`flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] ${
              settingsOpen
                ? "bg-[#262629] text-[#F4F4F5]"
                : "text-[#A1A1AA] hover:bg-[#252528] hover:text-[#F4F4F5]"
            }`}
          >
            <Settings className="h-[17px] w-[17px]" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
