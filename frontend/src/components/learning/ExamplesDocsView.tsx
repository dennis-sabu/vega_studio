"use client";

import { useEffect, useState } from"react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Compass,
  Copy,
  Cpu,
  ExternalLink,
  FileCode2,
  FolderPlus,
  GraduationCap,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from"lucide-react";
import { SafeDocMarkdownView } from"@/components/learning/SafeDocMarkdownView";
import type { LearningSubTab } from"@/hooks/useLearning";
import type {
  DocCatalogResponse,
  DocPageDetailResponse,
  DocPageSummary,
  DocSearchResponse,
  ExampleCatalogResponse,
  ExampleDetailResponse,
  ExampleFileContentResponse,
  ExampleSummary,
  ExampleVerificationStatus,
  IdeActionId,
} from"@/types/learning";

interface ExamplesDocsViewProps {
  subTab: LearningSubTab;
  onChangeSubTab: (tab: LearningSubTab) => void;
  activeBoardId: string | null;
  isBackendConnected: boolean;
  exampleCatalog: ExampleCatalogResponse | null;
  filteredExamples: ExampleSummary[];
  exampleSearch: string;
  onExampleSearchChange: (q: string) => void;
  exampleCategory: string;
  onExampleCategoryChange: (cat: string) => void;
  boardFilterOnly: boolean;
  onBoardFilterOnlyChange: (enabled: boolean) => void;
  selectedExampleId: string | null;
  selectedExampleDetail: ExampleDetailResponse | null;
  selectedFileRelPath: string | null;
  selectedFileContent: ExampleFileContentResponse | null;
  loadingExampleDetail: boolean;
  loadingFilePreview: boolean;
  onSelectExample: (exampleId: string) => void;
  onPreviewExampleFile: (exampleId: string, relPath: string) => void;
  onOpenCreateModal: (example: ExampleSummary) => void;
  docCatalog: DocCatalogResponse | null;
  filteredDocs: DocPageSummary[];
  docSearch: string;
  onDocSearchChange: (q: string) => void;
  docCategory: string;
  onDocCategoryChange: (cat: string) => void;
  docSearchResults: DocSearchResponse | null;
  searchingDocs: boolean;
  selectedDocSlug: string | null;
  selectedDocDetail: DocPageDetailResponse | null;
  loadingDocDetail: boolean;
  onSelectDoc: (slug: string) => void;
  error?: string | null;
  onClearError?: () => void;
  onRefresh: () => void;
  onRunIdeAction: (actionId: IdeActionId) => void;
  onAskAiAboutExample: (
    detail: ExampleDetailResponse,
    fileContent: ExampleFileContentResponse | null
  ) => void;
  onAskAiAboutDoc: (detail: DocPageDetailResponse) => void;
  onAskAiAboutSnippet: (snippet: string, title: string, language?: string) => void;
}

const GUIDE_CHECKLIST_STORAGE_KEY ="vega.learning.guideSteps.v1";

function loadCompletedGuideSteps(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GUIDE_CHECKLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

function verificationBadgeMeta(status: ExampleVerificationStatus): {
  label: string;
  classes: string;
} {
  if (status === "template_verified") {
    return {
      label: "Template Verified",
      classes: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
    };
  }
  if (status === "sdk_discovered") {
    return {
      label: "Local SDK",
      classes: "border-sky-500/35 bg-sky-500/12 text-sky-300",
    };
  }
  return {
    label: "Conceptual Pattern",
    classes: "border-amber-500/35 bg-amber-500/12 text-amber-300",
  };
}

function docBadgeMeta(badge: DocPageSummary["badge"]): {
  label: string;
  classes: string;
} {
  if (badge === "hardware_specs_verified") {
    return {
      label: "Hardware Specs Verified",
      classes: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
    };
  }
  if (badge === "conceptual") {
    return {
      label: "Conceptual Guide",
      classes: "border-amber-500/35 bg-amber-500/12 text-amber-300",
    };
  }
  if (badge === "external_reference") {
    return {
      label: "External Reference",
      classes: "border-sky-500/35 bg-sky-500/12 text-sky-300",
    };
  }
  return {
    label: "IDE Verified",
    classes: "border-[#7AA2FF]/35 bg-[#7AA2FF]/12 text-[#a8c4ff]",
  };
}

export function ExamplesDocsView({
  subTab,
  onChangeSubTab,
  activeBoardId,
  isBackendConnected,
  exampleCatalog,
  filteredExamples,
  exampleSearch,
  onExampleSearchChange,
  exampleCategory,
  onExampleCategoryChange,
  boardFilterOnly,
  onBoardFilterOnlyChange,
  selectedExampleId,
  selectedExampleDetail,
  selectedFileRelPath,
  selectedFileContent,
  loadingExampleDetail,
  loadingFilePreview,
  onSelectExample,
  onPreviewExampleFile,
  onOpenCreateModal,
  docCatalog,
  filteredDocs,
  docSearch,
  onDocSearchChange,
  docCategory,
  onDocCategoryChange,
  docSearchResults,
  searchingDocs,
  selectedDocSlug,
  selectedDocDetail,
  loadingDocDetail,
  onSelectDoc,
  error,
  onClearError,
  onRefresh,
  onRunIdeAction,
  onAskAiAboutExample,
  onAskAiAboutDoc,
  onAskAiAboutSnippet,
}: ExamplesDocsViewProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(
    loadCompletedGuideSteps
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GUIDE_CHECKLIST_STORAGE_KEY,
        JSON.stringify(completedSteps)
      );
    } catch {
      // Ignore storage quota issues cleanly
    }
  }, [completedSteps]);

  const toggleGuideStep = (guideId: string, stepNumber: number) => {
    const key = `${guideId}:${stepNumber}`;
    setCompletedSteps((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyPreview = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
  <div className="flex h-full min-h-0 flex-col bg-[#181818]">
      {/* Top Hero Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2D2D30] bg-[#181818] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 text-[#9ec0ff]">
            <GraduationCap className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-[#F4F4F5]">
              VEGA ARIES V3 Examples, Offline Docs &amp; Guided Learning
            </h1>
            <p className="text-xs text-[#E4E4E7]">
              Verified project starters, local SDK example discovery, offline firmware documentation, and workflow guides
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] ${
              exampleCatalog?.sdk_root_configured
                ? "border-sky-500/35 bg-sky-500/10 text-sky-300"
                : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7]"
            }`}
          >
          <ShieldCheck className="h-3.5 w-3.5" />
            {exampleCatalog?.sdk_root_configured
              ? `Local SDK (${exampleCatalog.sdk_examples_count} discovered)`
              : "Offline Bundled Catalog"}
          </span>

          {/* Sub-tab Segmented Switcher */}
          <div className="flex items-center gap-1 rounded-xl border border-[#2D2D30] bg-[#181818] p-0.5">
            {(
              [
                { id: "examples", label: "Examples Library", icon: Code2 },
                { id: "docs", label: "Offline Docs", icon: BookOpen },
                { id: "guides", label: "Guided Workflows", icon: Compass },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChangeSubTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "text-[#E4E4E7] hover:text-[#F4F4F5]"
                  }`}
                >
                <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={!isBackendConnected}
            title="Reload examples & docs"
            aria-label="Reload examples and docs"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2D2D30] bg-[#252527] text-[#F4F4F5] transition-colors hover:bg-[#2D2D31] hover:text-[#F4F4F5] disabled:opacity-40"
          >
          <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-5 mt-3 flex items-center justify-between gap-2 rounded-xl border border-red-400/30 bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200"
        >
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="truncate">{error}</span>
          </div>
          {onClearError && (
            <button
              type="button"
              onClick={onClearError}
              aria-label="Dismiss error banner"
              className="rounded p-1 hover:bg-[#2D2D31]"
            >
            <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {subTab === "examples" && (
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr]">
          {/* Left Example Catalog Column */}
          <div className="flex min-h-0 flex-col border-b border-[#2D2D30] bg-[#181818] lg:border-r lg:border-b-0">
            <div className="space-y-2.5 border-b border-[#2D2D30] p-3.5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-[#A1A1AA]" />
                <input
                  type="text"
                  value={exampleSearch}
                  onChange={(e) => onExampleSearchChange(e.target.value)}
                  placeholder="Search examples, tags, topics..."
                  className="w-full rounded-xl border border-[#2D2D30] bg-[#181818] py-2 pr-3 pl-9 text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => onExampleCategoryChange("")}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    exampleCategory === ""
                      ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:text-[#F4F4F5]"
                  }`}
                >
                  All
                </button>
                {(exampleCatalog?.categories ?? []).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      onExampleCategoryChange(exampleCategory === cat ? "" : cat)
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      exampleCategory === cat
                        ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                        : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:text-[#F4F4F5]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {activeBoardId && (
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#E4E4E7] select-none">
                  <input
                    type="checkbox"
                    checked={boardFilterOnly}
                    onChange={(e) => onBoardFilterOnlyChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#2D2D30] bg-[#181818]"
                  />
                  <span>Compatible with active board ({activeBoardId})</span>
                </label>
              )}
            </div>

            <div className="vega-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {filteredExamples.length === 0 ? (
              <div className="rounded-xl border border-[#2D2D30] bg-[#181818] p-4 text-center text-xs text-[#B4B4BC]">
                  No examples matched your filter. Clear search or configure local VEGA SDK paths in SDK Doctor.
                </div>
              ) : (
                filteredExamples.map((ex) => {
                  const selected = ex.id === selectedExampleId;
                  const badge = verificationBadgeMeta(ex.verification_status);
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => onSelectExample(ex.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selected
                          ? "border-[#7AA2FF]/50 bg-[#7AA2FF]/[0.1]"
                          : "border-[#2D2D30] bg-[#181818] hover:border-[#3F3F46] hover:bg-[#7AA2FF]/[0.11]"
                      }`}
                    >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-[#eff3ff]">
                          {ex.title}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-[#E4E4E7]">
                        {ex.short_description}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-[#B4B4BC]">
                        <span className="rounded bg-[#252527] px-1.5 py-0.5 capitalize">
                          {ex.difficulty}
                        </span>
                        <span className="rounded bg-[#252527] px-1.5 py-0.5">
                          {ex.file_count} files
                        </span>
                        <span>{ex.category}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Example Inspector & Source Preview */}
          <div className="vega-scroll min-h-0 overflow-y-auto p-5">
            {loadingExampleDetail ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#E4E4E7]">
              <Loader2 className="h-4 w-4 animate-spin text-[#7AA2FF]" />
                <span>Loading example metadata and files...</span>
              </div>
            ) : !selectedExampleDetail ? (
            <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-8 text-center text-xs text-[#E4E4E7]">
                Select an example on the left to inspect its architecture, source files, and create a new firmware project.
              </div>
            ) : (
            <div className="space-y-4">
                {/* Example Title + CTAs */}
                <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${
                            verificationBadgeMeta(
                              selectedExampleDetail.example.verification_status
                            ).classes
                          }`}
                        >
                          {
                            verificationBadgeMeta(
                              selectedExampleDetail.example.verification_status
                            ).label
                          }
                        </span>
                        <span className="rounded-full border border-[#2D2D30] bg-[#252527] px-2.5 py-0.5 font-mono text-[10px] capitalize text-[#F4F4F5]">
                          {selectedExampleDetail.example.difficulty}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#2D2D30] bg-[#252527] px-2.5 py-0.5 font-mono text-[10px] text-[#9ec0ff]">
                          <Cpu className="h-3 w-3" />
                          {selectedExampleDetail.example.compatible_boards.join(
                            ","
                          )}
                        </span>
                      </div>
                      <h2 className="mt-2 text-lg font-semibold tracking-tight text-[#F4F4F5]">
                        {selectedExampleDetail.example.title}
                      </h2>
                      <p className="mt-1 text-xs leading-relaxed text-[#F4F4F5]">
                        {selectedExampleDetail.long_description}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenCreateModal(selectedExampleDetail.example)
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#7AA2FF]/45 bg-[#7AA2FF]/20 px-3.5 py-2 text-xs font-semibold text-[#F4F4F5] transition-colors hover:bg-[#7AA2FF]/30"
                      >
                      <FolderPlus className="h-3.5 w-3.5 text-[#a8c4ff]" />
                        <span>Create Project from Example</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onAskAiAboutExample(
                            selectedExampleDetail,
                            selectedFileContent
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/14 bg-[#252527] px-3 py-2 text-xs font-medium text-[#F4F4F5] transition-colors hover:bg-[#2D2D31]"
                      >
                      <Sparkles className="h-3.5 w-3.5 text-[#7AA2FF]" />
                        <span>Ask VEGA AI</span>
                      </button>
                    </div>
                  </div>

                  {/* Verification & SDK Honesty Banner */}
                  <div
                    className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                      selectedExampleDetail.example.verification_status ===
                      "conceptual"
                        ? "border-amber-400/25 bg-amber-500/[0.07] text-amber-100/90"
                        : "border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-100/90"
                    }`}
                  >
                    <p>{selectedExampleDetail.example.verification_note}</p>
                    <p className="mt-1 font-mono text-[10.5px] opacity-80">
                      Toolchain / SDK note:{""}
                      {selectedExampleDetail.example.required_sdk}
                    </p>
                  </div>

                  {/* Objectives + Related Docs */}
                  {(selectedExampleDetail.learning_objectives.length > 0 ||
                    selectedExampleDetail.related_doc_slugs.length > 0) && (
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[#2D2D30] pt-3 md:grid-cols-2">
                      {selectedExampleDetail.learning_objectives.length > 0 && (
                        <div>
                          <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#B4B4BC] uppercase">
                            What you will learn
                          </span>
                          <ul className="mt-1.5 space-y-1 text-xs text-[#F4F4F5]">
                            {selectedExampleDetail.learning_objectives.map(
                              (obj, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7AA2FF]" />
                                  <span>{obj}</span>
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}

                      {selectedExampleDetail.related_doc_slugs.length > 0 && (
                        <div>
                          <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#B4B4BC] uppercase">
                            Related Offline Documentation
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {selectedExampleDetail.related_doc_slugs.map(
                              (slug) => (
                                <button
                                  key={slug}
                                  type="button"
                                  onClick={() => onSelectDoc(slug)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#7AA2FF]/30 bg-[#7AA2FF]/10 px-2.5 py-1 text-[11px] font-medium text-[#b9d0ff] transition-colors hover:bg-[#7AA2FF]/20"
                                >
                                <BookOpen className="h-3 w-3" />
                                  <span>{slug}</span>
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Source File Explorer + Bounded Code Preview */}
                <div className="overflow-hidden rounded-2xl border border-[#2D2D30] bg-[#181818]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2D2D30] bg-[#181818] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selectedExampleDetail.files.map((file) => {
                        const active =
                          file.relative_path === selectedFileRelPath;
                        return (
                          <button
                            key={file.relative_path}
                            type="button"
                            disabled={file.is_binary}
                            onClick={() =>
                              onPreviewExampleFile(
                                selectedExampleDetail.example.id,
                                file.relative_path
                              )
                            }
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                              active
                                ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                                : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:bg-[#252527] hover:text-[#F4F4F5]"
                            } disabled:opacity-40`}
                          >
                          <FileCode2 className="h-3 w-3" />
                            <span>{file.relative_path}</span>
                          </button>
                        );
                      })}
                    </div>

                    {selectedFileContent && (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-[#B4B4BC]">
                          {selectedFileContent.language} ·{""}
                          {selectedFileContent.size_bytes} B
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyPreview(selectedFileContent.content)
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-[#2D2D30] bg-[#252527] px-2 py-1 font-mono text-[10px] text-[#F4F4F5] hover:bg-[#2D2D31]"
                        >
                          {copiedCode ? (
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
                    )}
                  </div>

                  {loadingFilePreview ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-xs text-[#B4B4BC]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#7AA2FF]" />
                      <span>Loading source file preview...</span>
                    </div>
                  ) : selectedFileContent ? (
                  <div className="vega-scroll max-h-[420px] overflow-auto p-4">
                      {selectedFileContent.truncated && (
                      <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5" />
                          <span>
                            File preview truncated for safety at 32 KB. Create a project from this example to open the complete file in Monaco.
                          </span>
                        </div>
                      )}
                      <pre className="font-mono text-[12px] leading-[1.6] text-[#E4E4E7]">
                        <code>{selectedFileContent.content}</code>
                      </pre>
                    </div>
                  ) : (
                  <div className="p-6 text-center text-xs text-[#B4B4BC]">
                      Select a file tab above to preview its source code.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === "docs" && (
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
          {/* Left Doc Search + TOC Column */}
          <div className="flex min-h-0 flex-col border-b border-[#2D2D30] bg-[#181818] lg:border-r lg:border-b-0">
            <div className="space-y-2.5 border-b border-[#2D2D30] p-3.5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-[#A1A1AA]" />
                <input
                  type="text"
                  value={docSearch}
                  onChange={(e) => onDocSearchChange(e.target.value)}
                  placeholder="Full-text search offline docs..."
                  className="w-full rounded-xl border border-[#2D2D30] bg-[#181818] py-2 pr-3 pl-9 text-xs text-[#F4F4F5] placeholder:text-[#8E8E98] focus:border-[#7AA2FF]/55 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => onDocCategoryChange("")}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    docCategory === ""
                      ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                      : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:text-[#F4F4F5]"
                  }`}
                >
                  All
                </button>
                {(docCatalog?.categories ?? []).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      onDocCategoryChange(docCategory === cat ? "" : cat)
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      docCategory === cat
                        ? "border-[#7AA2FF]/45 bg-[#7AA2FF]/18 text-[#F4F4F5]"
                        : "border-[#2D2D30] bg-[#252527] text-[#E4E4E7] hover:text-[#F4F4F5]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="vega-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {docSearch.trim() ? (
                searchingDocs ? (
                <p className="py-4 text-center text-xs text-[#B4B4BC]">
                    Searching offline docs...
                  </p>
                ) : (docSearchResults?.results ?? []).length === 0 ? (
                <p className="py-4 text-center text-xs text-[#B4B4BC]">
                    No matching sections found for &ldquo;{docSearch}&rdquo;.
                  </p>
                ) : (
                  (docSearchResults?.results ?? []).map((res) => (
                    <button
                      key={res.slug}
                      type="button"
                      onClick={() => onSelectDoc(res.slug)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        res.slug === selectedDocSlug
                          ? "border-[#7AA2FF]/50 bg-[#7AA2FF]/[0.1]"
                          : "border-[#2D2D30] bg-[#181818] hover:border-[#3F3F46]"
                      }`}
                    >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-[#F4F4F5]">
                          {res.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-[#7AA2FF]">
                          {res.category}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[#E4E4E7]">
                        {res.snippet || res.summary}
                      </p>
                    </button>
                  ))
                )
              ) : (
                filteredDocs.map((doc) => (
                  <button
                    key={doc.slug}
                    type="button"
                    onClick={() => onSelectDoc(doc.slug)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      doc.slug === selectedDocSlug
                        ? "border-[#7AA2FF]/50 bg-[#7AA2FF]/[0.1]"
                        : "border-[#2D2D30] bg-[#181818] hover:border-[#3F3F46]"
                    }`}
                  >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-[#F4F4F5]">
                        {doc.title}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-[#B4B4BC]">
                        <Clock className="h-3 w-3" />
                        {doc.estimated_minutes}m
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-[#E4E4E7]">
                      {doc.summary}
                    </p>
                    <div className="mt-2 font-mono text-[10px] text-[#7AA2FF]">
                      {doc.category}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right Documentation Reader */}
          <div className="vega-scroll min-h-0 overflow-y-auto p-6">
            {loadingDocDetail ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#E4E4E7]">
              <Loader2 className="h-4 w-4 animate-spin text-[#7AA2FF]" />
                <span>Loading documentation page...</span>
              </div>
            ) : !selectedDocDetail ? (
            <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-8 text-center text-xs text-[#E4E4E7]">
                Choose a documentation topic on the left or run a full-text search above.
              </div>
            ) : (
            <div className="mx-auto max-w-3xl space-y-5">
                {/* Metadata & Action Bar */}
                <div className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${
                          docBadgeMeta(selectedDocDetail.doc.badge).classes
                        }`}
                      >
                        {docBadgeMeta(selectedDocDetail.doc.badge).label}
                      </span>
                      <span className="font-mono text-[11px] text-[#E4E4E7]">
                        {selectedDocDetail.doc.category} · ~
                        {selectedDocDetail.doc.estimated_minutes} min read
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onAskAiAboutDoc(selectedDocDetail)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#7AA2FF]/35 bg-[#7AA2FF]/12 px-3 py-1.5 text-xs font-medium text-[#c5d8ff] transition-colors hover:bg-[#7AA2FF]/22"
                    >
                    <Sparkles className="h-3.5 w-3.5" />
                      <span>Ask VEGA AI about Doc</span>
                    </button>
                  </div>

                  {/* Direct IDE Tool Actions */}
                  {selectedDocDetail.ide_actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#2D2D30] pt-3">
                    <span className="font-mono text-[10px] tracking-[0.06em] text-[#B4B4BC] uppercase">
                        IDE Actions:
                      </span>
                      {selectedDocDetail.ide_actions.map((act) => (
                        <button
                          key={`${act.action_id}-${act.label}`}
                          type="button"
                          onClick={() => onRunIdeAction(act.action_id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#2D2D30] bg-[#252527] px-2.5 py-1 text-[11.5px] font-medium text-[#F4F4F5] transition-colors hover:border-[#7AA2FF]/40 hover:bg-[#7AA2FF]/15"
                        >
                          <span>{act.label}</span>
                          <ArrowUpRight className="h-3 w-3 text-[#7AA2FF]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Safe Rendered Markdown */}
                <SafeDocMarkdownView
                  markdown={selectedDocDetail.markdown_content}
                  onSelectDocSlug={(slug) => onSelectDoc(slug)}
                  onAskAiSnippet={onAskAiAboutSnippet}
                />

                {/* Related Examples, Docs & External Links */}
                {(selectedDocDetail.doc.related_example_ids.length > 0 ||
                  selectedDocDetail.related_slugs.length > 0 ||
                  selectedDocDetail.external_links.length > 0) && (
                  <div className="space-y-3 rounded-2xl border border-[#2D2D30] bg-[#181818] p-4">
                    {selectedDocDetail.doc.related_example_ids.length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#B4B4BC] uppercase">
                          Related Firmware Examples
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {selectedDocDetail.doc.related_example_ids.map(
                            (exId) => (
                              <button
                                key={exId}
                                type="button"
                                onClick={() => {
                                  onSelectExample(exId);
                                  onChangeSubTab("examples");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                              >
                              <Code2 className="h-3 w-3" />
                                <span>{exId}</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {selectedDocDetail.related_slugs.length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#B4B4BC] uppercase">
                          Next Documentation Topics
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {selectedDocDetail.related_slugs.map((slug) => (
                            <button
                              key={slug}
                              type="button"
                              onClick={() => onSelectDoc(slug)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#2D2D30] bg-[#252527] px-2.5 py-1 text-[11px] text-[#F4F4F5] hover:bg-[#2D2D31]"
                            >
                            <BookOpen className="h-3 w-3 text-[#7AA2FF]" />
                              <span>{slug}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedDocDetail.external_links.length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-[#B4B4BC] uppercase">
                          Official External Resources (Opens in System Browser)
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {selectedDocDetail.external_links.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#7AA2FF]/30 bg-[#7AA2FF]/10 px-3 py-1.5 text-xs font-medium text-[#b9d0ff] hover:bg-[#7AA2FF]/20"
                            >
                              <span>{link.label}</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === "guides" && (
      <div className="vega-scroll min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
            {(docCatalog?.guides ?? []).map((guide) => {
              const doneCount = guide.steps.filter(
                (st) => completedSteps[`${guide.id}:${st.step_number}`]
              ).length;
              return (
                <section
                  key={guide.id}
                  className="rounded-2xl border border-[#2D2D30] bg-[#181818] p-5"
                >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#2D2D30] pb-3.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <Compass className="h-4 w-4 text-[#7AA2FF]" />
                        <h2 className="text-base font-semibold text-[#F4F4F5]">
                          {guide.title}
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-[#E4E4E7]">
                        {guide.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#E4E4E7]">
                      <span className="rounded-full border border-[#2D2D30] bg-[#252527] px-2.5 py-0.5 capitalize">
                        {guide.difficulty}
                      </span>
                      <span className="rounded-full border border-[#7AA2FF]/30 bg-[#7AA2FF]/12 px-2.5 py-0.5 text-[#b9d0ff]">
                        {doneCount}/{guide.steps.length} checked
                      </span>
                    </div>
                  </div>

                  <div className="mt-3.5 space-y-2.5">
                    {guide.steps.map((step) => {
                      const checked = Boolean(
                        completedSteps[`${guide.id}:${step.step_number}`]
                      );
                      return (
                        <div
                          key={step.step_number}
                          className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                            checked
                              ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                              : "border-[#2D2D30] bg-[#181818]"
                          }`}
                        >
                        <label className="flex flex-1 cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleGuideStep(guide.id, step.step_number)
                              }
                              className="mt-0.5 h-4 w-4 rounded border-[#2D2D30] bg-[#181818]"
                            />
                            <div>
                              <div
                                className={`text-xs font-semibold ${
                                  checked
                                    ? "text-emerald-200 line-through opacity-80"
                                    : "text-[#F4F4F5]"
                                }`}
                              >
                                Step {step.step_number}: {step.title}
                              </div>
                              <p className="mt-1 text-[11.5px] leading-relaxed text-[#E4E4E7]">
                                {step.detail}
                              </p>
                            </div>
                          </label>

                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {step.doc_slug && (
                              <button
                                type="button"
                                onClick={() => onSelectDoc(step.doc_slug!)}
                                className="inline-flex items-center gap-1 rounded-lg border border-[#2D2D30] bg-[#252527] px-2.5 py-1 text-[11px] font-medium text-[#F4F4F5] hover:bg-[#2D2D31]"
                              >
                              <BookOpen className="h-3 w-3 text-[#7AA2FF]" />
                                <span>Read Doc</span>
                              </button>
                            )}
                            {step.ide_action && (
                              <button
                                type="button"
                                onClick={() =>
                                  onRunIdeAction(step.ide_action!.action_id)
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-[#7AA2FF]/35 bg-[#7AA2FF]/14 px-2.5 py-1 text-[11px] font-medium text-[#c5d8ff] hover:bg-[#7AA2FF]/24"
                              >
                                <span>{step.ide_action.label}</span>
                                <ArrowUpRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
