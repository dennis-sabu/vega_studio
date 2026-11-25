"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
} from "@/types/editor";

const STORAGE_KEY = "vega-studio:editor-settings:v1";

function sanitizeSettings(raw: Partial<EditorSettings>): EditorSettings {
  const fontSize =
    typeof raw.fontSize === "number" &&
    Number.isFinite(raw.fontSize) &&
    raw.fontSize >= 11 &&
    raw.fontSize <= 22
      ? Math.round(raw.fontSize)
      : DEFAULT_EDITOR_SETTINGS.fontSize;

  const tabSize =
    raw.tabSize === 2 || raw.tabSize === 4 || raw.tabSize === 8
      ? raw.tabSize
      : DEFAULT_EDITOR_SETTINGS.tabSize;

  const insertSpaces =
    typeof raw.insertSpaces === "boolean"
      ? raw.insertSpaces
      : DEFAULT_EDITOR_SETTINGS.insertSpaces;

  const wordWrap =
    raw.wordWrap === "on" || raw.wordWrap === "off"
      ? raw.wordWrap
      : DEFAULT_EDITOR_SETTINGS.wordWrap;

  const minimap =
    typeof raw.minimap === "boolean"
      ? raw.minimap
      : DEFAULT_EDITOR_SETTINGS.minimap;

  const lineNumbers =
    raw.lineNumbers === "on" ||
    raw.lineNumbers === "relative" ||
    raw.lineNumbers === "off"
      ? raw.lineNumbers
      : DEFAULT_EDITOR_SETTINGS.lineNumbers;

  return {
    fontSize,
    tabSize,
    insertSpaces,
    wordWrap,
    minimap,
    lineNumbers,
  };
}

export function useEditorSettings() {
  const [settings, setSettings] = useState<EditorSettings>(
    DEFAULT_EDITOR_SETTINGS
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<EditorSettings>;
          setSettings(sanitizeSettings(parsed));
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage quota errors cleanly.
    }
  }, [hydrated, settings]);

  const updateSettings = useCallback((partial: Partial<EditorSettings>) => {
    setSettings((prev) => sanitizeSettings({ ...prev, ...partial }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_EDITOR_SETTINGS });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors cleanly.
    }
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
  };
}
