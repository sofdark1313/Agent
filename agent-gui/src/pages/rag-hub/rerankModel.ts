export type RagRerankCapabilities = {
  limits?: Record<string, number>;
};

export type RagRerankSourceHit = {
  knowledgeBaseId: string;
  documentId?: string | null;
  documentName?: string | null;
  chunkId: string;
  content: string;
  score: number;
  source: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RagRerankCandidate = {
  knowledgeBaseId: string;
  documentId?: string;
  documentName?: string;
  chunkId: string;
  content: string;
  score: number;
  source: string;
  metadata: Record<string, unknown>;
};

export type RagRerankRequest = {
  serviceId?: string;
  query: string;
  candidates: RagRerankCandidate[];
  topN: number;
};

export type BuildRagRerankRequestInput = {
  serviceId?: string | null;
  query: string;
  hits: readonly RagRerankSourceHit[];
  topN?: number;
  capabilities?: RagRerankCapabilities | null;
};

export const RAG_RERANK_LIMITS = {
  maxCandidates: 100,
  maxContentLength: 200_000,
  maxQueryLength: 4_000,
  maxTopN: 20,
  defaultTopN: 5,
} as const;

export class RagRerankModelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RagRerankModelError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RagRerankModelError(code, message);
}

function requiredTrimmed(value: unknown, field: string, code: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    fail(code, `独立重排候选 ${field} 不能为空`);
  }
  return normalized;
}

function optionalTrimmed(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function capabilityLimit(value: unknown, localMaximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return localMaximum;
  }
  return Math.min(Math.floor(value), localMaximum);
}

export function buildRagRerankCandidates(
  hits: readonly RagRerankSourceHit[],
): RagRerankCandidate[] {
  if (!Array.isArray(hits) || hits.length < 1 || hits.length > RAG_RERANK_LIMITS.maxCandidates) {
    fail(
      "RAG_RERANK_CANDIDATE_COUNT",
      `独立重排候选数量必须在 1 到 ${RAG_RERANK_LIMITS.maxCandidates} 之间`,
    );
  }

  const seenChunkIds = new Set<string>();
  let totalContentLength = 0;

  return hits.map((hit) => {
    const knowledgeBaseId = requiredTrimmed(
      hit.knowledgeBaseId,
      "knowledgeBaseId",
      "RAG_RERANK_KNOWLEDGE_BASE_ID_REQUIRED",
    );
    const chunkId = requiredTrimmed(hit.chunkId, "chunkId", "RAG_RERANK_CHUNK_ID_REQUIRED");
    const source = requiredTrimmed(hit.source, "source", "RAG_RERANK_SOURCE_REQUIRED");

    if (seenChunkIds.has(chunkId)) {
      fail("RAG_RERANK_DUPLICATE_CHUNK_ID", `独立重排候选的 chunkId 不能重复：${chunkId}`);
    }
    seenChunkIds.add(chunkId);

    if (typeof hit.content !== "string" || !hit.content.trim()) {
      fail("RAG_RERANK_CONTENT_REQUIRED", "独立重排候选 content 不能为空");
    }
    totalContentLength += hit.content.length;
    if (totalContentLength > RAG_RERANK_LIMITS.maxContentLength) {
      fail(
        "RAG_RERANK_CONTENT_TOO_LARGE",
        `独立重排候选总内容不能超过 ${RAG_RERANK_LIMITS.maxContentLength} 个 UTF-16 字符单元`,
      );
    }

    if (
      typeof hit.score !== "number" ||
      !Number.isFinite(hit.score) ||
      !Number.isFinite(Math.fround(hit.score))
    ) {
      fail("RAG_RERANK_SCORE_INVALID", "独立重排候选 score 必须能表示为有限的 Java Float");
    }

    return {
      knowledgeBaseId,
      documentId: optionalTrimmed(hit.documentId),
      documentName: optionalTrimmed(hit.documentName),
      chunkId,
      content: hit.content,
      score: hit.score,
      source,
      metadata: hit.metadata ?? {},
    };
  });
}

export function buildRagRerankRequest({
  serviceId,
  query,
  hits,
  topN,
  capabilities,
}: BuildRagRerankRequestInput): RagRerankRequest {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    fail("RAG_RERANK_QUERY_REQUIRED", "独立重排问题不能为空");
  }

  const maxQueryLength = capabilityLimit(
    capabilities?.limits?.maxQueryLength,
    RAG_RERANK_LIMITS.maxQueryLength,
  );
  if (normalizedQuery.length > maxQueryLength) {
    fail("RAG_RERANK_QUERY_TOO_LONG", `独立重排问题不能超过 ${maxQueryLength} 个 UTF-16 字符单元`);
  }

  const candidates = buildRagRerankCandidates(hits);
  const maximumTopN = Math.min(
    RAG_RERANK_LIMITS.maxTopN,
    capabilityLimit(capabilities?.limits?.maxTopN, RAG_RERANK_LIMITS.maxTopN),
    candidates.length,
  );
  const requestedTopN =
    typeof topN === "number" && Number.isFinite(topN)
      ? Math.floor(topN)
      : RAG_RERANK_LIMITS.defaultTopN;

  return {
    serviceId: optionalTrimmed(serviceId),
    query: normalizedQuery,
    candidates,
    topN: Math.max(1, Math.min(requestedTopN, maximumTopN)),
  };
}
