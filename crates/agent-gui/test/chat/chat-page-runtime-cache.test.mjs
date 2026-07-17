import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const llmModulePath = path.join(rootDir, "src/lib/providers/llm.ts");

const loader = createTsModuleLoader({
  mocks: {
    [llmModulePath]: {
      normalizeErrorMessage(value, fallback = "Request failed") {
        return typeof value === "string" && value.trim() ? value.trim() : fallback;
      },
    },
  },
});

const {
  pruneIdleConversationRuntimeCaches,
  setConversationRuntimeCacheEntry,
} = loader.loadModule("src/pages/chat/runtime/chatPageRuntime.ts");

function createEntry(id, options = {}) {
  return {
    state: {
      id,
      meta: {
        totalMessageCount: options.messageCount ?? 0,
      },
    },
    compactionStatus: { phase: "idle" },
    isSending: Boolean(options.isSending),
    errorMessage: null,
    hookWarning: null,
    sessionId: `${id}-session`,
    createdAt: 1,
  };
}

function createState(id) {
  return {
    id,
    meta: {
      totalMessageCount: 1,
    },
  };
}

test("pruneIdleConversationRuntimeCaches evicts oldest idle runtime entries", () => {
  const runtimeCache = new Map();
  const persistedStateCache = new Map();
  for (const id of ["a", "b", "c", "d"]) {
    setConversationRuntimeCacheEntry(runtimeCache, id, createEntry(id));
    persistedStateCache.set(id, createState(id));
  }
  const pruned = [];

  const result = pruneIdleConversationRuntimeCaches({
    runtimeCache,
    persistedStateCache,
    maxIdleEntries: 2,
    onPruneConversation: (id) => pruned.push(id),
  });

  assert.deepEqual(result, ["a", "b"]);
  assert.deepEqual(pruned, ["a", "b"]);
  assert.deepEqual([...runtimeCache.keys()], ["c", "d"]);
  assert.deepEqual([...persistedStateCache.keys()], ["c", "d"]);
});

test("pruneIdleConversationRuntimeCaches keeps visible and running conversations", () => {
  const runtimeCache = new Map();
  const persistedStateCache = new Map();
  setConversationRuntimeCacheEntry(runtimeCache, "visible", createEntry("visible"));
  setConversationRuntimeCacheEntry(
    runtimeCache,
    "sending",
    createEntry("sending", { isSending: true }),
  );
  setConversationRuntimeCacheEntry(runtimeCache, "old-idle", createEntry("old-idle"));
  setConversationRuntimeCacheEntry(runtimeCache, "running", createEntry("running"));
  setConversationRuntimeCacheEntry(runtimeCache, "new-idle", createEntry("new-idle"));
  for (const id of runtimeCache.keys()) {
    persistedStateCache.set(id, createState(id));
  }

  const result = pruneIdleConversationRuntimeCaches({
    runtimeCache,
    persistedStateCache,
    keepConversationIds: ["visible"],
    isConversationRunning: (id) => id === "running",
    maxIdleEntries: 1,
  });

  assert.deepEqual(result, ["old-idle"]);
  assert.deepEqual(
    [...runtimeCache.keys()],
    ["visible", "sending", "running", "new-idle"],
  );
  assert.deepEqual(
    [...persistedStateCache.keys()],
    ["visible", "sending", "running", "new-idle"],
  );
});

test("setConversationRuntimeCacheEntry refreshes LRU order", () => {
  const runtimeCache = new Map();
  const persistedStateCache = new Map();
  for (const id of ["a", "b", "c"]) {
    setConversationRuntimeCacheEntry(runtimeCache, id, createEntry(id));
    persistedStateCache.set(id, createState(id));
  }
  setConversationRuntimeCacheEntry(runtimeCache, "a", createEntry("a", { messageCount: 2 }));

  const result = pruneIdleConversationRuntimeCaches({
    runtimeCache,
    persistedStateCache,
    maxIdleEntries: 2,
  });

  assert.deepEqual(result, ["b"]);
  assert.deepEqual([...runtimeCache.keys()], ["c", "a"]);
  assert.deepEqual([...persistedStateCache.keys()], ["a", "c"]);
});

test("pruneIdleConversationRuntimeCaches removes unprotected persisted-only states", () => {
  const runtimeCache = new Map();
  const persistedStateCache = new Map([
    ["visible", createState("visible")],
    ["stale-a", createState("stale-a")],
    ["stale-b", createState("stale-b")],
  ]);
  setConversationRuntimeCacheEntry(runtimeCache, "visible", createEntry("visible"));

  const result = pruneIdleConversationRuntimeCaches({
    runtimeCache,
    persistedStateCache,
    keepConversationIds: ["visible"],
  });

  assert.deepEqual(result, ["stale-a", "stale-b"]);
  assert.deepEqual([...runtimeCache.keys()], ["visible"]);
  assert.deepEqual([...persistedStateCache.keys()], ["visible"]);
});
