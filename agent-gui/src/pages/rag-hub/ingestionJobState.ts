import { isTerminalIngestionStatus, type RagIngestionStatus } from "./ingestionPolling";

export type RagAcceptedJobState = {
  documentId: string;
  jobId: string;
  status: string;
};

export type RagIngestionJobState = {
  jobId: string;
  documentId: string;
  operation?: string | null;
  rootJobId?: string | null;
  parentJobId?: string | null;
  attemptNo?: number | null;
  status: RagIngestionStatus;
  stage?: string | null;
  progress: number;
  retryable: boolean;
  error?: { code: string; message: string } | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
};

export type RagDocumentJobState = {
  current: RagIngestionJobState;
  jobIds: string[];
  history: RagIngestionJobState[];
  pollingExhausted: boolean;
};

export type RagJobsByDocumentId = Record<string, RagDocumentJobState>;

function normalizedStatus(status: string) {
  return status.trim().toUpperCase();
}

export function normalizeRagDocumentStatus(status: string): RagIngestionStatus {
  switch (normalizedStatus(status)) {
    case "PROCESSING":
    case "RUNNING":
      return "RUNNING";
    case "READY":
    case "SUCCESS":
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

function normalizeJob(job: RagIngestionJobState): RagIngestionJobState {
  return {
    ...job,
    status: normalizeRagDocumentStatus(job.status),
    progress: Math.max(0, Math.min(100, Math.floor(job.progress))),
  };
}

function appendJobId(jobIds: string[], jobId: string) {
  return jobIds.includes(jobId) ? jobIds : [...jobIds, jobId];
}

function upsertHistory(history: RagIngestionJobState[], job: RagIngestionJobState) {
  return [job, ...history.filter((item) => item.jobId !== job.jobId)];
}

export function recordAcceptedRagJob(
  jobs: RagJobsByDocumentId,
  accepted: RagAcceptedJobState,
): RagJobsByDocumentId {
  const previous = jobs[accepted.documentId];
  const current: RagIngestionJobState = {
    jobId: accepted.jobId,
    documentId: accepted.documentId,
    status: normalizeRagDocumentStatus(accepted.status),
    stage: "VALIDATING",
    progress: 0,
    retryable: false,
    error: null,
  };
  return {
    ...jobs,
    [accepted.documentId]: {
      current,
      jobIds: appendJobId(previous?.jobIds ?? [], accepted.jobId),
      history: upsertHistory(previous?.history ?? [], current),
      pollingExhausted: false,
    },
  };
}

export function recordRagIngestionJob(
  jobs: RagJobsByDocumentId,
  job: RagIngestionJobState,
  pollingExhausted = false,
): RagJobsByDocumentId {
  const normalized = normalizeJob(job);
  const previous = jobs[normalized.documentId];
  return {
    ...jobs,
    [normalized.documentId]: {
      current: normalized,
      jobIds: appendJobId(previous?.jobIds ?? [], normalized.jobId),
      history: upsertHistory(previous?.history ?? [], normalized),
      pollingExhausted: isTerminalIngestionStatus(normalized.status) ? false : pollingExhausted,
    },
  };
}

export function hydrateRagIngestionHistory(
  jobs: RagJobsByDocumentId,
  documentId: string,
  history: RagIngestionJobState[],
): RagJobsByDocumentId {
  const seen = new Set<string>();
  const normalized = history
    .filter((job) => job.documentId === documentId && !seen.has(job.jobId) && seen.add(job.jobId))
    .map(normalizeJob);
  if (normalized.length === 0) return jobs;
  return {
    ...jobs,
    [documentId]: {
      current: normalized[0],
      jobIds: normalized.map((job) => job.jobId),
      history: normalized,
      pollingExhausted: false,
    },
  };
}

export function reconcileRagJobsWithDocuments(
  jobs: RagJobsByDocumentId,
  documents: Array<{ id: string; status: string }>,
): RagJobsByDocumentId {
  let next = jobs;
  for (const document of documents) {
    const existing = next[document.id];
    if (!existing) continue;
    const documentStatus = normalizeRagDocumentStatus(document.status);
    if (!isTerminalIngestionStatus(documentStatus)) continue;
    next = {
      ...next,
      [document.id]: {
        ...existing,
        current: {
          ...existing.current,
          status: documentStatus,
          progress: documentStatus === "SUCCEEDED" ? 100 : existing.current.progress,
        },
        history: existing.history.map((job) =>
          job.jobId === existing.current.jobId
            ? {
                ...job,
                status: documentStatus,
                progress: documentStatus === "SUCCEEDED" ? 100 : job.progress,
              }
            : job,
        ),
        pollingExhausted: false,
      },
    };
  }
  return next;
}

export function effectiveRagDocumentStatus(
  documentStatus: string,
  jobState: RagDocumentJobState | null | undefined,
): RagIngestionStatus {
  const normalizedDocument = normalizeRagDocumentStatus(documentStatus);
  if (isTerminalIngestionStatus(normalizedDocument)) return normalizedDocument;
  if (jobState) return jobState.current.status;
  return normalizedDocument;
}

export function retryJobIdForDocument(jobs: RagJobsByDocumentId, documentId: string) {
  const current = jobs[documentId]?.current;
  return current?.status === "FAILED" && current.retryable ? current.jobId : null;
}

export function removeRagDocumentJob(
  jobs: RagJobsByDocumentId,
  documentId: string,
): RagJobsByDocumentId {
  if (!(documentId in jobs)) return jobs;
  const { [documentId]: _removed, ...remaining } = jobs;
  return remaining;
}
