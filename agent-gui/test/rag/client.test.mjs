import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("RAG client strips credential material from service responses", async () => {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return [
            {
              id: "company",
              name: "Company RAG",
              adapterType: "ragent",
              baseUrl: "https://rag.example.com",
              enabled: true,
              default: true,
              agentEnabled: true,
              agentKnowledgeBaseIds: ["hr"],
              timeoutMs: 30_000,
              managementCredentialConfigured: true,
              agentCredentialConfigured: true,
              capabilitiesSnapshot: null,
              managementApiKey: "must-never-reach-react",
              agentApiKey: "must-never-reach-react",
              authorization: "Bearer must-never-reach-react",
              credentialRef: "vault-entry",
            },
          ];
        },
      },
    },
  });
  const { ragClient } = await loader.loadModule("src/lib/rag/client.ts");

  const services = await ragClient.listServices();

  assert.deepEqual(calls, [{ command: "rag_list_services", args: undefined }]);
  assert.equal(services[0].managementCredentialConfigured, true);
  assert.equal("managementApiKey" in services[0], false);
  assert.equal("agentApiKey" in services[0], false);
  assert.equal("authorization" in services[0], false);
  assert.equal("credentialRef" in services[0], false);
});

test("RAG client maps document ingestion history to the typed Tauri command", async () => {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return { items: [], page: 2, pageSize: 10, total: 0 };
        },
      },
    },
  });
  const { ragClient } = await loader.loadModule("src/lib/rag/client.ts");

  const result = await ragClient.listIngestionJobs("company", "doc-1", 2, 10);

  assert.deepEqual(calls, [
    {
      command: "rag_hub_list_ingestion_jobs",
      args: { service_id: "company", document_id: "doc-1", current: 2, size: 10 },
    },
  ]);
  assert.deepEqual(result, { items: [], page: 2, pageSize: 10, total: 0 });
});
