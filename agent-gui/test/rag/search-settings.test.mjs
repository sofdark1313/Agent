import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const NOW_MS = 1_800_000_000_000;

const capabilities = (overrides = {}) => ({
  protocolVersion: "1.0",
  capturedAtMs: NOW_MS - 1_000,
  limits: { maxTopK: 8, maxTopN: 3, maxQueryLength: 120 },
  features: { rerank: false },
  ...overrides,
});

test("RAG search settings use service capabilities and safe fallbacks", async () => {
  const loader = createTsModuleLoader();
  const { resolveRagSearchLimits } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  assert.deepEqual(
    resolveRagSearchLimits(capabilities(), NOW_MS),
    {
      maxTopK: 8,
      maxTopN: 3,
      maxQueryLength: 120,
      searchSupported: true,
      rerankSupported: false,
    },
  );
  assert.deepEqual(resolveRagSearchLimits(null, NOW_MS), {
    maxTopK: 1,
    maxTopN: 1,
    maxQueryLength: 1,
    searchSupported: false,
    rerankSupported: false,
  });
  assert.deepEqual(
    resolveRagSearchLimits(
      capabilities({
        limits: { maxTopK: 500, maxTopN: 200, maxQueryLength: 40_000 },
        features: { rerank: true },
      }),
      NOW_MS,
    ),
    {
      maxTopK: 50,
      maxTopN: 20,
      maxQueryLength: 4000,
      searchSupported: true,
      rerankSupported: true,
    },
  );
});

test("RAG search settings fail closed for stale snapshots and invalid limits", async () => {
  const loader = createTsModuleLoader();
  const { resolveRagSearchLimits } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  for (const snapshot of [
    capabilities({ capturedAtMs: undefined }),
    capabilities({ capturedAtMs: NOW_MS - 10 * 60 * 1_000 }),
    capabilities({ capturedAtMs: NOW_MS + 1 }),
    capabilities({ protocolVersion: "2.0" }),
  ]) {
    assert.equal(resolveRagSearchLimits(snapshot, NOW_MS).searchSupported, false);
    assert.equal(resolveRagSearchLimits(snapshot, NOW_MS).rerankSupported, false);
  }

  const invalidSearchLimit = resolveRagSearchLimits(
    capabilities({ limits: { maxTopK: 0, maxTopN: 3, maxQueryLength: 120 } }),
    NOW_MS,
  );
  assert.equal(invalidSearchLimit.searchSupported, false);
  assert.equal(invalidSearchLimit.maxTopK, 1);

  const missingRerankLimit = resolveRagSearchLimits(
    capabilities({
      limits: { maxTopK: 8, maxQueryLength: 120 },
      features: { rerank: true },
    }),
    NOW_MS,
  );
  assert.equal(missingRerankLimit.searchSupported, false);
  assert.equal(missingRerankLimit.rerankSupported, false);
  assert.equal(missingRerankLimit.maxTopN, 1);

  const zeroRerankLimit = resolveRagSearchLimits(
    capabilities({ limits: { maxTopK: 8, maxTopN: 0, maxQueryLength: 120 } }),
    NOW_MS,
  );
  assert.equal(zeroRerankLimit.searchSupported, false);
  assert.equal(zeroRerankLimit.rerankSupported, false);
  assert.equal(zeroRerankLimit.maxTopN, 1);

  for (const maxTopN of [-1, 1.5]) {
    const invalidRerankLimit = resolveRagSearchLimits(
      capabilities({ limits: { maxTopK: 8, maxTopN, maxQueryLength: 120 } }),
      NOW_MS,
    );
    assert.equal(invalidRerankLimit.searchSupported, false);
    assert.equal(invalidRerankLimit.rerankSupported, false);
    assert.equal(invalidRerankLimit.maxTopN, 1);
  }

  const missingRerankFeature = resolveRagSearchLimits(
    capabilities({ features: {} }),
    NOW_MS,
  );
  assert.equal(missingRerankFeature.searchSupported, false);
  assert.equal(missingRerankFeature.rerankSupported, false);

  const invalidRerankFeature = resolveRagSearchLimits(
    capabilities({ features: { rerank: "false" } }),
    NOW_MS,
  );
  assert.equal(invalidRerankFeature.searchSupported, false);
  assert.equal(invalidRerankFeature.rerankSupported, false);
});

test("RAG search settings clamp values and disable unsupported rerank", async () => {
  const loader = createTsModuleLoader();
  const { normalizeRagSearchSettings } = await loader.loadModule(
    "src/pages/rag-hub/searchSettings.ts",
  );

  assert.deepEqual(
    normalizeRagSearchSettings(
      { topK: 99, rerank: true, topN: 0 },
      {
        maxTopK: 12,
        maxTopN: 4,
        maxQueryLength: 4000,
        searchSupported: true,
        rerankSupported: false,
      },
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
