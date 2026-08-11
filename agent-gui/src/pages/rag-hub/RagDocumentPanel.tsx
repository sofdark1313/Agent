import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { FileText, Link2, RefreshCw, Trash2, Upload } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useLocale } from "../../i18n";
import {
  effectiveRagDocumentStatus,
  hydrateRagIngestionHistory,
  normalizeRagDocumentStatus,
  type RagJobsByDocumentId,
  reconcileRagJobsWithDocuments,
  recordAcceptedRagJob,
  recordRagIngestionJob,
  removeRagDocumentJob,
  retryJobIdForDocument,
} from "./ingestionJobState";
import { pollIngestionJob } from "./ingestionPolling";
import {
  createDefaultRagIngestionSelection,
  type RagIngestionProcessMode,
  type RagIngestionSelection,
  type RagIngestionSettings,
  type RagPickedDocumentFile,
  validateRagIngestionSelection,
  validateRagPickedDocument,
} from "./ingestionSettings";

type RagPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

type RagDocument = {
  id: string;
  knowledgeBaseId: string;
  name: string;
  sourceType?: string | null;
  sourceLocation?: string | null;
  enabled?: boolean | null;
  chunkCount?: number | null;
  fileType?: string | null;
  fileSize?: number | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type RagChunk = {
  id: string;
  index?: number | null;
  content: string;
  charCount?: number | null;
  tokenCount?: number | null;
  enabled: boolean;
};

type RagAcceptedJob = {
  documentId: string;
  jobId: string;
  status: string;
};

type RagIngestionJob = {
  jobId: string;
  documentId: string;
  operation?: string | null;
  rootJobId?: string | null;
  parentJobId?: string | null;
  attemptNo?: number | null;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  stage?: string | null;
  progress: number;
  retryable: boolean;
  error?: { code: string; message: string } | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
};

type Props = {
  serviceId: string;
  knowledgeBaseId: string;
  ingestionSettings: RagIngestionSettings;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type Translate = (key: string) => string;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeStatus(status: string) {
  return normalizeRagDocumentStatus(status);
}

function statusLabel(t: Translate, status: string) {
  switch (normalizeStatus(status)) {
    case "PENDING":
      return t("ragHub.document.status.pending");
    case "RUNNING":
      return t("ragHub.document.status.running");
    case "SUCCEEDED":
      return t("ragHub.document.status.succeeded");
    case "FAILED":
      return t("ragHub.document.status.failed");
    case "CANCELLED":
      return t("ragHub.document.status.cancelled");
    default:
      return status || t("ragHub.common.unknown");
  }
}

function statusClass(status: string) {
  switch (normalizeStatus(status)) {
    case "SUCCEEDED":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "FAILED":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "RUNNING":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function formatBytes(t: Translate, value?: number | null) {
  if (!value || value <= 0) return t("ragHub.document.unknownSize");
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function RagDocumentPanel({
  serviceId,
  knowledgeBaseId,
  ingestionSettings,
  onNotice,
  onError,
}: Props) {
  const { t } = useLocale();
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedFile, setSelectedFile] = useState<RagPickedDocumentFile | null>(null);
  const [ingestionSelection, setIngestionSelection] = useState<RagIngestionSelection>(() =>
    createDefaultRagIngestionSelection(ingestionSettings),
  );
  const [documentUrl, setDocumentUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [jobsByDocumentId, setJobsByDocumentId] = useState<RagJobsByDocumentId>({});
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [historyDocumentId, setHistoryDocumentId] = useState("");
  const [chunkDocumentId, setChunkDocumentId] = useState("");
  const [chunks, setChunks] = useState<RagChunk[]>([]);
  const pollController = useRef<AbortController | null>(null);
  const fileUploadSupported = ingestionSettings.fileUploadSupported;
  const urlImportSupported = ingestionSettings.urlImportSupported;
  const maxUploadBytes = ingestionSettings.maxUploadBytes;
  const activeJob = activeDocumentId ? jobsByDocumentId[activeDocumentId]?.current : null;

  const refreshDocuments = useCallback(
    async (silent = false) => {
      if (!serviceId || !knowledgeBaseId) {
        setDocuments([]);
        setTotal(0);
        return;
      }
      if (!silent) setBusy("documents");
      try {
        const page = await invoke<RagPage<RagDocument>>("rag_hub_list_documents", {
          service_id: serviceId,
          knowledge_base_id: knowledgeBaseId,
          current: 1,
          size: 50,
        });
        const items = page.items ?? [];
        setDocuments(items);
        setJobsByDocumentId((current) => reconcileRagJobsWithDocuments(current, items));
        setTotal(page.total ?? items.length);
        const historyResults = await Promise.allSettled(
          items
            .filter((document) => normalizeStatus(document.status) !== "SUCCEEDED")
            .map(async (document) => ({
              documentId: document.id,
              page: await invoke<RagPage<RagIngestionJob>>("rag_hub_list_ingestion_jobs", {
                service_id: serviceId,
                document_id: document.id,
                current: 1,
                size: 20,
              }),
            })),
        );
        setJobsByDocumentId((current) =>
          historyResults.reduce(
            (next, result) =>
              result.status === "fulfilled"
                ? hydrateRagIngestionHistory(next, result.value.documentId, result.value.page.items)
                : next,
            current,
          ),
        );
      } catch (reason) {
        if (!silent) onError(errorText(reason));
      } finally {
        if (!silent) setBusy("");
      }
    },
    [knowledgeBaseId, onError, serviceId],
  );

  useEffect(() => {
    pollController.current?.abort();
    setDocuments([]);
    setTotal(0);
    setSelectedFile(null);
    setIngestionSelection(createDefaultRagIngestionSelection(ingestionSettings));
    setDocumentUrl("");
    setJobsByDocumentId({});
    setActiveDocumentId("");
    setHistoryDocumentId("");
    setChunkDocumentId("");
    setChunks([]);
    if (serviceId && knowledgeBaseId) void refreshDocuments();
    return () => pollController.current?.abort();
  }, [serviceId, knowledgeBaseId, refreshDocuments, ingestionSettings]);

  async function chooseFile() {
    setBusy("pick");
    onError("");
    try {
      const selected = await invoke<RagPickedDocumentFile | null>("rag_pick_document_file", {
        service_id: serviceId,
      });
      if (selected) {
        const error = validateRagPickedDocument(ingestionSettings, selected);
        if (error) {
          setSelectedFile(null);
          onError(error);
        } else {
          setSelectedFile(selected);
        }
      }
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function waitForJob(jobId: string) {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    try {
      const result = await pollIngestionJob(
        async () => {
          const job = await invoke<RagIngestionJob>("rag_hub_get_ingestion_job", {
            service_id: serviceId,
            job_id: jobId,
          });
          setJobsByDocumentId((current) => recordRagIngestionJob(current, job));
          setActiveDocumentId(job.documentId);
          return job;
        },
        { signal: controller.signal },
      );
      setJobsByDocumentId((current) =>
        recordRagIngestionJob(current, result.job, result.exhausted),
      );
      return result;
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }
  }

  async function uploadDocument() {
    if (!serviceId || !knowledgeBaseId || !selectedFile) return;
    const fileError = validateRagPickedDocument(ingestionSettings, selectedFile);
    const ingestionValidation = validateRagIngestionSelection(
      ingestionSettings,
      ingestionSelection,
    );
    if (fileError || !ingestionValidation.valid || !ingestionValidation.request) {
      onError(fileError || ingestionValidation.error || t("ragHub.error.invalidIngestionConfig"));
      return;
    }
    const ingestionRequest = ingestionValidation.request;
    setBusy("upload");
    onError("");
    onNotice("");
    try {
      const accepted = await invoke<RagAcceptedJob>("rag_hub_upload_document", {
        service_id: serviceId,
        knowledge_base_id: knowledgeBaseId,
        file_path: selectedFile.path,
        ingestion: ingestionRequest,
      });
      setSelectedFile(null);
      await followAcceptedJob(accepted, t("ragHub.notice.documentSubmitted"));
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function importDocumentUrl() {
    const url = documentUrl.trim();
    if (!serviceId || !knowledgeBaseId || !url) return;
    const ingestionValidation = validateRagIngestionSelection(
      ingestionSettings,
      ingestionSelection,
    );
    if (!ingestionValidation.valid || !ingestionValidation.request) {
      onError(ingestionValidation.error || t("ragHub.error.invalidIngestionConfig"));
      return;
    }
    const ingestionRequest = ingestionValidation.request;
    setBusy("import-url");
    onError("");
    onNotice("");
    try {
      const accepted = await invoke<RagAcceptedJob>("rag_hub_import_document_url", {
        service_id: serviceId,
        knowledge_base_id: knowledgeBaseId,
        document_url: url,
        ingestion: ingestionRequest,
      });
      setDocumentUrl("");
      await followAcceptedJob(accepted, t("ragHub.notice.urlDocumentSubmitted"));
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function followAcceptedJob(accepted: RagAcceptedJob, pendingMessage: string) {
    setJobsByDocumentId((current) => recordAcceptedRagJob(current, accepted));
    setActiveDocumentId(accepted.documentId);
    onNotice(
      t("ragHub.notice.jobAccepted")
        .replace("{message}", pendingMessage)
        .replace("{jobId}", accepted.jobId),
    );
    await refreshDocuments(true);
    const polling = await waitForJob(accepted.jobId);
    const completed = polling.job;
    if (completed.status === "SUCCEEDED") {
      onNotice(t("ragHub.notice.documentSucceeded"));
    } else if (completed.status === "FAILED") {
      onError(completed.error?.message || t("ragHub.error.documentFailed"));
    } else if (polling.exhausted) {
      onNotice(t("ragHub.notice.pollingPaused").replace("{jobId}", completed.jobId));
    }
    await refreshDocuments(true);
  }

  async function retryDocument(documentId: string) {
    const retryJobId = retryJobIdForDocument(jobsByDocumentId, documentId);
    if (!retryJobId) {
      onError(t("ragHub.error.noRetryableJob"));
      return;
    }
    setBusy(`retry:${documentId}`);
    onError("");
    onNotice("");
    try {
      const job = await invoke<RagIngestionJob>("rag_hub_retry_ingestion_job", {
        service_id: serviceId,
        job_id: retryJobId,
      });
      setJobsByDocumentId((current) => recordRagIngestionJob(current, job));
      setActiveDocumentId(documentId);
      onNotice(t("ragHub.notice.retrySubmitted"));
      const polling = await waitForJob(job.jobId);
      const completed = polling.job;
      if (completed.status === "SUCCEEDED") {
        onNotice(t("ragHub.notice.retrySucceeded"));
      } else if (completed.status === "FAILED") {
        onError(completed.error?.message || t("ragHub.error.retryFailed"));
      } else if (polling.exhausted) {
        onNotice(t("ragHub.notice.pollingPaused").replace("{jobId}", completed.jobId));
      }
      await refreshDocuments(true);
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function deleteDocument(document: RagDocument) {
    if (!window.confirm(t("ragHub.confirm.deleteDocument").replace("{name}", document.name))) {
      return;
    }
    setBusy(`delete:${document.id}`);
    onError("");
    onNotice("");
    try {
      await invoke("rag_hub_delete_document", {
        service_id: serviceId,
        document_id: document.id,
      });
      if (chunkDocumentId === document.id) {
        setChunkDocumentId("");
        setChunks([]);
      }
      setJobsByDocumentId((current) => removeRagDocumentJob(current, document.id));
      if (activeDocumentId === document.id) setActiveDocumentId("");
      if (historyDocumentId === document.id) setHistoryDocumentId("");
      onNotice(t("ragHub.notice.documentDeleted"));
      await refreshDocuments(true);
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function toggleChunks(documentId: string) {
    if (chunkDocumentId === documentId) {
      setChunkDocumentId("");
      setChunks([]);
      return;
    }
    setBusy(`chunks:${documentId}`);
    onError("");
    try {
      const page = await invoke<RagPage<RagChunk>>("rag_hub_list_document_chunks", {
        service_id: serviceId,
        document_id: documentId,
        current: 1,
        size: 100,
      });
      setChunkDocumentId(documentId);
      setChunks(page.items ?? []);
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  const ingestionValidation = validateRagIngestionSelection(ingestionSettings, ingestionSelection);
  const selectedChunkSchema = ingestionSelection.chunkStrategy
    ? ingestionSettings.chunkConfigSchema[ingestionSelection.chunkStrategy]
    : undefined;

  function selectProcessMode(processMode: RagIngestionProcessMode) {
    setIngestionSelection(
      createDefaultRagIngestionSelection({
        ...ingestionSettings,
        processModes: [
          processMode,
          ...ingestionSettings.processModes.filter((mode) => mode !== processMode),
        ],
      }),
    );
  }

  function selectChunkStrategy(chunkStrategy: string) {
    setIngestionSelection(
      createDefaultRagIngestionSelection({
        ...ingestionSettings,
        processModes: ["chunk"],
        chunkStrategies: [
          chunkStrategy,
          ...ingestionSettings.chunkStrategies.filter((item) => item !== chunkStrategy),
        ],
      }),
    );
  }

  function updateChunkConfig(name: string, value: number | string | boolean) {
    setIngestionSelection((current) => ({
      ...current,
      chunkConfig: { ...(current.chunkConfig ?? {}), [name]: value },
    }));
  }

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("ragHub.document.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {fileUploadSupported
              ? t("ragHub.document.uploadHint").replace("{size}", formatBytes(t, maxUploadBytes))
              : t("ragHub.document.uploadUnsupported")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshDocuments()}
          disabled={!knowledgeBaseId || Boolean(busy)}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {t("ragHub.common.refresh")} {total ? `(${total})` : ""}
        </Button>
      </div>

      <div className="mb-3 rounded-xl border border-border/45 bg-muted/20 p-3">
        {ingestionSettings.capabilityError ? (
          <p className="text-xs text-destructive">{ingestionSettings.capabilityError}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("ragHub.document.processMode")}</span>
              <select
                className="h-9 w-full rounded-md border border-border/60 bg-background px-2"
                value={ingestionSelection.processMode}
                onChange={(event) =>
                  selectProcessMode(event.target.value as RagIngestionProcessMode)
                }
                disabled={Boolean(busy)}
              >
                {ingestionSettings.processModes.map((processMode) => (
                  <option key={processMode} value={processMode}>
                    {processMode === "chunk"
                      ? t("ragHub.document.chunkMode")
                      : t("ragHub.document.pipelineMode")}
                  </option>
                ))}
              </select>
            </label>

            {ingestionSelection.processMode === "chunk" ? (
              <>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">
                    {t("ragHub.document.chunkStrategy")}
                  </span>
                  <select
                    className="h-9 w-full rounded-md border border-border/60 bg-background px-2"
                    value={ingestionSelection.chunkStrategy ?? ""}
                    onChange={(event) => selectChunkStrategy(event.target.value)}
                    disabled={Boolean(busy)}
                  >
                    {ingestionSettings.chunkStrategies.map((chunkStrategy) => (
                      <option key={chunkStrategy} value={chunkStrategy}>
                        {chunkStrategy}
                      </option>
                    ))}
                  </select>
                </label>
                {Object.entries(selectedChunkSchema?.properties ?? {}).map(
                  ([name, schema], index) => {
                    const controlId = `rag-chunk-config-${index}`;
                    return (
                      <div key={name} className="space-y-1 text-xs">
                        <label htmlFor={controlId} className="text-muted-foreground">
                          {name}
                        </label>
                        {schema.type === "boolean" ? (
                          <select
                            id={controlId}
                            className="h-9 w-full rounded-md border border-border/60 bg-background px-2"
                            value={String(ingestionSelection.chunkConfig?.[name] ?? false)}
                            onChange={(event) =>
                              updateChunkConfig(name, event.target.value === "true")
                            }
                            disabled={Boolean(busy)}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : schema.enum ? (
                          <select
                            id={controlId}
                            className="h-9 w-full rounded-md border border-border/60 bg-background px-2"
                            value={String(ingestionSelection.chunkConfig?.[name] ?? "")}
                            onChange={(event) => updateChunkConfig(name, event.target.value)}
                            disabled={Boolean(busy)}
                          >
                            {schema.enum.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={controlId}
                            type={schema.type === "integer" ? "number" : "text"}
                            min={schema.minimum ?? schema.minLength}
                            max={schema.maximum ?? schema.maxLength}
                            step={schema.type === "integer" ? 1 : undefined}
                            value={String(ingestionSelection.chunkConfig?.[name] ?? "")}
                            onChange={(event) =>
                              updateChunkConfig(
                                name,
                                schema.type === "integer"
                                  ? Number(event.target.value)
                                  : event.target.value,
                              )
                            }
                            disabled={Boolean(busy)}
                          />
                        )}
                      </div>
                    );
                  },
                )}
              </>
            ) : (
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t("ragHub.document.pipelineLabel")}</span>
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2"
                  value={ingestionSelection.pipelineId ?? ""}
                  onChange={(event) =>
                    setIngestionSelection((current) => ({
                      ...current,
                      pipelineId: event.target.value,
                    }))
                  }
                  disabled={Boolean(busy)}
                >
                  {ingestionSettings.pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {!ingestionValidation.valid && !ingestionSettings.capabilityError ? (
          <p className="mt-2 text-[11px] text-destructive">{ingestionValidation.error}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          readOnly
          value={selectedFile?.name ?? ""}
          placeholder={
            !fileUploadSupported
              ? t("ragHub.document.fileUploadDisabled")
              : knowledgeBaseId
                ? t("ragHub.document.filePlaceholder")
                : t("ragHub.document.selectKnowledgeBaseFirst")
          }
          title={selectedFile?.path}
        />
        <Button
          variant="outline"
          onClick={chooseFile}
          disabled={!fileUploadSupported || !knowledgeBaseId || Boolean(busy)}
        >
          {t("ragHub.document.selectFile")}
        </Button>
        <Button
          onClick={uploadDocument}
          disabled={
            !fileUploadSupported ||
            !knowledgeBaseId ||
            !selectedFile ||
            !ingestionValidation.valid ||
            Boolean(busy)
          }
        >
          <Upload className="mr-2 h-4 w-4" />
          {busy === "upload" ? t("ragHub.document.ingesting") : t("ragHub.document.upload")}
        </Button>
      </div>

      <div className="mt-3 rounded-xl border border-border/45 bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            value={documentUrl}
            disabled={!urlImportSupported}
            onChange={(event) => setDocumentUrl(event.target.value)}
            placeholder={
              !urlImportSupported
                ? t("ragHub.document.urlImportDisabled")
                : knowledgeBaseId
                  ? "https://example.com/document.pdf"
                  : t("ragHub.document.selectKnowledgeBaseFirst")
            }
          />
          <Button
            variant="outline"
            onClick={importDocumentUrl}
            disabled={
              !urlImportSupported ||
              !knowledgeBaseId ||
              !documentUrl.trim() ||
              !ingestionValidation.valid ||
              Boolean(busy)
            }
          >
            <Link2 className="mr-2 h-4 w-4" />
            {busy === "import-url"
              ? t("ragHub.document.downloading")
              : t("ragHub.document.urlImport")}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {urlImportSupported
            ? t("ragHub.document.urlSecurityHint")
            : t("ragHub.document.urlCapabilityDisabled")}
        </p>
      </div>

      {activeJob ? (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">
              {t("ragHub.document.jobCurrent")}
              {statusLabel(t, activeJob.status)}
            </span>
            <span className="font-mono text-muted-foreground">
              {activeJob.stage || t("ragHub.document.stageComplete")} · {activeJob.progress}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-cyan-500 transition-[width]"
              style={{ width: `${Math.max(2, Math.min(100, activeJob.progress))}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {!knowledgeBaseId ? (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            {t("ragHub.document.selectKnowledgeBaseEmpty")}
          </p>
        ) : null}
        {knowledgeBaseId && !documents.length && busy !== "documents" ? (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            {t("ragHub.document.empty")}
          </p>
        ) : null}
        {documents.map((document) => {
          const jobState = jobsByDocumentId[document.id];
          const status = effectiveRagDocumentStatus(document.status, jobState);
          const running = status === "PENDING" || status === "RUNNING";
          const retryJobId = retryJobIdForDocument(jobsByDocumentId, document.id);
          return (
            <div key={document.id} className="rounded-xl border border-border/45 bg-muted/20 p-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-700 dark:text-cyan-300">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium" title={document.name}>
                      {document.name}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(status)}`}
                    >
                      {statusLabel(t, status)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{document.fileType || "file"}</span>
                    <span>{formatBytes(t, document.fileSize)}</span>
                    <span>
                      {t("ragHub.document.chunkCount").replace(
                        "{count}",
                        String(document.chunkCount ?? 0),
                      )}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleChunks(document.id)}
                      disabled={running || Boolean(busy)}
                    >
                      {chunkDocumentId === document.id
                        ? t("ragHub.document.hideChunks")
                        : t("ragHub.document.showChunks")}
                    </Button>
                    {retryJobId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryDocument(document.id)}
                        disabled={Boolean(busy)}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        {busy === `retry:${document.id}`
                          ? t("ragHub.document.retrying")
                          : t("ragHub.document.retry")}
                      </Button>
                    ) : null}
                    {jobState?.history.length ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setHistoryDocumentId((current) =>
                            current === document.id ? "" : document.id,
                          )
                        }
                      >
                        {historyDocumentId === document.id
                          ? t("ragHub.document.hideJobHistory")
                          : t("ragHub.document.showJobHistory")}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteDocument(document)}
                      disabled={running || Boolean(busy)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      {t("ragHub.common.delete")}
                    </Button>
                  </div>
                </div>
              </div>

              {historyDocumentId === document.id && jobState?.history.length ? (
                <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                  <p className="text-xs font-medium">{t("ragHub.document.jobHistory")}</p>
                  {jobState.history.map((job) => (
                    <div key={job.jobId} className="rounded-lg bg-background/65 p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {job.jobId}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(job.status)}`}
                        >
                          {statusLabel(t, job.status)}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                        <span>
                          {t("ragHub.document.jobAttempt").replace(
                            "{attempt}",
                            String(job.attemptNo ?? 1),
                          )}
                        </span>
                        <span>
                          {t("ragHub.document.jobOperation").replace(
                            "{operation}",
                            job.operation ?? "-",
                          )}
                        </span>
                        <span>
                          {t("ragHub.document.jobStarted").replace(
                            "{time}",
                            job.startedAt ?? job.createdAt ?? "-",
                          )}
                        </span>
                        <span>
                          {t("ragHub.document.jobCompleted").replace(
                            "{time}",
                            job.completedAt ?? "-",
                          )}
                        </span>
                        {job.parentJobId ? (
                          <span className="sm:col-span-2">
                            {t("ragHub.document.jobParent").replace("{jobId}", job.parentJobId)}
                          </span>
                        ) : null}
                      </div>
                      {job.error ? (
                        <p className="mt-2 rounded-md bg-destructive/8 px-2 py-1.5 text-destructive">
                          {t("ragHub.document.jobError")
                            .replace("{code}", job.error.code)
                            .replace("{message}", job.error.message)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {chunkDocumentId === document.id ? (
                <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                  {chunks.length ? (
                    chunks.map((chunk) => (
                      <div key={chunk.id} className="rounded-lg bg-background/65 p-3">
                        <div className="mb-1 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground">
                          <span>#{(chunk.index ?? 0) + 1}</span>
                          <span>{chunk.id}</span>
                          <span>
                            {t("ragHub.document.characterCount").replace(
                              "{count}",
                              String(chunk.charCount ?? chunk.content.length),
                            )}
                          </span>
                          {chunk.tokenCount != null ? (
                            <span>
                              {t("ragHub.document.tokenCount").replace(
                                "{count}",
                                String(chunk.tokenCount),
                              )}
                            </span>
                          ) : null}
                        </div>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5">
                          {chunk.content}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("ragHub.document.noChunks")}</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
