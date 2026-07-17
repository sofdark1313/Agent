import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const {
  DEFAULT_CUSTOM_APPROVAL_RULES,
  assessToolCall,
  enforceToolApproval,
  getToolApprovalRequirement,
} = loader.loadModule("src/lib/tools/toolApprovalPolicy.ts");

const metadata = (overrides = {}) => ({
  groupId: "fs",
  kind: "read",
  isReadOnly: true,
  displayCategory: "file",
  ...overrides,
});

test("workspace reads are automatic while external reads require approval", () => {
  const inside = assessToolCall({
    toolCall: { id: "read-1", name: "Read", arguments: { path: "src/App.tsx" } },
    metadata: metadata(),
    workdir: "C:/Code/Agent",
  });
  const outside = assessToolCall({
    toolCall: {
      id: "read-2",
      name: "Read",
      arguments: { path: "C:/Users/admin/.ssh/config" },
    },
    metadata: metadata(),
    workdir: "C:/Code/Agent",
  });

  assert.equal(inside.category, "read");
  assert.equal(inside.outsideWorkspace, false);
  assert.equal(getToolApprovalRequirement("ask", inside), "auto");
  assert.equal(outside.outsideWorkspace, true);
  assert.equal(getToolApprovalRequirement("ask", outside), "ask");
});

test("ask mode prompts for writes and agent mode only prompts for elevated actions", () => {
  const write = assessToolCall({
    toolCall: { id: "write-1", name: "Write", arguments: { path: "src/App.tsx" } },
    metadata: metadata({ kind: "write", isReadOnly: false }),
    workdir: "/workspace/agent",
  });
  const bash = assessToolCall({
    toolCall: { id: "bash-1", name: "Bash", arguments: { command: "pnpm test" } },
    metadata: metadata({
      groupId: "shell",
      kind: "bash",
      isReadOnly: false,
      displayCategory: "terminal",
    }),
    workdir: "/workspace/agent",
  });

  assert.equal(write.category, "write");
  assert.equal(getToolApprovalRequirement("ask", write), "ask");
  assert.equal(getToolApprovalRequirement("agent", write), "auto");
  assert.equal(bash.category, "command");
  assert.equal(getToolApprovalRequirement("agent", bash), "ask");
  assert.equal(getToolApprovalRequirement("full", bash), "auto");
});

test("delete, MCP and network calls are elevated", () => {
  const remove = assessToolCall({
    toolCall: { id: "delete-1", name: "Delete", arguments: { path: "tmp" } },
    metadata: metadata({ kind: "delete", isReadOnly: false }),
    workdir: "/workspace/agent",
  });
  const mcp = assessToolCall({
    toolCall: { id: "mcp-1", name: "mcp__github__create_issue", arguments: {} },
    metadata: metadata({
      groupId: "mcp",
      kind: "mcp_tool",
      isReadOnly: false,
      displayCategory: "mcp",
    }),
    workdir: "/workspace/agent",
  });
  const network = assessToolCall({
    toolCall: {
      id: "http-1",
      name: "HttpGetTest",
      arguments: { url: "https://example.com" },
    },
    metadata: metadata({
      groupId: "system",
      kind: "http_get_test",
      isReadOnly: true,
      displayCategory: "system",
    }),
    workdir: "/workspace/agent",
  });

  assert.equal(remove.destructive, true);
  assert.equal(getToolApprovalRequirement("agent", remove), "ask");
  assert.equal(mcp.category, "mcp");
  assert.equal(getToolApprovalRequirement("agent", mcp), "ask");
  assert.equal(network.category, "network");
  assert.equal(getToolApprovalRequirement("agent", network), "ask");

  const remoteImage = assessToolCall({
    toolCall: {
      id: "image-1",
      name: "Image",
      arguments: { url: "https://example.com/screenshot.png" },
    },
    metadata: metadata({ kind: "image", isReadOnly: true }),
    workdir: "/workspace/agent",
  });
  assert.equal(remoteImage.category, "network");
  assert.equal(getToolApprovalRequirement("agent", remoteImage), "ask");
});

test("custom mode follows persisted category and workspace rules", () => {
  const write = assessToolCall({
    toolCall: { id: "write-1", name: "Write", arguments: { path: "src/App.tsx" } },
    metadata: metadata({ kind: "write", isReadOnly: false }),
    workdir: "/workspace/agent",
  });
  const externalWrite = assessToolCall({
    toolCall: { id: "write-2", name: "Write", arguments: { path: "/tmp/output.txt" } },
    metadata: metadata({ kind: "write", isReadOnly: false }),
    workdir: "/workspace/agent",
  });

  assert.equal(
    getToolApprovalRequirement("custom", write, {
      ...DEFAULT_CUSTOM_APPROVAL_RULES,
      allowWorkspaceWrites: true,
    }),
    "auto",
  );
  assert.equal(
    getToolApprovalRequirement("custom", externalWrite, {
      ...DEFAULT_CUSTOM_APPROVAL_RULES,
      allowWorkspaceWrites: true,
      allowOutsideWorkspace: false,
    }),
    "ask",
  );
  assert.equal(
    getToolApprovalRequirement("custom", externalWrite, {
      ...DEFAULT_CUSTOM_APPROVAL_RULES,
      allowWorkspaceWrites: false,
      allowOutsideWorkspace: true,
    }),
    "ask",
  );
  assert.equal(
    getToolApprovalRequirement("custom", externalWrite, {
      ...DEFAULT_CUSTOM_APPROVAL_RULES,
      allowWorkspaceWrites: true,
      allowOutsideWorkspace: true,
    }),
    "auto",
  );
});

test("approval enforcement only invokes the broker when policy requires it", async () => {
  const requested = [];
  const requestApproval = async (input) => requested.push(input);
  const writeCall = {
    id: "write-gate",
    name: "Write",
    arguments: { path: "src/App.tsx" },
  };
  const writeMetadata = metadata({ kind: "write", isReadOnly: false });

  await enforceToolApproval({
    policy: "agent",
    customRules: DEFAULT_CUSTOM_APPROVAL_RULES,
    workdir: "/workspace/agent",
    sessionId: "run-1",
    toolCall: writeCall,
    metadata: writeMetadata,
    requestApproval,
  });
  assert.equal(requested.length, 0);

  await enforceToolApproval({
    policy: "ask",
    customRules: DEFAULT_CUSTOM_APPROVAL_RULES,
    workdir: "/workspace/agent",
    sessionId: "run-1",
    toolCall: writeCall,
    metadata: writeMetadata,
    requestApproval,
  });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].assessment.category, "write");
  assert.equal(requested[0].sessionId, "run-1");
});
