import type { AssistantMessage } from "@earendil-works/pi-ai";
import { formatErrorDisplayText } from "./errors";

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

export function createStreamingTextReconciler() {
  const emittedTextByKey = new Map<string, string>();
  const pendingTailByKey = new Map<string, string>();

  const splitSafeText = (text: string) => {
    const markerLength = CONVERSATION_END_MARKER.length;
    const maxTailLength = Math.min(text.length, markerLength - 1);
    for (let tailLength = maxTailLength; tailLength > 0; tailLength -= 1) {
      if (CONVERSATION_END_MARKER.startsWith(text.slice(-tailLength))) {
        return {
          text: normalizeAssistantDisplayText(text.slice(0, text.length - tailLength)),
          tail: text.slice(text.length - tailLength),
        };
      }
    }
    return { text: normalizeAssistantDisplayText(text), tail: "" };
  };

  return {
    appendDelta(key: string, delta: string) {
      if (!delta) return "";
      const previousTail = pendingTailByKey.get(key) ?? "";
      const { text, tail } = splitSafeText(previousTail + delta);
      pendingTailByKey.set(key, tail);
      emittedTextByKey.set(key, (emittedTextByKey.get(key) ?? "") + text);
      return text;
    },
    reconcileFinalText(key: string, finalText: string) {
      const previous = emittedTextByKey.get(key) ?? "";
      const sanitizedText = normalizeAssistantDisplayText(finalText);
      emittedTextByKey.set(key, sanitizedText);
      pendingTailByKey.delete(key);

      if (!sanitizedText) return "";
      if (!previous) return sanitizedText;
      if (sanitizedText.startsWith(previous)) {
        return sanitizedText.slice(previous.length);
      }
      return "";
    },
  };
}
