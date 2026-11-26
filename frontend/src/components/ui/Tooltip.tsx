"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

interface TooltipCoords {
  left: number;
  top: number;
  transform: string;
}

export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open || !anchorRef.current) return;

    const computeCoords = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const estWidth = Math.min(
        320,
        Math.max(96, label.length * 6.8 + (shortcut ? shortcut.length * 7 + 28 : 24))
      );
      const pad = 8;

      let effectiveSide = side;
      if (effectiveSide === "bottom" && r.bottom + 42 > vh) effectiveSide = "top";
      else if (effectiveSide === "top" && r.top - 42 < 0) effectiveSide = "bottom";
      else if (effectiveSide === "left" && r.left - estWidth - 12 < 0) effectiveSide = "right";
      else if (effectiveSide === "right" && r.right + estWidth + 12 > vw) effectiveSide = "left";

      if (effectiveSide === "top" || effectiveSide === "bottom") {
        const half = estWidth / 2;
        const centerX = Math.max(
          pad + half,
          Math.min(r.left + r.width / 2, vw - pad - half)
        );
        if (effectiveSide === "top") {
          setCoords({
            left: centerX,
            top: Math.max(pad, r.top - 8),
            transform: "translate(-50%, -100%)",
          });
        } else {
          setCoords({
            left: centerX,
            top: Math.min(vh - pad - 28, r.bottom + 8),
            transform: "translate(-50%, 0)",
          });
        }
      } else {
        const centerY = Math.max(20, Math.min(r.top + r.height / 2, vh - 20));
        if (effectiveSide === "left") {
          setCoords({
            left: Math.max(pad + estWidth, r.left - 8),
            top: centerY,
            transform: "translate(-100%, -50%)",
          });
        } else {
          setCoords({
            left: Math.min(vw - pad - estWidth, r.right + 8),
            top: centerY,
            transform: "translate(0, -50%)",
          });
        }
      }
    };

    computeCoords();
    window.addEventListener("resize", computeCoords);
    return () => window.removeEventListener("resize", computeCoords);
  }, [label, open, shortcut, side]);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        setCoords(null);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => {
        setOpen(false);
        setCoords(null);
      }}
    >
      {children}
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            style={{
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              transform: coords.transform,
            }}
            className="pointer-events-none fixed z-[140] flex items-center gap-2 whitespace-nowrap rounded-lg border border-[#333336] bg-[#1C1C1F] px-2.5 py-1 text-[11px] font-medium text-[#F4F4F5] shadow-2xl"
          >
            <span>{label}</span>
            {shortcut && (
              <kbd className="rounded border border-[#333336] bg-[#262629] px-1 py-0.5 font-mono text-[10px] font-semibold text-[#D4D4D8]">
                {shortcut}
              </kbd>
            )}
          </span>,
          document.body
        )}
    </span>
  );
}
