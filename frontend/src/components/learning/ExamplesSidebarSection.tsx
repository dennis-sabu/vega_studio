"use client";

import {
  BookOpen,
  Code2,
  Compass,
  FolderPlus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { LearningSubTab } from "@/hooks/useLearning";
import type {
  DocCatalogResponse,
  DocPageSummary,
  ExampleCatalogResponse,
  ExampleSummary,
  ExampleVerificationStatus,
} from "@/types/learning";

interface ExamplesSidebarSectionProps {
  subTab: LearningSubTab;
  onChangeSubTab: (tab: LearningSubTab) => void;
  onOpenCenterLibrary: (tab?: LearningSubTab) => void;
  exampleCatalog: ExampleCatalogResponse | null;
  filteredExamples: ExampleSummary[];
  exampleSearch: string;
  onExampleSearchChange: (q: string) => void;
  selectedExampleId: string | null;
  onSelectExample: (exampleId: string) => void;
  onCreateFromExample: (example: ExampleSummary) => void;
  docCatalog: DocCatalogResponse | null;
  filteredDocs: DocPageSummary[];
  docSearch: string;
  onDocSearchChange: (q: string) => void;
  selectedDocSlug: string | null;
  onSelectDoc: (slug: string) => void;
  loading: boolean;
  onRefresh: () => void;
  isBackendConnected: boolean;
}

function statusPillClass(status: ExampleVerificationStatus): string {
  if (status === "template_verified") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "sdk_discovered") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function shortStatusLabel(status: ExampleVerificationStatus): string {
  if (status === "template_verified") return "Verified";
  if (status === "sdk_discovered") return "Local SDK";
  return "Conceptual";
}

export function ExamplesSidebarSection({
  subTab,
  onChangeSubTab,
  onOpenCenterLibrary,
  exampleCatalog,
  filteredExamples,
  exampleSearch,
  onExampleSearchChange,
  selectedExampleId,
  onSelectExample,
  onCreateFromExample,
  docCatalog,
  filteredDocs,
  docSearch,
  onDocSearchChange,
  selectedDocSlug,
  onSelectDoc,
  loading,
  onRefresh,
  isBackendConnected,
}: ExamplesSidebarSectionProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header Controls */}
      <div className="space-y-2 border-b border-white/8 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenCenterLibrary(subTab)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 px-2.5 py-1.5 text-[11px] font-medium text-[#c5d7ff] transition-colors hover:bg-[#7aa2ff]/20"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Open Full Library View</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || !isBackendConnected}
            title="Refresh examples & docs catalog"
            aria-label="Refresh examples and docs"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#e8ebf7]/65 transition-colors hover:bg-white/[0.1] hover:text-[#e8ebf7] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/8 bg-[#05060b]/80 p-0.5">
          {(
            [
              { id: "examples", label: "Examples" },
              { id: "docs", label: "Docs" },
              { id: "guides", label: "Guides" },
            ] as const
          ).map((item) => {
            const active = subTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChangeSubTab(item.id);
                  onOpenCenterLibrary(item.id);
                }}
                className={`rounded-md py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-white/12 text-[#f0f3ff]"
                    : "text-[#e8ebf7]/50 hover:text-[#e8ebf7]/85"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        {subTab !== "guides" && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[#e8ebf7]/35" />
            <input
              type="text"
              value={subTab === "examples" ? exampleSearch : docSearch}
              onChange={(e) =>
                subTab === "examples"
                  ? onExampleSearchChange(e.target.value)
                  : onDocSearchChange(e.target.value)
              }
              placeholder={
                subTab === "examples"
                  ? "Filter VEGA examples..."
                  : "Search offline docs..."
              }
              aria-label={
                subTab === "examples"
                  ? "Filter firmware examples"
                  : "Search offline documentation"
              }
              className="w-full rounded-lg border border-white/10 bg-[#05060b]/80 py-1.5 pr-2.5 pl-8 text-xs text-[#e8ebf7] placeholder:text-[#e8ebf7]/35 focus:border-[#7aa2ff]/50 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Scrollable Catalog List */}
      <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-2.5 space-y-2">
        {!isBackendConnected && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
            Backend offline — waiting for connection to load examples and offline docs.
          </div>
        )}

        {subTab === "examples" && (
          <>
            {filteredExamples.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-[#e8ebf7]/45">
                No matching VEGA firmware examples.
              </p>
            ) : (
              filteredExamples.map((ex) => {
                const selected = ex.id === selectedExampleId;
                return (
                  <div
                    key={ex.id}
                    className={`rounded-xl border p-2.5 transition-colors ${
                      selected
                        ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/[0.09]"
                        : "border-white/8 bg-[#0b0e18]/65 hover:border-white/16 hover:bg-[#0e1220]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectExample(ex.id);
                        onOpenCenterLibrary("examples");
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium leading-snug text-[#edf1ff]">
                          {ex.title}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase ${statusPillClass(ex.verification_status)}`}
                        >
                          {shortStatusLabel(ex.verification_status)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#e8ebf7]/55">
                        {ex.short_description}
                      </p>
                      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[#e8ebf7]/40">
                        <span>{ex.category}</span>
                        <span>{ex.file_count} files</span>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center gap-1.5 border-t border-white/6 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectExample(ex.id);
                          onOpenCenterLibrary("examples");
                        }}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.04] py-1 text-[10.5px] text-[#e8ebf7]/75 hover:bg-white/[0.1] hover:text-[#e8ebf7]"
                      >
                        <Code2 className="h-3 w-3" />
                        <span>Inspect</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onCreateFromExample(ex)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-[#7aa2ff]/30 bg-[#7aa2ff]/12 py-1 text-[10.5px] font-medium text-[#b9d0ff] hover:bg-[#7aa2ff]/22"
                      >
                        <FolderPlus className="h-3 w-3" />
                        <span>Use</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {subTab === "docs" && (
          <>
            {filteredDocs.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-[#e8ebf7]/45">
                No documentation pages found.
              </p>
            ) : (
              filteredDocs.map((doc) => {
                const selected = doc.slug === selectedDocSlug;
                return (
                  <button
                    key={doc.slug}
                    type="button"
                    onClick={() => {
                      onSelectDoc(doc.slug);
                      onOpenCenterLibrary("docs");
                    }}
                    className={`w-full rounded-xl border p-2.5 text-left transition-colors ${
                      selected
                        ? "border-[#7aa2ff]/45 bg-[#7aa2ff]/[0.09]"
                        : "border-white/8 bg-[#0b0e18]/65 hover:border-white/16 hover:bg-[#0e1220]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium leading-snug text-[#edf1ff]">
                        {doc.title}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] text-[#e8ebf7]/40">
                        {doc.estimated_minutes}m
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#e8ebf7]/55">
                      {doc.summary}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[#7aa2ff]/70">
                      <span>{doc.category}</span>
                    </div>
                  </button>
                );
              })
            )}
          </>
        )}

        {subTab === "guides" && (
          <div className="space-y-2">
            {(docCatalog?.guides ?? []).map((guide) => (
              <button
                key={guide.id}
                type="button"
                onClick={() => onOpenCenterLibrary("guides")}
                className="w-full rounded-xl border border-white/8 bg-[#0b0e18]/65 p-2.5 text-left transition-colors hover:border-[#7aa2ff]/35 hover:bg-[#0e1220]"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#edf1ff]">
                  <Compass className="h-3.5 w-3.5 text-[#7aa2ff]" />
                  <span>{guide.title}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#e8ebf7]/55">
                  {guide.description}
                </p>
                <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[#e8ebf7]/45">
                  <span>{guide.steps.length} steps</span>
                  <span>~{guide.estimated_minutes} min</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Honest SDK Status Footer */}
      <div className="border-t border-white/8 bg-[#05060b]/60 px-3 py-2 text-[10.5px] text-[#e8ebf7]/50">
        {exampleCatalog?.sdk_root_configured ? (
          <div className="flex items-center gap-1.5 text-sky-300/85">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span>
              Local SDK scanned ({exampleCatalog.sdk_examples_count} example
              {exampleCatalog.sdk_examples_count === 1 ? "" : "s"})
            </span>
          </div>
        ) : (
          <span>Built-in offline VEGA ARIES V3 library</span>
        )}
      </div>
    </div>
  );
}
