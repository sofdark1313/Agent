import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const NOW_MS = 1_800_000_000_000;

const validCapabilities = (overrides = {}) => ({
  protocolVersion: "1.0",
  capturedAtMs: NOW_MS - 1_000,
  features: { fileUpload: true, urlImport: true, rerank: true },
  limits: { maxUploadBytes: 100 * 1024 * 1024 },
  ingestion: {
    allowedExtensions: [".PDF", "md"],
    allowedMimeTypes: ["application/pdf", "text/markdown"],
    processModes: ["chunk", "pipeline"],
    chunkStrategies: ["fixed_size"],
    chunkConfigSchema: {
      fixed_size: {
        type: "object",
        properties: {
          chunkSize: { type: "integer", minimum: 128, maximum: 2048, default: 512 },
          overlapSize: { type: "integer", minimum: 0, maximum: 512, default: 64 },
        },
        required: ["chunkSize", "overlapSize"],
        additionalProperties: false,
      },
    },
    pipelines: [{ id: "clean", name: "Clean pipeline" }],
  },
  ...overrides,
});

test("RAG ingestion settings normalize a complete server contract and choose schema defaults", async () => {
  const loader = createTsModuleLoader();
  const {
    createDefaultRagIngestionSelection,
    resolveRagIngestionSettings,
    validateRagIngestionSelection,
  } = await loader.loadModule("src/pages/rag-hub/ingestionSettings.ts");

  const settings = resolveRagIngestionSettings(validCapabilities(), NOW_MS);
  assert.equal(settings.fileUploadSupported, true);
  assert.equal(settings.urlImportSupported, true);
  assert.equal(settings.maxUploadBytes, 25 * 1024 * 1024);
  assert.deepEqual(settings.allowedExtensions, [".pdf", ".md"]);
  assert.deepEqual(settings.allowedMimeTypes, ["application/pdf", "text/markdown"]);
  assert.deepEqual(settings.processModes, ["chunk", "pipeline"]);
  assert.deepEqual(settings.chunkStrategies, ["fixed_size"]);
  assert.deepEqual(settings.pipelines, [{ id: "clean", name: "Clean pipeline" }]);
  assert.equal(settings.capabilityError, null);

  const selection = createDefaultRagIngestionSelection(settings);
  assert.deepEqual(selection, {
    processMode: "chunk",
    chunkStrategy: "fixed_size",
    chunkConfig: { chunkSize: 512, overlapSize: 64 },
    pipelineId: null,
  });
  assert.deepEqual(validateRagIngestionSelection(settings, selection), {
    valid: true,
    error: null,
    request: selection,
  });
});

test("RAG ingestion is fail-closed when the optional ingestion contract is absent or incompatible", async () => {
  const loader = createTsModuleLoader();
  const { resolveRagIngestionSettings } = await loader.loadModule(
    "src/pages/rag-hub/ingestionSettings.ts",
  );

  for (const snapshot of [
    validCapabilities({ ingestion: undefined }),
    validCapabilities({
      ingestion: { ...validCapabilities().ingestion, processModes: ["future_mode"] },
    }),
    validCapabilities({
      ingestion: { ...validCapabilities().ingestion, chunkConfigSchema: {} },
    }),
    validCapabilities({
      ingestion: {
        ...validCapabilities().ingestion,
        chunkConfigSchema: {
          fixed_size: {
            type: "object",
            properties: { chunkSize: { type: "number", default: 512 } },
            additionalProperties: false,
          },
        },
      },
    }),
  ]) {
    const settings = resolveRagIngestionSettings(snapshot, NOW_MS);
    assert.equal(settings.fileUploadSupported, false);
    assert.equal(settings.urlImportSupported, false);
    assert.match(settings.capabilityError, /capabilities|能力|schema/i);
  }
});

test("RAG ingestion validation enforces selected mode, schema values, pipeline ids, and file metadata", async () => {
  const loader = createTsModuleLoader();
  const {
    resolveRagIngestionSettings,
    validateRagIngestionSelection,
    validateRagPickedDocument,
  } = await loader.loadModule("src/pages/rag-hub/ingestionSettings.ts");
  const settings = resolveRagIngestionSettings(validCapabilities(), NOW_MS);

  assert.equal(
    validateRagIngestionSelection(settings, {
      processMode: "chunk",
      chunkStrategy: "fixed_size",
      chunkConfig: { chunkSize: 4096, overlapSize: 64 },
      pipelineId: null,
    }).valid,
    false,
  );
  assert.deepEqual(
    validateRagIngestionSelection(settings, {
      processMode: "pipeline",
      chunkStrategy: null,
      chunkConfig: null,
      pipelineId: "clean",
    }),
    {
      valid: true,
      error: null,
      request: {
        processMode: "pipeline",
        chunkStrategy: null,
        chunkConfig: null,
        pipelineId: "clean",
      },
    },
  );
  assert.equal(
    validateRagIngestionSelection(settings, {
      processMode: "pipeline",
      chunkStrategy: null,
      chunkConfig: null,
      pipelineId: "missing",
    }).valid,
    false,
  );

  assert.equal(
    validateRagPickedDocument(settings, {
      path: "C:/policy.pdf",
      name: "policy.pdf",
      size: 1024,
      extension: ".pdf",
      mimeType: "application/pdf",
    }),
    null,
  );
  assert.match(
    validateRagPickedDocument(settings, {
      path: "C:/policy.exe",
      name: "policy.exe",
      size: 1024,
      extension: ".exe",
      mimeType: "application/octet-stream",
    }),
    /扩展名|extension/i,
  );
  assert.match(
    validateRagPickedDocument(settings, {
      path: "C:/policy.pdf",
      name: "policy.pdf",
      size: 30 * 1024 * 1024,
      extension: ".pdf",
      mimeType: "application/pdf",
    }),
    /大小|size/i,
  );
});

test("RAG ingestion settings expire instead of leaving upload controls enabled", async () => {
  const loader = createTsModuleLoader();
  const { RAG_CAPABILITY_TTL_MS } = await loader.loadModule(
    "src/lib/rag/capabilitySnapshot.ts",
  );
  const { resolveRagIngestionSettings } = await loader.loadModule(
    "src/pages/rag-hub/ingestionSettings.ts",
  );
  const snapshot = validCapabilities({ capturedAtMs: NOW_MS - RAG_CAPABILITY_TTL_MS - 1 });

  const settings = resolveRagIngestionSettings(snapshot, NOW_MS);
  assert.equal(settings.fileUploadSupported, false);
  assert.equal(settings.urlImportSupported, false);
  assert.match(settings.capabilityError, /过期|expired|capabilities/i);
});
