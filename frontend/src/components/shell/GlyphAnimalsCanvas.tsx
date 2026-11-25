"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent,
  type Ref,
} from "react";
import {
  GlyphAnimalsEngine,
  type AtmosphereTweaks,
  type SpeciesKey,
} from "@/lib/glyphAnimalsEngine";

export interface GlyphAnimalsCanvasHandle {
  tapAt: (clientX: number, clientY: number) => void;
}

interface GlyphAnimalsCanvasProps {
  species: SpeciesKey;
  tweaks: AtmosphereTweaks;
  dimmed: boolean;
  workspaceMode: boolean;
  ref?: Ref<GlyphAnimalsCanvasHandle>;
}

export function GlyphAnimalsCanvas({
  species,
  tweaks,
  dimmed,
  workspaceMode,
  ref,
}: GlyphAnimalsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GlyphAnimalsEngine | null>(null);
  const reducedMotionRef = useRef(false);
  const workspaceModeRef = useRef(workspaceMode);

  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);

  useImperativeHandle(ref, () => ({
    tapAt: (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      if (!canvas || !engine) return;
      const rect = canvas.getBoundingClientRect();
      engine.tap(clientX - rect.left, clientY - rect.top);
    },
  }));

  // Initialize engine, ResizeObserver, IntersectionObserver, and RAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const engine = new GlyphAnimalsEngine(species, tweaks);
    engineRef.current = engine;

    const computedFont = getComputedStyle(canvas).fontFamily;
    engine.setFontFamily(computedFont);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mediaQuery.matches;
    engine.setReducedMotion(mediaQuery.matches);

    let isVisible = true;
    let rafId = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let lastDrawTime = 0;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      engine.resize(w, h);
    };

    const drawReducedStill = async () => {
      try {
        if (document.fonts) {
          await document.fonts.load('600 16px "Geist Mono"');
        }
      } catch {
        // Proceed with fallback font if font loader rejects.
      }
      syncSize();
      engine.simulateSettledStill();
      engine.render(ctx);
    };

    const tick = (now: number) => {
      rafId = 0;
      if (reducedMotionRef.current || !isVisible || document.hidden) return;

      // Subtle frame pacing in Workspace mode so background atmosphere costs minimal CPU.
      const minInterval = workspaceModeRef.current ? 42 : 0;
      if (minInterval > 0 && now - lastDrawTime < minInterval) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      lastDrawTime = now;

      accumulator += dt;
      const fixedStep = 1 / 60;
      let steps = 0;
      while (accumulator >= fixedStep && steps < 4) {
        engine.step(fixedStep);
        accumulator -= fixedStep;
        steps++;
      }
      if (steps === 4) accumulator = 0;

      engine.render(ctx);
      rafId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (reducedMotionRef.current) {
        void drawReducedStill();
        return;
      }
      if (!rafId && isVisible && !document.hidden) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    const stopLoop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    syncSize();
    startLoop();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            syncSize();
            if (reducedMotionRef.current) {
              engine.render(ctx);
            }
          })
        : null;
    resizeObserver?.observe(canvas);

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            isVisible = entries[0]?.isIntersecting ?? true;
            if (isVisible) startLoop();
            else stopLoop();
          })
        : null;
    intersectionObserver?.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
      engine.setReducedMotion(e.matches);
      if (e.matches) {
        stopLoop();
        void drawReducedStill();
      } else {
        startLoop();
      }
    };
    mediaQuery.addEventListener("change", onMotionChange);

    return () => {
      stopLoop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      mediaQuery.removeEventListener("change", onMotionChange);
      engineRef.current = null;
    };
    // Intentionally initialize engine once; species/tweaks sync via dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync species changes
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    if (engine.getSpecies() !== species) {
      engine.setSpecies(species, tweaks);
      if (reducedMotionRef.current) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          engine.simulateSettledStill();
          engine.render(ctx);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species]);

  // Sync live tweaks
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    engine.updateTweaks(tweaks);
    if (reducedMotionRef.current) {
      const ctx = canvas.getContext("2d", { alpha: false });
      if (ctx) engine.render(ctx);
    }
  }, [tweaks]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || workspaceModeRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    engine.tap(event.clientX - rect.left, event.clientY - rect.top);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#06070c]">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        style={{ fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace' }}
        className={`pointer-events-auto block h-full w-full touch-none transition-opacity duration-500 ${
          workspaceMode
            ? "opacity-25"
            : dimmed
              ? "opacity-45"
              : "opacity-100"
        }`}
      />
      {/* Smooth scrim when focusing composer or working inside IDE panes */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-all duration-300 ${
          workspaceMode
            ? "bg-[#06070c]/55"
            : dimmed
              ? "bg-[#06070c]/48 backdrop-blur-[2px]"
              : "bg-transparent"
        }`}
      />
    </div>
  );
}
