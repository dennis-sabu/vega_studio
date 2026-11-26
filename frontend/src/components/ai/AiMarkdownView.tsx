"use client";

import { useState, type ReactNode } from"react";
import {
  Check,
  Code2,
  Copy,
  FileCheck2,
  Replace,
  CornerDownRight,
} from"lucide-react";
import type { AICodeApplyMode } from"@/types/ai";

interface AiMarkdownViewProps {
  content: string;
  canApplyToEditor: boolean;
  hasSelection: boolean;
  onProposeApply?: (code: string, language: string, mode: AICodeApplyMode) => void;
}

type Block =
  | { type: "code"; language: string; code: string }
  | { type: "markdown"; text: string };

function splitBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const fenceRe = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const before = raw.slice(lastIndex, match.index);
      if (before.trim()) {
        blocks.push({ type: "markdown", text: before });
      }
    }
    blocks.push({
      type: "code",
      language: match[1]?.trim() ||"text",
      code: match[2] ?? "",
    });
    lastIndex = fenceRe.lastIndex;
  }

  if (lastIndex < raw.length) {
    const tail = raw.slice(lastIndex);
    if (tail.trim()) {
      blocks.push({ type: "markdown", text: tail });
    }
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(text.slice(lastIdx, m.index));
    }
    const tok = m[0];
    if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded border border-[#2D2D30] bg-[#252527] px-1 py-0.5 font-mono text-[10.5px] text-[#93c5fd]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(
      <strong key={key++} className="font-semibold text-[#F4F4F5]">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      out.push(
      <em key={key++} className="italic text-[#F4F4F5]">
          {tok.slice(1, -1)}
        </em>
      );
    }
    lastIdx = tokenRe.lastIndex;
  }
  if (lastIdx < text.length) {
    out.push(text.slice(lastIdx));
  }
  return out;
}

function MarkdownTextBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const elements: ReactNode[] = [];
  let listItems: string[] = [];
  let ordered = false;
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (ordered) {
      elements.push(
      <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-4 text-[11.5px] text-[#F4F4F5]">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    } else {
      elements.push(
      <ul key={key++} className="my-1.5 list-disc space-y-1 pl-4 text-[11.5px] text-[#F4F4F5]">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }
    listItems = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const ulMatch = /^[-*]\s+(.*)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ulMatch) {
      if (listItems.length > 0 && ordered) flushList();
      ordered = false;
      listItems.push(ulMatch[1]);
      continue;
    }
    if (olMatch) {
      if (listItems.length > 0 && !ordered) flushList();
      ordered = true;
      listItems.push(olMatch[1]);
      continue;
    }
    flushList();

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      elements.push(
        <div
          key={key++}
          className={`mt-2 mb-1 font-semibold text-[#F4F4F5] ${
            level <= 2 ? "text-[12.5px]" : "text-[11.5px] text-[#93c5fd]"
          }`}
        >
          {renderInline(headingMatch[2])}
        </div>
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      elements.push(
        <blockquote
          key={key++}
          className="my-1 border-l-2 border-[#7AA2FF]/45 pl-2.5 text-[11px] text-[#F4F4F5]"
        >
          {renderInline(trimmed.slice(1).trim())}
        </blockquote>
      );
      continue;
    }

    elements.push(
    <p key={key++} className="my-1 text-[11.5px] leading-relaxed text-[#F4F4F5]">
        {renderInline(rawLine)}
      </p>
    );
  }
  flushList();

  return <div className="space-y-0.5">{elements}</div>;
}

function CodeBlockCard({
  language,
  code,
  canApplyToEditor,
  hasSelection,
  onProposeApply,
}: {
  language: string;
  code: string;
  canApplyToEditor: boolean;
  hasSelection: boolean;
  onProposeApply?: (code: string, language: string, mode: AICodeApplyMode) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure cleanly
    }
  };

  return (
  <div className="my-2 overflow-hidden rounded-xl border border-[#2D2D30] bg-[#181818]">
    <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#2D2D30] bg-[#181818] px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-[#7AA2FF] uppercase">
        <Code2 className="h-3 w-3" />
          <span>{language ||"code"}</span>
        </span>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            title="Copy code block"
            className="inline-flex h-5 items-center gap-1 rounded border border-[#2D2D30] bg-[#252527] px-1.5 font-mono text-[9.5px] text-[#F4F4F5] hover:bg-[#2D2D31] hover:text-[#F4F4F5]"
          >
            {copied ? (
              <>
              <Check className="h-2.5 w-2.5 text-emerald-300" />
              <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
              <Copy className="h-2.5 w-2.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          {onProposeApply && canApplyToEditor && (
            <>
              <button
                type="button"
                onClick={() => onProposeApply(code, language,"insert_at_cursor")}
                title="Preview & insert at active Monaco cursor"
                className="inline-flex h-5 items-center gap-1 rounded border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-1.5 font-mono text-[9.5px] text-[#F4F4F5] hover:bg-[#7AA2FF]/25"
              >
              <CornerDownRight className="h-2.5 w-2.5 text-[#7AA2FF]" />
                <span>Insert</span>
              </button>

              {hasSelection && (
                <button
                  type="button"
                  onClick={() => onProposeApply(code, language,"replace_selection")}
                  title="Preview & replace selected code in Monaco"
                  className="inline-flex h-5 items-center gap-1 rounded border border-amber-400/35 bg-amber-500/15 px-1.5 font-mono text-[9.5px] text-amber-100 hover:bg-amber-500/25"
                >
                <Replace className="h-2.5 w-2.5" />
                  <span>Replace Sel</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onProposeApply(code, language,"replace_file")}
                title="Review diff & apply to active file"
                className="inline-flex h-5 items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/12 px-1.5 font-mono text-[9.5px] text-emerald-200 hover:bg-emerald-500/22"
              >
              <FileCheck2 className="h-2.5 w-2.5" />
                <span>Review &amp; Apply</span>
              </button>
            </>
          )}
        </div>
      </div>

      <pre className="vega-scroll max-h-72 overflow-x-auto overflow-y-auto p-2.5 font-mono text-[10.5px] leading-relaxed text-[#F4F4F5]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function AiMarkdownView({
  content,
  canApplyToEditor,
  hasSelection,
  onProposeApply,
}: AiMarkdownViewProps) {
  const blocks = splitBlocks(content);
  if (blocks.length === 0) {
    return (
    <p className="text-[11.5px] text-[#B4B4BC] italic">
        (No content)
      </p>
    );
  }

  return (
  <div className="min-w-0 space-y-1.5 break-words">
      {blocks.map((block, idx) =>
        block.type === "code" ? (
          <CodeBlockCard
            key={idx}
            language={block.language}
            code={block.code}
            canApplyToEditor={canApplyToEditor}
            hasSelection={hasSelection}
            onProposeApply={onProposeApply}
          />
        ) : (
          <MarkdownTextBlock key={idx} text={block.text} />
        )
      )}
    </div>
  );
}
