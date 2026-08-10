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

  assert.equal(result.status, "SUCCEEDED");
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

  assert.equal(result.retryable, true);
  assert.deepEqual(delays, []);
});
