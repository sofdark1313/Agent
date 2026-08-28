import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const uiMessages = loader.loadModule("src/lib/chat/messages/uiMessages.ts");
const conversationState = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
const messageUtils = loader.loadModule("src/lib/providers/runtime/messageUtils.ts");
const bubbleUtils = loader.loadModule(
  "src/pages/chat/components/assistant-bubble/assistantBubbleUtils.ts",
);

function user(content, timestamp) {
  return { role: "user", content, timestamp };
}

function assistant(text, timestamp, extra = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Block ids: stable at creation, never shifted by later inserts

test("appendTextDeltaToRound extends the trailing block without changing its id", () => {
  let round = { blocks: [] };
  round = uiMessages.appendTextDeltaToRound(round, "Hello ");
  round = uiMessages.appendTextDeltaToRound(round, "world");
  assert.equal(round.blocks.length, 1);
  assert.equal(round.blocks[0].id, "text-1");
  assert.equal(round.blocks[0].text, "Hello world");
});

test("appendTextDeltaToRound strips the conversation end marker from visible text", () => {
  let round = { blocks: [] };
  round = uiMessages.appendTextDeltaToRound(round, "Answer ");
  round = uiMessages.appendTextDeltaToRound(round, "<CPA_DONE>");
  assert.equal(round.blocks.length, 1);
  assert.equal(round.blocks[0].text, "Answer ");
});

test("interleaved thinking/text/tool blocks get per-kind ordinal ids", () => {
  let round = { blocks: [] };
  round = uiMessages.appendThinkingDeltaToRound(round, "pondering");
  round = uiMessages.appendTextDeltaToRound(round, "part one");
  round = uiMessages.upsertToolCallToRound(round, {
    type: "toolCall",
    id: "call-1",
    name: "Read",
    arguments: {},
  });
  round = uiMessages.appendTextDeltaToRound(round, "part two");
  const ids = round.blocks.map((block) => (block.kind === "tool" ? "tool" : block.id));
  assert.deepEqual(ids, ["thinking-1", "text-1", "tool", "text-2"]);
});

test("block ids assign deterministically across replays of the same sequence", () => {
  const build = () => {
    let round = { blocks: [] };
    round = uiMessages.appendThinkingDeltaToRound(round, "t");
    round = uiMessages.appendTextDeltaToRound(round, "a");
    round = uiMessages.upsertToolCallToRound(round, {
      type: "toolCall",
      id: "call-1",
      name: "Bash",
      arguments: {},
    });
    round = uiMessages.appendTextDeltaToRound(round, "b");
    return round.blocks.map((block) => (block.kind === "tool" ? block.item.toolCall.id : block.id));
  };
  assert.deepEqual(build(), build());
});

// ---------------------------------------------------------------------------
// groupRoundBlocks keys derive from block ids, not array positions

test("groupRoundBlocks keys survive a block being inserted before them", () => {
  const before = [
    { kind: "thinking", id: "thinking-1", text: "think" },
    { kind: "text", id: "text-1", text: "answer" },
  ];
  const after = [
    { kind: "thinking", id: "thinking-1", text: "think" },
    {
      kind: "tool",
      item: { toolCall: { type: "toolCall", id: "call-1", name: "Read", arguments: {} } },
    },
    { kind: "text", id: "text-1", text: "answer" },
  ];
  const keysBefore = bubbleUtils.groupRoundBlocks(before).map((block) => block.key);
  const keysAfter = bubbleUtils.groupRoundBlocks(after).map((block) => block.key);
  // The text block's key must not change when a tool block lands before it —
  // an index-derived key would flip and remount the rendered markdown.
  assert.equal(keysBefore.at(-1), "text-1");
  assert.equal(keysAfter.at(-1), "text-1");
  assert.equal(keysBefore[0], "thinking-1");
  assert.equal(keysAfter[0], "thinking-1");
});

test("a single ordinary tool is normalized into a collapsed activity group", () => {
  const grouped = bubbleUtils.groupRoundBlocks([
    {
      kind: "tool",
      item: {
        toolCall: {
          type: "toolCall",
          id: "call-read",
          name: "Read",
          arguments: { path: "src/App.tsx" },
        },
      },
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, "toolGroup");
  assert.equal(grouped[0].items.length, 1);
  assert.equal(grouped[0].items[0].toolCall.name, "Read");
});

test("image todo and agent calls keep their dedicated rendering paths", () => {
  for (const name of ["Image", "TodoWrite", "Agent"]) {
    const grouped = bubbleUtils.groupRoundBlocks([
      {
        kind: "tool",
        item: {
          toolCall: { type: "toolCall", id: `call-${name}`, name, arguments: {} },
        },
      },
    ]);
    assert.equal(grouped[0].kind, "tool");
  }
});

// ---------------------------------------------------------------------------
// Round keys: history rounds are r<n>; rebuilds are deterministic

test("buildUiMessages stamps r<n> round keys and deterministic block ids", () => {
  const messages = [
    user("question", 1),
    assistant("first round", 2, { stopReason: "toolUse" }),
    assistant("second round", 3),
  ];
  const first = uiMessages.buildUiMessages(messages);
  const second = uiMessages.buildUiMessages(messages);
  const reply = first.find((message) => message.role === "assistant");
  assert.deepEqual(
    reply.rounds.map((round) => round.key),
    ["r1", "r2"],
  );
  assert.deepEqual(first, second, "rebuilding the same messages yields identical keys/ids");
});

test("assistantMessageToText and streaming reconciliation drop the conversation end marker", () => {
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "Final answer <CPA_DONE>" }],
    stopReason: "stop",
  };
  assert.equal(messageUtils.assistantMessageToText(assistant), "Final answer ");

  const reconciler = messageUtils.createStreamingTextReconciler();
  assert.equal(reconciler.appendDelta("1", "Final answer <CPA_"), "Final answer ");
  assert.equal(reconciler.appendDelta("1", "DONE>"), "");
  assert.equal(reconciler.reconcileFinalText("1", "Final answer <CPA_DONE>"), "");
});

test("assistantMessageToText unwraps structured answer payloads", () => {
  const assistant = {
    role: "assistant",
    content: [
      {
        type: "text",
        text: '{"answer":"可读正文","answer_language":"zh-CN"}',
      },
    ],
    stopReason: "stop",
  };
  assert.equal(messageUtils.assistantMessageToText(assistant), "可读正文");
});

test("merging render-only rounds shifts r<n> keys in lockstep with round numbers", () => {
  const state = conversationState.createConversationStateFromContext({
    systemPrompt: "base",
    tools: [],
    messages: [user("question", 1), assistant("first reply", 2)],
  });
  const lastBefore = state.historyRenderItems.at(-1);
  assert.equal(lastBefore.kind, "assistant");
  assert.deepEqual(
    lastBefore.rounds.map((round) => round.key),
    ["r1"],
  );

  const merged = conversationState.appendRenderOnlyMessagesToConversation(state, [
    assistant("appended reply", 3),
  ]);
  const lastAfter = merged.historyRenderItems.at(-1);
  assert.deepEqual(
    lastAfter.rounds.map((round) => round.round),
    [1, 2],
  );
  assert.deepEqual(
    lastAfter.rounds.map((round) => round.key),
    ["r1", "r2"],
    "shifted rounds re-stamp their ordinal keys so merged keys stay collision-free",
  );
});
