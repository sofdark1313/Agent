import type { CacheRetention, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ProviderId, ReasoningLevel } from "../../settings";
import { normalizeSessionId } from "./common";

export function buildDualAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
  };
}

export function buildGeminiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "x-goog-api-key": apiKey,
  };
}

export function buildProviderAuthHeaders(
  providerId: ProviderId,
  apiKey: string,
): Record<string, string> {
  return providerId === "gemini" ? buildGeminiAuthHeaders(apiKey) : buildDualAuthHeaders(apiKey);
}

export function toSimpleStreamReasoning(
  reasoning: ReasoningLevel | undefined,
): SimpleStreamOptions["reasoning"] | undefined {
  return reasoning && reasoning !== "off" ? reasoning : undefined;
}

export function resolveProviderCacheRetention(
  providerId: ProviderId,
  promptCachingEnabled?: boolean,
  override?: CacheRetention,
): CacheRetention | undefined {
  if (providerId !== "claude_code") return undefined;
  if (override) return override;
  return promptCachingEnabled === false ? "none" : "short";
}

export function buildProviderRequestMetadata(
  providerId: ProviderId,
  sessionId?: string,
): Record<string, unknown> | undefined {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (providerId !== "claude_code" || !normalizedSessionId) return undefined;
  return {
    user_id: normalizedSessionId,
  };
}
