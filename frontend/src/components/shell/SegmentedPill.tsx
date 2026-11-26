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
    window.addEventListener("resize", updateThumb);
    void document.fonts?.ready.then(() => updateThumb());
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateThumb);
    };
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

  if (liquid) {
    return (
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={ariaLabel}
        className={`vega-liquid-glass relative flex max-w-[max(240px,calc(100%-220px))] items-center gap-[2px] rounded-full p-[4px] select-none ${
          wrapOnSmall
            ? "max-[920px]:flex-wrap max-[920px]:justify-center max-[920px]:gap-y-[2px] max-[920px]:overflow-visible max-[920px]:rounded-[22px] max-[720px]:w-full max-[720px]:max-w-full"
            : "vega-no-scrollbar overflow-x-auto"
        } ${className}`}
        style={{ ["--blur" as string]: "5px" }}
      >
        <span
          aria-hidden="true"
          className="vega-thumb-overshoot pointer-events-none absolute left-0 top-0 rounded-full bg-[var(--thumb)]"
          style={{
            transform: `translate(${thumbStyle.left}px, ${thumbStyle.top}px)`,
            width: `${thumbStyle.width}px`,
            height: `${thumbStyle.height}px`,
            opacity: thumbStyle.visible ? 1 : 0,
            boxShadow:
              "inset 0 1px 0 var(--glass-rim), 0 2px 8px rgba(0, 0, 0, 0.22)",
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
              className={`relative z-10 inline-flex h-[32px] shrink-0 items-center gap-[7px] rounded-full border-0 bg-transparent pr-[13px] pl-[11px] text-[13px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7aa2ff]/70 max-[640px]:h-[30px] max-[640px]:gap-[6px] max-[640px]:pr-[11px] max-[640px]:pl-[9px] max-[640px]:text-[12.5px] max-[360px]:gap-[5px] max-[360px]:pr-[8px] max-[360px]:pl-[7px] max-[360px]:text-[12px] ${
                selected
                  ? "text-[#f3f5fc]"
                  : "text-[#c8d2ec] hover:text-[#f3f5fc]/90"
              }`}
            >
              {opt.dotColor && (
                <span
                  aria-hidden="true"
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${opt.dotColor} 50%, #ffffff), ${opt.dotColor} 70%)`,
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

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative inline-flex items-center gap-0.5 rounded-[7px] border border-[#2E2E32] bg-[#141416] p-0.5 select-none ${
        wrapOnSmall ? "flex-wrap justify-center md:flex-nowrap" : ""
      } ${className}`}
      data-liquid="false"
    >
      <span
        aria-hidden="true"
        className="vega-thumb-transition pointer-events-none absolute left-0 top-0 rounded-[5px] border border-[#3E3E44] bg-[#28282B] shadow-sm"
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
            className={`relative z-10 inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] ${
              selected
                ? "text-[#F4F4F5]"
                : "text-[#A1A1AA] hover:text-[#F4F4F5]"
            }`}
          >
            {opt.dotColor && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: opt.dotColor,
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
