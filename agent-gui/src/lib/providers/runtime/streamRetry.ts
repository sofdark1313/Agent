import {
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";

export const DEFAULT_STREAM_RETRY_MAX_ATTEMPTS = 3;

const STREAM_RETRY_BASE_DELAY_MS = 500;
const STREAM_RETRY_MAX_DELAY_MS = 8_000;

export type StreamRetryConfig = {
  maxAttempts?: number;
  disabled?: boolean;
};

export type StreamRetryOptions = StreamRetryConfig & {
  signal?: AbortSignal;
};

type TerminalEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

const COMMITTING_EVENT_TYPES = new Set<AssistantMessageEvent["type"]>([
  "text_delta",
  "thinking_delta",
  "toolcall_start",
]);

function isTerminalEvent(event: AssistantMessageEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}

function terminalMessage(event: TerminalEvent) {
  return event.type === "done" ? event.message : event.error;
}

/** Full-jitter exponential backoff (AWS-style): uniform(0, min(cap, base * 2^(attempt-1))). */
export function computeStreamRetryBackoffMs(attempt: number): number {
  const cap = Math.min(STREAM_RETRY_MAX_DELAY_MS, STREAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.random() * cap;
}

function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps a fresh-stream factory with attempt-scoped retry for transient
 * provider/transport failures.
 *
 * Events are buffered per attempt until the first content-bearing event
 * ("committed": text_delta / thinking_delta / toolcall_start) is observed. An
 * attempt that ends in error before committing, classified retryable by
 * pi-ai's `isRetryableAssistantError`, is discarded wholesale and replaced by
 * a fresh `factory()` call after a full-jitter backoff — the caller never
 * sees the failed attempt's events. Once committed, or once retries are
 * exhausted/disabled, events pass straight through untouched.
 *
 * The pump below runs eagerly (not gated on the returned stream being
 * iterated) because pi-ai's own stream factories start their network work as
 * soon as they're called, independent of consumer iteration — some callers
 * only await `.result()` without ever iterating events, and that pattern must
 * keep working through this wrapper.
 */
export function withStreamRetry(
  factory: () => AssistantMessageEventStream,
  options?: StreamRetryOptions,
): AssistantMessageEventStream {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_STREAM_RETRY_MAX_ATTEMPTS);
  const disabled = options?.disabled ?? false;
  const signal = options?.signal;

  const output = createAssistantMessageEventStream();
  const firstSource = factory();

  void (async () => {
    let attempt = 1;
    let source = firstSource;

    while (true) {
      let committed = false;
      const buffered: AssistantMessageEvent[] = [];
      let terminal: TerminalEvent | undefined;

      for await (const event of source) {
        if (!committed && COMMITTING_EVENT_TYPES.has(event.type)) {
          committed = true;
          for (const bufferedEvent of buffered.splice(0)) output.push(bufferedEvent);
        }
        if (committed) {
          output.push(event);
        } else {
          buffered.push(event);
        }
        if (isTerminalEvent(event)) terminal = event;
      }

      if (terminal?.type === "error" && !committed && !disabled && attempt < maxAttempts) {
        if (isRetryableAssistantError(terminalMessage(terminal))) {
          attempt += 1;
          try {
            await sleepWithAbort(computeStreamRetryBackoffMs(attempt - 1), signal);
            source = factory();
            continue;
          } catch {
            // Aborted mid-backoff, or the next attempt failed to start —
            // surface the prior attempt's real failure below instead of
            // hanging the consumer on a retry that will never happen.
          }
        }
      }

      if (!committed) {
        for (const bufferedEvent of buffered) output.push(bufferedEvent);
      }
      // Some streams (notably minimal test doubles) never yield a terminal
      // done/error event through iteration and only expose the final message
      // via result(). output.end() is idempotent once a terminal event has
      // already been pushed above, so this also safety-nets that case.
      output.end(await source.result());
      return;
    }
  })();

  return output;
}
