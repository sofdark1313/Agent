import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("built-in RAG keeps credentials outside React, SQLite service config, and MCP", () => {
  const page = read("src/pages/rag-hub/RagHubPage.tsx");
  const documentPanel = read("src/pages/rag-hub/RagDocumentPanel.tsx");
  const client = read("src/lib/rag/client.ts");
  const types = read("src/lib/rag/types.ts");
  const commands = read("src-tauri/src/commands/integration/rag.rs");
  const model = read("src-tauri/src/services/rag/model.rs");
  const store = read("src-tauri/src/services/rag/service_store.rs");
  const credentials = read("src-tauri/src/services/rag/credential_store.rs");
  const sources = [page, documentPanel, client, types, commands, model, store, credentials].join(
    "\n",
  );

  assert.doesNotMatch(sources, /\/mcp\/rag|createMcp\w*Rag|rag\w*stdio/i);
  assert.doesNotMatch(page, /managementApiKey|agentApiKey|type="password"|localStorage/);
  assert.doesNotMatch(documentPanel, /managementApiKey|agentApiKey|Authorization/);
  assert.doesNotMatch(types, /managementApiKey\s*:|agentApiKey\s*:|credentialRef\s*:/);
  assert.doesNotMatch(model, /management_api_key|agent_api_key|authorization_header|credential_ref/i);
  assert.doesNotMatch(store, /api[_ ]?key|authorization|secret/i);
  assert.match(credentials, /keyring/i);
  assert.match(client, /function safeService/);
  assert.match(client, /managementCredentialConfigured/);
  assert.match(client, /agentCredentialConfigured/);
});

test("RAG save IPC rejects secret-bearing top-level fields", () => {
  const commands = read("src-tauri/src/commands/integration/rag.rs");

  assert.match(commands, /deny_unknown_fields/);
  assert.match(commands, /pub struct RagSaveServiceRequest \{\s*pub service: RagServiceConfig,?\s*\}/);
  assert.doesNotMatch(commands, /RagSaveServiceRequest[\s\S]{0,300}(management_api_key|agent_api_key)/i);
});
