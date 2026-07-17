import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function source(relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

test("access selector persists a real approval policy instead of using text mode", async () => {
  const content = await source("src/pages/chat/components/ChatAccessSelector.tsx");
  assert.match(content, /approvalPolicy:\s*ApprovalPolicy/);
  assert.match(content, /approvalPolicy:\s*"ask"/);
  assert.match(content, /approvalPolicy:\s*"agent"/);
  assert.match(content, /approvalPolicy:\s*"full"/);
  assert.match(content, /approvalPolicy:\s*"custom"/);
  assert.doesNotMatch(content, /mode:\s*"text"/);
});

test("approval card exposes deny, allow once, and allow for run actions", async () => {
  const content = await source("src/pages/chat/components/ToolApprovalCard.tsx");
  assert.match(content, /data-agent-tool-approval/);
  assert.match(content, /"deny"/);
  assert.match(content, /"allow-once"/);
  assert.match(content, /"allow-session"/);
  assert.match(content, /outsideWorkspace/);
});

test("chat page subscribes to the approval broker and renders pending requests", async () => {
  const content = await source("src/pages/ChatPage.tsx");
  assert.match(content, /new ToolApprovalBroker\(\)/);
  assert.match(content, /useSyncExternalStore/);
  assert.match(content, /<ToolApprovalCard/);
  assert.match(content, /approvalBroker\.request/);
});

test("system tools settings expose custom approval and workspace rules", async () => {
  const content = await source("src/pages/settings/SystemToolsSection.tsx");
  assert.match(content, /customApprovalRules/);
  assert.match(content, /allowWorkspaceWrites/);
  assert.match(content, /allowCommands/);
  assert.match(content, /allowNetwork/);
  assert.match(content, /allowMcp/);
  assert.match(content, /allowOutsideWorkspace/);
});
