import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function toolCall(name, argumentsValue) {
  return { type: "toolCall", id: `call-${name}`, name, arguments: argumentsValue };
}

test("RAG tools register only when an agent-enabled service has a credential", async () => {
  const disabledLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": { async invoke() { return []; } },
    },
  });
  const disabled = await disabledLoader
    .loadModule("src/lib/tools/ragTools.ts")
    .createRagTools();
  assert.deepEqual(disabled.tools, []);

  const enabledLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "rag_list_services");
          return [
            {
              enabled: true,
              agentEnabled: true,
              agentCredentialConfigured: true,
              capabilitiesSnapshot: { protocolVersion: "1.0" },
            },
          ];
        },
      },
    },
  });
  const enabled = await enabledLoader.loadModule("src/lib/tools/ragTools.ts").createRagTools();
  assert.deepEqual(enabled.tools.map((tool) => tool.name), [
    "RagListKnowledgeBases",
    "RagSearch",
  ]);
});

test("RAG tools require a tested compatible protocol snapshot", async () => {
  async function toolsFor(capabilitiesSnapshot) {
    const loader = createTsModuleLoader({
      mocks: {
        "@tauri-apps/api/core": {
          async invoke(command) {
            assert.equal(command, "rag_list_services");
            return [
              {
                enabled: true,
                agentEnabled: true,
                agentCredentialConfigured: true,
                capabilitiesSnapshot,
              },
            ];
          },
        },
      },
    });
    return loader.loadModule("src/lib/tools/ragTools.ts").createRagTools();
  }

  assert.deepEqual((await toolsFor(null)).tools, []);
  assert.deepEqual((await toolsFor({ protocolVersion: "2.0" })).tools, []);
  assert.deepEqual(
    (await toolsFor({ protocolVersion: "1.7" })).tools.map((tool) => tool.name),
    ["RagListKnowledgeBases", "RagSearch"],
  );
});

test("RAG tools call the read-only agent commands and format citations", async () => {
  const invocations = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          if (command === "rag_list_services") {
            return [
              {
                enabled: true,
                agentEnabled: true,
                agentCredentialConfigured: true,
                capabilitiesSnapshot: { protocolVersion: "1.0" },
              },
            ];
          }
          if (command === "rag_agent_list_knowledge_bases") {
            return [{ id: "hr", name: "Human Resources" }];
          }
          if (command === "rag_agent_search") {
            return {
              requestId: "request-1",
              rawResults: [],
              results: [
                {
                  knowledgeBaseId: "hr",
                  documentId: "document-1",
                  documentName: "Employee Handbook.pdf",
                  chunkId: "chunk-1",
                  content: "Annual leave is five days.",
                  score: 0.91,
                  source: "vector",
                  rankBefore: 3,
                  rankAfter: 1,
                  metadata: { chunkIndex: 2 },
                },
              ],
              warnings: ["RAG_RERANK_UNAVAILABLE"],
              timings: { retrievalMs: 12, rerankMs: 8, totalMs: 22 },
            };
          }
          throw new Error(`unexpected invoke ${command}`);
        },
      },
    },
  });
  const bundle = await loader.loadModule("src/lib/tools/ragTools.ts").createRagTools();

  const listed = await bundle.executeToolCall(
    toolCall("RagListKnowledgeBases", { service_id: "company" }),
  );
  assert.equal(listed.isError, false);
  assert.match(listed.content[0].text, /hr/);

  const searched = await bundle.executeToolCall(
    toolCall("RagSearch", {
      service_id: "company",
      query: "annual leave",
      knowledge_base_ids: ["hr"],
      top_k: 5,
    }),
  );
  assert.equal(searched.isError, false);
  assert.match(searched.content[0].text, /\[1\]/);
  assert.match(searched.content[0].text, /chunk-1/);
  assert.match(searched.content[0].text, /Employee Handbook\.pdf/);
  assert.match(searched.content[0].text, /rank=3->1/);
  assert.match(searched.content[0].text, /RAG_RERANK_UNAVAILABLE/);
  assert.deepEqual(searched.details.timings, { retrievalMs: 12, rerankMs: 8, totalMs: 22 });
  assert.deepEqual(invocations.slice(1), [
    {
      command: "rag_agent_list_knowledge_bases",
      args: { service_id: "company" },
    },
    {
      command: "rag_agent_search",
      args: {
        request: {
          serviceId: "company",
          query: "annual leave",
          knowledgeBaseIds: ["hr"],
          topK: 5,
          rerank: true,
          topN: 5,
        },
      },
    },
  ]);
});
