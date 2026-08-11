import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const NOW_MS = 1_800_000_000_000;

test("RAG capability snapshots require a fresh local timestamp and protocol 1.x", async () => {
  const loader = createTsModuleLoader();
  const { RAG_CAPABILITY_TTL_MS, isFreshRagCapabilitySnapshot } =
    await loader.loadModule("src/lib/rag/capabilitySnapshot.ts");
  const snapshot = {
    protocolVersion: "1.7",
    capturedAtMs: NOW_MS - 1_000,
    limits: { maxTopK: 50 },
    features: { rerank: true },
  };

  assert.equal(isFreshRagCapabilitySnapshot(snapshot, NOW_MS), true);
  assert.equal(isFreshRagCapabilitySnapshot(null, NOW_MS), false);
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, capturedAtMs: undefined }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, capturedAtMs: Number.NaN }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, capturedAtMs: NOW_MS + 1 }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot(
      { ...snapshot, capturedAtMs: NOW_MS - RAG_CAPABILITY_TTL_MS - 1 },
      NOW_MS,
    ),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, protocolVersion: "2.0" }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, protocolVersion: "1beta" }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, protocolVersion: "1" }, NOW_MS),
    false,
  );
  assert.equal(
    isFreshRagCapabilitySnapshot({ ...snapshot, protocolVersion: "01.0" }, NOW_MS),
    false,
  );
});

test("RAG capability snapshots expose the exact delay until idle UI invalidation", async () => {
  const loader = createTsModuleLoader();
  const { RAG_CAPABILITY_TTL_MS, nextRagCapabilityExpiryDelay } = await loader.loadModule(
    "src/lib/rag/capabilitySnapshot.ts",
  );
  const snapshot = { protocolVersion: "1.0", capturedAtMs: NOW_MS - 1_000 };

  assert.equal(
    nextRagCapabilityExpiryDelay(snapshot, NOW_MS),
    RAG_CAPABILITY_TTL_MS - 1_000 + 1,
  );
  assert.equal(
    nextRagCapabilityExpiryDelay(
      { ...snapshot, capturedAtMs: NOW_MS - RAG_CAPABILITY_TTL_MS - 1 },
      NOW_MS,
    ),
    null,
  );
  assert.equal(nextRagCapabilityExpiryDelay(null, NOW_MS), null);
});
