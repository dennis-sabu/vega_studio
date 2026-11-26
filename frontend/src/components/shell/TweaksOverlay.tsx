"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { SPECIES_MAP, type AtmosphereTweaks, type SpeciesKey } from "@/lib/glyphAnimalsEngine";
import { buildTweakGroups, type TweakControlSpec } from "@/lib/glyphTweaksConfig";

interface TweaksOverlayProps {
  open: boolean;
  species: SpeciesKey;
  tweaks: AtmosphereTweaks;
  onToggleOpen: (open: boolean) => void;
  onTweaksChange: (partial: Partial<AtmosphereTweaks>) => void;
  onResetTweaks: () => void;
}

export function TweaksOverlay({
  open,
  species,
  tweaks,
  onToggleOpen,
  onTweaksChange,
  onResetTweaks,
}: TweaksOverlayProps) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "console">("idle");
  const [activeHint, setActiveHint] = useState<string | null>(null);

  const defaults = SPECIES_MAP[species].defaults;
  const groups = buildTweakGroups(species);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 1400);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const handleCopyDiff = async () => {
    const diff: Record<string, number | boolean> = {};
    for (const key of Object.keys(tweaks) as Array<keyof AtmosphereTweaks>) {
      if (tweaks[key] !== defaults[key]) {
        diff[key] = tweaks[key];
      }
    }
    const payload = JSON.stringify({ species, overrides: diff }, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setCopyStatus("copied");
        return;
      }
    } catch {
      // Clipboard blocked or unavailable; log safely below.
    }
    console.info("[VEGA Studio Tweaks]", payload);
    setCopyStatus("console");
  };

  const handleResetClick = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    onResetTweaks();
  };

  if (!isClient) return null;

  if (!open) {
    return createPortal(
      <button
        type="button"
        onClick={() => onToggleOpen(true)}
        aria-label="Open canvas Tweaks"
        className="vega-tweaks-glass fixed right-4 top-[52px] z-[80] inline-flex h-[34px] items-center gap-1.5 rounded-full px-3.5 pl-3 text-[13px] font-medium text-[#ffffff] transition-colors hover:border-white/25 hover:text-white max-[720px]:top-auto max-[720px]:bottom-8 max-[720px]:right-3"
      >
      <SlidersHorizontal className="h-[15px] w-[15px] text-[#7aa2ff]" />
        <span>Tweaks</span>
      </button>,
      document.body
    );
  }

  return createPortal(
    <aside
      aria-label="Glyph Animals Tweaks"
      className="vega-tweaks-glass fixed right-4 top-[52px] z-[80] flex max-h-[calc(100vh-110px)] w-[288px] flex-col rounded-[20px] text-[12px] text-[#ffffff] max-[720px]:left-3 max-[720px]:right-3 max-[720px]:top-auto max-[720px]:bottom-8 max-[720px]:max-h-[70vh] max-[720px]:w-auto"
      style={{ ["--blur" as string]: "18px" }}
    >
      {/* Tooltip rendered strictly left of the aside when hovering/focusing a control */}
      {activeHint && (
        <div
          role="status"
          className="pointer-events-none absolute right-[calc(100%+10px)] top-3 hidden w-[240px] rounded-[12px] border border-white/[0.22] bg-white/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-[#ffffff] shadow-2xl md:block"
        >
        <p className="m-0 text-[#ffffff]">{activeHint}</p>
        <p className="mt-1 m-0 font-mono text-[10px] text-[#d4def5]">
            Double-click the name to reset it.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.18] px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#7aa2ff]" />
          <span className="text-[13px] font-medium text-[#ffffff]">Tweaks</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopyDiff()}
            className="inline-flex h-[26px] items-center gap-1 rounded-full border border-white/[0.19] bg-white/[0.06] px-2.5 text-[11px] font-medium text-[#ffffff] transition-colors hover:bg-white/[0.14]"
          >
            {copyStatus === "copied" ? (
              <>
              <Check className="h-3 w-3 text-emerald-300" />
                <span>Copied</span>
              </>
            ) : copyStatus === "console" ? (
              <span>In console</span>
            ) : (
              <>
              <Copy className="h-3 w-3 text-[#d4def5]" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleResetClick}
            className={`inline-flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
              confirmReset
                ? "border-red-400/50 bg-red-500/25 text-red-100"
                : "border-white/[0.19] bg-white/[0.06] text-[#ffffff] hover:bg-white/[0.14]"
            }`}
          >
          <RotateCcw className="h-3 w-3" />
            <span>{confirmReset ? "Reset all? " : "Reset"}</span>
          </button>

          <button
            type="button"
            aria-label="Close Tweaks"
            onClick={() => {
              setActiveHint(null);
              onToggleOpen(false);
            }}
            className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/[0.18] bg-white/[0.09] text-[#ffffff] transition-colors hover:bg-white/[0.14]"
          >
          <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Groups */}
      <div className="vega-scroll flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pt-2 pb-3.5">
        {groups.map((group) => {
          const visibleControls = group.controls.filter(
            (ctrl) => !ctrl.hiddenFor?.includes(species)
          );
          if (visibleControls.length === 0) return null;

          return (
          <div key={group.id} className="space-y-2">
            <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#d4def5] uppercase">
                {group.title}
              </div>

              <div className="space-y-2">
                {visibleControls.map((ctrl: TweakControlSpec) => {
                  if (ctrl.type === "toggle") {
                    const checked = Boolean(tweaks[ctrl.key]);
                    return (
                      <div
                        key={ctrl.key}
                        onMouseEnter={() => setActiveHint(ctrl.hint)}
                        onMouseLeave={() => setActiveHint(null)}
                        onFocus={() => setActiveHint(ctrl.hint)}
                        onBlur={() => setActiveHint(null)}
                        className="flex items-center justify-between py-0.5"
                      >
                        <button
                          type="button"
                          onDoubleClick={() =>
                            onTweaksChange({ [ctrl.key]: defaults[ctrl.key] })
                          }
                          className="cursor-default text-left text-[12px] text-[#f2f5ff] hover:text-white"
                        >
                          {ctrl.label}
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={ctrl.label}
                          onClick={() => onTweaksChange({ [ctrl.key]: !checked })}
                          className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
                            checked ? "bg-[#7aa2ff]" : "bg-white/20"
                          }`}
                        >
                          <span
                            className={`block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
                              checked ? "translate-x-[14px]" : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  }

                  const rawVal = Number(tweaks[ctrl.key]);
                  const isDisabled = ctrl.disabled ? ctrl.disabled(tweaks) : false;
                  const pct = ((rawVal - ctrl.min) / (ctrl.max - ctrl.min)) * 100;

                  return (
                    <div
                      key={ctrl.key}
                      onMouseEnter={() => setActiveHint(ctrl.hint)}
                      onMouseLeave={() => setActiveHint(null)}
                      onFocus={() => setActiveHint(ctrl.hint)}
                      onBlur={() => setActiveHint(null)}
                      className={`grid grid-cols-[1fr_auto] items-center gap-x-2 transition-opacity ${
                        isDisabled ? "opacity-40" : "opacity-100"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={isDisabled}
                        onDoubleClick={() =>
                          onTweaksChange({ [ctrl.key]: defaults[ctrl.key] })
                        }
                        className="cursor-default text-left text-[12px] text-[#f2f5ff] hover:text-white disabled:cursor-not-allowed"
                      >
                        {ctrl.label}
                      </button>
                      <span className="font-mono text-[11px] font-semibold text-[#e5ecfc]">
                        {rawVal.toFixed(ctrl.decimals)}
                        {ctrl.unit ?? ""}
                      </span>
                      <input
                        type="range"
                        aria-label={ctrl.label}
                        min={ctrl.min}
                        max={ctrl.max}
                        step={ctrl.step}
                        disabled={isDisabled}
                        value={rawVal}
                        onChange={(e) =>
                          onTweaksChange({ [ctrl.key]: parseFloat(e.target.value) })
                        }
                        style={{ ["--fill" as string]: `${pct.toFixed(1)}%` }}
                        className="vega-slider col-span-2"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>,
    document.body
  );
}
