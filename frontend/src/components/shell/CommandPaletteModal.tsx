"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from"react";
import { Command, CornerDownLeft, Search, X } from"lucide-react";

export interface CommandPaletteAction {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteModalProps {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
}

export function CommandPaletteModal({
  open,
  actions,
  onClose,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    });
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.keywords ?? "").toLowerCase().includes(q)
    );
  }, [actions, query]);

  const clampedIdx =
    filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) {
        setSelectedIndex((clampedIdx + 1) % filtered.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) {
        setSelectedIndex((clampedIdx - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[clampedIdx];
      if (target) {
        onClose();
        target.run();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="VEGA Studio Command Center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[56px] px-4 backdrop-blur-md"
    >
    <div className="vega-tweaks-glass flex w-full max-w-[620px] flex-col overflow-hidden rounded-[16px] border border-[#2D2D30] shadow-2xl">
      <div className="flex items-center gap-2.5 border-b border-[#2D2D30] px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-[#7AA2FF]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, view, file, or action..."
            className="w-full bg-transparent text-[13.5px] text-[#F4F4F5] placeholder:text-[#8E8E98] focus:outline-none"
          />
          <button
            type="button"
            aria-label="Close Command Palette"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#B4B4BC] hover:bg-[#2D2D31] hover:text-white"
          >
          <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="vega-scroll max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
            <Command className="h-5 w-5 text-[#A1A1AA]" />
            <p className="text-xs font-medium text-[#F4F4F5]">
                No commands matching &ldquo;{query}&rdquo;
              </p>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === clampedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onClose();
                    item.run();
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-[9px] px-3 py-2 text-left transition-colors ${
                    active
                      ? "border border-[#7AA2FF]/40 bg-[#7AA2FF]/20 text-white"
                      : "border border-transparent text-[#F4F4F5] hover:bg-[#252527]"
                  }`}
                >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 rounded border border-[#2D2D30] bg-[#252527] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#B4B4BC]">
                      {item.category}
                    </span>
                    <span className="truncate text-[12.5px] font-medium">
                      {item.label}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.shortcut && (
                    <kbd className="rounded border border-[#2D2D30] bg-[#141414] px-1.5 py-0.5 font-mono text-[10px] text-[#E4E4E7]">
                        {item.shortcut}
                      </kbd>
                    )}
                    {active && <CornerDownLeft className="h-3.5 w-3.5 text-[#7AA2FF]" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
