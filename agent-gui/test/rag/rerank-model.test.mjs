import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function hit(overrides = {}) {
  return {
    knowledgeBaseId: " kb-1 ",
    documentId: " doc-1 ",
    documentName: " Handbook ",
    chunkId: " chunk-1 ",
    content: "Annual leave policy",
    score: 0.75,
    source: " vector ",
    metadata: { section: "leave" },
    rankBefore: 4,
    rankAfter: 1,
    unexpected: "must not cross the command boundary",
    ...overrides,
  };
}

async function loadModel() {
  const loader = createTsModuleLoader();
  return loader.loadModule("src/pages/rag-hub/rerankModel.ts");
}

function expectModelError(action, code, message) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code);
    assert.equal(error?.message, message);
    return true;
  });
}

test("RAG rerank request keeps only the nested camelCase candidate contract", async () => {
  const { buildRagRerankCandidates, buildRagRerankRequest } = await loadModel();
  const candidates = buildRagRerankCandidates([
    hit(),
    hit({
      chunkId: " chunk-2 ",
      documentId: "   ",
      documentName: null,
      metadata: undefined,
    }),
  ]);

  assert.deepEqual(candidates, [
    {
      knowledgeBaseId: "kb-1",
      documentId: "doc-1",
      documentName: "Handbook",
      chunkId: "chunk-1",
      content: "Annual leave policy",
      score: 0.75,
      source: "vector",
      metadata: { section: "leave" },
    },
    {
      knowledgeBaseId: "kb-1",
      documentId: undefined,
      documentName: undefined,
      chunkId: "chunk-2",
      content: "Annual leave policy",
      score: 0.75,
      source: "vector",
      metadata: {},
    },
  ]);
  assert.deepEqual(
    buildRagRerankRequest({
      serviceId: " service-a ",
      query: " annual leave ",
      hits: [hit()],
      topN: 8,
      capabilities: { limits: { maxTopN: 4, maxQueryLength: 200 } },
    }),
    {
      serviceId: "service-a",
      query: "annual leave",
      candidates: [candidates[0]],
      topN: 1,
    },
  );
});

test("RAG rerank query limits count UTF-16 code units", async () => {
  const { buildRagRerankRequest } = await loadModel();

  assert.equal(
    buildRagRerankRequest({
      query: "  \ud83d\ude00ab  ",
      hits: [hit()],
      capabilities: { limits: { maxQueryLength: 4 } },
    }).query,
    "\ud83d\ude00ab",
  );
  expectModelError(
    () =>
      buildRagRerankRequest({
        query: "\ud83d\ude00abc",
        hits: [hit()],
        capabilities: { limits: { maxQueryLength: 4 } },
      }),
    "RAG_RERANK_QUERY_TOO_LONG",
    "独立重排问题不能超过 4 个 UTF-16 字符单元",
  );
  assert.equal(
    buildRagRerankRequest({ query: "\ud83d\ude00".repeat(2_000), hits: [hit()] }).query.length,
    4_000,
  );
  expectModelError(
    () => buildRagRerankRequest({ query: `${"\ud83d\ude00".repeat(2_000)}a`, hits: [hit()] }),
    "RAG_RERANK_QUERY_TOO_LONG",
    "独立重排问题不能超过 4000 个 UTF-16 字符单元",
  );
});

test("RAG rerank candidates reject normalized duplicate chunk ids", async () => {
  const { buildRagRerankCandidates } = await loadModel();

  expectModelError(
    () =>
      buildRagRerankCandidates([
        hit({ chunkId: "chunk-a" }),
        hit({ chunkId: " chunk-a " }),
      ]),
    "RAG_RERANK_DUPLICATE_CHUNK_ID",
    "独立重排候选的 chunkId 不能重复：chunk-a",
  );
});

test("RAG rerank candidates enforce count and total UTF-16 content limits", async () => {
  const { buildRagRerankCandidates } = await loadModel();

  expectModelError(
    () => buildRagRerankCandidates([]),
    "RAG_RERANK_CANDIDATE_COUNT",
    "独立重排候选数量必须在 1 到 100 之间",
  );
  expectModelError(
    () =>
      buildRagRerankCandidates(
        Array.from({ length: 101 }, (_, index) => hit({ chunkId: `chunk-${index}` })),
      ),
    "RAG_RERANK_CANDIDATE_COUNT",
    "独立重排候选数量必须在 1 到 100 之间",
  );
  assert.equal(
    buildRagRerankCandidates([
      hit({ chunkId: "chunk-limit", content: "\ud83d\ude00".repeat(100_000) }),
    ])[0].content.length,
    200_000,
  );
  expectModelError(
    () =>
      buildRagRerankCandidates([
        hit({ chunkId: "chunk-too-large", content: `${"\ud83d\ude00".repeat(100_000)}a` }),
      ]),
    "RAG_RERANK_CONTENT_TOO_LARGE",
    "独立重排候选总内容不能超过 200000 个 UTF-16 字符单元",
  );
});

test("RAG rerank candidates reject scores that overflow Java Float", async () => {
  const { buildRagRerankCandidates } = await loadModel();

  expectModelError(
    () => buildRagRerankCandidates([hit({ score: Number.MAX_VALUE })]),
    "RAG_RERANK_SCORE_INVALID",
    "独立重排候选 score 必须能表示为有限的 Java Float",
  );
  expectModelError(
    () => buildRagRerankCandidates([hit({ score: Number.NaN })]),
    "RAG_RERANK_SCORE_INVALID",
    "独立重排候选 score 必须能表示为有限的 Java Float",
  );
});

test("RAG rerank topN clamps to local, capability, and candidate limits", async () => {
  const { buildRagRerankRequest } = await loadModel();
  const hits = Array.from({ length: 8 }, (_, index) => hit({ chunkId: `chunk-${index}` }));

  assert.equal(buildRagRerankRequest({ query: "q", hits }).topN, 5);
  assert.equal(buildRagRerankRequest({ query: "q", hits, topN: 0 }).topN, 1);
  assert.equal(buildRagRerankRequest({ query: "q", hits, topN: 99 }).topN, 8);
  assert.equal(
    buildRagRerankRequest({
      query: "q",
      hits,
      topN: 99,
      capabilities: { limits: { maxTopN: 3 } },
    }).topN,
    3,
  );
});

test("RAG rerank candidates reject blank ids, source, content, and query", async () => {
  const { buildRagRerankCandidates, buildRagRerankRequest } = await loadModel();

  for (const [field, code] of [
    ["knowledgeBaseId", "RAG_RERANK_KNOWLEDGE_BASE_ID_REQUIRED"],
    ["chunkId", "RAG_RERANK_CHUNK_ID_REQUIRED"],
    ["source", "RAG_RERANK_SOURCE_REQUIRED"],
  ]) {
    expectModelError(
      () => buildRagRerankCandidates([hit({ [field]: "   " })]),
      code,
      `独立重排候选 ${field} 不能为空`,
    );
  }
  expectModelError(
    () => buildRagRerankCandidates([hit({ content: "   " })]),
    "RAG_RERANK_CONTENT_REQUIRED",
    "独立重排候选 content 不能为空",
  );
  expectModelError(
    () => buildRagRerankRequest({ query: "   ", hits: [hit()] }),
    "RAG_RERANK_QUERY_REQUIRED",
    "独立重排问题不能为空",
  );
});
