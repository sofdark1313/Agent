import type { RagCapabilitySnapshot } from "./capabilitySnapshot";

export type RagCredentialKind = "management" | "agent";

export type RagServiceConfig = {
  id: string;
  name: string;
  adapterType: "ragent" | string;
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  agentEnabled: boolean;
  agentKnowledgeBaseIds: string[];
  timeoutMs: number;
  managementCredentialConfigured: boolean;
  agentCredentialConfigured: boolean;
  capabilitiesSnapshot: RagCapabilitySnapshot | null;
};

export type RagKnowledgeBase = {
  id: string;
  name: string;
  embeddingModel?: string | null;
  collectionName?: string | null;
  documentCount?: number | null;
  updatedAt?: string | null;
  indexStatus?: string | null;
};

export type RagPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type RagDocument = {
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

export type RagChunk = {
  id: string;
  index?: number | null;
  content: string;
  charCount?: number | null;
  tokenCount?: number | null;
  enabled: boolean;
};

export type RagAcceptedJob = {
  documentId: string;
  jobId: string;
  status: string;
};

export type RagIngestionError = { code: string; message: string };

export type RagIngestionJob = {
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
  error?: RagIngestionError | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
};

export type RagPickedDocumentFile = {
  path: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
};

export type RagIngestionRequest = {
  processMode: string;
  chunkStrategy?: string | null;
  chunkConfig?: Record<string, unknown> | null;
  pipelineId?: string | null;
};

export type RagSearchHit = {
  knowledgeBaseId: string;
  documentId?: string | null;
  documentName?: string | null;
  chunkId: string;
  content: string;
  score: number;
  source: string;
  rankBefore?: number | null;
  rankAfter?: number | null;
  metadata?: Record<string, unknown>;
};

export type RagSearchResponse = {
  requestId?: string | null;
  rawResults?: RagSearchHit[];
  results: RagSearchHit[];
  warnings?: string[];
  timings?: { retrievalMs: number; rerankMs: number; totalMs: number } | null;
};

export type RagSearchRequest = {
  serviceId?: string;
  query: string;
  knowledgeBaseIds: string[];
  topK?: number;
  rerank?: boolean;
  topN?: number;
};

export type RagRerankRequest = {
  serviceId?: string;
  query: string;
  candidates: Array<{
    knowledgeBaseId: string;
    documentId?: string | null;
    documentName?: string | null;
    chunkId: string;
    content: string;
    score: number;
    source: string;
    metadata?: Record<string, unknown>;
  }>;
  topN?: number;
};
