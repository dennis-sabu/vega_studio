"use client";

import { useId, useState, type ReactNode } from "react";

interface TooltipProps {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

const POSITION_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/12 bg-[#0e101a]/95 px-2.5 py-1 text-[11px] font-medium text-[#e8ebf7] shadow-xl backdrop-blur-md ${POSITION_CLASSES[side]}`}
        >
          <span>{label}</span>
          {shortcut && (
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] font-semibold text-[#e8ebf7]/60">
              {shortcut}
            </kbd>
          )}
        </span>
      )}
    </span>
  );
}
