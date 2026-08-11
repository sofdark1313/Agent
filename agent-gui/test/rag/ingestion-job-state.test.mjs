import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("RAG document statuses map to ingestion job statuses", async () => {
  const loader = createTsModuleLoader();
  const { normalizeRagDocumentStatus } = await loader.loadModule(
    "src/pages/rag-hub/ingestionJobState.ts",
  );

  assert.equal(normalizeRagDocumentStatus("PENDING"), "PENDING");
  assert.equal(normalizeRagDocumentStatus("PROCESSING"), "RUNNING");
  assert.equal(normalizeRagDocumentStatus("READY"), "SUCCEEDED");
  assert.equal(normalizeRagDocumentStatus("FAILED"), "FAILED");
  assert.equal(normalizeRagDocumentStatus("CANCELLED"), "CANCELLED");
});

test("RAG jobs stay independent per document and retry uses only a retryable real job id", async () => {
  const loader = createTsModuleLoader();
  const { recordAcceptedRagJob, recordRagIngestionJob, retryJobIdForDocument } =
    await loader.loadModule("src/pages/rag-hub/ingestionJobState.ts");

  let jobs = recordAcceptedRagJob({}, { documentId: "doc-a", jobId: "job-a", status: "PENDING" });
  jobs = recordAcceptedRagJob(jobs, {
    documentId: "doc-b",
    jobId: "job-b",
    status: "PENDING",
  });
  jobs = recordRagIngestionJob(jobs, {
    documentId: "doc-a",
    jobId: "job-a",
    status: "FAILED",
    stage: "INDEXING",
    progress: 70,
    retryable: true,
    error: { code: "RAG_INDEX_FAILED", message: "failed" },
  });

  assert.equal(jobs["doc-a"].current.jobId, "job-a");
  assert.equal(jobs["doc-b"].current.jobId, "job-b");
  assert.equal(retryJobIdForDocument(jobs, "doc-a"), "job-a");
  assert.equal(retryJobIdForDocument(jobs, "doc-b"), null);
});

test("RAG refreshed document terminals override exhausted stale jobs without losing job history", async () => {
  const loader = createTsModuleLoader();
  const {
    effectiveRagDocumentStatus,
    reconcileRagJobsWithDocuments,
    recordAcceptedRagJob,
    recordRagIngestionJob,
  } = await loader.loadModule("src/pages/rag-hub/ingestionJobState.ts");

  let jobs = recordAcceptedRagJob({}, {
    documentId: "doc-a",
    jobId: "job-a",
    status: "PENDING",
  });
  jobs = recordRagIngestionJob(
    jobs,
    {
      documentId: "doc-a",
      jobId: "job-a",
      status: "RUNNING",
      stage: "INDEXING",
      progress: 80,
      retryable: false,
      error: null,
    },
    true,
  );
  jobs = reconcileRagJobsWithDocuments(jobs, [{ id: "doc-a", status: "READY" }]);

  assert.equal(effectiveRagDocumentStatus("READY", jobs["doc-a"]), "SUCCEEDED");
  assert.equal(jobs["doc-a"].current.status, "SUCCEEDED");
  assert.deepEqual(jobs["doc-a"].jobIds, ["job-a"]);
});

test("RAG retries append a new job id while retaining completed history", async () => {
  const loader = createTsModuleLoader();
  const { recordAcceptedRagJob, recordRagIngestionJob } = await loader.loadModule(
    "src/pages/rag-hub/ingestionJobState.ts",
  );

  let jobs = recordAcceptedRagJob({}, { documentId: "doc-a", jobId: "job-a", status: "PENDING" });
  jobs = recordRagIngestionJob(jobs, {
    documentId: "doc-a",
    jobId: "job-a",
    status: "FAILED",
    stage: "INDEXING",
    progress: 100,
    retryable: true,
    error: null,
  });
  jobs = recordRagIngestionJob(jobs, {
    documentId: "doc-a",
    jobId: "job-a-retry",
    status: "PENDING",
    stage: "VALIDATING",
    progress: 0,
    retryable: false,
    error: null,
  });

  assert.equal(jobs["doc-a"].current.jobId, "job-a-retry");
  assert.deepEqual(jobs["doc-a"].jobIds, ["job-a", "job-a-retry"]);
});

test("RAG persisted history restores retry after a page refresh", async () => {
  const loader = createTsModuleLoader();
  const { hydrateRagIngestionHistory, retryJobIdForDocument } = await loader.loadModule(
    "src/pages/rag-hub/ingestionJobState.ts",
  );

  const jobs = hydrateRagIngestionHistory({}, "doc-a", [
    {
      documentId: "doc-a",
      jobId: "job-a-retry",
      operation: "RETRY",
      rootJobId: "job-a",
      parentJobId: "job-a",
      attemptNo: 2,
      status: "FAILED",
      stage: "EMBEDDING",
      progress: 65,
      retryable: true,
      error: { code: "RAG_INDEX_FAILED", message: "failed" },
      startedAt: "2026-08-11T06:00:00Z",
      completedAt: "2026-08-11T06:01:00Z",
      createdAt: "2026-08-11T05:59:00Z",
    },
    {
      documentId: "doc-a",
      jobId: "job-a",
      operation: "UPLOAD",
      attemptNo: 1,
      status: "FAILED",
      stage: "INDEXING",
      progress: 80,
      retryable: true,
      error: { code: "RAG_INDEX_FAILED", message: "failed" },
    },
  ]);

  assert.equal(retryJobIdForDocument(jobs, "doc-a"), "job-a-retry");
  assert.deepEqual(jobs["doc-a"].jobIds, ["job-a-retry", "job-a"]);
  assert.equal(jobs["doc-a"].history.length, 2);
  assert.equal(jobs["doc-a"].history[0].parentJobId, "job-a");
  assert.equal(jobs["doc-a"].history[0].completedAt, "2026-08-11T06:01:00Z");
});
