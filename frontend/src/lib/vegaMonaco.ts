import type * as MonacoType from "monaco-editor";

export type MonacoNamespace = typeof MonacoType;

export const VEGA_MONACO_THEME = "vega-obsidian";

export const MONACO_LANGUAGE_LABELS: Record<string, string> = {
  c: "C Source",
  cpp: "C++ Source",
  makefile: "Makefile",
  "riscv-asm": "RISC-V Assembly",
  json: "JSON",
  python: "Python",
  markdown: "Markdown",
  yaml: "YAML",
  shell: "Shell Script",
  ini: "Config / INI",
  xml: "XML",
  javascript: "JavaScript",
  typescript: "TypeScript",
  css: "CSS",
  html: "HTML",
  bat: "Batch Script",
  powershell: "PowerShell",
  plaintext: "Plain Text",
};

const EXT_TO_MONACO: Record<string, string> = {
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".s": "riscv-asm",
  ".asm": "riscv-asm",
  ".inc": "riscv-asm",
  ".mk": "makefile",
  ".mak": "makefile",
  ".json": "json",
  ".jsonc": "json",
  ".py": "python",
  ".pyw": "python",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".toml": "ini",
  ".xml": "xml",
  ".svg": "xml",
  ".js": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".bat": "bat",
  ".cmd": "bat",
  ".ps1": "powershell",
  ".txt": "plaintext",
  ".log": "plaintext",
  ".ld": "plaintext",
};

export function detectMonacoLanguageClient(
  fileName: string,
  extension?: string
): { monacoLanguage: string; displayLabel: string } {
  const lower = fileName.toLowerCase();
  if (
    lower === "makefile" ||
    lower === "gnumakefile" ||
    lower.startsWith("makefile.")
  ) {
    return { monacoLanguage: "makefile", displayLabel: "Makefile" };
  }
  if (lower === ".gitignore" || lower.startsWith(".env")) {
    return { monacoLanguage: "ini", displayLabel: "Config / INI" };
  }

  const ext = (extension ?? (lower.includes(".") ? `.${lower.split(".").pop()}` : "")).toLowerCase();
  if (ext === ".h") {
    return { monacoLanguage: "c", displayLabel: "C Header" };
  }
  if (ext === ".hpp" || ext === ".hh" || ext === ".hxx") {
    return { monacoLanguage: "cpp", displayLabel: "C++ Header" };
  }

  const monacoId = EXT_TO_MONACO[ext] ?? "plaintext";
  return {
    monacoLanguage: monacoId,
    displayLabel: MONACO_LANGUAGE_LABELS[monacoId] ?? "Plain Text",
  };
}

interface MonacoGlobalScope {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
}

let monacoLoadPromise: Promise<MonacoNamespace> | null = null;
let monacoConfigured = false;

function configureMonacoWorkers(): void {
  if (typeof window === "undefined") return;
  const globalObj = window as unknown as MonacoGlobalScope;
  if (globalObj.MonacoEnvironment) return;

  globalObj.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === "json") {
        return new Worker(
          new URL(
            "monaco-editor/languages/features/json/json.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new Worker(
          new URL(
            "monaco-editor/languages/features/css/css.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new Worker(
          new URL(
            "monaco-editor/languages/features/html/html.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      }
      if (label === "typescript" || label === "javascript") {
        return new Worker(
          new URL(
            "monaco-editor/languages/features/typescript/ts.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      }
      return new Worker(
        new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
        { type: "module" }
      );
    },
  };
}

function registerCustomLanguages(monaco: MonacoNamespace): void {
  const registered = new Set(monaco.languages.getLanguages().map((l) => l.id));

  if (!registered.has("makefile")) {
    monaco.languages.register({
      id: "makefile",
      filenames: ["Makefile", "makefile", "GNUmakefile"],
      extensions: [".mk", ".mak"],
      aliases: ["Makefile", "makefile"],
    });
    monaco.languages.setLanguageConfiguration("makefile", {
      comments: { lineComment: "#" },
      brackets: [
        ["(", ")"],
        ["{", "}"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: "{", close: "}" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });
    monaco.languages.setMonarchTokensProvider("makefile", {
      defaultToken: "",
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/^\s*(ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|sinclude|export|unexport|vpath|define|endef)\b/, "keyword"],
          [/^\.[A-Z_]+\b/, "keyword"],
          [/^[A-Za-z0-9_.\-/]+\s*(?=(:=|\?=|\+=|=))/, "variable"],
          [/^[A-Za-z0-9_.\-/%\s]+:/, "type.identifier"],
          [/\$(?:\([A-Za-z0-9_.*@<^?+%/-]+\)|\{[A-Za-z0-9_.*@<^?+%/-]+\}|[@<^?+*])/, "variable.predefined"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/^\t.*$/, "identifier"],
        ],
      },
    });
  }

  if (!registered.has("riscv-asm")) {
    monaco.languages.register({
      id: "riscv-asm",
      extensions: [".s", ".S", ".asm", ".inc"],
      aliases: ["RISC-V Assembly", "Assembly"],
    });
    monaco.languages.setLanguageConfiguration("riscv-asm", {
      comments: {
        lineComment: "#",
        blockComment: ["/*", "*/"],
      },
      brackets: [
        ["(", ")"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });
    monaco.languages.setMonarchTokensProvider("riscv-asm", {
      defaultToken: "",
      ignoreCase: true,
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/\/\/.*$/, "comment"],
          [/\/\*[\s\S]*?\*\//, "comment"],
          [/^\s*[A-Za-z_.$][A-Za-z0-9_.$]*:/, "type.identifier"],
          [/^\s*\.[A-Za-z_][A-Za-z0-9_.]*/, "keyword"],
          [
            /\b(x[0-9]|x[12][0-9]|x3[01]|zero|ra|sp|gp|tp|t[0-6]|s[0-9]|s1[01]|a[0-7]|fp|pc)\b/,
            "variable.predefined",
          ],
          [
            /\b(lui|auipc|jal|jalr|beq|bne|blt|bge|bltu|bgeu|lb|lh|lw|lbu|lhu|sb|sh|sw|addi|slti|sltiu|xori|ori|andi|slli|srli|srai|add|sub|sll|slt|sltu|xor|srl|sra|or|and|fence|ecall|ebreak|csrrw|csrrs|csrrc|csrrwi|csrrsi|csrrci|li|la|mv|nop|ret|j|jr|call|tail|wfi|mret)\b/,
            "keyword",
          ],
          [/0x[0-9a-fA-F]+/, "number.hex"],
          [/-?\d+/, "number"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
        ],
      },
    });
  }
}

function registerObsidianTheme(monaco: MonacoNamespace): void {
  monaco.editor.defineTheme(VEGA_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "E8EBF7", background: "06070C" },
      { token: "comment", foreground: "6D7790", fontStyle: "italic" },
      { token: "keyword", foreground: "7AA2FF" },
      { token: "keyword.control", foreground: "93B4FF" },
      { token: "type", foreground: "C4B5FD" },
      { token: "type.identifier", foreground: "C4B5FD" },
      { token: "string", foreground: "6EE7B7" },
      { token: "number", foreground: "FCD34D" },
      { token: "number.hex", foreground: "FCD34D" },
      { token: "variable", foreground: "E8EBF7" },
      { token: "variable.predefined", foreground: "93C5FD" },
      { token: "delimiter", foreground: "94A3B8" },
      { token: "operator", foreground: "A5B4FC" },
      { token: "tag", foreground: "7AA2FF" },
      { token: "attribute.name", foreground: "C4B5FD" },
      { token: "attribute.value", foreground: "6EE7B7" },
    ],
    colors: {
      "editor.background": "#06070c",
      "editor.foreground": "#e8ebf7",
      "editorGutter.background": "#070910",
      "editorCursor.foreground": "#7aa2ff",
      "editor.lineHighlightBackground": "#ffffff07",
      "editor.lineHighlightBorder": "#ffffff06",
      "editor.selectionBackground": "#7aa2ff33",
      "editor.inactiveSelectionBackground": "#7aa2ff1c",
      "editor.selectionHighlightBackground": "#7aa2ff1f",
      "editor.findMatchBackground": "#7aa2ff45",
      "editor.findMatchHighlightBackground": "#7aa2ff24",
      "editorLineNumber.foreground": "#e8ebf738",
      "editorLineNumber.activeForeground": "#7aa2ffcc",
      "editorIndentGuide.background1": "#ffffff10",
      "editorIndentGuide.activeBackground1": "#7aa2ff40",
      "editorBracketMatch.background": "#7aa2ff22",
      "editorBracketMatch.border": "#7aa2ff80",
      "editorWhitespace.foreground": "#ffffff14",
      "editorWidget.background": "#0b0e18",
      "editorWidget.border": "#ffffff1e",
      "editorWidget.foreground": "#e8ebf7",
      "input.background": "#06070c",
      "input.border": "#ffffff20",
      "input.foreground": "#e8ebf7",
      "inputOption.activeBorder": "#7aa2ff",
      "inputOption.activeBackground": "#7aa2ff28",
      "focusBorder": "#7aa2ff80",
      "scrollbar.shadow": "#00000060",
      "scrollbarSlider.background": "#ffffff1a",
      "scrollbarSlider.hoverBackground": "#ffffff2c",
      "scrollbarSlider.activeBackground": "#7aa2ff45",
      "minimap.background": "#06070c",
      "minimapSlider.background": "#ffffff14",
      "minimapSlider.hoverBackground": "#ffffff24",
    },
  });
}

export async function loadVegaMonaco(): Promise<MonacoNamespace> {
  if (!monacoLoadPromise) {
    configureMonacoWorkers();
    monacoLoadPromise = import("monaco-editor").then((monacoModule) => {
      if (!monacoConfigured) {
        registerCustomLanguages(monacoModule);
        registerObsidianTheme(monacoModule);
        monacoConfigured = true;
      }
      return monacoModule;
    });
  }
  return monacoLoadPromise;
}

export interface TabModelRecord {
  model: MonacoType.editor.ITextModel;
  savedVersionId: number;
  savedContent: string;
  viewState: MonacoType.editor.ICodeEditorViewState | null;
}

const sessionModels = new Map<string, TabModelRecord>();

export function buildModelUri(monaco: MonacoNamespace, uid: string, filePath: string): MonacoType.Uri {
  const cleanPath = filePath.replace(/^\/+/, "");
  return monaco.Uri.from({
    scheme: "vega",
    authority: uid,
    path: `/${cleanPath}`,
  });
}

export function getOrCreateTabModel(
  monaco: MonacoNamespace,
  uid: string,
  filePath: string,
  initialContent: string,
  monacoLanguage: string,
  tabSize: number,
  insertSpaces: boolean
): TabModelRecord {
  const existing = sessionModels.get(uid);
  if (existing && !existing.model.isDisposed()) {
    if (existing.model.getLanguageId() !== monacoLanguage) {
      monaco.editor.setModelLanguage(existing.model, monacoLanguage);
    }
    const isMakefile = monacoLanguage === "makefile";
    existing.model.updateOptions({
      tabSize: isMakefile ? 4 : tabSize,
      insertSpaces: isMakefile ? false : insertSpaces,
    });
    return existing;
  }

  const uri = buildModelUri(monaco, uid, filePath);
  const priorByUri = monaco.editor.getModel(uri);
  if (priorByUri && !priorByUri.isDisposed()) {
    priorByUri.dispose();
  }

  const model = monaco.editor.createModel(initialContent, monacoLanguage, uri);
  const isMakefile = monacoLanguage === "makefile";
  model.updateOptions({
    tabSize: isMakefile ? 4 : tabSize,
    insertSpaces: isMakefile ? false : insertSpaces,
  });

  const record: TabModelRecord = {
    model,
    savedVersionId: model.getAlternativeVersionId(),
    savedContent: initialContent,
    viewState: null,
  };
  sessionModels.set(uid, record);
  return record;
}

export function getTabModelRecord(uid: string): TabModelRecord | undefined {
  const record = sessionModels.get(uid);
  if (!record || record.model.isDisposed()) {
    sessionModels.delete(uid);
    return undefined;
  }
  return record;
}

export function getTabModelContent(uid: string): string | null {
  const record = getTabModelRecord(uid);
  return record ? record.model.getValue() : null;
}

export function isTabModelDirty(uid: string): boolean {
  const record = getTabModelRecord(uid);
  if (!record) return false;
  if (record.model.getAlternativeVersionId() === record.savedVersionId) {
    return false;
  }
  return record.model.getValue() !== record.savedContent;
}

export function markTabModelSaved(uid: string, savedContent: string): boolean {
  const record = getTabModelRecord(uid);
  if (!record) return false;
  record.savedContent = savedContent;
  const stillMatches = record.model.getValue() === savedContent;
  if (stillMatches) {
    record.savedVersionId = record.model.getAlternativeVersionId();
    return false;
  }
  // User edited further while async save was in flight: keep dirty.
  return true;
}

export function resetTabModelFromDisk(
  monaco: MonacoNamespace,
  uid: string,
  diskContent: string,
  monacoLanguage?: string
): void {
  const record = getTabModelRecord(uid);
  if (!record) return;
  if (monacoLanguage && record.model.getLanguageId() !== monacoLanguage) {
    monaco.editor.setModelLanguage(record.model, monacoLanguage);
  }
  record.savedContent = diskContent;
  if (record.model.getValue() !== diskContent) {
    record.model.setValue(diskContent);
  }
  record.savedVersionId = record.model.getAlternativeVersionId();
}

export function saveTabViewState(
  uid: string,
  viewState: MonacoType.editor.ICodeEditorViewState | null
): void {
  const record = getTabModelRecord(uid);
  if (record) {
    record.viewState = viewState;
  }
}

export function disposeTabModel(uid: string): void {
  const record = sessionModels.get(uid);
  if (record) {
    sessionModels.delete(uid);
    if (!record.model.isDisposed()) {
      record.model.dispose();
    }
  }
}

export function disposeAllTabModels(): void {
  for (const [, record] of sessionModels.entries()) {
    if (!record.model.isDisposed()) {
      record.model.dispose();
    }
  }
  sessionModels.clear();
}
