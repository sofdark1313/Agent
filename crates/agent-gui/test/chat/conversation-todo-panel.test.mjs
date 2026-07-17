import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const todoState = loader.loadModule("src/pages/chat/components/conversationTodoState.ts");

const todo = (content, status = "pending") => ({
  content,
  status,
  activeForm: status === "in_progress" ? `Working on ${content}` : content,
});

function todoBlock(id, todos, options = {}) {
  const toolResult = options.streaming
    ? undefined
    : {
        role: "toolResult",
        toolCallId: id,
        toolName: "TodoWrite",
        content: [{ type: "text", text: "updated" }],
        details: options.invalidKind ? { kind: "other", todos } : { kind: "todo_write", todos },
        isError: Boolean(options.isError),
        timestamp: options.timestamp ?? 1,
      };

  return {
    kind: "tool",
    item: {
      toolCall: {
        type: "toolCall",
        id,
        name: "TodoWrite",
        arguments: options.arguments ?? { todos },
      },
      toolResult,
    },
  };
}

function assistantItem(key, blocks, timestamp) {
  return {
    kind: "assistant",
    key,
    segmentIndex: 0,
    rounds: [{ round: 1, key: `${key}-round`, blocks }],
    timestamp,
    isFromCompactedSegment: false,
  };
}

test("latest successful historical TodoWrite replaces earlier snapshots", () => {
  const first = [todo("Inspect project", "completed"), todo("Implement panel")];
  const latest = [todo("Implement panel", "completed"), todo("Run verification", "in_progress")];

  const result = todoState.findLatestConversationTodos(
    [
      assistantItem("assistant-1", [todoBlock("todo-1", first)], 10),
      assistantItem("assistant-2", [todoBlock("todo-2", latest)], 20),
    ],
    [],
  );

  assert.deepEqual(result, latest);
});

test("live TodoWrite replaces the historical snapshot", () => {
  const historical = [todo("Old task", "completed")];
  const live = [todo("Current task", "in_progress"), todo("Next task")];

  const result = todoState.findLatestConversationTodos(
    [assistantItem("assistant-1", [todoBlock("todo-1", historical)], 10)],
    [
      {
        round: 2,
        key: "live-round",
        blocks: [todoBlock("todo-live", live, { streaming: true })],
        runningToolCallIds: ["todo-live"],
        thinkingOpen: false,
      },
    ],
  );

  assert.deepEqual(result, live);
});

test("failed and incomplete TodoWrite calls preserve the previous snapshot", () => {
  const historical = [todo("Keep this task", "in_progress")];
  const historyItems = [assistantItem("assistant-1", [todoBlock("todo-1", historical)], 10)];

  const failed = todoState.findLatestConversationTodos(historyItems, [
    {
      round: 2,
      key: "failed-round",
      blocks: [todoBlock("todo-failed", [], { isError: true })],
      runningToolCallIds: [],
      thinkingOpen: false,
    },
  ]);
  const incomplete = todoState.findLatestConversationTodos(historyItems, [
    {
      round: 2,
      key: "partial-round",
      blocks: [
        todoBlock("todo-partial", [], {
          streaming: true,
          arguments: { todos: [{ content: "Partial" }] },
        }),
      ],
      runningToolCallIds: ["todo-partial"],
      thinkingOpen: false,
    },
  ]);

  assert.deepEqual(failed, historical);
  assert.deepEqual(incomplete, historical);
});

test("a successful empty TodoWrite clears the conversation task list", () => {
  const historical = [todo("Finished task", "completed")];

  const result = todoState.findLatestConversationTodos(
    [
      assistantItem("assistant-1", [todoBlock("todo-1", historical)], 10),
      assistantItem("assistant-2", [todoBlock("todo-clear", [])], 20),
    ],
    [],
  );

  assert.deepEqual(result, []);
  assert.equal(todoState.findLatestConversationTodos([], []), null);
});
