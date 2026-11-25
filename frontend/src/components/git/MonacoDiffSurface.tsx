"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type * as MonacoType from "monaco-editor";
import {
  detectMonacoLanguageClient,
  loadVegaMonaco,
  VEGA_MONACO_THEME,
} from "@/lib/vegaMonaco";

interface MonacoDiffSurfaceProps {
  path: string;
  originalContent: string;
  modifiedContent: string;
  sideBySide: boolean;
}

export function MonacoDiffSurface({
  path,
  originalContent,
  modifiedContent,
  sideBySide,
}: MonacoDiffSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const diffEditorRef = useRef<MonacoType.editor.IStandaloneDiffEditor | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let diffEditor: MonacoType.editor.IStandaloneDiffEditor | null = null;
    let origModel: MonacoType.editor.ITextModel | null = null;
    let modModel: MonacoType.editor.ITextModel | null = null;

    void loadVegaMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;

      const { monacoLanguage } = detectMonacoLanguageClient(path);
      origModel = monaco.editor.createModel(originalContent, monacoLanguage);
      modModel = monaco.editor.createModel(modifiedContent, monacoLanguage);

      diffEditor = monaco.editor.createDiffEditor(hostRef.current, {
        theme: VEGA_MONACO_THEME,
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: sideBySide,
        enableSplitViewResizing: true,
        ignoreTrimWhitespace: false,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily:
          'var(--font-mono), "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      });

      diffEditor.setModel({
        original: origModel,
        modified: modModel,
      });

      diffEditorRef.current = diffEditor;
      setLoading(false);
    });

    return () => {
      disposed = true;
      diffEditorRef.current = null;
      if (diffEditor) {
        try {
          diffEditor.setModel(null);
        } catch {
          // Ignore detach failures on teardown.
        }
        diffEditor.dispose();
      }
      origModel?.dispose();
      modModel?.dispose();
    };
  }, [modifiedContent, originalContent, path, sideBySide]);

  return (
    <div className="vega-monaco-host relative min-h-[260px] flex-1 overflow-hidden bg-[#06070c]">
      {loading && (
        <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-[#e8ebf7]/55">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7aa2ff]" />
          <span>Loading Monaco diff view…</span>
        </div>
      )}
      <div
        ref={hostRef}
        className={`h-full w-full ${loading ? "hidden" : "block"}`}
      />
    </div>
  );
}
