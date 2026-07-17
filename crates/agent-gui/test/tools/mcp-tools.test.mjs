import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createToolCall(id, name, args = {}) {
  return {
    type: "toolCall",
    id,
    name,
    arguments: args,
  };
}

function createServer(id) {
  return {
    id,
    enabled: true,
    transport: "stdio",
    command: "mock-mcp-server",
    args: [],
    env: {},
  };
}

test("MCP business tool calls are serialized per server", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const events = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          if (command === "mcp_list_tools") {
            return [
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "search",
                description: "Search docs",
                inputSchema: { type: "object" },
              },
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "read",
                description: "Read docs",
                inputSchema: { type: "object" },
              },
            ];
          }
          if (command !== "mcp_call_tool") {
            throw new Error(`Unexpected invoke: ${command}`);
          }

          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          events.push(`start:${args.tool_name}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push(`end:${args.tool_name}`);
          activeCalls -= 1;
          return {
            content: [{ type: "text", text: `ok:${args.tool_name}` }],
            isError: false,
            details: {},
          };
        },
      },
    },
  });

  const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
  const bundle = await createMcpTools({
    servers: [createServer("docs")],
  });
  const search = bundle.tools.find((tool) => tool.name.endsWith("_search"));
  const read = bundle.tools.find((tool) => tool.name.endsWith("_read"));

  assert.ok(search);
  assert.ok(read);

  const [searchResult, readResult] = await Promise.all([
    bundle.executeToolCall(createToolCall("call-search", search.name, { q: "agent" })),
    bundle.executeToolCall(createToolCall("call-read", read.name, { id: "agent" })),
  ]);

  assert.equal(searchResult.isError, false);
  assert.equal(readResult.isError, false);
  assert.equal(maxActiveCalls, 1);
  assert.deepEqual(events, ["start:search", "end:search", "start:read", "end:read"]);
});

test("MCP business tool calls on different servers can run concurrently", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          if (command === "mcp_list_tools") {
            return [
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "search",
                description: "Search docs",
                inputSchema: { type: "object" },
              },
              {
                serverId: "issues",
                serverLabel: "Issues",
                name: "search",
                description: "Search issues",
                inputSchema: { type: "object" },
              },
            ];
          }
          if (command !== "mcp_call_tool") {
            throw new Error(`Unexpected invoke: ${command}`);
          }

          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeCalls -= 1;
          return {
            content: [{ type: "text", text: `ok:${args.server_id}` }],
            isError: false,
            details: {},
          };
        },
      },
    },
  });

  const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
  const bundle = await createMcpTools({
    servers: [createServer("docs"), createServer("issues")],
  });
  const docsSearch = bundle.tools.find((tool) => tool.name.startsWith("mcp_docs_"));
  const issuesSearch = bundle.tools.find((tool) => tool.name.startsWith("mcp_issues_"));

  assert.ok(docsSearch);
  assert.ok(issuesSearch);

  await Promise.all([
    bundle.executeToolCall(createToolCall("call-docs", docsSearch.name, { q: "agent" })),
    bundle.executeToolCall(createToolCall("call-issues", issuesSearch.name, { q: "agent" })),
  ]);

  assert.equal(maxActiveCalls, 2);
});
