import assert from "node:assert/strict";
import test from "node:test";

import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const {
  INITIAL_GATEWAY_SIDEBAR_STATUS_FRESHNESS,
  reduceGatewaySidebarStatusFreshness,
  shouldDisableGatewaySidebarSections,
} = loader.loadModule("src/app/sidebar/gatewaySidebarAvailability.ts");

test("gateway sidebar sections require both the transport and desktop Agent to be online", () => {
  const cases = [
    {
      name: "connected and Agent online",
      connectionLost: false,
      agentStatusFresh: true,
      agentOnline: true,
      expected: false,
    },
    {
      name: "connected but Agent offline",
      connectionLost: false,
      agentStatusFresh: true,
      agentOnline: false,
      expected: true,
    },
    {
      name: "connected before the first Agent status",
      connectionLost: false,
      agentStatusFresh: false,
      agentOnline: null,
      expected: true,
    },
    {
      name: "connected with an unknown Agent status",
      connectionLost: false,
      agentStatusFresh: true,
      agentOnline: undefined,
      expected: true,
    },
    {
      name: "transport lost despite the last Agent status being online",
      connectionLost: true,
      agentStatusFresh: false,
      agentOnline: true,
      expected: true,
    },
  ];

  for (const entry of cases) {
    assert.equal(
      shouldDisableGatewaySidebarSections({
        connectionLost: entry.connectionLost,
        agentStatusFresh: entry.agentStatusFresh,
        agentOnline: entry.agentOnline,
      }),
      entry.expected,
      entry.name,
    );
  }
});

test("a reconnected socket stays disabled until it receives a fresh Agent status", () => {
  let freshness = INITIAL_GATEWAY_SIDEBAR_STATUS_FRESHNESS;
  const reduce = (event) => {
    freshness = reduceGatewaySidebarStatusFreshness(freshness, event);
  };
  const isDisabledWithStaleOnlineStatus = () =>
    shouldDisableGatewaySidebarSections({
      connectionLost: false,
      agentStatusFresh: freshness.agentStatusFresh,
      // Simulate the online=true value cached from the previous socket.
      agentOnline: true,
    });

  reduce({ type: "connection", connected: true });
  reduce({ type: "status" });
  assert.equal(isDisabledWithStaleOnlineStatus(), false, "the original socket is ready");

  reduce({ type: "connection", connected: false });
  reduce({ type: "connection", connected: true });
  assert.equal(
    isDisabledWithStaleOnlineStatus(),
    true,
    "authentication alone must not reuse the previous socket's online status",
  );

  reduce({ type: "status" });
  assert.equal(isDisabledWithStaleOnlineStatus(), false, "the fresh status unlocks the sections");
});
