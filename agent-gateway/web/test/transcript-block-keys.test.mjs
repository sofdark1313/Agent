import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});

const uiMessages = loader.loadModule("src/lib/chat/uiMessages.ts");
const providerLlm = loader.loadModule("src/lib/providers/llm.ts");
const { buildTurnRows, normalizeSettledRowRounds } = loader.loadModule(
  "src/lib/chat/transcript/rows.ts",
);
const { createTurn, applyEventToTurn } = loader.loadModule(
  "src/lib/chat/transcript/turnReducer.ts",
);

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
// Settled rounds normalize at row build time, not per render

test("buildTurnRows keeps live round state while streaming and strips it once settled", () => {
  let turn = createTurn({ key: "req:c1", runId: "run-1", phase: "streaming" });
  turn = applyEventToTurn(turn, { type: "thinking", text: "hmm", round: 1 });

  const thinkingRound = buildTurnRows(turn).find((row) => row.kind === "assistant").rounds[0];
  assert.equal(thinkingRound.thinkingOpen, true, "auto-open survives while streaming");

  turn = applyEventToTurn(turn, {
    type: "tool_call",
    id: "call-1",
    name: "Read",
    arguments: {},
    round: 1,
  });
  const streamingRound = buildTurnRows(turn).find((row) => row.kind === "assistant").rounds[0];
  assert.deepEqual(streamingRound.runningToolCallIds, ["call-1"]);

  const settledRound = buildTurnRows({ ...turn, phase: "settled" }).find(
    (row) => row.kind === "assistant",
  ).rounds[0];
  assert.equal(settledRound.thinkingOpen, undefined, "live-only state cleared at build time");
  assert.deepEqual(settledRound.runningToolCallIds, []);
});

test("assistantMessageToText strips the conversation end marker", () => {
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "Final answer <CPA_DONE>" }],
    stopReason: "stop",
  };
  assert.equal(providerLlm.assistantMessageToText(assistant), "Final answer ");
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
  assert.equal(providerLlm.assistantMessageToText(assistant), "可读正文");
});

test("normalizeSettledRowRounds returns identical round objects when nothing needs clearing", () => {
  let turn = createTurn({ key: "req:c2", runId: "run-2", phase: "settled" });
  turn = applyEventToTurn(turn, { type: "token", text: "plain reply", round: 1 });
  const rows = buildTurnRows({ ...turn, phase: "settled" });
  const normalized = normalizeSettledRowRounds(rows);
  const row = normalized.find((entry) => entry.kind === "assistant");
  const original = rows.find((entry) => entry.kind === "assistant");
  assert.equal(
    row.rounds[0],
    original.rounds[0],
    "already-clean rounds keep their identity for memoized renderers",
  );
});
