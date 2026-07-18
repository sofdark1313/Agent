import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const loader = createWebModuleLoader();
const { ConversationStreamClient } = loader.loadModule(
  "src/lib/chat/stream/conversationStreamClient.ts",
);

function createTransport() {
  const calls = [];
  let responder = () => ({});
  return {
    calls,
    setResponder(fn) {
      responder = fn;
    },
    request(type, payload, options) {
      calls.push({ type, payload, options });
      return Promise.resolve(responder(type, payload));
    },
  };
}

function subscribeResponse(overrides = {}) {
  return {
    conversation_id: "conv-1",
    stream_epoch: "epoch-1",
    latest_seq: 0,
    reset: false,
    activity: null,
    snapshot: null,
    events: [],
    ...overrides,
  };
}

function collectHandlers() {
  const seen = { syncs: [], events: [] };
  return {
    seen,
    handlers: {
      onSync(result) {
        seen.syncs.push(result);
      },
      onEvent(event) {
        seen.events.push(event);
      },
    },
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

function waitFor(predicate, label, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

test("subscribes with resume cursor and re-subscribes after reconnect", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();

  transport.setResponder(() => subscribeResponse({ latest_seq: 4 }));
  client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();

  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].type, "chat.subscribe");
  assert.equal(transport.calls[0].payload.after_seq, 0);
  assert.equal(transport.calls[0].options.timeoutMs, 5_000);
  assert.equal(seen.syncs.length, 1);

  // Live events advance the cursor.
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", run_id: "run-1", seq: 5, text: "a" });
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", run_id: "run-1", seq: 6, text: "b" });
  assert.equal(seen.events.length, 2);

  // Disconnect + reconnect: the registration survives and resumes from seq 6
  // with the stream epoch.
  client.handleDisconnected();
  transport.setResponder(() => subscribeResponse({ latest_seq: 8, events: [
    { type: "token", conversation_id: "conv-1", run_id: "run-1", seq: 7, text: "c" },
    { type: "token", conversation_id: "conv-1", run_id: "run-1", seq: 8, text: "d" },
  ] }));
  client.handleConnected();
  await flushMicrotasks();

  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[1].payload.after_seq, 6);
  assert.equal(transport.calls[1].payload.stream_epoch, "epoch-1");
  assert.equal(seen.syncs.length, 2);
  assert.equal(seen.syncs[1].events.length, 2);
});

test("duplicate and stale seqs are dropped; gaps trigger a resync", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();

  transport.setResponder(() => subscribeResponse({ latest_seq: 2 }));
  client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();

  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 2, text: "dup" });
  assert.equal(seen.events.length, 0, "stale seq dropped");

  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 3, text: "ok" });
  assert.equal(seen.events.length, 1);

  transport.setResponder(() => subscribeResponse({ latest_seq: 9, events: [] }));
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 9, text: "gap" });
  await flushMicrotasks();
  assert.equal(seen.events.length, 1, "gapped event not delivered directly");
  assert.equal(
    transport.calls.filter((call) => call.type === "chat.subscribe").length,
    2,
    "gap triggered a resync",
  );
});

test("events racing ahead of the subscribe response are buffered, then drained", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  transport.setResponder(() => gate.then(() => subscribeResponse({ latest_seq: 1 })));

  client.subscribe("conv-1", handlers);
  client.handleConnected();

  // Pushes arrive while the subscribe response is still in flight.
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 2, text: "early" });
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 3, text: "birds" });
  assert.equal(seen.events.length, 0);

  release();
  await flushMicrotasks();
  assert.equal(seen.syncs.length, 1);
  assert.deepEqual(
    seen.events.map((event) => event.text),
    ["early", "birds"],
  );
});

test("seq-less events (snapshot pushes) pass through without cursor changes", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();

  transport.setResponder(() => subscribeResponse({ latest_seq: 5 }));
  client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();

  client.handleChatEvent({ type: "snapshot", conversation_id: "conv-1", run_id: "run-1", entries_json: "[]" });
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 6, text: "next" });
  assert.deepEqual(
    seen.events.map((event) => event.type),
    ["snapshot", "token"],
  );
});

test("subscription_reset resumes from the cursor; cleanup unsubscribes", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { handlers } = collectHandlers();

  transport.setResponder(() => subscribeResponse({ latest_seq: 3 }));
  const cleanup = client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();

  client.handleSubscriptionReset({ conversation_id: "conv-1" });
  await flushMicrotasks();
  const subscribes = transport.calls.filter((call) => call.type === "chat.subscribe");
  assert.equal(subscribes.length, 2);
  assert.equal(subscribes[1].payload.after_seq, 3);

  assert.equal(client.size, 1);
  cleanup();
  await flushMicrotasks();
  assert.equal(client.size, 0);
  assert.equal(
    transport.calls.filter((call) => call.type === "chat.unsubscribe").length,
    1,
  );
});

test("disconnect clears events buffered before the subscribe response", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  transport.setResponder(() => gate.then(() => subscribeResponse({ latest_seq: 1 })));
  client.subscribe("conv-1", handlers);
  client.handleConnected();

  // Events buffered while the subscribe response is in flight belong to the
  // dying connection; after a disconnect the resume protocol re-fetches
  // everything, so draining them later would corrupt the transcript.
  client.handleChatEvent({ type: "token", conversation_id: "conv-1", seq: 2, text: "stale" });
  client.handleDisconnected();

  transport.setResponder(() => subscribeResponse({ latest_seq: 3 }));
  client.handleConnected();
  release();
  await flushMicrotasks();

  assert.equal(seen.events.length, 0, "stale buffered events were dropped");
  assert.equal(seen.syncs.length, 1, "the stale pre-disconnect response was ignored");
  assert.equal(seen.syncs[0].latestSeq, 3);
});

test("handleConnected is idempotent for the same authenticated connection", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { handlers } = collectHandlers();

  transport.setResponder(() => subscribeResponse({ latest_seq: 1 }));
  client.subscribe("conv-1", handlers);
  client.handleConnected();
  client.handleConnected();
  await flushMicrotasks();

  assert.equal(
    transport.calls.filter((call) => call.type === "chat.subscribe").length,
    1,
  );
});

test("failed subscribe retries on the current connection and drains buffered pushes", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { seen, handlers } = collectHandlers();
  let attempt = 0;

  transport.setResponder(() => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error("temporary subscribe failure");
    }
    return subscribeResponse({ latest_seq: 1 });
  });
  client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();

  client.handleChatEvent({
    type: "token",
    conversation_id: "conv-1",
    run_id: "run-1",
    seq: 2,
    text: "recovered",
  });
  await waitFor(
    () => transport.calls.filter((call) => call.type === "chat.subscribe").length === 2,
    "subscribe retry",
  );
  await flushMicrotasks();

  assert.equal(seen.syncs.length, 1);
  assert.deepEqual(seen.events.map((event) => event.text), ["recovered"]);
});

test("disconnect and cleanup cancel scheduled subscribe retries", async () => {
  const transport = createTransport();
  const client = new ConversationStreamClient(transport);
  const { handlers } = collectHandlers();

  transport.setResponder(() => {
    throw new Error("temporary subscribe failure");
  });
  const cleanup = client.subscribe("conv-1", handlers);
  client.handleConnected();
  await flushMicrotasks();
  assert.equal(transport.calls.length, 1);

  client.handleDisconnected();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(transport.calls.length, 1, "no retry fires after disconnect/cleanup");
});
