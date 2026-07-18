import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const modelSelection = loader.loadModule("src/pages/chat/runtime/modelSelection.ts");

function provider(overrides = {}) {
  const id = overrides.id ?? "provider-1";
  const type = overrides.type ?? "codex";
  const models = overrides.models ?? ["gpt-5"];
  const activeModels = overrides.activeModels ?? models;
  return {
    id,
    name: id,
    type,
    baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
    apiKey: "key",
    models,
    activeModels,
    requestFormat: type === "codex" ? "openai-responses" : undefined,
  };
}

function appSettings(customProviders, selectedModel) {
  return settings.normalizeSettings({
    customProviders,
    selectedModel,
  });
}

test("local chat model selection resolves only an enabled selected model", () => {
  const app = appSettings(
    [provider({ id: "openai-main", models: ["gpt-5", "gpt-5-mini"] })],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  const resolved = modelSelection.resolveEffectiveChatModelSelection(app);

  assert.equal(resolved.provider.id, "openai-main");
  assert.equal(resolved.providerId, "codex");
  assert.equal(resolved.model, "gpt-5");
  assert.deepEqual(resolved.selectedModel, {
    customProviderId: "openai-main",
    model: "gpt-5",
  });
});

test("remote chat model selection does not fall back to another provider with the same type", () => {
  const app = appSettings(
    [
      provider({ id: "openai-main", models: ["gpt-5"] }),
      provider({ id: "openai-backup", models: ["gpt-5-mini"] }),
    ],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  assert.throws(
    () =>
      modelSelection.resolveEffectiveChatModelSelection(app, {
        customProviderId: "missing-openai",
        model: "gpt-5-mini",
        providerType: "codex",
      }),
    /供应商不存在/,
  );
});

test("remote chat model selection rejects provider type drift", () => {
  const app = appSettings(
    [provider({ id: "anthropic-main", type: "claude_code", models: ["claude-sonnet"] })],
    { customProviderId: "anthropic-main", model: "claude-sonnet" },
  );

  assert.throws(
    () =>
      modelSelection.resolveEffectiveChatModelSelection(app, {
        customProviderId: "anthropic-main",
        model: "claude-sonnet",
        providerType: "codex",
      }),
    /供应商类型.*不一致/,
  );
});

test("remote chat model selection rejects models that are no longer enabled", () => {
  const app = appSettings(
    [
      provider({
        id: "openai-main",
        models: ["gpt-5", "gpt-5-mini"],
        activeModels: ["gpt-5"],
      }),
    ],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  assert.throws(
    () =>
      modelSelection.resolveEffectiveChatModelSelection(app, {
        customProviderId: "openai-main",
        model: "gpt-5-mini",
        providerType: "codex",
      }),
    /未在桌面端启用/,
  );
});

test("remote chat model selection accepts an exact enabled provider model", () => {
  const app = appSettings(
    [provider({ id: "gemini-main", type: "gemini", models: ["gemini-3.5-flash"] })],
    { customProviderId: "gemini-main", model: "gemini-3.5-flash" },
  );

  const resolved = modelSelection.resolveEffectiveChatModelSelection(app, {
    customProviderId: "gemini-main",
    model: "gemini-3.5-flash",
    providerType: "gemini",
  });

  assert.equal(resolved.provider.id, "gemini-main");
  assert.equal(resolved.providerId, "gemini");
  assert.deepEqual(resolved.selectedModel, {
    customProviderId: "gemini-main",
    model: "gemini-3.5-flash",
  });
});
