import type { AssistantMessage } from "../agentTypes";

import type { ProviderId } from "../settings";

export type ModelOption = {
  value: string;
  label: string;
  providerName: string;
  providerType: ProviderId;
  model: string;
};

const VALUE_SEP = "::";

export function toModelValue(customProviderId: string, model: string) {
  return `${customProviderId}${VALUE_SEP}${model}`;
}

export function parseModelValue(value: string): { customProviderId: string; model: string } | null {
  const idx = value.indexOf(VALUE_SEP);
  if (idx <= 0) return null;
  const customProviderId = value.slice(0, idx);
  const model = value.slice(idx + VALUE_SEP.length);
  if (!model || !customProviderId) return null;
  return { customProviderId, model };
}

function extractStructuredErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;

  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractStructuredErrorMessage(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["error", "message", "detail", "details", "errorMessage", "msg", "title"]) {
    const nested = extractStructuredErrorMessage(record[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

export function normalizeErrorMessage(rawMessage: string | undefined, fallback = "Request failed") {
  const raw = (rawMessage || "").trim();
  if (!raw) return fallback;

  const parseCandidates = [raw];
  const objectStart = raw.indexOf("{");
  if (objectStart > 0) parseCandidates.push(raw.slice(objectStart));
  const arrayStart = raw.indexOf("[");
  if (arrayStart > 0) parseCandidates.push(raw.slice(arrayStart));

  for (const candidate of parseCandidates) {
    try {
      const structured = extractStructuredErrorMessage(JSON.parse(candidate));
      if (structured) return structured;
    } catch {
      // Ignore parse failures and fall back to the raw message below.
    }
  }

  return raw;
}

function formatErrorDisplayText(rawMessage: string | undefined, fallback = "Request failed") {
  const message = normalizeErrorMessage(rawMessage, fallback);
  if (!message || message === fallback) return fallback;
  if (message.startsWith(`${fallback}：`) || message.startsWith(`${fallback}:`)) {
    return message;
  }
  return `${fallback}：${message}`;
}

export function assistantMessageToText(message: AssistantMessage) {
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }
  if (text.trim()) return text;
  if (message.stopReason === "error") {
    return formatErrorDisplayText(message.errorMessage, "Request failed");
  }
  if (message.stopReason === "aborted") {
    return formatErrorDisplayText(message.errorMessage, "Cancelled");
  }
  return text;
}
