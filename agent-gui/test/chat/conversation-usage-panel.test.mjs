import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const usageState = loader.loadModule("src/pages/chat/components/conversationUsageState.ts");

const usage = (totalTokens, input, output) => ({
  totalTokens,
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function assistantItem(key, roundUsages, timestamp) {
  return {
    kind: "assistant",
    key,
    segmentIndex: 0,
    rounds: roundUsages.map((roundUsage, index) => ({
      round: index + 1,
      key: `${key}-round-${index}`,
      blocks: [],
      meta: roundUsage ? { usage: roundUsage } : undefined,
    })),
    timestamp,
    isFromCompactedSegment: false,
  };
}

test("latest historical usage replaces earlier round usage", () => {
  const earlier = usage(100, 80, 20);
  const latest = usage(240, 200, 40);

  assert.deepEqual(
    usageState.findLatestConversationUsage(
      [
        assistantItem("assistant-1", [earlier], 10),
        assistantItem("assistant-2", [undefined, latest], 20),
      ],
      [],
    ),
    latest,
  );
});

test("live usage replaces historical usage and empty live rounds preserve it", () => {
  const historical = usage(120, 100, 20);
  const live = usage(300, 250, 50);
  const historyItems = [assistantItem("assistant-1", [historical], 10)];

  assert.deepEqual(usageState.findLatestConversationUsage(historyItems, []), historical);
  assert.deepEqual(
    usageState.findLatestConversationUsage(historyItems, [
      {
        round: 2,
        key: "live-round",
        blocks: [],
        meta: { usage: live },
        runningToolCallIds: [],
        thinkingOpen: false,
      },
    ]),
    live,
  );
});

test("zero and missing usage snapshots do not create a global row", () => {
  assert.equal(usageState.findLatestConversationUsage([], []), null);
  assert.equal(
    usageState.findLatestConversationUsage(
      [assistantItem("assistant-1", [usage(0, 0, 0)], 10)],
      [],
    ),
    null,
  );
});
