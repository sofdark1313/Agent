import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("eligible built-in RAG registers exactly two read-only tools", async () => {
  const nowMs = 1_800_000_000_000;
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "rag_list_services");
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
              capabilitiesSnapshot: {
                protocolVersion: "1.0",
                capturedAtMs: nowMs - 1_000,
                features: { rerank: true },
                limits: { maxTopK: 50, maxTopN: 20, maxQueryLength: 4_000 },
              },
            },
          ];
        },
      },
    },
  });

  const bundle = await loader.loadModule("src/lib/tools/ragTools.ts").createRagTools(nowMs);

  assert.deepEqual(bundle.tools.map((tool) => tool.name), [
    "RagListKnowledgeBases",
    "RagSearch",
  ]);
  assert.equal(bundle.metadataByName.get("RagListKnowledgeBases").isReadOnly, true);
  assert.equal(bundle.metadataByName.get("RagSearch").isReadOnly, true);
});

test("the Agent RAG command surface contains no write operation", () => {
  const commands = fs.readFileSync(
    path.join(root, "src-tauri/src/commands/integration/rag.rs"),
    "utf8",
  );
  const agentCommands = [...commands.matchAll(/pub async fn (rag_agent_[a-z_]+)/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(agentCommands, ["rag_agent_list_knowledge_bases", "rag_agent_search"]);
  assert.doesNotMatch(agentCommands.join("\n"), /upload|import|create|update|delete|retry|rerank/);
});
