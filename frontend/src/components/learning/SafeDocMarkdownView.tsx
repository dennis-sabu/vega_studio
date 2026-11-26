"use client";

import React, { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";

interface SafeDocMarkdownViewProps {
  markdown: string;
  onSelectDocSlug?: (slug: string) => void;
  onAskAiSnippet?: (snippet: string, title: string, language?: string) => void;
}

type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "blockquote"; alertType: string | null; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" };

function sanitizeExternalUrl(rawUrl: string): string | null {
  const cleaned = rawUrl.trim();
  if (!cleaned) return null;
  if (/^(https?:)\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }
  return null;
}

function parseMarkdownBlocks(markdown: string): BlockNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = raw.match(/^\s*```([A-Za-z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "text";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Headings
    const headingMatch = raw.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Blockquote & Alerts
    if (raw.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      let alertType: string | null = null;
      if (quoteLines.length > 0) {
        const alertMatch = quoteLines[0].match(
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i
        );
        if (alertMatch) {
          alertType = alertMatch[1].toUpperCase();
          if (alertMatch[2]) {
            quoteLines[0] = alertMatch[2];
          } else {
            quoteLines.shift();
          }
        }
      }
      blocks.push({ type: "blockquote", alertType, lines: quoteLines });
      continue;
    }

    // Markdown table
    if (
      trimmed.startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      const splitRow = (line: string): string[] =>
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = splitRow(raw);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Unordered or ordered list
    const ulMatch = raw.match(/^\s*[-*+]\s+(.+)$/);
    const olMatch = raw.match(/^\s*\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const line = lines[i];
        const m = ordered
          ? line.match(/^\s*\d+\.\s+(.+)$/)
          : line.match(/^\s*[-*+]\s+(.+)$/);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph (join contiguous plain lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        curTrim.startsWith("#") ||
        curTrim.startsWith("```") ||
        curTrim.startsWith(">") ||
        curTrim.startsWith("|") ||
        /^\s*[-*+]\s+/.test(cur) ||
        /^\s*\d+\.\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim)
      ) {
        break;
      }
      paraLines.push(curTrim);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    } else {
      i += 1;
    }
  }

  return blocks;
}

function renderInlineSpans(
  text: string,
  onSelectDocSlug?: (slug: string) => void
): React.ReactNode[] {
  // Tokenize inline code, bold, italic, and markdown links safely without HTML injection.
  const tokenRegex =
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `tok-${keyCounter++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={key}
          className="rounded border border-white/10 bg-[#0b0e18] px-1.5 py-0.5 font-mono text-[12px] text-[#9ec0ff]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={key} className="font-semibold text-[#f1f4ff]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <em key={key} className="italic text-[#e8ebf7]/90">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1];
        const rawHref = linkMatch[2].trim();
        if (rawHref.startsWith("doc:") && onSelectDocSlug) {
          const slug = rawHref.slice(4).trim();
          parts.push(
            <button
              key={key}
              type="button"
              onClick={() => onSelectDocSlug(slug)}
              className="font-medium text-[#7aa2ff] underline decoration-[#7aa2ff]/40 underline-offset-2 hover:text-[#a8c4ff]"
            >
              {label}
            </button>
          );
        } else {
          const safeUrl = sanitizeExternalUrl(rawHref);
          if (safeUrl) {
            parts.push(
              <a
                key={key}
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[#7aa2ff] underline decoration-[#7aa2ff]/40 underline-offset-2 hover:text-[#a8c4ff]"
              >
                <span>{label}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            );
          } else {
            // Non-http(s) links (e.g. javascript:, file:) are safely flattened to plain text
            parts.push(<span key={key}>{label}</span>);
          }
        }
      } else {
        parts.push(token);
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function CodeBlock({
  lang,
  code,
  onAskAiSnippet,
}: {
  lang: string;
  code: string;
  onAskAiSnippet?: (snippet: string, title: string, language?: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-[#05060b]">
      <div className="flex items-center justify-between border-b border-white/8 bg-[#0b0e18]/90 px-3 py-1.5">
        <span className="font-mono text-[10px] tracking-[0.06em] text-[#e8ebf7]/50 uppercase">
          {lang || "code"}
        </span>
        <div className="flex items-center gap-1.5">
          {onAskAiSnippet && (
            <button
              type="button"
              onClick={() =>
                onAskAiSnippet(code, `Doc code snippet (${lang || "text"})`, lang)
              }
              className="inline-flex items-center gap-1 rounded-md border border-[#7aa2ff]/25 bg-[#7aa2ff]/10 px-2 py-0.5 font-mono text-[10px] text-[#9ec0ff] transition-colors hover:bg-[#7aa2ff]/20"
            >
              <Sparkles className="h-3 w-3" />
              <span>Ask AI</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-[#e8ebf7]/70 transition-colors hover:bg-white/[0.1] hover:text-[#e8ebf7]"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="vega-scroll overflow-x-auto p-3 font-mono text-[12px] leading-[1.6] text-[#dde4fb]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const ALERT_STYLES: Record<string, string> = {
  NOTE: "border-[#7aa2ff]/35 bg-[#7aa2ff]/[0.06] text-[#d6e4ff]",
  TIP: "border-emerald-500/35 bg-emerald-500/[0.06] text-emerald-100",
  IMPORTANT: "border-indigo-400/35 bg-indigo-500/[0.07] text-indigo-100",
  WARNING: "border-amber-400/35 bg-amber-500/[0.07] text-amber-100",
  CAUTION: "border-rose-400/35 bg-rose-500/[0.07] text-rose-100",
};

export function SafeDocMarkdownView({
  markdown,
  onSelectDocSlug,
  onAskAiSnippet,
}: SafeDocMarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);

  return (
    <div className="space-y-3 text-[13.5px] leading-[1.68] text-[#e8ebf7]/82">
      {blocks.map((block, index) => {
        if (block.type === "hr") {
          return <hr key={index} className="my-4 border-white/10" />;
        }

        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h1
                key={index}
                className="border-b border-white/8 pb-2 text-xl font-semibold tracking-tight text-[#f4f6ff]"
              >
                {renderInlineSpans(block.text, onSelectDocSlug)}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2
                key={index}
                className="mt-5 text-[16px] font-semibold tracking-tight text-[#edf1ff]"
              >
                {renderInlineSpans(block.text, onSelectDocSlug)}
              </h2>
            );
          }
          return (
            <h3
              key={index}
              className="mt-4 text-[14px] font-semibold text-[#dce4ff]"
            >
              {renderInlineSpans(block.text, onSelectDocSlug)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={index} className="text-[#e8ebf7]/80">
              {renderInlineSpans(block.text, onSelectDocSlug)}
            </p>
          );
        }

        if (block.type === "code") {
          return (
            <CodeBlock
              key={index}
              lang={block.lang}
              code={block.code}
              onAskAiSnippet={onAskAiSnippet}
            />
          );
        }

        if (block.type === "blockquote") {
          const styleClass = block.alertType
            ? ALERT_STYLES[block.alertType] ??
              "border-white/15 bg-white/[0.03] text-[#e8ebf7]/85"
            : "border-[#7aa2ff]/40 bg-white/[0.02] text-[#e8ebf7]/78";
          return (
            <div
              key={index}
              className={`rounded-r-xl border-l-2 px-3.5 py-2.5 text-[13px] ${styleClass}`}
            >
              {block.alertType && (
                <div className="mb-1 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80">
                  {block.alertType}
                </div>
              )}
              <div className="space-y-1">
                {block.lines.map((line, li) => (
                  <p key={li}>
                    {renderInlineSpans(line, onSelectDocSlug)}
                  </p>
                ))}
              </div>
            </div>
          );
        }

        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag
              key={index}
              className={`space-y-1.5 pl-5 ${
                block.ordered ? "list-decimal" : "list-disc"
              } text-[#e8ebf7]/80 marker:text-[#7aa2ff]/70`}
            >
              {block.items.map((item, li) => (
                <li key={li} className="pl-1">
                  {renderInlineSpans(item, onSelectDocSlug)}
                </li>
              ))}
            </Tag>
          );
        }

        if (block.type === "table") {
          return (
            <div
              key={index}
              className="vega-scroll my-3 overflow-x-auto rounded-xl border border-white/10 bg-[#080b13]/70"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03]">
                    {block.headers.map((h, hi) => (
                      <th
                        key={hi}
                        className="px-3 py-2 font-mono text-[11px] font-semibold text-[#cfd9fb]"
                      >
                        {renderInlineSpans(h, onSelectDocSlug)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-white/6 last:border-b-0"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 align-top text-[#e8ebf7]/75"
                        >
                          {renderInlineSpans(cell, onSelectDocSlug)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
