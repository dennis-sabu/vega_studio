"use client";

import { useEffect } from "react";

interface LiquidGlassFilterProps {
  refraction?: number;
  ripple?: number;
}

/**
  * Enables the Chromium-only SVG liquid-glass displacement filter on
  * `html.liquid` while falling back cleanly to plain frosted blur elsewhere.
  */
export function LiquidGlassFilter({
  refraction = 40,
  ripple = 0.007,
}: LiquidGlassFilterProps) {
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Chrome/")
    ) {
      document.documentElement.classList.add("liquid");
    }
  }, []);

  const baseFreq = `${ripple.toFixed(4)} ${(ripple * 1.5).toFixed(4)}`;

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      className="pointer-events-none fixed h-0 w-0 overflow-hidden"
    >
      <defs>
        <filter
          id="liquid-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={baseFreq}
            numOctaves="2"
            seed="11"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale={refraction}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
