import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const i18n = loader.loadModule("src/i18n/config.ts");

test("supported locales and default locale are stable", () => {
  assert.equal(i18n.DEFAULT_LOCALE, "zh-CN");
  assert.deepEqual([...i18n.SUPPORTED_LOCALES], ["zh-CN", "en-US"]);
  assert.equal(i18n.normalizeLocale("en-US"), "en-US");
  assert.equal(i18n.normalizeLocale("fr-FR"), "zh-CN");
});

test("all locales expose the same translation keys", () => {
  const localeKeys = Object.fromEntries(
    Object.entries(i18n.translations).map(([locale, messages]) => [
      locale,
      Object.keys(messages).sort(),
    ]),
  );
  const zhKeys = localeKeys["zh-CN"];
  const enKeys = localeKeys["en-US"];

  assert.deepEqual(
    zhKeys.filter((key) => !enKeys.includes(key)),
    [],
    "en-US is missing keys present in zh-CN",
  );
  assert.deepEqual(
    enKeys.filter((key) => !zhKeys.includes(key)),
    [],
    "zh-CN is missing keys present in en-US",
  );
});

test("translation lookup falls back to the key for unknown entries", () => {
  assert.equal(i18n.t("app.name", "en-US"), "Agent");
  assert.equal(i18n.t("missing.key", "en-US"), "missing.key");
});

test("RAG Hub translations cover navigation, services, documents, jobs, and search", () => {
  const requiredKeys = [
    "ragHub.navTitle",
    "ragHub.subtitle",
    "ragHub.service.add",
    "ragHub.service.connectionConfig",
    "ragHub.service.managementCredential",
    "ragHub.service.agentCredential",
    "ragHub.service.protocolVersion",
    "ragHub.service.capabilityHealth",
    "ragHub.service.capabilityStatus.untested",
    "ragHub.service.capabilityStatus.valid",
    "ragHub.service.capabilityStatus.expired",
    "ragHub.service.capabilityStatus.incompatible",
    "ragHub.service.adapter",
    "ragHub.service.adapterHint",
    "ragHub.service.timeout",
    "ragHub.service.timeoutHint",
    "ragHub.service.timeoutInvalid",
    "ragHub.credential.management",
    "ragHub.credential.configuredShort",
    "ragHub.knowledgeBase.title",
    "ragHub.knowledgeBase.searchLabel",
    "ragHub.knowledgeBase.searchPlaceholder",
    "ragHub.knowledgeBase.noMatches",
    "ragHub.knowledgeBase.agentAccess",
    "ragHub.knowledgeBase.addToAgent",
    "ragHub.knowledgeBase.removeFromAgent",
    "ragHub.knowledgeBase.allowlistSaveRetest",
    "ragHub.document.title",
    "ragHub.document.status.running",
    "ragHub.document.jobCurrent",
    "ragHub.search.title",
    "ragHub.search.resultViewLegend",
    "ragHub.search.rawResults",
    "ragHub.search.rerankedResults",
    "ragHub.error.invalidIngestionConfig",
  ];

  for (const key of requiredKeys) {
    assert.notEqual(i18n.t(key, "zh-CN"), key, `zh-CN is missing ${key}`);
    assert.notEqual(i18n.t(key, "en-US"), key, `en-US is missing ${key}`);
    assert.doesNotMatch(
      i18n.t(key, "en-US"),
      /[\u3400-\u9fff]/u,
      `en-US contains Chinese text for ${key}`,
    );
  }
});
