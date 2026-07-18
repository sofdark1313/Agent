import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const panel = loader.loadModule("src/components/project-tools/SshTunnelPanel.tsx");

function host(overrides = {}) {
  return {
    id: "host-1",
    name: "Production",
    description: "",
    host: "prod.example.com",
    port: 22,
    username: "deploy",
    authType: "password",
    password: "",
    passwordConfigured: false,
    privateKey: "",
    privateKeyPath: "",
    privateKeyConfigured: false,
    privateKeyPassphrase: "",
    privateKeyPassphraseConfigured: false,
    proxy: {
      type: "socks5",
      url: "",
      port: 0,
      username: "",
      password: "",
      passwordConfigured: false,
    },
    ...overrides,
  };
}

test("SSH tunnel panel treats keyboard-interactive hosts as credential ready", () => {
  const keyboardInteractiveHost = host({
    authType: "keyboardInteractive",
    passwordConfigured: false,
    privateKeyConfigured: false,
  });

  assert.equal(panel.hostSecretReady(keyboardInteractiveHost), true);
  assert.equal(panel.hostStatusMessage(keyboardInteractiveHost, (key) => key), "");
});

test("SSH tunnel panel does not disable hosts only because proxy is configured", () => {
  const proxyHost = host({
    passwordConfigured: true,
    proxy: {
      type: "http",
      url: "http://127.0.0.1",
      port: 8080,
      username: "proxy-user",
      password: "",
      passwordConfigured: true,
    },
  });

  assert.equal(panel.hostStatusMessage(proxyHost, (key) => key), "");
});
