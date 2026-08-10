import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("RAG search settings use service capabilities and safe fallbacks", async () => {
  const loader = createTsModuleLoader();
  const { resolveRagSearchLimits } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  assert.deepEqual(
    resolveRagSearchLimits({
      limits: { maxTopK: 8, maxTopN: 3, maxQueryLength: 120 },
      features: { rerank: false },
    }),
    { maxTopK: 8, maxTopN: 3, maxQueryLength: 120, rerankSupported: false },
  );
  assert.deepEqual(resolveRagSearchLimits(null), {
    maxTopK: 50,
    maxTopN: 20,
    maxQueryLength: 4000,
    rerankSupported: true,
  });
  assert.deepEqual(
    resolveRagSearchLimits({
      limits: { maxTopK: 500, maxTopN: 200, maxQueryLength: 40_000 },
      features: { rerank: true },
    }),
    { maxTopK: 50, maxTopN: 20, maxQueryLength: 4000, rerankSupported: true },
  );
});

test("RAG search settings clamp values and disable unsupported rerank", async () => {
  const loader = createTsModuleLoader();
  const { normalizeRagSearchSettings } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  assert.deepEqual(
    normalizeRagSearchSettings(
      { topK: 99, rerank: true, topN: 0 },
      { maxTopK: 12, maxTopN: 4, maxQueryLength: 4000, rerankSupported: false },
    ),
    { topK: 12, rerank: false, topN: 1 },
  );
});

test("RAG search knowledge-base selection toggles without duplicates", async () => {
  const loader = createTsModuleLoader();
  const { toggleRagKnowledgeBase } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  assert.deepEqual(toggleRagKnowledgeBase(["hr"], "finance"), ["hr", "finance"]);
  assert.deepEqual(toggleRagKnowledgeBase(["hr", "finance"], "hr"), ["finance"]);
});
