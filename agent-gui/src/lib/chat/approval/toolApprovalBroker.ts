import type { ToolCall } from "@earendil-works/pi-ai";
import type { ToolApprovalAssessment } from "../../tools/toolApprovalPolicy";

export type ToolApprovalDecision = "allow-once" | "allow-session" | "deny";

export type ToolApprovalRequest = {
  id: string;
  sessionId: string;
  conversationId: string;
  toolCall: ToolCall;
  assessment: ToolApprovalAssessment;
  createdAt: number;
};

type ToolApprovalRequestInput = Omit<ToolApprovalRequest, "id" | "createdAt"> & {
  signal?: AbortSignal;
};

type PendingApproval = {
  request: ToolApprovalRequest;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export class ToolApprovalDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool execution denied by user: ${toolName}`);
    this.name = "ToolApprovalDeniedError";
  }
}

function cancellationError() {
  const error = new Error("Tool approval cancelled");
  error.name = "AbortError";
  return error;
}

function allowanceKey(input: Pick<ToolApprovalRequest, "sessionId" | "toolCall" | "assessment">) {
  return [
    input.sessionId,
    input.toolCall.name.toLowerCase(),
    input.assessment.category,
    input.assessment.outsideWorkspace ? "external" : "workspace",
  ].join(":");
}

export class ToolApprovalBroker {
  private counter = 0;
  private pending = new Map<string, PendingApproval>();
  private allowances = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: ToolApprovalRequest[] = [];

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish() {
    this.snapshot = Array.from(this.pending.values(), ({ request }) => request).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    for (const listener of this.listeners) listener();
  }

  request(input: ToolApprovalRequestInput) {
    if (input.signal?.aborted) return Promise.reject(cancellationError());
    if (this.allowances.has(allowanceKey(input))) return Promise.resolve();

    const id = `${input.sessionId}:${input.toolCall.id}:${++this.counter}`;
    const request: ToolApprovalRequest = {
      id,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      toolCall: input.toolCall,
      assessment: input.assessment,
      createdAt: Date.now(),
    };

    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        this.publish();
        reject(cancellationError());
      };
      const cleanup = () => input.signal?.removeEventListener("abort", abort);
      input.signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { request, resolve, reject, cleanup });
      this.publish();
    });
  }

  resolve(id: string, decision: ToolApprovalDecision) {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.cleanup();
    if (decision === "allow-session") {
      this.allowances.add(allowanceKey(pending.request));
    }
    this.publish();
    if (decision === "deny") {
      pending.reject(new ToolApprovalDeniedError(pending.request.toolCall.name));
    } else {
      pending.resolve();
    }
    return true;
  }

  cancelSession(sessionId: string) {
    for (const [id, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) continue;
      this.pending.delete(id);
      pending.cleanup();
      pending.reject(cancellationError());
    }
    for (const key of this.allowances) {
      if (key.startsWith(`${sessionId}:`)) this.allowances.delete(key);
    }
    this.publish();
  }
}
