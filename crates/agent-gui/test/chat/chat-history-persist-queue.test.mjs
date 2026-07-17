import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createInvokeRecorder() {
  const calls = [];
  return {
    calls,
    invoke(cmd, args) {
      const deferred = createDeferred();
      calls.push({ cmd, args, deferred });
      return deferred.promise;
    },
  };
}

function loadChatHistory(invoke) {
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": { invoke },
    },
  });
  return loader.loadModule("src/lib/chat/history/chatHistory.ts");
}

function segment(index, overrides = {}) {
  return {
    segmentIndex: index,
    segmentId: `seg-${index}`,
    messages: [],
    messageCount: 0,
    createdAt: 100 + index,
    updatedAt: 100 + index,
    ...overrides,
  };
}

function buildState(segments, activeSegmentIndex) {
  return {
    meta: {
      schemaVersion: 3,
      systemPrompt: "prompt",
      activeSegmentIndex,
      totalSegmentCount: segments.length,
      totalMessageCount: segments.reduce((sum, seg) => sum + seg.messageCount, 0),
    },
    segments,
    historyRenderItems: [],
    activeSegmentIndex,
  };
}

function summaryFor(updatedAt) {
  return {
    id: "conv-1",
    title: "对话",
    providerId: "anthropic",
    model: "claude",
    createdAt: 1,
    updatedAt,
  };
}

function persistParams(previousRef, state) {
  return {
    conversationId: "conv-1",
    providerId: "anthropic",
    model: "claude",
    title: "对话",
    updatedAt: 1,
    state,
    getPreviousState: () => previousRef.current,
    commitPersistedState: (persisted) => {
      previousRef.current = persisted;
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

const seg0 = segment(0, { messageCount: 2, endMessageId: "m-2" });
const stateA = buildState([seg0], 0);
const stateB = buildState([seg0, segment(1, { messageCount: 1 })], 1);
const stateC = buildState([seg0, segment(1, { messageCount: 3, updatedAt: 205 })], 1);

test("overlapping persists serialize and the later one diffs against the committed state", async () => {
  const recorder = createInvokeRecorder();
  const chatHistory = loadChatHistory(recorder.invoke);
  const previousRef = { current: stateA };

  const first = chatHistory.persistConversationState(persistParams(previousRef, stateB));
  const second = chatHistory.persistConversationState(persistParams(previousRef, stateC));
  await flush();

  // 第二个持久化必须等第一个完成（含基线推进），不得并发发起 IPC。
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].cmd, "chat_history_append_segment");
  assert.equal(recorder.calls[0].args.input.segment.segmentId, "seg-1");

  recorder.calls[0].deferred.resolve(summaryFor(10));
  await flush();

  // C 对比的是已落盘的 B（同形状 → active upsert），而不是过期的 A（会误判为 append）。
  assert.equal(recorder.calls.length, 2);
  assert.equal(recorder.calls[1].cmd, "chat_history_upsert_active_segment");
  assert.equal(recorder.calls[1].args.input.segment.messageCount, 3);

  recorder.calls[1].deferred.resolve(summaryFor(11));
  await first;
  await second;
  assert.equal(previousRef.current, stateC);
});

test("failed persist does not advance the baseline; the next diff retries from the last committed state", async () => {
  const recorder = createInvokeRecorder();
  const chatHistory = loadChatHistory(recorder.invoke);
  const previousRef = { current: stateA };

  const first = chatHistory.persistConversationState(persistParams(previousRef, stateB));
  await flush();
  assert.equal(recorder.calls[0].cmd, "chat_history_append_segment");
  recorder.calls[0].deferred.reject(new Error("db busy"));
  await assert.rejects(first, /db busy/);
  assert.equal(previousRef.current, stateA);

  const second = chatHistory.persistConversationState(persistParams(previousRef, stateC));
  await flush();
  assert.equal(recorder.calls.length, 2);
  assert.equal(recorder.calls[1].cmd, "chat_history_append_segment");
  recorder.calls[1].deferred.resolve(summaryFor(12));
  await second;
  assert.equal(previousRef.current, stateC);
});

test("persist without a previous state falls back to a full upsert", async () => {
  const recorder = createInvokeRecorder();
  const chatHistory = loadChatHistory(recorder.invoke);
  const previousRef = { current: null };

  const persist = chatHistory.persistConversationState(persistParams(previousRef, stateB));
  await flush();
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].cmd, "chat_history_upsert");
  assert.equal(recorder.calls[0].args.input.segments.length, 2);

  recorder.calls[0].deferred.resolve(summaryFor(13));
  await persist;
  assert.equal(previousRef.current, stateB);
});

test("history mutations share the same per-conversation lock as state persists", async () => {
  const recorder = createInvokeRecorder();
  const chatHistory = loadChatHistory(recorder.invoke);
  const previousRef = { current: stateA };

  const persist = chatHistory.persistConversationState(persistParams(previousRef, stateB));
  const rename = chatHistory.renameChatHistory("conv-1", "新标题");
  await flush();

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].cmd, "chat_history_append_segment");

  recorder.calls[0].deferred.resolve(summaryFor(14));
  await flush();
  assert.equal(recorder.calls.length, 2);
  assert.equal(recorder.calls[1].cmd, "chat_history_rename");

  recorder.calls[1].deferred.resolve(summaryFor(15));
  await persist;
  await rename;
});
