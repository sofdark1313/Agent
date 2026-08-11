import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const service = (id, overrides = {}) => ({
  id,
  name: `Service ${id}`,
  adapterType: "ragent",
  baseUrl: `https://${id}.example.com`,
  enabled: true,
  default: false,
  agentEnabled: true,
  agentKnowledgeBaseIds: ["hr"],
  timeoutMs: 30_000,
  managementCredentialConfigured: true,
  agentCredentialConfigured: true,
  capabilitiesSnapshot: { protocolVersion: "1.0" },
  ...overrides,
});

test("RAG service selection ignores deleted ids and falls back deterministically", async () => {
  const loader = createTsModuleLoader();
  const { DEFAULT_RAGENT_BASE_URL, chooseRagServiceId } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  assert.equal(DEFAULT_RAGENT_BASE_URL, "http://localhost:9090/api/ragent");
  const services = [service("a"), service("b", { default: true })];

  assert.equal(chooseRagServiceId(services, "missing", "deleted"), "b");
  assert.equal(chooseRagServiceId(services, "a", "b"), "a");
  assert.equal(chooseRagServiceId([], "a", "b"), "");
});

test("RAG connection test is blocked until the persisted draft matches", async () => {
  const loader = createTsModuleLoader();
  const { canTestSavedRagService } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  const saved = service("a");

  assert.equal(canTestSavedRagService(saved, { ...saved }), true);
  assert.equal(
    canTestSavedRagService(saved, { ...saved, baseUrl: "https://new.example.com" }),
    false,
  );
  assert.equal(canTestSavedRagService(null, service("new")), false);
});

test("RAG capability health distinguishes untested, valid, expired, and incompatible snapshots", async () => {
  const loader = createTsModuleLoader();
  const { resolveRagCapabilityHealth } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  const nowMs = 1_800_000_000_000;

  assert.equal(resolveRagCapabilityHealth(null, nowMs), "untested");
  assert.equal(
    resolveRagCapabilityHealth(
      { protocolVersion: "1.2", capturedAtMs: nowMs - 60_000 },
      nowMs,
    ),
    "valid",
  );
  assert.equal(
    resolveRagCapabilityHealth(
      { protocolVersion: "1.2", capturedAtMs: nowMs - 5 * 60_000 - 1 },
      nowMs,
    ),
    "expired",
  );
  assert.equal(
    resolveRagCapabilityHealth({ protocolVersion: "2.0", capturedAtMs: nowMs }, nowMs),
    "incompatible",
  );
});

test("RAG service timeout validation enforces the supported millisecond range", async () => {
  const loader = createTsModuleLoader();
  const {
    MAX_RAG_SERVICE_TIMEOUT_MS,
    MIN_RAG_SERVICE_TIMEOUT_MS,
    isValidRagServiceTimeout,
  } = await loader.loadModule("src/pages/rag-hub/serviceState.ts");

  assert.equal(MIN_RAG_SERVICE_TIMEOUT_MS, 1_000);
  assert.equal(MAX_RAG_SERVICE_TIMEOUT_MS, 120_000);
  assert.equal(isValidRagServiceTimeout(1_000), true);
  assert.equal(isValidRagServiceTimeout(120_000), true);
  assert.equal(isValidRagServiceTimeout(999), false);
  assert.equal(isValidRagServiceTimeout(120_001), false);
  assert.equal(isValidRagServiceTimeout(1_000.5), false);
});

test("RAG knowledge base filtering matches names and ids without changing order", async () => {
  const loader = createTsModuleLoader();
  const { filterRagKnowledgeBases } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  const knowledgeBases = [
    { id: "policy-cn", name: "Company Policies" },
    { id: "engineering", name: "Engineering Handbook" },
    { id: "hr", name: "People Ops" },
  ];

  assert.deepEqual(filterRagKnowledgeBases(knowledgeBases, "  POLICy "), [knowledgeBases[0]]);
  assert.deepEqual(filterRagKnowledgeBases(knowledgeBases, "engine"), [knowledgeBases[1]]);
  assert.deepEqual(filterRagKnowledgeBases(knowledgeBases, ""), knowledgeBases);
});
