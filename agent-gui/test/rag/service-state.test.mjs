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
  const { chooseRagServiceId } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  const services = [service("a"), service("b", { default: true })];

  assert.equal(chooseRagServiceId(services, "missing", "deleted"), "b");
  assert.equal(chooseRagServiceId(services, "a", "b"), "a");
  assert.equal(chooseRagServiceId([], "a", "b"), "");
});

test("RAG connection test is blocked until draft and credential changes are saved", async () => {
  const loader = createTsModuleLoader();
  const { canTestSavedRagService } = await loader.loadModule(
    "src/pages/rag-hub/serviceState.ts",
  );
  const saved = service("a");

  assert.equal(canTestSavedRagService(saved, { ...saved }, "", ""), true);
  assert.equal(
    canTestSavedRagService(saved, { ...saved, baseUrl: "https://new.example.com" }, "", ""),
    false,
  );
  assert.equal(canTestSavedRagService(saved, { ...saved }, "new-management-key", ""), false);
  assert.equal(canTestSavedRagService(null, service("new"), "", ""), false);
});
