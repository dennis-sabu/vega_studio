"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import type * as MonacoType from "monaco-editor";
import {
  getOrCreateTabModel,
  getTabModelRecord,
  isTabModelDirty,
  loadVegaMonaco,
  saveTabViewState,
  VEGA_MONACO_THEME,
  type MonacoNamespace,
} from "@/lib/vegaMonaco";
import type { EditorCursorPosition, EditorSettings } from "@/types/editor";
import type { OpenFileTab } from "@/types/explorer";

export interface MonacoEditorHandle {
  triggerFind: () => void;
  triggerReplace: () => void;
  focusEditor: () => void;
  syncDirtyState: (uid: string) => void;
}

interface MonacoEditorSurfaceProps {
  activeTab: OpenFileTab;
  settings: EditorSettings;
  onDirtyChange: (uid: string, isDirty: boolean) => void;
  onCursorChange: (pos: EditorCursorPosition) => void;
  onSaveShortcut: (uid: string) => void;
}

export const MonacoEditorSurface = forwardRef<
  MonacoEditorHandle,
  MonacoEditorSurfaceProps
>(function MonacoEditorSurface(
  { activeTab, settings, onDirtyChange, onCursorChange, onSaveShortcut },
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

  const onDirtyChangeRef = useRef(onDirtyChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveShortcutRef = useRef(onSaveShortcut);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
    onCursorChangeRef.current = onCursorChange;
    onSaveShortcutRef.current = onSaveShortcut;
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
    let resizeObserver: ResizeObserver | null = null;
    let rafLayoutId: number | null = null;

    loadVegaMonaco()
      .then((monaco) => {
        if (!mounted || !containerRef.current) return;
        monacoRef.current = monaco;

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
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
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
    <div className="vega-monaco-host relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#06070c]">
      {initializing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#06070c]/90 text-xs text-[#e8ebf7]/65">
          <Loader2 className="h-4 w-4 animate-spin text-[#7aa2ff]" />
          <span>Initializing Monaco Editor...</span>
        </div>
      )}
      <div ref={containerRef} className="min-h-0 w-full flex-1" />
    </div>
  );
});
