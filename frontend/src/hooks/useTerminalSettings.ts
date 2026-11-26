"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalFontFamily,
  type TerminalSettings,
} from "@/types/terminal";

const STORAGE_KEY = "vega-studio:terminal-settings:v1";

export function resolveTerminalFontCss(family: TerminalFontFamily): string {
  switch (family) {
    case "geist-mono":
      return '"Geist Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
    case "system":
      return 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
    case "jetbrains-mono":
    default:
      return '"JetBrains Mono", "Geist Mono", ui-monospace, Menlo, Consolas, monospace';
  }
}

function sanitizeSettings(raw: Partial<TerminalSettings>): TerminalSettings {
  const fontFamily: TerminalFontFamily =
    raw.fontFamily === "jetbrains-mono" ||
    raw.fontFamily === "geist-mono" ||
    raw.fontFamily === "system"
      ? raw.fontFamily
      : DEFAULT_TERMINAL_SETTINGS.fontFamily;

  const fontSize =
    typeof raw.fontSize === "number" &&
    Number.isFinite(raw.fontSize) &&
    raw.fontSize >= 11 &&
    raw.fontSize <= 20
      ? Math.round(raw.fontSize)
      : DEFAULT_TERMINAL_SETTINGS.fontSize;

  const lineHeight =
    typeof raw.lineHeight === "number" &&
    Number.isFinite(raw.lineHeight) &&
    raw.lineHeight >= 1.15 &&
    raw.lineHeight <= 1.8
      ? Math.round(raw.lineHeight * 20) / 20
      : DEFAULT_TERMINAL_SETTINGS.lineHeight;

  const cursorStyle =
    raw.cursorStyle === "block" ||
    raw.cursorStyle === "underline" ||
    raw.cursorStyle === "bar"
      ? raw.cursorStyle
      : DEFAULT_TERMINAL_SETTINGS.cursorStyle;

  const cursorBlink =
    typeof raw.cursorBlink === "boolean"
      ? raw.cursorBlink
      : DEFAULT_TERMINAL_SETTINGS.cursorBlink;

  const autoLaunch =
    typeof raw.autoLaunch === "boolean"
      ? raw.autoLaunch
      : DEFAULT_TERMINAL_SETTINGS.autoLaunch;

  return {
    fontFamily,
    fontSize,
    lineHeight,
    cursorStyle,
    cursorBlink,
    autoLaunch,
  };
}

export function useTerminalSettings() {
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(
    DEFAULT_TERMINAL_SETTINGS
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
          setTerminalSettings(sanitizeSettings(parsed));
        }
      } catch {
        // Ignore invalid localStorage payloads cleanly.
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(terminalSettings)
      );
    } catch {
      // Ignore storage quota errors cleanly.
    }
  }, [hydrated, terminalSettings]);

  const updateTerminalSettings = useCallback(
    (partial: Partial<TerminalSettings>) => {
      setTerminalSettings((prev) => sanitizeSettings({ ...prev, ...partial }));
    },
    []
  );

  const resetTerminalSettings = useCallback(() => {
    setTerminalSettings({ ...DEFAULT_TERMINAL_SETTINGS });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors cleanly.
    }
  }, []);

  return {
    terminalSettings,
    updateTerminalSettings,
    resetTerminalSettings,
    hydrated,
  };
}
