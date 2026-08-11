export type RagIngestionStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type PollableIngestionJob = {
  status: RagIngestionStatus;
};

export type PollIngestionResult<T extends PollableIngestionJob> = {
  job: T;
  exhausted: boolean;
};

type PollOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  maxAttempts?: number;
};

const DELAYS = [1000, 2000, 4000, 8000];

export function isTerminalIngestionStatus(status: string) {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function pollIngestionJob<T extends PollableIngestionJob>(
  fetchJob: () => Promise<T>,
  options: PollOptions = {},
): Promise<PollIngestionResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 60);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException("RAG 入库轮询已取消", "AbortError");
    }

    const job = await fetchJob();
    if (isTerminalIngestionStatus(job.status)) return { job, exhausted: false };
    if (attempt === maxAttempts - 1) return { job, exhausted: true };

    const delay = DELAYS[attempt] ?? 10_000;
    await sleep(delay);
  }

  throw new Error("RAG 入库轮询未返回结果");
}
