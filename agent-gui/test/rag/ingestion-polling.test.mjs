import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("RAG ingestion polling backs off and stops at a terminal status", async () => {
  const loader = createTsModuleLoader();
  const { pollIngestionJob } = await loader.loadModule(
    "src/pages/rag-hub/ingestionPolling.ts",
  );
  const statuses = ["PENDING", "RUNNING", "SUCCEEDED"];
  const delays = [];

  const result = await pollIngestionJob(
    async () => ({ status: statuses.shift(), progress: 0 }),
    {
      sleep: async (milliseconds) => delays.push(milliseconds),
    },
  );

  assert.equal(result.job.status, "SUCCEEDED");
  assert.equal(result.exhausted, false);
  assert.deepEqual(delays, [1000, 2000]);
});

test("RAG ingestion polling returns failed jobs without another delay", async () => {
  const loader = createTsModuleLoader();
  const { pollIngestionJob } = await loader.loadModule(
    "src/pages/rag-hub/ingestionPolling.ts",
  );
  const delays = [];

  const result = await pollIngestionJob(
    async () => ({ status: "FAILED", progress: 100, retryable: true }),
    {
      sleep: async (milliseconds) => delays.push(milliseconds),
    },
  );

  assert.equal(result.job.retryable, true);
  assert.equal(result.exhausted, false);
  assert.deepEqual(delays, []);
});

test("RAG ingestion polling marks a non-terminal job when attempts are exhausted", async () => {
  const loader = createTsModuleLoader();
  const { pollIngestionJob } = await loader.loadModule(
    "src/pages/rag-hub/ingestionPolling.ts",
  );
  const delays = [];

  const result = await pollIngestionJob(
    async () => ({ status: "RUNNING", progress: 45 }),
    {
      maxAttempts: 2,
      sleep: async (milliseconds) => delays.push(milliseconds),
    },
  );

  assert.equal(result.job.status, "RUNNING");
  assert.equal(result.job.progress, 45);
  assert.equal(result.exhausted, true);
  assert.deepEqual(delays, [1000]);
});
