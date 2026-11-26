"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from"react";
import { Loader2 } from"lucide-react";
import type * as MonacoType from"monaco-editor";
import {
  getOrCreateTabModel,
  getTabModelRecord,
  isTabModelDirty,
  loadVegaMonaco,
  saveTabViewState,
  VEGA_MONACO_THEME,
  type MonacoNamespace,
} from"@/lib/vegaMonaco";
import type {
  EditorCursorPosition,
  EditorRevealTarget,
  EditorSettings,
} from"@/types/editor";
import type { OpenFileTab } from"@/types/explorer";
import type { AICodeApplyMode, AIContextAttachment } from"@/types/ai";

export interface MonacoEditorHandle {
  triggerFind: () => void;
  triggerReplace: () => void;
  focusEditor: () => void;
  syncDirtyState: (uid: string) => void;
  getSelectionSnippet: () => {
    text: string;
    startLine: number;
    endLine: number;
  } | null;
  getFullText: () => string | null;
  applyCodeEdit: (mode: AICodeApplyMode, code: string) => boolean;
}

interface MonacoEditorSurfaceProps {
  activeTab: OpenFileTab;
  settings: EditorSettings;
  pendingReveal?: EditorRevealTarget | null;
  onDirtyChange: (uid: string, isDirty: boolean) => void;
  onCursorChange: (pos: EditorCursorPosition) => void;
  onSaveShortcut: (uid: string) => void;
  onConsumeReveal?: (nonce: number) => void;
  onAskNativeAi?: (
    ctx: AIContextAttachment,
    suggestedPrompt?: string
  ) => void;
}

export const MonacoEditorSurface = forwardRef<
  MonacoEditorHandle,
  MonacoEditorSurfaceProps
>(function MonacoEditorSurface(
  {
    activeTab,
    settings,
    pendingReveal,
    onDirtyChange,
    onCursorChange,
    onSaveShortcut,
    onConsumeReveal,
    onAskNativeAi,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(
    null
  );
  const attachedUidRef = useRef<string | null>(null);
  const contentListenerRef = useRef<MonacoType.IDisposable | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const activeTabRef = useRef(activeTab);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveShortcutRef = useRef(onSaveShortcut);
  const onConsumeRevealRef = useRef(onConsumeReveal);
  const onAskNativeAiRef = useRef(onAskNativeAi);
  useEffect(() => {
    activeTabRef.current = activeTab;
    onDirtyChangeRef.current = onDirtyChange;
    onCursorChangeRef.current = onCursorChange;
    onSaveShortcutRef.current = onSaveShortcut;
    onConsumeRevealRef.current = onConsumeReveal;
    onAskNativeAiRef.current = onAskNativeAi;
  });

  useImperativeHandle(
    ref,
    () => ({
      triggerFind() {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        void editor.getAction("actions.find")?.run();
      },
      triggerReplace() {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        void editor.getAction("editor.action.startFindReplaceAction")?.run();
      },
      focusEditor() {
        editorRef.current?.focus();
      },
      syncDirtyState(uid: string) {
        onDirtyChangeRef.current(uid, isTabModelDirty(uid));
      },
      getSelectionSnippet() {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const sel = editor?.getSelection();
        if (!editor || !model || !sel || sel.isEmpty()) return null;
        return {
          text: model.getValueInRange(sel),
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
        };
      },
      getFullText() {
        const editor = editorRef.current;
        return editor?.getModel()?.getValue() ?? null;
      },
      applyCodeEdit(mode: AICodeApplyMode, code: string) {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) return false;
        let range: MonacoType.IRange;
        if (mode === "replace_file") {
          range = model.getFullModelRange();
        } else if (mode === "replace_selection") {
          const sel = editor.getSelection();
          if (!sel || sel.isEmpty()) return false;
          range = sel;
        } else {
          const pos = editor.getPosition() ?? { lineNumber: 1, column: 1 };
          range = {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column,
          };
        }
        editor.pushUndoStop();
        const ok = editor.executeEdits("vega-native-ai", [
          { range, text: code, forceMoveMarkers: true },
        ]);
        editor.pushUndoStop();
        editor.focus();
        return ok;
      },
    }),
    []
  );

  // Initialize standalone Monaco editor once per mount cleanly
  useEffect(() => {
    let mounted = true;
    const host = containerRef.current;
    if (!host) return;

    let cursorDisposable: MonacoType.IDisposable | null = null;
    let selectionDisposable: MonacoType.IDisposable | null = null;
    const actionDisposables: MonacoType.IDisposable[] = [];
    let resizeObserver: ResizeObserver | null = null;
    let rafLayoutId: number | null = null;

    loadVegaMonaco()
      .then((monaco) => {
        if (!mounted || !containerRef.current) return;
        monacoRef.current = monaco;

        const prefersReducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const editor = monaco.editor.create(containerRef.current, {
          theme: VEGA_MONACO_THEME,
          automaticLayout: false,
          fontFamily:
            '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: settings.fontSize,
          lineHeight: Math.round(settings.fontSize * 1.55),
          tabSize: settings.tabSize,
          insertSpaces: settings.insertSpaces,
          wordWrap: settings.wordWrap,
          lineNumbers: settings.lineNumbers,
          minimap: {
            enabled: settings.minimap,
            renderCharacters: false,
            scale: 1,
          },
          scrollBeyondLastLine: false,
          smoothScrolling: !prefersReducedMotion,
          cursorBlinking: prefersReducedMotion ? "solid" : "smooth",
          cursorSmoothCaretAnimation: prefersReducedMotion ? "off" : "on",
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          renderWhitespace: "selection",
          padding: { top: 12, bottom: 16 },
          folding: true,
          foldingHighlight: true,
          fixedOverflowWidgets: true,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 9,
            horizontalScrollbarSize: 9,
          },
        });
        editorRef.current = editor;

        // Bind Ctrl+S / Cmd+S inside Monaco directly to active file save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const currentUid = attachedUidRef.current;
          if (currentUid) {
            onSaveShortcutRef.current(currentUid);
          }
        });

        const buildSelectionAttachment = () => {
          const tab = activeTabRef.current;
          const model = editor.getModel();
          const sel = editor.getSelection();
          if (!tab || !model || !sel || sel.isEmpty()) return null;
          const raw = model.getValueInRange(sel);
          const truncated = raw.length > 4000;
          const snippet = truncated ? raw.slice(0, 4000) : raw;
          return {
            kind: "selection" as const,
            title: `${tab.name}:${sel.startLineNumber}-${sel.endLineNumber}`,
            relative_path: tab.path,
            start_line: sel.startLineNumber,
            end_line: sel.endLineNumber,
            language: tab.monacoLanguage || tab.language || null,
            snippet,
            truncated,
          };
        };

        actionDisposables.push(
          editor.addAction({
            id: "vega.nativeAi.explainSelection",
            label: "Explain Selection (Native VEGA AI)",
            precondition: "editorHasSelection",
            contextMenuGroupId: "9_cutcopypaste",
            contextMenuOrder: 14,
            run: () => {
              const ctx = buildSelectionAttachment();
              if (ctx) {
                onAskNativeAiRef.current?.(
                  ctx,
                  `Explain this selection from ${ctx.relative_path ?? ctx.title} in the context of VEGA firmware:`
                );
              }
            },
          }),
          editor.addAction({
            id: "vega.nativeAi.fixSelection",
            label: "Review / Suggest Fix (Native VEGA AI)",
            precondition: "editorHasSelection",
            contextMenuGroupId: "9_cutcopypaste",
            contextMenuOrder: 15,
            run: () => {
              const ctx = buildSelectionAttachment();
              if (ctx) {
                onAskNativeAiRef.current?.(
                  ctx,
                  `Review and suggest embedded C/RISC-V fixes for this selection in ${ctx.relative_path ?? ctx.title}:`
                );
              }
            },
          }),
          editor.addAction({
            id: "vega.nativeAi.askFile",
            label: "Ask Native VEGA AI about File",
            contextMenuGroupId: "9_cutcopypaste",
            contextMenuOrder: 16,
            run: () => {
              const tab = activeTabRef.current;
              const model = editor.getModel();
              if (!tab || !model) return;
              const raw = model.getValue();
              const truncated = raw.length > 6000;
              const snippet = truncated ? raw.slice(0, 6000) : raw;
              onAskNativeAiRef.current?.(
                {
                  kind: "file",
                  title: tab.name,
                  relative_path: tab.path,
                  language: tab.monacoLanguage || tab.language || null,
                  snippet,
                  truncated,
                },
                `Analyze ${tab.path} for VEGA firmware development:`
              );
            },
          })
        );

        const emitCursor = () => {
          const pos = editor.getPosition();
          const sel = editor.getSelection();
          const model = editor.getModel();
          if (!pos) return;
          const selectionLength =
            sel && model && !sel.isEmpty() ? model.getValueInRange(sel).length : 0;
          onCursorChangeRef.current({
            lineNumber: pos.lineNumber,
            column: pos.column,
            selectionLength,
          });
        };

        cursorDisposable = editor.onDidChangeCursorPosition(emitCursor);
        selectionDisposable = editor.onDidChangeCursorSelection(emitCursor);

        resizeObserver = new ResizeObserver(() => {
          if (rafLayoutId !== null) cancelAnimationFrame(rafLayoutId);
          rafLayoutId = requestAnimationFrame(() => {
            editorRef.current?.layout();
          });
        });
        resizeObserver.observe(containerRef.current);

        setInitError(null);
        setInitializing(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to initialize Monaco Editor runtime.";
        setInitError(msg);
        setInitializing(false);
      });

    return () => {
      mounted = false;
      if (rafLayoutId !== null) cancelAnimationFrame(rafLayoutId);
      resizeObserver?.disconnect();
      cursorDisposable?.dispose();
      selectionDisposable?.dispose();
      for (const d of actionDisposables) d.dispose();
      contentListenerRef.current?.dispose();
      contentListenerRef.current = null;

      const editor = editorRef.current;
      if (editor) {
        if (attachedUidRef.current) {
          saveTabViewState(attachedUidRef.current, editor.saveViewState());
        }
        // Detach model before disposing editor so open ITextModels survive Home/Workspace toggles
        editor.setModel(null);
        editor.dispose();
        editorRef.current = null;
      }
      attachedUidRef.current = null;
    };
    // Initial mount reads initial settings; live settings updates run in separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update editor options when user modifies Editor Settings
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      fontSize: settings.fontSize,
      lineHeight: Math.round(settings.fontSize * 1.55),
      wordWrap: settings.wordWrap,
      lineNumbers: settings.lineNumbers,
      minimap: {
        enabled: settings.minimap,
        renderCharacters: false,
        scale: 1,
      },
    });
    const record = attachedUidRef.current
      ? getTabModelRecord(attachedUidRef.current)
      : undefined;
    if (record) {
      const isMakefile = record.model.getLanguageId() === "makefile";
      record.model.updateOptions({
        tabSize: isMakefile ? 4 : settings.tabSize,
        insertSpaces: isMakefile ? false : settings.insertSpaces,
      });
    }
    editor.layout();
  }, [settings]);

  // Navigate to requested line/column (e.g. clicking a build diagnostic)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || initializing || !pendingReveal) return;
    if (
      activeTab.path !== pendingReveal.path ||
      activeTab.loading ||
      activeTab.error
    ) {
      return;
    }
    const lineNumber = Math.max(1, pendingReveal.line);
    const column = Math.max(1, pendingReveal.column ?? 1);
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column });
    editor.focus();
    onConsumeRevealRef.current?.(pendingReveal.nonce);
  }, [
    initializing,
    pendingReveal,
    activeTab.path,
    activeTab.loading,
    activeTab.error,
  ]);

  // Attach or switch ITextModel when activeTab changes or finishes loading
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || initializing) return;
    if (activeTab.loading || activeTab.error) return;

    const prevUid = attachedUidRef.current;
    if (prevUid && prevUid !== activeTab.uid) {
      saveTabViewState(prevUid, editor.saveViewState());
    }

    contentListenerRef.current?.dispose();
    contentListenerRef.current = null;

    const record = getOrCreateTabModel(
      monaco,
      activeTab.uid,
      activeTab.path,
      activeTab.savedContent,
      activeTab.monacoLanguage,
      settings.tabSize,
      settings.insertSpaces
    );

    if (editor.getModel() !== record.model) {
      editor.setModel(record.model);
      if (record.viewState) {
        editor.restoreViewState(record.viewState);
      } else {
        editor.setPosition({ lineNumber: 1, column: 1 });
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      }
      editor.focus();
    }

    attachedUidRef.current = activeTab.uid;

    contentListenerRef.current = record.model.onDidChangeContent(() => {
      onDirtyChangeRef.current(activeTab.uid, isTabModelDirty(activeTab.uid));
    });

    const pos = editor.getPosition();
    if (pos) {
      onCursorChangeRef.current({
        lineNumber: pos.lineNumber,
        column: pos.column,
        selectionLength: 0,
      });
    }
    editor.layout();
  }, [
    initializing,
    activeTab.uid,
    activeTab.path,
    activeTab.loading,
    activeTab.error,
    activeTab.savedContent,
    activeTab.monacoLanguage,
    settings.tabSize,
    settings.insertSpaces,
  ]);

  if (initError) {
    return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-md rounded-2xl border border-red-400/25 bg-red-500/10 p-5 text-xs text-red-200">
        <p className="font-medium">Monaco Editor Initialization Error</p>
        <p className="mt-1 font-mono text-[11px] opacity-85">{initError}</p>
        </div>
      </div>
    );
  }

  return (
  <div className="vega-monaco-host relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#181818]">
      {initializing && (
      <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#181818] text-xs text-[#E4E4E7]">
        <Loader2 className="h-4 w-4 animate-spin text-[#7AA2FF]" />
          <span>Initializing Monaco Editor...</span>
        </div>
      )}
      <div ref={containerRef} className="min-h-0 w-full flex-1" />
    </div>
  );
});
