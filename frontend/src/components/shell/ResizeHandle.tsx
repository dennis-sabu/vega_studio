"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  invertDelta?: boolean;
  onResize: (nextSize: number) => void;
}

export function ResizeHandle({
  orientation,
  ariaLabel,
  value,
  min,
  max,
  defaultValue,
  invertDelta = false,
  onResize,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startCoordRef = useRef(0);
  const startValueRef = useRef(value);

  const isVertical = orientation === "vertical";

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startCoordRef.current = isVertical ? event.clientX : event.clientY;
    startValueRef.current = value;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const currentCoord = isVertical ? event.clientX : event.clientY;
    const rawDelta = currentCoord - startCoordRef.current;
    const delta = invertDelta ? -rawDelta : rawDelta;
    onResize(startValueRef.current + delta);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (isVertical) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onResize(value + (invertDelta ? step : -step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onResize(value + (invertDelta ? -step : step));
      }
    } else {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onResize(value + (invertDelta ? step : -step));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onResize(value + (invertDelta ? -step : step));
      }
    }

    if (event.key === "Home") {
      event.preventDefault();
      onResize(min);
    } else if (event.key === "End") {
      event.preventDefault();
      onResize(max);
    }
  };

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onResize(defaultValue)}
      onKeyDown={handleKeyDown}
      title="Drag to resize · Double-click to reset"
      className={`group relative shrink-0 select-none focus-visible:outline-none ${
        isVertical
          ? "w-1.5 cursor-col-resize"
          : "h-1.5 cursor-row-resize"
      }`}
    >
      <div
        className={`absolute transition-colors duration-150 ${
          isVertical
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        } ${
          dragging
            ? "bg-[#7aa2ff]"
            : "bg-white/8 group-hover:bg-[#7aa2ff]/70 group-focus-visible:bg-[#7aa2ff]"
        }`}
      />
    </div>
  );
}
