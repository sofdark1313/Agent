import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(raw) {
    this.sent.push(typeof raw === "string" ? JSON.parse(raw) : raw);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(envelope) {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }

  receiveRaw(data) {
    this.onmessage?.({ data });
  }

  close(event = {}) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({
      code: event.code ?? 1006,
      reason: event.reason ?? "",
      wasClean: event.wasClean ?? false,
    });
  }
}

function installBrowser(options = {}) {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  delete globalThis.SharedWorker;
  const windowListeners = new Map();
  const documentListeners = new Map();
  const addListener = (listeners, type, listener) => {
    const items = listeners.get(type) ?? new Set();
    items.add(listener);
    listeners.set(type, items);
  };
  const removeListener = (listeners, type, listener) => {
    listeners.get(type)?.delete(listener);
  };
  const dispatch = (listeners, event) => {
    const type = event?.type;
    if (typeof type !== "string") return;
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };
  globalThis.window = {
    location: { origin: "https://gateway.example" },
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout: options.clearTimeout ?? clearTimeout,
    setInterval: options.setInterval ?? setInterval,
    clearInterval: options.clearInterval ?? clearInterval,
    addEventListener: (type, listener) => addListener(windowListeners, type, listener),
    removeEventListener: (type, listener) => removeListener(windowListeners, type, listener),
    dispatchEvent: (event) => {
      dispatch(windowListeners, event);
      return true;
    },
  };
  globalThis.document = {
    visibilityState: options.visibilityState ?? "visible",
    addEventListener: (type, listener) => addListener(documentListeners, type, listener),
    removeEventListener: (type, listener) => removeListener(documentListeners, type, listener),
    dispatchEvent: (event) => {
      dispatch(documentListeners, event);
      return true;
    },
  };
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 500) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

async function connectAndAuth(index = 0) {
  await waitFor(() => FakeWebSocket.instances.length > index, "websocket construction");
  const socket = FakeWebSocket.instances[index];
  socket.open();
  await waitFor(() => socket.sent.length >= 1, "auth envelope");
  assert.equal(socket.url, "wss://gateway.example/ws");
  assert.equal(socket.sent[0].type, "auth");
  assert.deepEqual(socket.sent[0].payload, { token: "token" });
  socket.receive({ id: socket.sent[0].id, type: "response", payload: { ok: true } });
  return socket;
}

function encodeTerminalStreamFrame(header, data = new Uint8Array()) {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const payload = new Uint8Array(4 + headerBytes.byteLength + data.byteLength);
  payload[0] = 1;
  payload[1] = { attach: 1, input: 2, resize: 3, detach: 4, output: 5, snapshot: 6, error: 7 }[
    header.kind
  ] ?? 0;
  new DataView(payload.buffer).setUint16(2, headerBytes.byteLength, false);
  payload.set(headerBytes, 4);
  payload.set(data, 4 + headerBytes.byteLength);
  return payload;
}

function decodeTerminalStreamFrame(payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  assert.equal(bytes[0], 1);
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    2,
    false,
  );
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;
  return {
    header: JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerEnd))),
    data: bytes.slice(headerEnd),
  };
}

test("GatewayWebSocketClient authenticates once and sends status requests over /ws", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient(" token ");
  const statusPromise = client.getStatus();
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "status envelope");
  assert.equal(socket.sent[1].type, "status.get");
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { online: true, agent_id: "desktop-agent" },
  });

  const status = await statusPromise;
  assert.deepEqual(status, { online: true, agent_id: "desktop-agent" });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient bounds the complete WebSocket connection attempt", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statusResult = assert.rejects(
    client.getStatus(),
    /Gateway WebSocket connection timed out/,
  );
  await waitFor(() => FakeWebSocket.instances.length === 1, "connecting websocket");
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.readyState, FakeWebSocket.CONNECTING);

  timers.fire((timer) => timer.ms === 10_000);
  await statusResult;
  assert.equal(socket.readyState, FakeWebSocket.CLOSED, "timed-out attempt was abandoned");
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends chat.prepare with the caller reason", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const preparePromise = client.prepareChatRuntime("composer-focus");
  const socket = await connectAndAuth();
  await waitFor(
    () => socket.sent.some((item) => item.type === "chat.prepare"),
    "chat.prepare envelope",
  );
  const prepareRequest = socket.sent.find((item) => item.type === "chat.prepare");
  assert.deepEqual(prepareRequest.payload, { reason: "composer-focus" });
  socket.receive({
    id: prepareRequest.id,
    type: "response",
    payload: { online: true, chat_runtime_ready: true, runtime_state: "ready" },
  });

  assert.deepEqual(await preparePromise, {
    online: true,
    chat_runtime_ready: true,
    runtime_state: "ready",
  });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient falls back to status.get when chat.prepare is unsupported", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const preparePromise = client.prepareChatRuntime("foreground");
  const socket = await connectAndAuth();
  await waitFor(
    () => socket.sent.some((item) => item.type === "chat.prepare"),
    "chat.prepare envelope",
  );
  const prepareRequest = socket.sent.find((item) => item.type === "chat.prepare");
  socket.receive({ id: prepareRequest.id, type: "error", error: "unsupported request type" });
  await waitFor(
    () => socket.sent.some((item) => item.type === "status.get"),
    "fallback status.get envelope",
  );
  const statusRequest = socket.sent.find((item) => item.type === "status.get");
  socket.receive({ id: statusRequest.id, type: "response", payload: { online: true } });

  assert.deepEqual(await preparePromise, { online: true });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient clears a timed-out prepare so the next wake can retry", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const firstResult = assert.rejects(client.prepareChatRuntime("foreground"), /Gateway/);
  const firstSocket = await connectAndAuth(0);
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "chat.prepare"),
    "first chat.prepare envelope",
  );
  timers.fire((timer) => timer.ms === 2_500);
  await firstResult;

  const secondPrepare = client.prepareChatRuntime("send");
  const secondSocket = await connectAndAuth(1);
  await waitFor(
    () => secondSocket.sent.some((item) => item.type === "chat.prepare"),
    "second chat.prepare envelope",
  );
  const secondRequest = secondSocket.sent.find((item) => item.type === "chat.prepare");
  assert.deepEqual(secondRequest.payload, { reason: "send" });
  secondSocket.receive({
    id: secondRequest.id,
    type: "response",
    payload: { online: true, chat_runtime_ready: true },
  });
  assert.equal((await secondPrepare).chat_runtime_ready, true);
  resetGatewayWebSocketClient();
});

test("BrowserGatewayTerminalStreamClient connects to /ws/terminal and attaches with binary frames", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { BrowserGatewayTerminalStreamClient } = loader.loadModule(
    "src/lib/terminal/gatewayTerminalStreamClient.ts",
  );

  const session = {
    id: "terminal-1",
    projectPathKey: "/workspace/project",
    cwd: "/workspace/project",
    shell: "zsh",
    title: "Terminal 1",
    kind: "local",
    cols: 80,
    rows: 24,
    createdAt: 1,
    updatedAt: 2,
    running: true,
  };
  const client = new BrowserGatewayTerminalStreamClient("token");
  const attachPromise = client.attach(session, { maxBytes: 8192 });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await waitFor(() => socket.sent.length >= 1, "terminal stream auth");
  assert.equal(socket.url, "wss://gateway.example/ws/terminal");
  assert.deepEqual(socket.sent[0], { type: "auth", token: "token" });

  socket.receive({ type: "ready" });
  await waitFor(() => socket.sent.length >= 2, "terminal stream attach frame");
  const attachFrame = decodeTerminalStreamFrame(socket.sent[1]);
  assert.equal(attachFrame.header.kind, "attach");
  assert.equal(attachFrame.header.sessionId, "terminal-1");
  assert.equal(attachFrame.header.projectPathKey, "/workspace/project");
  assert.equal(attachFrame.header.maxBytes, 8192);

  socket.receiveRaw(
    encodeTerminalStreamFrame(
      {
        kind: "snapshot",
        streamId: attachFrame.header.streamId,
        session,
        startOffset: 10,
        endOffset: 13,
      },
      new Uint8Array([112, 119, 100]),
    ).buffer,
  );
  const handle = await attachPromise;
  assert.equal(handle.snapshot.session.id, "terminal-1");
  assert.deepEqual([...handle.snapshot.bytes], [112, 119, 100]);
  assert.equal(handle.snapshot.outputStartOffset, 10);
  handle.dispose();
  client.dispose();
});

test("BrowserGatewayTerminalStreamClient retries attach while desktop stream is offline", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { BrowserGatewayTerminalStreamClient } = loader.loadModule(
    "src/lib/terminal/gatewayTerminalStreamClient.ts",
  );

  const session = {
    id: "terminal-1",
    projectPathKey: "/workspace/project",
    cwd: "/workspace/project",
    shell: "zsh",
    title: "Terminal 1",
    kind: "local",
    cols: 80,
    rows: 24,
    createdAt: 1,
    updatedAt: 2,
    running: true,
  };
  const client = new BrowserGatewayTerminalStreamClient("token");
  const attachPromise = client.attach(session);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await waitFor(() => socket.sent.length >= 1, "terminal stream auth");
  socket.receive({ type: "ready" });
  await waitFor(() => socket.sent.length >= 2, "terminal stream attach frame");
  const firstAttach = decodeTerminalStreamFrame(socket.sent[1]);

  socket.receiveRaw(
    encodeTerminalStreamFrame({
      kind: "error",
      streamId: firstAttach.header.streamId,
      sessionId: "terminal-1",
      error: "desktop agent is offline",
    }).buffer,
  );

  await waitFor(() => socket.sent.length >= 3, "retry terminal stream attach frame");
  const retryAttach = decodeTerminalStreamFrame(socket.sent[2]);
  assert.equal(retryAttach.header.kind, "attach");
  assert.equal(retryAttach.header.streamId, firstAttach.header.streamId);
  assert.equal(retryAttach.header.sessionId, "terminal-1");

  socket.receiveRaw(
    encodeTerminalStreamFrame(
      {
        kind: "snapshot",
        streamId: retryAttach.header.streamId,
        session,
        startOffset: 0,
        endOffset: 2,
      },
      new Uint8Array([111, 107]),
    ).buffer,
  );
  const handle = await attachPromise;
  assert.deepEqual([...handle.snapshot.bytes], [111, 107]);
  handle.dispose();
  client.dispose();
});

test("BrowserGatewayTerminalStreamClient falls back to /ws terminal query when /ws/terminal fails", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { BrowserGatewayTerminalStreamClient } = loader.loadModule(
    "src/lib/terminal/gatewayTerminalStreamClient.ts",
  );

  const session = {
    id: "terminal-1",
    projectPathKey: "/workspace/project",
    cwd: "/workspace/project",
    shell: "zsh",
    title: "Terminal 1",
    kind: "local",
    cols: 80,
    rows: 24,
    createdAt: 1,
    updatedAt: 2,
    running: true,
  };
  const client = new BrowserGatewayTerminalStreamClient("token");
  const attachPromise = client.attach(session);

  await waitFor(() => FakeWebSocket.instances.length >= 1, "primary terminal stream socket");
  const primarySocket = FakeWebSocket.instances[0];
  assert.equal(primarySocket.url, "wss://gateway.example/ws/terminal");
  primarySocket.onerror?.({ type: "error" });

  await waitFor(() => FakeWebSocket.instances.length >= 2, "fallback terminal stream socket");
  const fallbackSocket = FakeWebSocket.instances[1];
  assert.equal(fallbackSocket.url, "wss://gateway.example/ws?terminal=1");
  fallbackSocket.open();
  await waitFor(() => fallbackSocket.sent.length >= 1, "fallback terminal stream auth");
  assert.deepEqual(fallbackSocket.sent[0], { type: "auth", token: "token" });
  fallbackSocket.receive({ type: "ready" });
  await waitFor(() => fallbackSocket.sent.length >= 2, "fallback terminal stream attach frame");
  const attachFrame = decodeTerminalStreamFrame(fallbackSocket.sent[1]);
  fallbackSocket.receiveRaw(
    encodeTerminalStreamFrame({
      kind: "snapshot",
      streamId: attachFrame.header.streamId,
      session,
      startOffset: 0,
      endOffset: 0,
    }).buffer,
  );

  const handle = await attachPromise;
  assert.equal(handle.snapshot.session.id, "terminal-1");
  handle.dispose();
  client.dispose();
});

test("GatewayWebSocketClient sends git requests with workdir and args", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient(" token ");
  const gitPromise = client.gitRequest("diff", "/workspace/project", { mode: "branch" });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((message) => message.type === "git.diff"), "git.diff envelope");
  const request = socket.sent.find((message) => message.type === "git.diff");
  assert.deepEqual(request.payload, {
    workdir: "/workspace/project",
    args: { mode: "branch" },
  });
  socket.receive({
    id: request.id,
    type: "response",
    payload: { patch: "diff --git a/file b/file" },
  });

  assert.deepEqual(await gitPromise, { patch: "diff --git a/file b/file" });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient does not recover mutating git requests", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient(" token ");
  const stagePromise = client.gitRequest("stage", "/workspace/project", { path: "src/main.rs" });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((message) => message.type === "git.stage"), "git.stage envelope");
  socket.close({ code: 1006, wasClean: false });

  await assert.rejects(stagePromise, /Gateway WebSocket disconnected/);
  assert.equal(FakeWebSocket.instances.length, 1);
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends mention query payloads", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const mentionPromise = client.listMentionFiles("/workspace", 200, "src");
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "mentions envelope");
  assert.equal(socket.sent[1].type, "mentions.list");
  assert.deepEqual(socket.sent[1].payload, {
    workdir: "/workspace",
    max_results: 200,
    query: "src",
  });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { entries: [{ path: "src/main.ts", kind: "file" }], truncated: false },
  });

  assert.deepEqual(await mentionPromise, {
    entries: [{ path: "src/main.ts", kind: "file" }],
    truncated: false,
  });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends memory manage payloads", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const memoryPromise = client.memoryManage({
    command: "memory_search",
    args: { query: "Kevin", limit: 3 },
  });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "memory envelope");
  assert.equal(socket.sent[1].type, "memory.manage");
  assert.deepEqual(socket.sent[1].payload, {
    command: "memory_search",
    args: { query: "Kevin", limit: 3 },
  });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { matches: [], usedFallback: false },
  });

  assert.deepEqual(await memoryPromise, { matches: [], usedFallback: false });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient retries recoverable memory manage commands after a clean disconnect", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const updatePromise = client.memoryManage({
    command: "memory_organize_run_update",
    args: {
      runId: "run-1",
      safeApplied: 2,
      trimmedProtocol: {
        manualApplyState: { status: "applied" },
      },
    },
  });

  const firstSocket = await connectAndAuth(0);
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "memory.manage"),
    "initial memory update envelope",
  );
  const firstRequest = firstSocket.sent.find((item) => item.type === "memory.manage");
  assert.deepEqual(firstRequest.payload, {
    command: "memory_organize_run_update",
    args: {
      runId: "run-1",
      safeApplied: 2,
      trimmedProtocol: {
        manualApplyState: { status: "applied" },
      },
    },
  });

  firstSocket.close({ code: 1000, wasClean: true });
  await waitFor(() => FakeWebSocket.instances.length === 2, "memory update recovery websocket");
  const reconnectSocket = FakeWebSocket.instances[1];
  reconnectSocket.open();
  await waitFor(() => reconnectSocket.sent.length >= 1, "memory update recovery auth envelope");
  reconnectSocket.receive({
    id: reconnectSocket.sent[0].id,
    type: "response",
    payload: { ok: true },
  });
  await waitFor(
    () => reconnectSocket.sent.some((item) => item.type === "memory.manage"),
    "retried memory update envelope",
  );

  const retriedRequest = reconnectSocket.sent.find((item) => item.type === "memory.manage");
  assert.deepEqual(retriedRequest.payload, firstRequest.payload);
  const payload = {
    runId: "run-1",
    status: "succeeded",
    trimmedProtocol: {
      manualApplyState: { status: "applied" },
    },
  };
  reconnectSocket.receive({
    id: retriedRequest.id,
    type: "response",
    payload,
  });

  assert.deepEqual(await updatePromise, payload);
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient does not replay memory apply batch after a disconnect", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const applyPromise = client.memoryManage({
    command: "memory_apply_batch",
    args: {
      trigger: "memory-organize",
      decisions: [
        {
          op: "delete",
          slug: "stale-memory",
          scope: "project",
        },
      ],
    },
  });

  const socket = await connectAndAuth(0);
  await waitFor(
    () => socket.sent.some((item) => item.type === "memory.manage"),
    "memory apply envelope",
  );
  socket.close({ code: 1000, wasClean: true });

  await assert.rejects(
    applyPromise,
    /Gateway WebSocket disconnected \(code=1000 clean=true\)/,
  );
  assert.equal(FakeWebSocket.instances.length, 1);
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends skill manage payloads", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const skillPromise = client.manageSkill({
    action: "list",
  });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "skill manage envelope");
  assert.equal(socket.sent[1].type, "skills.manage");
  assert.deepEqual(socket.sent[1].payload, {
    action: "list",
  });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { action: "list", rootDir: "/Users/me/.liveagent/skills", skills: [] },
  });

  assert.deepEqual(await skillPromise, {
    action: "list",
    rootDir: "/Users/me/.liveagent/skills",
    skills: [],
  });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends history list requests", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const listPromise = client.listHistory(2, 50);
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "history list envelope");
  assert.equal(socket.sent[1].type, "history.list");
  assert.deepEqual(socket.sent[1].payload, { page: 2, page_size: 50 });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: {
      conversations: [],
      total_count: 0,
      running_conversations: [
        {
          conversation_id: "conversation-running",
          run_id: "run-running",
          cwd: "/tmp/project-a",
          updated_at: 123,
        },
      ],
    },
  });
  assert.deepEqual(await listPromise, {
    conversations: [],
    total_count: 0,
    running_conversations: [
      {
        conversation_id: "conversation-running",
        run_id: "run-running",
        cwd: "/tmp/project-a",
        updated_at: 123,
      },
    ],
  });

  const sharedListPromise = client.listSharedHistory(1, 25);
  await waitFor(() => socket.sent.length >= 3, "shared history list envelope");
  assert.equal(socket.sent[2].type, "history.shared_list");
  assert.deepEqual(socket.sent[2].payload, { page: 1, page_size: 25 });
  socket.receive({
    id: socket.sent[2].id,
    type: "response",
    payload: { conversations: [], total_count: 0 },
  });
  assert.deepEqual(await sharedListPromise, { conversations: [], total_count: 0 });

  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends project-aware history and fs requests", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const filteredListPromise = client.listHistory(3, 25, { cwd: "/tmp/project-a" });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "filtered history list envelope");
  assert.equal(socket.sent[1].type, "history.list");
  assert.deepEqual(socket.sent[1].payload, {
    page: 3,
    page_size: 25,
    cwd: "/tmp/project-a",
  });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { conversations: [], total_count: 0, running_conversations: [] },
  });
  assert.deepEqual(await filteredListPromise, {
    conversations: [],
    total_count: 0,
    running_conversations: [],
  });

  const chatModeListPromise = client.listHistory(1, 80, { cwdEmpty: true });
  await waitFor(() => socket.sent.length >= 3, "cwd empty history list envelope");
  assert.equal(socket.sent[2].type, "history.list");
  assert.deepEqual(socket.sent[2].payload, {
    page: 1,
    page_size: 80,
    cwd_empty: true,
  });
  socket.receive({
    id: socket.sent[2].id,
    type: "response",
    payload: { conversations: [], total_count: 0, running_conversations: [] },
  });
  assert.deepEqual(await chatModeListPromise, {
    conversations: [],
    total_count: 0,
    running_conversations: [],
  });

  const workdirsPromise = client.listHistoryWorkdirs();
  await waitFor(() => socket.sent.length >= 4, "history workdirs envelope");
  assert.equal(socket.sent[3].type, "history.workdirs");
  assert.deepEqual(socket.sent[3].payload, {});
  socket.receive({
    id: socket.sent[3].id,
    type: "response",
    payload: {
      workdirs: [
        { path: "/tmp/project-a", conversation_count: 2, updated_at: 1700000000300 },
      ],
    },
  });
  assert.deepEqual(await workdirsPromise, {
    workdirs: [
      { path: "/tmp/project-a", conversationCount: 2, updatedAt: 1700000000300 },
    ],
  });

  const createPromise = client.createProjectFolder("/tmp", "Project A");
  await waitFor(() => socket.sent.length >= 5, "create project folder envelope");
  assert.equal(socket.sent[4].type, "fs.create_project_folder");
  assert.deepEqual(socket.sent[4].payload, { parent: "/tmp", name: "Project A" });
  socket.receive({
    id: socket.sent[4].id,
    type: "response",
    payload: { path: "/tmp/Project A" },
  });
  assert.deepEqual(await createPromise, { path: "/tmp/Project A" });

  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient defaults invalid history pagination", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const listPromise = client.listHistory(0, 0);
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "history list envelope");
  assert.equal(socket.sent[1].type, "history.list");
  assert.deepEqual(socket.sent[1].payload, { page: 1, page_size: 80 });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: { conversations: [], total_count: 0, running_conversations: [] },
  });
  assert.deepEqual(await listPromise, {
    conversations: [],
    total_count: 0,
    running_conversations: [],
  });

  const sharedListPromise = client.listSharedHistory(Number.NaN, 500);
  await waitFor(() => socket.sent.length >= 3, "shared history list envelope");
  assert.equal(socket.sent[2].type, "history.shared_list");
  assert.deepEqual(socket.sent[2].payload, { page: 1, page_size: 200 });
  socket.receive({
    id: socket.sent[2].id,
    type: "response",
    payload: { conversations: [], total_count: 0 },
  });
  assert.deepEqual(await sharedListPromise, { conversations: [], total_count: 0 });

  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient sends history share requests", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const getPromise = client.getHistoryShare("conversation-1");
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "history share get envelope");
  assert.equal(socket.sent[1].type, "history.share.get");
  assert.deepEqual(socket.sent[1].payload, {
    conversation_id: "conversation-1",
  });
  socket.receive({
    id: socket.sent[1].id,
    type: "response",
    payload: {
      conversation_id: "conversation-1",
      enabled: false,
      token: "",
      created_at: 0,
      updated_at: 0,
    },
  });
  assert.deepEqual(await getPromise, {
    conversation_id: "conversation-1",
    enabled: false,
    token: "",
    created_at: 0,
    updated_at: 0,
  });

  const setPromise = client.setHistoryShare("conversation-1", true, {
    redactToolContent: true,
  });
  await waitFor(() => socket.sent.length >= 3, "history share set envelope");
  assert.equal(socket.sent[2].type, "history.share.set");
  assert.deepEqual(socket.sent[2].payload, {
    conversation_id: "conversation-1",
    enabled: true,
    redact_tool_content: true,
  });
  socket.receive({
    id: socket.sent[2].id,
    type: "response",
    payload: {
      conversation_id: "conversation-1",
      enabled: true,
      token: "share-token",
      created_at: 10,
      updated_at: 20,
      redact_tool_content: true,
    },
  });
  assert.deepEqual(await setPromise, {
    conversation_id: "conversation-1",
    enabled: true,
    token: "share-token",
    created_at: 10,
    updated_at: 20,
    redact_tool_content: true,
  });

  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient reconnects before read requests when an authenticated socket goes stale", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const realDateNow = Date.now;
  try {
    const client = getGatewayWebSocketClient("token");
    const statusPromise = client.getStatus();
    const firstSocket = await connectAndAuth();
    await waitFor(() => firstSocket.sent.some((item) => item.type === "status.get"), "initial status.get");
    const statusRequest = firstSocket.sent.find((item) => item.type === "status.get");
    firstSocket.receive({
      id: statusRequest.id,
      type: "response",
      payload: { online: true, agent_id: "desktop-agent" },
    });
    await statusPromise;

    let mockNow = realDateNow();
    Date.now = () => mockNow;
    mockNow += 46_000;

    const historyPromise = client.getHistory("conversation-1");
    assert.equal(FakeWebSocket.instances.length, 2);

    Date.now = realDateNow;

    const reconnectSocket = FakeWebSocket.instances[1];
    reconnectSocket.open();
    await waitFor(() => reconnectSocket.sent.length >= 1, "stale reconnect auth envelope");
    reconnectSocket.receive({
      id: reconnectSocket.sent[0].id,
      type: "response",
      payload: { ok: true },
    });
    await waitFor(
      () => reconnectSocket.sent.some((item) => item.type === "history.get"),
      "history request after stale reconnect",
    );

    const historyRequest = reconnectSocket.sent.find((item) => item.type === "history.get");
    assert.deepEqual(historyRequest.payload, {
      conversation_id: "conversation-1",
    });

    const payload = {
      conversation_id: "conversation-1",
      messages_json: "[]",
      total_message_count: 0,
      returned_message_count: 0,
      has_more: false,
    };
    reconnectSocket.receive({
      id: historyRequest.id,
      type: "response",
      payload,
    });

    assert.deepEqual(await historyPromise, payload);
  } finally {
    Date.now = realDateNow;
    resetGatewayWebSocketClient();
  }
});

test("GatewayWebSocketClient retries history.get after a recoverable transport stall timeout", async () => {
  const realSetTimeout = setTimeout;
  installBrowser({
    setTimeout: (fn, delay, ...args) =>
      realSetTimeout(fn, delay >= 30_000 ? 0 : delay, ...args),
  });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const historyPromise = client.getHistory("conversation-1");
  const firstSocket = await connectAndAuth();
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "history.get"),
    "initial history.get envelope",
  );

  await waitFor(() => FakeWebSocket.instances.length === 2, "timeout recovery websocket");
  const reconnectSocket = FakeWebSocket.instances[1];
  reconnectSocket.open();
  await waitFor(() => reconnectSocket.sent.length >= 1, "timeout recovery auth envelope");
  reconnectSocket.receive({
    id: reconnectSocket.sent[0].id,
    type: "response",
    payload: { ok: true },
  });
  await waitFor(
    () => reconnectSocket.sent.some((item) => item.type === "history.get"),
    "retried history.get envelope",
  );

  const historyRequest = reconnectSocket.sent.find((item) => item.type === "history.get");
  const payload = {
    conversation_id: "conversation-1",
    messages_json: "[]",
    total_message_count: 0,
    returned_message_count: 0,
    has_more: false,
  };
  reconnectSocket.receive({
    id: historyRequest.id,
    type: "response",
    payload,
  });

  assert.deepEqual(await historyPromise, payload);
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient suppresses transient recoverable disconnect status errors", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statusEvents = [];
  const unsubscribe = client.subscribeStatus((status, error) => {
    statusEvents.push({ status, error });
  });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((item) => item.type === "status.get"), "status envelope");
  const statusRequest = socket.sent.find((item) => item.type === "status.get");
  socket.receive({
    id: statusRequest.id,
    type: "response",
    payload: { online: true, agent_id: "desktop-agent" },
  });
  await waitFor(
    () => statusEvents.some((event) => event.status?.online === true),
    "online status event",
  );

  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    statusEvents.some((event) =>
      String(event.error ?? "").includes("Gateway WebSocket disconnected"),
    ),
    false,
  );

  unsubscribe();
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient replies to gateway websocket pings", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statusPromise = client.getStatus();
  const socket = await connectAndAuth();
  socket.receive({
    type: "ping",
    payload: { timestamp: 123 },
  });
  await waitFor(() => socket.sent.some((item) => item.type === "pong"), "pong envelope");
  const pong = socket.sent.find((item) => item.type === "pong");
  assert.deepEqual(pong.payload, { timestamp: 123 });

  await waitFor(() => socket.sent.some((item) => item.type === "status.get"), "status envelope");
  const statusRequest = socket.sent.find((item) => item.type === "status.get");
  socket.receive({
    id: statusRequest.id,
    type: "response",
    payload: { online: true, agent_id: "desktop-agent" },
  });
  await statusPromise;
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient chatCommand sends the command envelope and parses the accept response", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const commandPromise = client.chatCommand({
    type: "chat.submit",
    message: "hello",
    conversationId: "conversation-1",
    clientRequestId: "req-1",
    queuePolicy: "append",
    systemSettings: {
      executionMode: "agent",
      workdir: "/workspace/project",
      selectedSystemTools: ["Bash"],
    },
  });
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((item) => item.type === "chat.command"), "chat command envelope");
  const commandEnvelope = socket.sent.find((item) => item.type === "chat.command");
  assert.equal(commandEnvelope.payload.type, "chat.submit");
  assert.equal(commandEnvelope.payload.payload.message, "hello");
  assert.equal(commandEnvelope.payload.payload.conversation_id, "conversation-1");
  assert.equal(commandEnvelope.payload.payload.client_request_id, "req-1");
  assert.equal(commandEnvelope.payload.payload.queue_policy, "append");
  assert.equal(commandEnvelope.payload.payload.workdir, "/workspace/project");

  socket.receive({
    id: commandEnvelope.id,
    type: "response",
    payload: { run_id: " run-1 ", conversation_id: "conversation-1", accepted_seq: 7 },
  });
  assert.deepEqual(await commandPromise, {
    runId: "run-1",
    conversationId: "conversation-1",
    acceptedSeq: 7,
  });
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient reconnects once and retries chatCommand with the same payload", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const commandPromise = client.chatCommand({
    type: "chat.submit",
    message: "retry me",
    conversationId: "conversation-1",
    clientRequestId: "client-retry-1",
  });
  const firstSocket = await connectAndAuth(0);
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "chat.command"),
    "first chat.command envelope",
  );
  const firstCommand = firstSocket.sent.find((item) => item.type === "chat.command");
  firstSocket.close({ code: 1006, wasClean: false });

  const secondSocket = await connectAndAuth(1);
  await waitFor(
    () => secondSocket.sent.some((item) => item.type === "chat.command"),
    "retried chat.command envelope",
  );
  const retriedCommand = secondSocket.sent.find((item) => item.type === "chat.command");
  assert.deepEqual(retriedCommand.payload, firstCommand.payload);
  assert.equal(
    retriedCommand.payload.payload.client_request_id,
    "client-retry-1",
    "retry preserves the idempotency key",
  );
  secondSocket.receive({
    id: retriedCommand.id,
    type: "response",
    payload: { run_id: "run-canonical", conversation_id: "conversation-1", accepted_seq: 3 },
  });

  assert.equal((await commandPromise).runId, "run-canonical");
  assert.equal(FakeWebSocket.instances.length, 2, "only one transparent retry is attempted");
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient uses a short ACK timeout and preserves a generated client id", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const commandPromise = client.chatCommand({
    type: "chat.submit",
    message: "timeout retry",
    conversationId: "conversation-1",
  });
  const firstSocket = await connectAndAuth(0);
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "chat.command"),
    "first chat.command envelope",
  );
  const firstCommand = firstSocket.sent.find((item) => item.type === "chat.command");
  const generatedClientRequestId = firstCommand.payload.payload.client_request_id;
  assert.match(generatedClientRequestId, /^webui-chat\.submit-/);

  timers.fire((timer) => timer.ms === 4_000);
  const secondSocket = await connectAndAuth(1);
  await waitFor(
    () => secondSocket.sent.some((item) => item.type === "chat.command"),
    "ACK-timeout retry envelope",
  );
  const retriedCommand = secondSocket.sent.find((item) => item.type === "chat.command");
  assert.equal(retriedCommand.payload.payload.client_request_id, generatedClientRequestId);
  assert.deepEqual(retriedCommand.payload, firstCommand.payload);
  secondSocket.receive({
    id: retriedCommand.id,
    type: "response",
    payload: { run_id: "run-timeout", conversation_id: "conversation-1", accepted_seq: 1 },
  });

  assert.equal((await commandPromise).runId, "run-timeout");
  resetGatewayWebSocketClient();
});

test("a detached socket's late close cannot tear down its replacement", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const firstStatus = client.getStatus();
  const firstSocket = await connectAndAuth(0);
  await waitFor(
    () => firstSocket.sent.some((item) => item.type === "status.get"),
    "first status request",
  );
  const firstStatusRequest = firstSocket.sent.find((item) => item.type === "status.get");
  firstSocket.receive({
    id: firstStatusRequest.id,
    type: "response",
    payload: { online: true },
  });
  await firstStatus;

  const lateClose = firstSocket.onclose;
  firstSocket.close({ code: 1006, wasClean: false });
  const secondStatus = client.getStatus();
  const secondSocket = await connectAndAuth(1);
  await waitFor(
    () => secondSocket.sent.some((item) => item.type === "status.get"),
    "replacement status request",
  );
  lateClose?.({ code: 1006, reason: "late old close", wasClean: false });
  const secondStatusRequest = secondSocket.sent.find((item) => item.type === "status.get");
  secondSocket.receive({
    id: secondStatusRequest.id,
    type: "response",
    payload: { online: true, session_id: "replacement" },
  });

  assert.equal((await secondStatus).session_id, "replacement");
  assert.equal(FakeWebSocket.instances.length, 2);
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient cancelChat sends chat.cancel with conversation and run ids", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const cancelPromise = client.cancelChat(" conversation-1 ", " run-9 ");
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((item) => item.type === "chat.cancel"), "chat.cancel envelope");
  const cancelEnvelope = socket.sent.find((item) => item.type === "chat.cancel");
  assert.deepEqual(cancelEnvelope.payload, {
    conversation_id: "conversation-1",
    run_id: "run-9",
  });
  socket.receive({ id: cancelEnvelope.id, type: "response", payload: {} });
  await cancelPromise;
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient conversation subscriptions subscribe after auth, route pushes, and survive reconnects", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const seen = { syncs: [], events: [] };
  const cleanup = client.subscribeConversationStream("conversation-1", {
    onSync: (result) => seen.syncs.push(result),
    onEvent: (event) => seen.events.push(event),
  });

  // Authentication is the only connection notification point. Answer each
  // subscribe request with the caller's cursor plus any staged replay events.
  const answeredSubscribes = new Set();
  let replayEvents = [];
  const subscribeCalls = [];
  const answerSubscribes = (socket) => {
    for (const envelope of socket.sent) {
      if (envelope.type !== "chat.subscribe" || answeredSubscribes.has(envelope.id)) {
        continue;
      }
      answeredSubscribes.add(envelope.id);
      subscribeCalls.push(envelope.payload);
      const events = replayEvents;
      replayEvents = [];
      const latestSeq = events.length
        ? events[events.length - 1].seq
        : Math.max(envelope.payload.after_seq ?? 0, 2);
      socket.receive({
        id: envelope.id,
        type: "response",
        payload: {
          conversation_id: "conversation-1",
          stream_epoch: "epoch-1",
          latest_seq: latestSeq,
          reset: false,
          activity: null,
          snapshot: null,
          events,
        },
      });
    }
  };
  const settle = async (socket) => {
    for (let i = 0; i < 20; i += 1) {
      answerSubscribes(socket);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  // Auth completes → the persistent subscription issues chat.subscribe.
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.some((item) => item.type === "chat.subscribe"), "chat.subscribe");
  assert.equal(subscribeCalls.length, 0);
  await settle(socket);
  assert.ok(seen.syncs.length >= 1, "subscribe sync delivered");
  assert.equal(subscribeCalls.length, 1, "initial auth issues exactly one subscribe");
  assert.equal(subscribeCalls[0].conversation_id, "conversation-1");
  assert.equal(subscribeCalls[0].after_seq, 0);

  // chat.event pushes route by conversation id (no subscription id).
  socket.receive({
    type: "chat.event",
    payload: { type: "run_started", conversation_id: "conversation-1", run_id: "run-1", seq: 3 },
  });
  socket.receive({
    type: "chat.event",
    payload: { type: "token", conversation_id: "conversation-1", run_id: "run-1", seq: 4, text: "hi" },
  });
  socket.receive({
    type: "chat.event",
    payload: { type: "token", conversation_id: "conversation-other", run_id: "run-x", seq: 9, text: "ignored" },
  });
  await settle(socket);
  assert.deepEqual(
    seen.events.map((event) => event.type),
    ["run_started", "token"],
  );

  // Disconnect keeps the registration; the reconnect re-subscribes with the
  // resume cursor and stream epoch.
  const syncsBeforeReconnect = seen.syncs.length;
  replayEvents = [
    { type: "token", conversation_id: "conversation-1", run_id: "run-1", seq: 5, text: "re" },
    {
      type: "run_finished",
      conversation_id: "conversation-1",
      run_id: "run-1",
      seq: 6,
      status: "completed",
    },
  ];
  const subscribesBeforeReconnect = subscribeCalls.length;
  socket.close();
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (FakeWebSocket.instances.length >= 2) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 3_000) {
        reject(new Error("timed out waiting for reconnect socket"));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
  const reconnectSocket = await connectAndAuth(1);
  await settle(reconnectSocket);
  assert.ok(seen.syncs.length > syncsBeforeReconnect, "resume sync delivered");
  assert.equal(
    subscribeCalls.length,
    subscribesBeforeReconnect + 1,
    "each reconnect issues exactly one resume subscribe",
  );
  const resumePayload = subscribeCalls[subscribesBeforeReconnect];
  assert.equal(resumePayload.after_seq, 4, "resume cursor from last delivered seq");
  assert.equal(resumePayload.stream_epoch, "epoch-1");
  const resumeSync = seen.syncs[seen.syncs.length - 1];
  assert.deepEqual(
    resumeSync.events.map((event) => event.type),
    ["token", "run_finished"],
    "replayed events delivered with the resume sync",
  );

  // chat.subscription_reset triggers another resync from the cursor.
  const subscribesBeforeReset = subscribeCalls.length;
  reconnectSocket.receive({
    type: "chat.subscription_reset",
    payload: { conversation_id: "conversation-1" },
  });
  await settle(reconnectSocket);
  assert.ok(subscribeCalls.length > subscribesBeforeReset, "reset re-subscribed");
  assert.equal(subscribeCalls[subscribesBeforeReset].after_seq, 6);

  // Cleanup unsubscribes on the wire.
  cleanup();
  await waitFor(
    () => reconnectSocket.sent.some((item) => item.type === "chat.unsubscribe"),
    "chat.unsubscribe",
  );
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient fans chat.activity and chat.command_update out to listeners", async () => {
  installBrowser();
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } = loader.loadModule(
    "src/lib/gatewaySocket.ts",
  );
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const activityEvents = [];
  const commandUpdates = [];
  client.subscribeChatActivity((event) => activityEvents.push(event));
  client.subscribeChatCommandUpdates((update) => commandUpdates.push(update));

  const statusPromise = client.getStatus();
  const socket = await connectAndAuth();
  await waitFor(() => socket.sent.length >= 2, "status envelope");
  socket.receive({ id: socket.sent[1].id, type: "response", payload: { online: true } });
  await statusPromise;

  socket.receive({
    type: "chat.activity",
    payload: {
      conversation_id: "conversation-1",
      run_id: "run-1",
      running: true,
      state: "running",
      workdir: "/workspace/project",
      client_request_id: "req-42",
      updated_at: 1234,
    },
  });
  socket.receive({
    type: "chat.activity",
    payload: { conversation_id: "", running: true },
  });
  assert.equal(activityEvents.length, 1, "malformed activity payloads are dropped");
  assert.deepEqual(activityEvents[0], {
    conversationId: "conversation-1",
    runId: "run-1",
    running: true,
    state: "running",
    workdir: "/workspace/project",
    clientRequestId: "req-42",
    updatedAt: 1234,
  });

  socket.receive({
    type: "chat.command_update",
    payload: {
      run_id: "run-1",
      client_request_id: "req-1",
      conversation_id: "conversation-9",
      phase: "bound",
    },
  });
  socket.receive({
    type: "chat.command_update",
    payload: { run_id: "run-1", phase: "unknown-phase" },
  });
  assert.equal(commandUpdates.length, 1, "unknown phases are dropped");
  assert.deepEqual(commandUpdates[0], {
    runId: "run-1",
    clientRequestId: "req-1",
    conversationId: "conversation-9",
    phase: "bound",
    errorCode: null,
    message: null,
  });
  resetGatewayWebSocketClient();
});

function createManualTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout: (fn, ms = 0) => {
      const id = nextId++;
      timers.set(id, { fn, ms, kind: "timeout" });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    setInterval: (fn, ms = 0) => {
      const id = nextId++;
      timers.set(id, { fn, ms, kind: "interval" });
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
    fire: (predicate) => {
      for (const [id, timer] of [...timers]) {
        if (!predicate(timer)) continue;
        if (timer.kind === "timeout") timers.delete(id);
        timer.fn();
      }
    },
    delays: () => [...timers.values()].map((timer) => timer.ms),
  };
}

test("GatewayWebSocketClient applies pushed status.event frames and polls slowly as fallback", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statuses = [];
  client.subscribeStatus((status, error) => {
    statuses.push({ status, error });
  });
  assert.ok(
    timers.delays().includes(30_000),
    `status poll interval registered at 30s, got delays ${JSON.stringify(timers.delays())}`,
  );

  const socket = await connectAndAuth();
  // The initial poll fired by subscribeStatus rides the fresh socket.
  await waitFor(
    () => socket.sent.some((envelope) => envelope.type === "status.get"),
    "initial status.get",
  );

  socket.receive({
    type: "status.event",
    payload: { online: true, agent_id: "desktop-agent" },
  });
  assert.equal(statuses.at(-1)?.status?.online, true, "pushed status.event reaches listeners");
  assert.equal(statuses.at(-1)?.error, null);

  socket.receive({ type: "status.event", payload: { online: false } });
  assert.equal(statuses.at(-1)?.status?.online, false, "offline push reaches listeners");
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient defers offline verdicts while hidden and reconciles on wake", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statuses = [];
  client.subscribeStatus((status, error) => {
    statuses.push({ status, error });
  });
  const socket = await connectAndAuth();
  socket.receive({ type: "status.event", payload: { online: true } });
  assert.equal(statuses.at(-1)?.status?.online, true);

  // Tab goes hidden, then the socket drops (e.g. the browser froze the page
  // long enough for a proxy to cut the link).
  globalThis.document.visibilityState = "hidden";
  const offlineCountBefore = statuses.filter((s) => s.status?.online === false).length;
  socket.close();

  // The 15s reconnect notice fires while hidden: no offline paint.
  timers.fire((timer) => timer.ms === 15_000);
  assert.equal(
    statuses.filter((s) => s.status?.online === false).length,
    offlineCountBefore,
    "hidden tab must not paint offline from throttled timers",
  );

  // Tab returns: wake handler reconnects; the offline verdict stays deferred
  // until the post-wake reconnect + status refresh settles.
  globalThis.document.visibilityState = "visible";
  globalThis.document.dispatchEvent({ type: "visibilitychange" });
  timers.fire((timer) => timer.ms === 0); // armed reconnect timer
  const socket2 = await connectAndAuth(1);
  await waitFor(
    () => socket2.sent.some((envelope) => envelope.type === "status.get"),
    "post-wake status refresh",
  );
  const statusReq = socket2.sent.find((envelope) => envelope.type === "status.get");
  socket2.receive({ id: statusReq.id, type: "response", payload: { online: true } });
  await waitFor(() => statuses.at(-1)?.status?.online === true, "post-wake online status");
  assert.equal(
    statuses.filter((s) => s.status?.online === false).length,
    offlineCountBefore,
    "successful wake reconcile never flashed offline",
  );
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient paints offline when the post-wake reconnect notice expires visible", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  const statuses = [];
  client.subscribeStatus((status, error) => {
    statuses.push({ status, error });
  });
  const socket = await connectAndAuth();
  socket.receive({ type: "status.event", payload: { online: true } });

  globalThis.document.visibilityState = "hidden";
  socket.close();
  timers.fire((timer) => timer.ms === 15_000);
  assert.ok(!statuses.some((s) => s.status?.online === false), "no offline while hidden");

  globalThis.document.visibilityState = "visible";
  globalThis.document.dispatchEvent({ type: "visibilitychange" });
  // Reconnect never succeeds; the re-armed notice expires while visible.
  timers.fire((timer) => timer.ms === 15_000);
  const last = statuses.at(-1);
  assert.equal(last?.status?.online, false, "failed wake reconcile paints offline");
  assert.equal(last?.error, "Gateway 正在重新连接...");
  resetGatewayWebSocketClient();
});

test("GatewayWebSocketClient refreshes status immediately on wake with a healthy socket", async () => {
  const timers = createManualTimers();
  installBrowser({ ...timers });
  const loader = createWebModuleLoader();
  const { getGatewayWebSocketClient, resetGatewayWebSocketClient } =
    loader.loadModule("src/lib/gatewaySocket.ts");
  resetGatewayWebSocketClient();

  const client = getGatewayWebSocketClient("token");
  client.subscribeStatus(() => {});
  const socket = await connectAndAuth();
  await waitFor(
    () => socket.sent.some((envelope) => envelope.type === "status.get"),
    "initial status.get",
  );
  const initialStatusRequests = socket.sent.filter(
    (envelope) => envelope.type === "status.get",
  ).length;
  const statusReq = socket.sent.find((envelope) => envelope.type === "status.get");
  socket.receive({ id: statusReq.id, type: "response", payload: { online: true } });
  // Let the in-flight refreshStatus settle (its finally runs in a microtask)
  // so the wake-triggered refresh is not swallowed by the in-flight guard.
  await new Promise((resolve) => setTimeout(resolve, 0));

  globalThis.window.dispatchEvent({ type: "focus" });
  await waitFor(
    () =>
      socket.sent.filter((envelope) => envelope.type === "status.get").length >
      initialStatusRequests,
    "wake-triggered status.get",
  );
  resetGatewayWebSocketClient();
});
