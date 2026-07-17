import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createHookHarness() {
  const refs = [];
  const effects = [];
  let refIndex = 0;
  let effectIndex = 0;

  const react = {
    useRef(initialValue) {
      const index = refIndex++;
      refs[index] ??= { current: initialValue };
      return refs[index];
    },
    useEffect(effect, deps) {
      const index = effectIndex++;
      const previous = effects[index];
      const changed =
        !previous ||
        deps.length !== previous.deps.length ||
        deps.some((value, depIndex) => value !== previous.deps[depIndex]);
      if (!changed) return;
      previous?.cleanup?.();
      effects[index] = { deps: [...deps], cleanup: effect() };
    },
  };

  return {
    react,
    render(run) {
      refIndex = 0;
      effectIndex = 0;
      run();
    },
    cleanup() {
      for (const effect of effects) {
        effect?.cleanup?.();
      }
    },
  };
}

function createEventTarget() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(name, handler) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler);
      handlers.set(name, set);
    },
    removeEventListener(name, handler) {
      handlers.get(name)?.delete(handler);
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("gateway bridge listener keeps one worker across renders and handles native wake immediately", async () => {
  const hookHarness = createHookHarness();
  const invokeCalls = [];
  const registrations = [];
  const windowEvents = createEventTarget();
  const documentEvents = createEventTarget();
  let nextTimerId = 1;
  const timers = new Map();

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    ...windowEvents,
    setInterval(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    setTimeout,
    clearTimeout,
  };
  globalThis.document = {
    ...documentEvents,
    visibilityState: "visible",
  };

  try {
    const loader = createTsModuleLoader({
      mocks: {
        react: hookHarness.react,
        "@tauri-apps/api/core": {
          async invoke(command, payload) {
            invokeCalls.push({ command, payload });
            if (command === "gateway_chat_claim_next") return null;
            return undefined;
          },
        },
        "@tauri-apps/api/event": {
          listen(name, handler) {
            let resolve;
            const promise = new Promise((next) => {
              resolve = next;
            });
            registrations.push({ name, handler, resolve, disposed: false });
            return promise;
          },
        },
        "../../../lib/settings": {
          normalizeChatRuntimeControls(value) {
            return value;
          },
          normalizeSystemToolSelection(value) {
            return Array.isArray(value) ? value : [];
          },
        },
      },
    });
    const { useGatewayBridgeListeners } = loader.loadModule(
      "src/pages/chat/gateway/useGatewayBridgeListeners.ts",
    );

    const currentConversationIdRef = { current: "conversation-1" };
    const ensureGatewayBridgeConversationReadyRef = {
      current: async (id) => id || "conversation-1",
    };
    const sendActionRef = { current: async () => true };
    let firstAbortCalls = 0;
    let secondAbortCalls = 0;
    const baseParams = {
      currentConversationIdRef,
      conversationRuntimeCacheRef: { current: new Map() },
      ensureGatewayBridgeConversationReadyRef,
      sendActionRef,
      queueGatewayBridgeEventForRequest() {},
      shouldQueueGatewayChatRequest() {
        return false;
      },
      async enqueueGatewayChatRequest() {
        return false;
      },
      isConversationRunning() {
        return false;
      },
      getConversationAbortController() {
        return { abort: () => firstAbortCalls++ };
      },
    };

    hookHarness.render(() => useGatewayBridgeListeners(baseParams));

    assert.ok(
      invokeCalls.some((call) => call.command === "gateway_chat_claim_next"),
      "the inbox must drain before async listen registration resolves",
    );
    assert.equal(registrations.length, 4);
    assert.ok(registrations.some((entry) => entry.name === "gateway:chat-runtime-wake"));

    for (const registration of registrations) {
      registration.resolve(() => {
        registration.disposed = true;
      });
    }
    await flushPromises();

    const runtimeHeartbeatsBeforeRender = invokeCalls.filter(
      (call) => call.command === "gateway_chat_runtime_heartbeat",
    );
    assert.ok(runtimeHeartbeatsBeforeRender.length > 0);
    const workerId = runtimeHeartbeatsBeforeRender[0].payload.worker_id;

    hookHarness.render(() =>
      useGatewayBridgeListeners({
        ...baseParams,
        shouldQueueGatewayChatRequest() {
          return true;
        },
        async enqueueGatewayChatRequest() {
          return true;
        },
        getConversationAbortController() {
          return { abort: () => secondAbortCalls++ };
        },
      }),
    );

    assert.equal(registrations.length, 4, "callback identity changes must not remount listeners");
    assert.ok(registrations.every((entry) => entry.disposed === false));

    const claimsBeforeWake = invokeCalls.filter(
      (call) => call.command === "gateway_chat_claim_next",
    ).length;
    registrations.find((entry) => entry.name === "gateway:chat-runtime-wake").handler({
      payload: { reason: "prepare" },
    });
    await flushPromises();
    const claimsAfterWake = invokeCalls.filter(
      (call) => call.command === "gateway_chat_claim_next",
    ).length;
    assert.ok(claimsAfterWake > claimsBeforeWake);

    registrations.find((entry) => entry.name === "gateway:chat-cancel").handler({
      payload: { requestId: "request-1", conversationId: "conversation-1" },
    });
    assert.equal(firstAbortCalls, 0);
    assert.equal(secondAbortCalls, 1, "listeners must dispatch through the latest callback refs");

    const runtimeWorkerIds = invokeCalls
      .filter((call) => call.command === "gateway_chat_runtime_heartbeat")
      .map((call) => call.payload.worker_id);
    assert.ok(runtimeWorkerIds.every((candidate) => candidate === workerId));

    hookHarness.cleanup();
    const finalHeartbeat = invokeCalls
      .filter((call) => call.command === "gateway_chat_runtime_heartbeat")
      .at(-1);
    assert.equal(finalHeartbeat.payload.worker_id, workerId);
    assert.equal(finalHeartbeat.payload.state, "suspended");
    assert.ok(registrations.every((entry) => entry.disposed === true));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
