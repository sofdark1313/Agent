import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { ToolApprovalBroker, ToolApprovalDeniedError } = loader.loadModule(
  "src/lib/chat/approval/toolApprovalBroker.ts",
);

function requestInput(overrides = {}) {
  return {
    sessionId: "run-1",
    conversationId: "conversation-1",
    toolCall: {
      id: "tool-1",
      name: "Bash",
      arguments: { command: "pnpm test" },
    },
    assessment: {
      category: "command",
      destructive: false,
      outsideWorkspace: false,
      pathCandidates: [],
      summary: "Bash: pnpm test",
    },
    ...overrides,
  };
}

test("broker blocks execution until an approval decision is resolved", async () => {
  const broker = new ToolApprovalBroker();
  let settled = false;
  const pending = broker.request(requestInput()).then(() => {
    settled = true;
  });

  assert.equal(settled, false);
  assert.equal(broker.getSnapshot().length, 1);
  const [request] = broker.getSnapshot();
  assert.equal(request.toolCall.name, "Bash");
  assert.equal(request.conversationId, "conversation-1");

  broker.resolve(request.id, "allow-once");
  await pending;
  assert.equal(settled, true);
  assert.equal(broker.getSnapshot().length, 0);
});

test("allow-session remembers the same tool scope for the current run", async () => {
  const broker = new ToolApprovalBroker();
  const first = broker.request(requestInput());
  const [request] = broker.getSnapshot();
  broker.resolve(request.id, "allow-session");
  await first;

  await broker.request(
    requestInput({
      toolCall: {
        id: "tool-2",
        name: "Bash",
        arguments: { command: "pnpm build" },
      },
    }),
  );
  assert.equal(broker.getSnapshot().length, 0);

  const otherRun = broker.request(requestInput({ sessionId: "run-2" }));
  assert.equal(broker.getSnapshot().length, 1);
  broker.resolve(broker.getSnapshot()[0].id, "allow-once");
  await otherRun;
});

test("deny and abort reject pending tool execution and remove the request", async () => {
  const broker = new ToolApprovalBroker();
  const denied = broker.request(requestInput());
  broker.resolve(broker.getSnapshot()[0].id, "deny");
  await assert.rejects(denied, ToolApprovalDeniedError);

  const controller = new AbortController();
  const aborted = broker.request(
    requestInput({
      sessionId: "run-abort",
      toolCall: { id: "tool-abort", name: "Delete", arguments: { path: "tmp" } },
      signal: controller.signal,
    }),
  );
  controller.abort();
  await assert.rejects(aborted, /cancelled/i);
  assert.equal(broker.getSnapshot().length, 0);
});
