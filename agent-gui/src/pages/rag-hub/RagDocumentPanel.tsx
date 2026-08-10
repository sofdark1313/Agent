import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { FileText, Link2, RefreshCw, Trash2, Upload } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { pollIngestionJob } from "./ingestionPolling";

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
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  stage?: string | null;
  progress: number;
  retryable: boolean;
  error?: { code: string; message: string } | null;
};

type Props = {
  serviceId: string;
  knowledgeBaseId: string;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "SUCCESS") return "SUCCEEDED";
  return normalized;
}

function statusLabel(status: string) {
  switch (normalizeStatus(status)) {
    case "PENDING":
      return "等待处理";
    case "RUNNING":
      return "处理中";
    case "SUCCEEDED":
      return "已入库";
    case "FAILED":
      return "处理失败";
    case "CANCELLED":
      return "已取消";
    default:
      return status || "未知";
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

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function RagDocumentPanel({ serviceId, knowledgeBaseId, onNotice, onError }: Props) {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [activeJob, setActiveJob] = useState<RagIngestionJob | null>(null);
  const [chunkDocumentId, setChunkDocumentId] = useState("");
  const [chunks, setChunks] = useState<RagChunk[]>([]);
  const pollController = useRef<AbortController | null>(null);

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
        setDocuments(page.items ?? []);
        setTotal(page.total ?? page.items?.length ?? 0);
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
    setFilePath("");
    setDocumentUrl("");
    setActiveJob(null);
    setChunkDocumentId("");
    setChunks([]);
    if (serviceId && knowledgeBaseId) void refreshDocuments();
    return () => pollController.current?.abort();
  }, [serviceId, knowledgeBaseId, refreshDocuments]);

  async function chooseFile() {
    setBusy("pick");
    onError("");
    try {
      const selected = await invoke<string | null>("rag_pick_document_file");
      if (selected) setFilePath(selected);
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
      return await pollIngestionJob(
        async () => {
          const job = await invoke<RagIngestionJob>("rag_hub_get_ingestion_job", {
            service_id: serviceId,
            job_id: jobId,
          });
          setActiveJob(job);
          return job;
        },
        { signal: controller.signal },
      );
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }
  }

  async function uploadDocument() {
    if (!serviceId || !knowledgeBaseId || !filePath) return;
    setBusy("upload");
    onError("");
    onNotice("");
    try {
      const accepted = await invoke<RagAcceptedJob>("rag_hub_upload_document", {
        service_id: serviceId,
        knowledge_base_id: knowledgeBaseId,
        file_path: filePath,
      });
      setFilePath("");
      await followAcceptedJob(accepted, "文档已提交，正在等待入库");
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function importDocumentUrl() {
    const url = documentUrl.trim();
    if (!serviceId || !knowledgeBaseId || !url) return;
    setBusy("import-url");
    onError("");
    onNotice("");
    try {
      const accepted = await invoke<RagAcceptedJob>("rag_hub_import_document_url", {
        service_id: serviceId,
        knowledge_base_id: knowledgeBaseId,
        document_url: url,
      });
      setDocumentUrl("");
      await followAcceptedJob(accepted, "URL 文档已安全下载，正在等待入库");
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function followAcceptedJob(accepted: RagAcceptedJob, pendingMessage: string) {
    setActiveJob({
      jobId: accepted.jobId,
      documentId: accepted.documentId,
      status: "PENDING",
      stage: "VALIDATING",
      progress: 0,
      retryable: false,
    });
    onNotice(`${pendingMessage}（任务 ${accepted.jobId}）。`);
    await refreshDocuments(true);
    const completed = await waitForJob(accepted.jobId);
    if (completed.status === "SUCCEEDED") {
      onNotice("文档已完成解析、分块和向量入库。");
    } else if (completed.status === "FAILED") {
      onError(completed.error?.message || "文档入库失败，可以点击重试。");
    }
    await refreshDocuments(true);
  }

  async function retryDocument(documentId: string) {
    setBusy(`retry:${documentId}`);
    onError("");
    onNotice("");
    try {
      const job = await invoke<RagIngestionJob>("rag_hub_retry_ingestion_job", {
        service_id: serviceId,
        job_id: documentId,
      });
      setActiveJob(job);
      onNotice("已重新提交文档入库任务。");
      const completed = await waitForJob(job.jobId);
      if (completed.status === "SUCCEEDED") {
        onNotice("重试成功，文档已经入库。");
      } else if (completed.status === "FAILED") {
        onError(completed.error?.message || "重试后仍然失败。");
      }
      await refreshDocuments(true);
    } catch (reason) {
      if (!isAbortError(reason)) onError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  async function deleteDocument(document: RagDocument) {
    if (!window.confirm(`确定删除文档“${document.name}”吗？对应 Chunk 和向量也会被清理。`)) {
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
      onNotice("文档、Chunk 和向量已删除。");
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

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">文档入库</h2>
          <p className="text-xs text-muted-foreground">
            选择本地文件后由 Rust 直接流式上传，React 不读取文件内容。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshDocuments()}
          disabled={!knowledgeBaseId || Boolean(busy)}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          刷新 {total ? `(${total})` : ""}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          readOnly
          value={filePath}
          placeholder={knowledgeBaseId ? "请选择要入库的文档" : "请先选择知识库"}
          title={filePath}
        />
        <Button variant="outline" onClick={chooseFile} disabled={!knowledgeBaseId || Boolean(busy)}>
          选择文件
        </Button>
        <Button onClick={uploadDocument} disabled={!knowledgeBaseId || !filePath || Boolean(busy)}>
          <Upload className="mr-2 h-4 w-4" />
          {busy === "upload" ? "入库中" : "上传入库"}
        </Button>
      </div>

      <div className="mt-3 rounded-xl border border-border/45 bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            value={documentUrl}
            onChange={(event) => setDocumentUrl(event.target.value)}
            placeholder={knowledgeBaseId ? "https://example.com/document.pdf" : "请先选择知识库"}
          />
          <Button
            variant="outline"
            onClick={importDocumentUrl}
            disabled={!knowledgeBaseId || !documentUrl.trim() || Boolean(busy)}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {busy === "import-url" ? "下载中" : "URL 入库"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          仅允许公网 HTTP(S) 文档；内网、回环地址和跳转到内网的链接会被拒绝。
        </p>
      </div>

      {activeJob ? (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">当前任务：{statusLabel(activeJob.status)}</span>
            <span className="font-mono text-muted-foreground">
              {activeJob.stage || "完成"} · {activeJob.progress}%
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
            先刷新并选择一个知识库。
          </p>
        ) : null}
        {knowledgeBaseId && !documents.length && busy !== "documents" ? (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            这个知识库还没有文档。
          </p>
        ) : null}
        {documents.map((document) => {
          const status =
            activeJob?.documentId === document.id
              ? activeJob.status
              : normalizeStatus(document.status);
          const running = status === "PENDING" || status === "RUNNING";
          const failed = status === "FAILED";
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
                      {statusLabel(status)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{document.fileType || "file"}</span>
                    <span>{formatBytes(document.fileSize)}</span>
                    <span>{document.chunkCount ?? 0} Chunks</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleChunks(document.id)}
                      disabled={running || Boolean(busy)}
                    >
                      {chunkDocumentId === document.id ? "收起 Chunk" : "查看 Chunk"}
                    </Button>
                    {failed ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryDocument(document.id)}
                        disabled={Boolean(busy)}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        {busy === `retry:${document.id}` ? "重试中" : "重试入库"}
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
                      删除
                    </Button>
                  </div>
                </div>
              </div>

              {chunkDocumentId === document.id ? (
                <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                  {chunks.length ? (
                    chunks.map((chunk) => (
                      <div key={chunk.id} className="rounded-lg bg-background/65 p-3">
                        <div className="mb-1 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground">
                          <span>#{(chunk.index ?? 0) + 1}</span>
                          <span>{chunk.id}</span>
                          <span>{chunk.charCount ?? chunk.content.length} 字符</span>
                          {chunk.tokenCount != null ? <span>{chunk.tokenCount} tokens</span> : null}
                        </div>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5">
                          {chunk.content}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无 Chunk。</p>
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
