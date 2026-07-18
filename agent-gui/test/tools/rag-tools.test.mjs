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
          return [{ enabled: true, agentEnabled: true, agentCredentialConfigured: true }];
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

test("RAG tools call the read-only agent commands and format citations", async () => {
  const invocations = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          if (command === "rag_list_services") {
            return [{ enabled: true, agentEnabled: true, agentCredentialConfigured: true }];
          }
          if (command === "rag_agent_list_knowledge_bases") {
            return [{ id: "hr", name: "Human Resources" }];
          }
          if (command === "rag_agent_search") {
            return {
              results: [
                {
                  knowledgeBaseId: "hr",
                  chunkId: "chunk-1",
                  content: "Annual leave is five days.",
                  score: 0.91,
                  source: "vector",
                },
              ],
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
