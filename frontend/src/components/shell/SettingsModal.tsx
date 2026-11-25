"use client";

import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import {
  Bot,
  Cpu,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Type,
  X,
} from "lucide-react";
import { AiProviderSettingsPanel } from "@/components/ai/AiProviderSettingsPanel";
import { OpenCodeSettingsPanel } from "@/components/opencode/OpenCodeSettingsPanel";
import { SdkConfigForm } from "@/components/sdk/SdkConfigForm";
import {
  SegmentedPill,
  type SegmentedPillOption,
} from "@/components/shell/SegmentedPill";
import {
  SPECIES_LIST,
  SPECIES_MAP,
  type AtmosphereTweaks,
  type SpeciesKey,
} from "@/lib/glyphAnimalsEngine";
import type { EditorSettings } from "@/types/editor";

export type SettingsCategory = "appearance" | "editor" | "sdk" | "ai" | "opencode";

interface SettingsModalProps {
  open: boolean;
  initialCategory?: SettingsCategory;
  species: SpeciesKey;
  tweaks: AtmosphereTweaks;
  editorSettings: EditorSettings;
  sdkConfigProps: ComponentProps<typeof SdkConfigForm>;
  aiConfigProps: ComponentProps<typeof AiProviderSettingsPanel>;
  opencodeConfigProps: ComponentProps<typeof OpenCodeSettingsPanel>;
  onClose: () => void;
  onSpeciesChange: (species: SpeciesKey) => void;
  onTweaksChange: (partial: Partial<AtmosphereTweaks>) => void;
  onResetTweaks: () => void;
  onEditorSettingsChange: (partial: Partial<EditorSettings>) => void;
  onResetEditorSettings: () => void;
  onOpenSdkDoctor: () => void;
}

interface SliderSpec {
  key: keyof AtmosphereTweaks;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
  hint: string;
  disabled?: (t: AtmosphereTweaks) => boolean;
}

const SPECIES_OPTIONS: SegmentedPillOption<SpeciesKey>[] = SPECIES_LIST.map(
  (s) => ({
    value: s.key,
    label: s.label,
    dotColor: s.dotColor,
  })
);

const MOVEMENT_SLIDERS: SliderSpec[] = [
  {
    key: "density",
    label: "Density",
    min: 0.1,
    max: 4,
    step: 0.05,
    decimals: 2,
    hint: "Target population density across the grid.",
  },
  {
    key: "direction",
    label: "Direction",
    min: 0,
    max: 360,
    step: 1,
    decimals: 0,
    unit: "°",
    hint: "Travel heading in degrees (0° right, 90° up).",
    disabled: (t) => t.cornerToCorner,
  },
  {
    key: "speed",
    label: "Speed",
    min: 0.1,
    max: 3,
    step: 0.05,
    decimals: 2,
    hint: "Overall cruise velocity multiplier.",
  },
  {
    key: "size",
    label: "Size",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    decimals: 2,
    hint: "Scale multiplier for each creature.",
  },
];

const LOOK_SLIDERS: SliderSpec[] = [
  {
    key: "hue",
    label: "Hue shift",
    min: -180,
    max: 180,
    step: 1,
    decimals: 0,
    unit: "°",
    hint: "Luminance-preserving hue rotation across all glyphs.",
  },
  {
    key: "shimmer",
    label: "Shimmer",
    min: 0,
    max: 1,
    step: 0.05,
    decimals: 2,
    hint: "Surface wave brightness modulation.",
  },
  {
    key: "sparkle",
    label: "Sparkle",
    min: 0,
    max: 0.6,
    step: 0.02,
    decimals: 2,
    hint: "Glinting pale highlights across bright cells.",
  },
  {
    key: "trail",
    label: "Trail",
    min: 0,
    max: 4,
    step: 0.05,
    decimals: 2,
    hint: "Energy trail intensity shed behind motion.",
  },
  {
    key: "grid",
    label: "Grid",
    min: 0,
    max: 4,
    step: 0.05,
    decimals: 2,
    hint: "Visibility of the underlying character cell grid.",
  },
  {
    key: "detail",
    label: "ASCII detail",
    min: 0.5,
    max: 2,
    step: 0.05,
    decimals: 2,
    hint: "Grid cell resolution (higher draws smaller cells).",
  },
];

const GLASS_SLIDERS: SliderSpec[] = [
  {
    key: "blur",
    label: "Blur",
    min: 0,
    max: 30,
    step: 0.5,
    decimals: 1,
    unit: "px",
    hint: "Backdrop blur radius on floating glass surfaces.",
  },
  {
    key: "refraction",
    label: "Refraction",
    min: 0,
    max: 120,
    step: 2,
    decimals: 0,
    hint: "Chromium liquid-glass displacement strength.",
  },
  {
    key: "tint",
    label: "Tint",
    min: 0,
    max: 3,
    step: 0.05,
    decimals: 2,
    hint: "Surface glass tint luminance.",
  },
  {
    key: "edge",
    label: "Edge",
    min: 0,
    max: 2,
    step: 0.05,
    decimals: 2,
    hint: "Specular rim and hairline border contrast.",
  },
];

const FUTURE_SETTINGS_SECTIONS = [
  { label: "Board & Serial", phase: "Phases 7–9", icon: Cpu },
];

export function SettingsModal({
  open,
  initialCategory = "appearance",
  species,
  tweaks,
  editorSettings,
  sdkConfigProps,
  aiConfigProps,
  opencodeConfigProps,
  onClose,
  onSpeciesChange,
  onTweaksChange,
  onResetTweaks,
  onEditorSettingsChange,
  onResetEditorSettings,
  onOpenSdkDoctor,
}: SettingsModalProps) {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>(initialCategory);
  const [confirmReset, setConfirmReset] = useState(false);
  const [hoveredHint, setHoveredHint] = useState<string | null>(null);
  const defaults = SPECIES_MAP[species].defaults;

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setConfirmReset(false);
      setActiveCategory(initialCategory);
    });
  }, [initialCategory, open]);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const renderSliderGroup = (title: string, specs: SliderSpec[]) => (
    <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-[#06070c]/60 p-4">
      <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2">
        {specs.map((spec) => {
          const val = Number(tweaks[spec.key]);
          const isDisabled = spec.disabled ? spec.disabled(tweaks) : false;
          const pct = ((val - spec.min) / (spec.max - spec.min)) * 100;

          return (
            <div
              key={spec.key}
              onMouseEnter={() => setHoveredHint(spec.hint)}
              onMouseLeave={() => setHoveredHint(null)}
              className={`space-y-0.5 transition-opacity ${
                isDisabled ? "opacity-40" : "opacity-100"
              }`}
            >
              <div className="flex items-center justify-between text-[12px]">
                <button
                  type="button"
                  disabled={isDisabled}
                  onDoubleClick={() =>
                    onTweaksChange({ [spec.key]: defaults[spec.key] })
                  }
                  title="Double-click to reset"
                  className="cursor-default text-left text-[#e8ebf7]/80 hover:text-[#e8ebf7] disabled:cursor-not-allowed"
                >
                  {spec.label}
                </button>
                <span className="font-mono text-[11px] font-semibold text-[#e8ebf7]/65">
                  {val.toFixed(spec.decimals)}
                  {spec.unit ?? ""}
                </span>
              </div>
              <input
                type="range"
                aria-label={spec.label}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                disabled={isDisabled}
                value={val}
                onChange={(e) =>
                  onTweaksChange({ [spec.key]: parseFloat(e.target.value) })
                }
                style={{ ["--fill" as string]: `${pct.toFixed(1)}%` }}
                className="vega-slider"
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="VEGA Studio Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="vega-view-enter fixed inset-0 z-50 flex items-center justify-center bg-[#06070c]/65 p-4 backdrop-blur-sm"
    >
      <div
        className="vega-glass flex max-h-[min(86vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] bg-[#090b13]/92 shadow-2xl"
        style={{ ["--blur" as string]: "18px", ["--tint" as string]: "0.7" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-[#7aa2ff]">
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e8ebf7]">
                Shell &amp; Appearance Settings
              </h2>
              <p className="text-[11px] text-[#e8ebf7]/50">
                Customize the ambient ASCII canvas, species, and glass surfaces
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  return;
                }
                setConfirmReset(false);
                if (activeCategory === "editor") {
                  onResetEditorSettings();
                } else if (activeCategory === "sdk") {
                  void sdkConfigProps.onReset();
                } else if (activeCategory === "ai") {
                  void aiConfigProps.onResetConfig();
                } else if (activeCategory === "opencode") {
                  void opencodeConfigProps.onReset();
                } else {
                  onResetTweaks();
                }
              }}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors ${
                confirmReset
                  ? "border-red-400/45 bg-red-500/20 text-red-200"
                  : "border-white/10 bg-white/[0.05] text-[#e8ebf7]/75 hover:bg-white/12 hover:text-[#e8ebf7]"
              }`}
            >
              {confirmReset ? "Reset all?" : "Reset defaults"}
            </button>
            <button
              type="button"
              aria-label="Close Settings"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[#e8ebf7]/70 hover:bg-white/12 hover:text-[#e8ebf7]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Category Rail */}
          <nav
            aria-label="Settings categories"
            className="hidden w-48 shrink-0 flex-col justify-between border-r border-white/[0.08] bg-[#070910]/60 p-3 sm:flex"
          >
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  setActiveCategory("appearance");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeCategory === "appearance"
                    ? "bg-white/10 text-[#e8ebf7]"
                    : "text-[#e8ebf7]/60 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Appearance &amp; Canvas</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  setActiveCategory("editor");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeCategory === "editor"
                    ? "bg-white/10 text-[#e8ebf7]"
                    : "text-[#e8ebf7]/60 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                }`}
              >
                <Type className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Monaco Editor</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  setActiveCategory("sdk");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeCategory === "sdk"
                    ? "bg-white/10 text-[#e8ebf7]"
                    : "text-[#e8ebf7]/60 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                }`}
              >
                <Stethoscope className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>SDK &amp; Toolchain</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  setActiveCategory("ai");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeCategory === "ai"
                    ? "bg-white/10 text-[#e8ebf7]"
                    : "text-[#e8ebf7]/60 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                }`}
              >
                <Bot className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>Native VEGA AI</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  setActiveCategory("opencode");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeCategory === "opencode"
                    ? "bg-white/10 text-[#e8ebf7]"
                    : "text-[#e8ebf7]/60 hover:bg-white/[0.05] hover:text-[#e8ebf7]"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-[#7aa2ff]" />
                <span>AI &amp; OpenCode</span>
              </button>

              {FUTURE_SETTINGS_SECTIONS.map(({ label, phase, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  title={`${label} settings arrive in ${phase}`}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-[#e8ebf7]/40 opacity-55 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </span>
                  <span className="font-mono text-[9px] uppercase">
                    {phase}
                  </span>
                </button>
              ))}
            </div>

            <p className="px-2 font-mono text-[10px] leading-relaxed text-[#e8ebf7]/35">
              {activeCategory === "editor"
                ? "Applies immediately to all open code editor tabs."
                : activeCategory === "sdk" || activeCategory === "ai" || activeCategory === "opencode"
                ? "Persisted in local app storage across IDE restarts."
                : "Double-click any slider name to reset it."}
            </p>
          </nav>

          {/* Right Customization Content */}
          <div className="vega-scroll flex-1 space-y-4 overflow-y-auto p-5">
            {activeCategory === "ai" ? (
              <AiProviderSettingsPanel {...aiConfigProps} />
            ) : activeCategory === "opencode" ? (
              <OpenCodeSettingsPanel {...opencodeConfigProps} />
            ) : activeCategory === "sdk" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#7aa2ff]/20 bg-[#7aa2ff]/[0.07] px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-[#e8ebf7]">
                      Need full toolchain validation?
                    </p>
                    <p className="text-[11px] text-[#e8ebf7]/60">
                      Use SDK Doctor to verify compiler execution, Make, Python,
                      target triple, and XMODEM uploader checks.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenSdkDoctor}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#7aa2ff]/40 bg-[#7aa2ff]/18 px-3.5 text-xs font-medium text-[#e8ebf7] hover:bg-[#7aa2ff]/28"
                  >
                    <Stethoscope className="h-3.5 w-3.5 text-[#7aa2ff]" />
                    <span>Open SDK Doctor</span>
                  </button>
                </div>

                <SdkConfigForm {...sdkConfigProps} />
              </div>
            ) : activeCategory === "editor" ? (
              <div className="space-y-4">
                <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#06070c]/60 p-4">
                  <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Typography &amp; Wrapping
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#e8ebf7]/80">Font Size</span>
                        <span className="font-mono text-[11px] font-semibold text-[#7aa2ff]">
                          {editorSettings.fontSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        aria-label="Editor font size"
                        min={11}
                        max={22}
                        step={1}
                        value={editorSettings.fontSize}
                        onChange={(e) =>
                          onEditorSettingsChange({
                            fontSize: parseInt(e.target.value, 10),
                          })
                        }
                        style={{
                          ["--fill" as string]: `${(((editorSettings.fontSize - 11) / (22 - 11)) * 100).toFixed(1)}%`,
                        }}
                        className="vega-slider"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[#e8ebf7]/80">
                        Word Wrap
                      </span>
                      <div className="flex gap-1.5">
                        {(["off", "on"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              onEditorSettingsChange({ wordWrap: mode })
                            }
                            className={`h-7 flex-1 rounded-lg border font-mono text-[11px] font-medium transition-colors ${
                              editorSettings.wordWrap === mode
                                ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7]"
                                : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.07]"
                            }`}
                          >
                            {mode === "on" ? "Wrap On" : "No Wrap"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#06070c]/60 p-4">
                  <div className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Indentation &amp; Chrome
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="block text-xs text-[#e8ebf7]/80">
                        Tab Size
                      </span>
                      <div className="flex gap-1.5">
                        {([2, 4, 8] as const).map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() =>
                              onEditorSettingsChange({ tabSize: size })
                            }
                            className={`h-7 flex-1 rounded-lg border font-mono text-[11px] font-medium transition-colors ${
                              editorSettings.tabSize === size
                                ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7]"
                                : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.07]"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[#e8ebf7]/80">
                        Indentation Character
                      </span>
                      <div className="flex gap-1.5">
                        {[
                          { label: "Spaces", value: true },
                          { label: "Tabs", value: false },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() =>
                              onEditorSettingsChange({
                                insertSpaces: opt.value,
                              })
                            }
                            className={`h-7 flex-1 rounded-lg border font-mono text-[11px] font-medium transition-colors ${
                              editorSettings.insertSpaces === opt.value
                                ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7]"
                                : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.07]"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[#e8ebf7]/80">
                        Line Numbers
                      </span>
                      <div className="flex gap-1.5">
                        {(["on", "relative", "off"] as const).map((ln) => (
                          <button
                            key={ln}
                            type="button"
                            onClick={() =>
                              onEditorSettingsChange({ lineNumbers: ln })
                            }
                            className={`h-7 flex-1 rounded-lg border font-mono text-[11px] font-medium capitalize transition-colors ${
                              editorSettings.lineNumbers === ln
                                ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/20 text-[#e8ebf7]"
                                : "border-white/10 bg-white/[0.03] text-[#e8ebf7]/60 hover:bg-white/[0.07]"
                            }`}
                          >
                            {ln}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-white/8 bg-[#090b13]/70 px-3 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-[#e8ebf7]">
                          Code Minimap
                        </p>
                        <p className="text-[10px] text-[#e8ebf7]/45">
                          Compact overview strip on the right edge
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editorSettings.minimap}
                        aria-label="Toggle editor minimap"
                        onClick={() =>
                          onEditorSettingsChange({
                            minimap: !editorSettings.minimap,
                          })
                        }
                        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
                          editorSettings.minimap ? "bg-[#7aa2ff]" : "bg-white/15"
                        }`}
                      >
                        <span
                          className={`block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
                            editorSettings.minimap
                              ? "translate-x-[14px]"
                              : "translate-x-[2px]"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {/* Ambient Animal Species Switcher */}
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#06070c]/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#e8ebf7]/45 uppercase">
                    Ambient Animal Species
                  </span>
                  <p className="mt-0.5 text-xs text-[#e8ebf7]/60">
                    Choose the procedural ASCII creature populating the
                    background grid.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-xs text-[#e8ebf7]/75">
                  <span>Corner to corner</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tweaks.cornerToCorner}
                    aria-label="Corner to corner"
                    onClick={() =>
                      onTweaksChange({ cornerToCorner: !tweaks.cornerToCorner })
                    }
                    className={`relative h-[18px] w-[30px] rounded-full transition-colors ${
                      tweaks.cornerToCorner ? "bg-[#7aa2ff]" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
                        tweaks.cornerToCorner
                          ? "translate-x-[14px]"
                          : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                </label>
              </div>

              <SegmentedPill
                ariaLabel="Ambient Background Species"
                options={SPECIES_OPTIONS}
                value={species}
                onChange={onSpeciesChange}
                wrapOnSmall
                liquid={false}
                className="w-full justify-center bg-[#0b0d16]/75"
              />
            </div>

            {renderSliderGroup("Movement", MOVEMENT_SLIDERS)}
            {renderSliderGroup("Look & Grid", LOOK_SLIDERS)}
            {renderSliderGroup("Glass Surface", GLASS_SLIDERS)}
              </>
            )}
          </div>
        </div>

        {/* Footer Hint */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.08] bg-[#070910]/75 px-5 font-mono text-[11px] text-[#e8ebf7]/45">
          <span>
            {activeCategory === "editor"
              ? "Editor preferences save locally and apply immediately"
              : activeCategory === "sdk"
              ? "VEGA SDK settings persist in application data directory"
              : activeCategory === "ai"
              ? "API keys are stored securely in OS Credential Store — never SQLite"
              : activeCategory === "opencode"
              ? "OpenCode configuration persists in application data directory"
              : hoveredHint ??
                "Hover a slider for details · Double-click a label to reset"}
          </span>
          <span>Saved locally</span>
        </div>
      </div>
    </div>
  );
}
