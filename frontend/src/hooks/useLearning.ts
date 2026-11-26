"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createProjectFromExample,
  fetchDocCatalog,
  fetchDocDetail,
  fetchExampleCatalog,
  fetchExampleDetail,
  fetchExampleFileContent,
  searchDocsCatalog,
  validateExampleCompatibility,
} from "@/lib/api";
import type {
  CreateProjectFromExamplePayload,
  DocCatalogResponse,
  DocPageDetailResponse,
  DocSearchResponse,
  ExampleCatalogResponse,
  ExampleDetailResponse,
  ExampleFileContentResponse,
  ExampleSummary,
  ExampleValidationResponse,
} from "@/types/learning";
import type { WorkspaceSummary } from "@/types/project";

export type LearningSubTab = "examples" | "docs" | "guides";

interface UseLearningOptions {
  isBackendConnected: boolean;
  activeProjectDir: string | null;
  activeBoardId: string | null;
  sdkConfigUpdatedAt?: string | null;
  onProjectCreated: (summary: WorkspaceSummary) => Promise<void> | void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export function useLearning({
  isBackendConnected,
  activeProjectDir,
  activeBoardId,
  sdkConfigUpdatedAt,
  onProjectCreated,
  onLog,
}: UseLearningOptions) {
  const [subTab, setSubTab] = useState<LearningSubTab>("examples");

  const [exampleCatalog, setExampleCatalog] =
    useState<ExampleCatalogResponse | null>(null);
  const [exampleSearch, setExampleSearch] = useState("");
  const [exampleCategory, setExampleCategory] = useState("");
  const [boardFilterOnly, setBoardFilterOnly] = useState(false);

  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(
    null
  );
  const [selectedExampleDetail, setSelectedExampleDetail] =
    useState<ExampleDetailResponse | null>(null);
  const [selectedFileRelPath, setSelectedFileRelPath] = useState<string | null>(
    null
  );
  const [selectedFileContent, setSelectedFileContent] =
    useState<ExampleFileContentResponse | null>(null);

  const [docCatalog, setDocCatalog] = useState<DocCatalogResponse | null>(null);
  const [docSearch, setDocSearch] = useState("");
  const [docCategory, setDocCategory] = useState("");
  const [docSearchResults, setDocSearchResults] =
    useState<DocSearchResponse | null>(null);
  const [selectedDocSlug, setSelectedDocSlug] = useState<string | null>(null);
  const [selectedDocDetail, setSelectedDocDetail] =
    useState<DocPageDetailResponse | null>(null);

  const [loadingExamples, setLoadingExamples] = useState(false);
  const [loadingExampleDetail, setLoadingExampleDetail] = useState(false);
  const [loadingFilePreview, setLoadingFilePreview] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingDocDetail, setLoadingDocDetail] = useState(false);
  const [searchingDocs, setSearchingDocs] = useState(false);

  const [createModalExample, setCreateModalExample] =
    useState<ExampleSummary | null>(null);
  const [validationReport, setValidationReport] =
    useState<ExampleValidationResponse | null>(null);
  const [validatingExample, setValidatingExample] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [collisionPrompted, setCollisionPrompted] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const onLogRef = useRef(onLog);
  const selectedExampleIdRef = useRef<string | null>(selectedExampleId);
  const selectedDocSlugRef = useRef<string | null>(selectedDocSlug);
  const exampleAbortRef = useRef<AbortController | null>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const docAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onLogRef.current = onLog;
    selectedExampleIdRef.current = selectedExampleId;
    selectedDocSlugRef.current = selectedDocSlug;
  });

  useEffect(() => {
    return () => {
      exampleAbortRef.current?.abort();
      fileAbortRef.current?.abort();
      docAbortRef.current?.abort();
    };
  }, []);

  const previewExampleFile = useCallback(
    async (exampleId: string, relPath: string) => {
      if (!isBackendConnected) return;
      fileAbortRef.current?.abort();
      const ctrl = new AbortController();
      fileAbortRef.current = ctrl;

      setSelectedFileRelPath(relPath);
      setLoadingFilePreview(true);
      setError(null);
      try {
        const res = await fetchExampleFileContent(
          exampleId,
          relPath,
          ctrl.signal
        );
        if (ctrl.signal.aborted || fileAbortRef.current !== ctrl) return;
        setSelectedFileContent(res);
      } catch (err: unknown) {
        if (
          ctrl.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setSelectedFileContent(null);
        setError(
          err instanceof Error ? err.message : "Failed to load example file."
        );
      } finally {
        if (fileAbortRef.current === ctrl) {
          setLoadingFilePreview(false);
        }
      }
    },
    [isBackendConnected]
  );

  const selectExample = useCallback(
    async (exampleId: string, previewEntry = true) => {
      if (!isBackendConnected) return;
      exampleAbortRef.current?.abort();
      fileAbortRef.current?.abort();
      const ctrl = new AbortController();
      exampleAbortRef.current = ctrl;

      setSelectedExampleId(exampleId);
      setLoadingExampleDetail(true);
      setError(null);
      try {
        const detail = await fetchExampleDetail(exampleId, ctrl.signal);
        if (ctrl.signal.aborted || exampleAbortRef.current !== ctrl) return;
        setSelectedExampleDetail(detail);
        const preferredFile =
          detail.example.entry_file ||
          detail.files.find((f) => !f.is_binary && f.relative_path !== "README.md")
            ?.relative_path ||
          detail.files[0]?.relative_path ||
          null;
        if (previewEntry && preferredFile) {
          setSelectedFileRelPath(preferredFile);
          setLoadingFilePreview(true);
          try {
            const fileRes = await fetchExampleFileContent(
              exampleId,
              preferredFile,
              ctrl.signal
            );
            if (ctrl.signal.aborted || exampleAbortRef.current !== ctrl) return;
            setSelectedFileContent(fileRes);
          } catch (fileErr: unknown) {
            if (
              ctrl.signal.aborted ||
              (fileErr instanceof Error && fileErr.name === "AbortError")
            ) {
              return;
            }
            setSelectedFileContent(null);
            setError(
              fileErr instanceof Error
                ? fileErr.message
                : "Failed to preview entry file."
            );
          } finally {
            if (exampleAbortRef.current === ctrl) {
              setLoadingFilePreview(false);
            }
          }
        } else {
          setSelectedFileRelPath(null);
          setSelectedFileContent(null);
        }
      } catch (err: unknown) {
        if (
          ctrl.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setSelectedExampleDetail(null);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load example details."
        );
      } finally {
        if (exampleAbortRef.current === ctrl) {
          setLoadingExampleDetail(false);
        }
      }
    },
    [isBackendConnected]
  );

  const selectDoc = useCallback(
    async (slug: string, switchToDocsTab = true) => {
      if (!isBackendConnected) return;
      docAbortRef.current?.abort();
      const ctrl = new AbortController();
      docAbortRef.current = ctrl;

      if (switchToDocsTab) {
        setSubTab("docs");
      }
      setSelectedDocSlug(slug);
      setLoadingDocDetail(true);
      setError(null);
      try {
        const detail = await fetchDocDetail(slug, ctrl.signal);
        if (ctrl.signal.aborted || docAbortRef.current !== ctrl) return;
        setSelectedDocDetail(detail);
      } catch (err: unknown) {
        if (
          ctrl.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setSelectedDocDetail(null);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load documentation page."
        );
      } finally {
        if (docAbortRef.current === ctrl) {
          setLoadingDocDetail(false);
        }
      }
    },
    [isBackendConnected]
  );

  const refreshCatalogs = useCallback(async () => {
    if (!isBackendConnected) return;
    setLoadingExamples(true);
    setLoadingDocs(true);
    setError(null);
    try {
      const [exRes, docRes] = await Promise.all([
        fetchExampleCatalog(),
        fetchDocCatalog(),
      ]);
      setExampleCatalog(exRes);
      setDocCatalog(docRes);

      const fallbackEx = exRes.examples[0]?.id ?? null;
      if (!selectedExampleIdRef.current && fallbackEx) {
        await selectExample(fallbackEx, true);
      }
      const fallbackDoc = docRes.docs[0]?.slug ?? null;
      if (!selectedDocSlugRef.current && fallbackDoc) {
        await selectDoc(fallbackDoc, false);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load examples & documentation."
      );
    } finally {
      setLoadingExamples(false);
      setLoadingDocs(false);
    }
  }, [isBackendConnected, selectDoc, selectExample]);

  useEffect(() => {
    if (!isBackendConnected) return;
    const ctrl = new AbortController();
    void (async () => {
      setLoadingExamples(true);
      setLoadingDocs(true);
      try {
        const [exRes, docRes] = await Promise.all([
          fetchExampleCatalog(undefined, ctrl.signal),
          fetchDocCatalog(undefined, ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        setExampleCatalog(exRes);
        setDocCatalog(docRes);

        if (!selectedExampleIdRef.current && exRes.examples[0]?.id) {
          void selectExample(exRes.examples[0].id, true);
        }
        if (!selectedDocSlugRef.current && docRes.docs[0]?.slug) {
          void selectDoc(docRes.docs[0].slug, false);
        }
      } catch (err: unknown) {
        if (
          !ctrl.signal.aborted &&
          !(err instanceof Error && err.name === "AbortError")
        ) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load examples & docs catalog."
          );
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setLoadingExamples(false);
          setLoadingDocs(false);
        }
      }
    })();
    return () => {
      ctrl.abort();
    };
  }, [isBackendConnected, sdkConfigUpdatedAt, selectDoc, selectExample]);

  useEffect(() => {
    const query = docSearch.trim();
    if (!isBackendConnected || !query) {
      queueMicrotask(() => {
        setDocSearchResults(null);
        setSearchingDocs(false);
      });
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearchingDocs(true);
        try {
          const res = await searchDocsCatalog(
            query,
            docCategory || null,
            ctrl.signal
          );
          if (!ctrl.signal.aborted) {
            setDocSearchResults(res);
          }
        } catch (err: unknown) {
          if (
            !ctrl.signal.aborted &&
            !(err instanceof Error && err.name === "AbortError")
          ) {
            setError(
              err instanceof Error
                ? err.message
                : "Documentation search failed."
            );
          }
        } finally {
          if (!ctrl.signal.aborted) {
            setSearchingDocs(false);
          }
        }
      })();
    }, 180);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [docCategory, docSearch, isBackendConnected]);

  const filteredExamples = useMemo(() => {
    const items = exampleCatalog?.examples ?? [];
    const needle = exampleSearch.trim().toLowerCase();
    const cat = exampleCategory.trim().toLowerCase();
    return items.filter((item) => {
      if (cat && item.category.toLowerCase() !== cat) return false;
      if (
        boardFilterOnly &&
        activeBoardId &&
        !item.compatible_boards.includes(activeBoardId)
      ) {
        return false;
      }
      if (needle) {
        const hay =
          `${item.title} ${item.short_description} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [
    activeBoardId,
    boardFilterOnly,
    exampleCatalog,
    exampleCategory,
    exampleSearch,
  ]);

  const filteredDocs = useMemo(() => {
    const items = docCatalog?.docs ?? [];
    const cat = docCategory.trim().toLowerCase();
    if (!cat) return items;
    return items.filter((d) => d.category.toLowerCase() === cat);
  }, [docCatalog, docCategory]);

  const runValidation = useCallback(
    async (exampleId: string, boardId?: string | null) => {
      if (!isBackendConnected) return;
      setValidatingExample(true);
      try {
        const res = await validateExampleCompatibility(exampleId, {
          project_dir: activeProjectDir,
          board_id: boardId ?? activeBoardId ?? "VEGA_ARIES_V3",
        });
        setValidationReport(res);
      } catch (err: unknown) {
        setCreateError(
          err instanceof Error ? err.message : "Validation check failed."
        );
      } finally {
        setValidatingExample(false);
      }
    },
    [activeBoardId, activeProjectDir, isBackendConnected]
  );

  const openCreateProjectModal = useCallback(
    (example: ExampleSummary) => {
      setCreateModalExample(example);
      setCreateError(null);
      setCollisionPrompted(false);
      setValidationReport(null);
      void runValidation(
        example.id,
        example.compatible_boards[0] ?? activeBoardId ?? "VEGA_ARIES_V3"
      );
    },
    [activeBoardId, runValidation]
  );

  const closeCreateProjectModal = useCallback(() => {
    if (creatingProject) return;
    setCreateModalExample(null);
    setCreateError(null);
    setCollisionPrompted(false);
  }, [creatingProject]);

  const submitCreateProject = useCallback(
    async (payload: CreateProjectFromExamplePayload): Promise<boolean> => {
      setCreatingProject(true);
      setCreateError(null);
      try {
        const summary = await createProjectFromExample(payload);
        setCollisionPrompted(false);
        setCreateModalExample(null);
        onLogRef.current?.(
          "info",
          `Created project '${summary.project.name}' from example '${payload.example_id}'.`
        );
        await onProjectCreated(summary);
        return true;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) {
          setCollisionPrompted(true);
        }
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to create project from example.";
        setCreateError(msg);
        onLogRef.current?.("error", msg);
        return false;
      } finally {
        setCreatingProject(false);
      }
    },
    [onProjectCreated]
  );

  return {
    subTab,
    setSubTab,
    exampleCatalog,
    filteredExamples,
    exampleSearch,
    setExampleSearch,
    exampleCategory,
    setExampleCategory,
    boardFilterOnly,
    setBoardFilterOnly,
    selectedExampleId,
    selectedExampleDetail,
    selectedFileRelPath,
    selectedFileContent,
    loadingExamples,
    loadingExampleDetail,
    loadingFilePreview,
    selectExample,
    previewExampleFile,
    docCatalog,
    filteredDocs,
    docSearch,
    setDocSearch,
    docCategory,
    setDocCategory,
    docSearchResults,
    searchingDocs,
    selectedDocSlug,
    selectedDocDetail,
    loadingDocs,
    loadingDocDetail,
    selectDoc,
    refreshCatalogs,
    createModalExample,
    validationReport,
    validatingExample,
    creatingProject,
    createError,
    collisionPrompted,
    setCreateError,
    setCollisionPrompted,
    runValidation,
    openCreateProjectModal,
    closeCreateProjectModal,
    submitCreateProject,
    error,
    clearError: () => setError(null),
  };
}
