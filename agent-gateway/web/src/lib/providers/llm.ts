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
const CONVERSATION_END_MARKER = "<CPA_DONE>";
const ASSISTANT_TEXT_KEYS = ["answer", "text", "content", "message"] as const;

export function stripConversationEndMarker(text: string) {
  return text.includes(CONVERSATION_END_MARKER)
    ? text.replaceAll(CONVERSATION_END_MARKER, "")
    : text;
}

export function normalizeAssistantDisplayText(text: string) {
  const withoutMarker = stripConversationEndMarker(text);
  const trimmed = withoutMarker.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return withoutMarker;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return withoutMarker;
    }
    const record = parsed as Record<string, unknown>;
    for (const key of ASSISTANT_TEXT_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return stripConversationEndMarker(value);
      }
    }
  } catch {
    // Keep the original text when it is not a plain structured response.
  }

  return withoutMarker;
}

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
  const sanitizedText = normalizeAssistantDisplayText(text);
  if (sanitizedText.trim()) return sanitizedText;
  if (message.stopReason === "error") {
    return formatErrorDisplayText(message.errorMessage, "Request failed");
  }
  if (message.stopReason === "aborted") {
    return formatErrorDisplayText(message.errorMessage, "Cancelled");
  }
  return sanitizedText;
}
