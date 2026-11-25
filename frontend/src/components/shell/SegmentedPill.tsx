"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface SegmentedPillOption<T extends string> {
  value: T;
  label: string;
  dotColor?: string;
}

interface SegmentedPillProps<T extends string> {
  ariaLabel: string;
  options: SegmentedPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  wrapOnSmall?: boolean;
  liquid?: boolean;
}

export function SegmentedPill<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className = "",
  wrapOnSmall = false,
  liquid = true,
}: SegmentedPillProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumbStyle, setThumbStyle] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
  }>({ left: 0, top: 0, width: 0, height: 28, visible: false });

  const updateThumb = useCallback(() => {
    const activeIndex = options.findIndex((opt) => opt.value === value);
    const activeBtn = buttonRefs.current[activeIndex];
    if (!activeBtn) return;

    setThumbStyle({
      left: activeBtn.offsetLeft,
      top: activeBtn.offsetTop,
      width: activeBtn.offsetWidth,
      height: activeBtn.offsetHeight,
      visible: true,
    });
  }, [options, value]);

  useLayoutEffect(() => {
    updateThumb();
  }, [updateThumb]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateThumb());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateThumb]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + options.length) % options.length;
    const nextOption = options[nextIndex];
    if (!nextOption) return;
    onChange(nextOption.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`vega-glass ${liquid ? "vega-glass-liquid" : ""} relative inline-flex items-center gap-0.5 rounded-full p-1 select-none ${
        wrapOnSmall ? "flex-wrap justify-center rounded-[22px] md:flex-nowrap md:rounded-full" : ""
      } ${className}`}
      style={{ ["--blur" as string]: "5px" }}
    >
      <span
        aria-hidden="true"
        className="vega-thumb-transition pointer-events-none absolute left-0 top-0 rounded-full bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_8px_rgba(0,0,0,0.20)]"
        style={{
          transform: `translate(${thumbStyle.left}px, ${thumbStyle.top}px)`,
          width: `${thumbStyle.width}px`,
          height: `${thumbStyle.height}px`,
          opacity: thumbStyle.visible ? 1 : 0,
        }}
      />

      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(node) => {
              buttonRefs.current[idx] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`relative z-10 inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2ff]/50 ${
              selected
                ? "text-[#e8ebf7]"
                : "text-[#e8ebf7]/45 hover:text-[#e8ebf7]/75"
            }`}
          >
            {opt.dotColor && (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{
                  background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${opt.dotColor} 50%, white), ${opt.dotColor} 70%)`,
                }}
              />
            )}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
