export interface EditorSettings {
  fontSize: number;
  tabSize: 2 | 4 | 8;
  insertSpaces: boolean;
  wordWrap: "off" | "on";
  minimap: boolean;
  lineNumbers: "on" | "relative" | "off";
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 13,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: "off",
  minimap: true,
  lineNumbers: "on",
};

export interface EditorCursorPosition {
  lineNumber: number;
  column: number;
  selectionLength: number;
}

export interface EditorRevealTarget {
  path: string;
  line: number;
  column?: number;
  nonce: number;
}

export interface UnsavedGuardPrompt {
  title: string;
  description: string;
  confirmSaveLabel: string;
  confirmDiscardLabel: string;
  files: Array<{ uid: string; path: string; name: string }>;
  resolve: (decision: "save" | "discard" | "cancel") => void;
}
