export const RAG_CAPABILITY_TTL_MS = 5 * 60 * 1_000;

export type RagIngestionFieldSchema = {
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  default?: unknown;
  enum?: unknown;
};

export type RagIngestionChunkConfigSchema = {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
  additionalProperties?: unknown;
};

export type RagIngestionCapabilities = {
  allowedExtensions?: unknown;
  allowedMimeTypes?: unknown;
  processModes?: unknown;
  chunkStrategies?: unknown;
  chunkConfigSchema?: unknown;
  pipelines?: unknown;
};

export type RagCapabilitySnapshot = {
  protocolVersion?: string | null;
  capturedAtMs?: number | null;
  features?: Record<string, boolean> | null;
  limits?: Record<string, number> | null;
  ingestion?: RagIngestionCapabilities | null;
};

function supportsProtocolVersion(version: string | null | undefined) {
  return /^1\.\d+(?:\.\d+)*$/.test(version?.trim() ?? "");
}

export function isFreshRagCapabilitySnapshot(
  snapshot: RagCapabilitySnapshot | null | undefined,
  nowMs = Date.now(),
) {
  const capturedAtMs = snapshot?.capturedAtMs;
  if (
    !supportsProtocolVersion(snapshot?.protocolVersion) ||
    typeof capturedAtMs !== "number" ||
    !Number.isSafeInteger(capturedAtMs) ||
    capturedAtMs < 0 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < capturedAtMs
  ) {
    return false;
  }
  return nowMs - capturedAtMs <= RAG_CAPABILITY_TTL_MS;
}

export function nextRagCapabilityExpiryDelay(
  snapshot: RagCapabilitySnapshot | null | undefined,
  nowMs = Date.now(),
) {
  if (!snapshot || !isFreshRagCapabilitySnapshot(snapshot, nowMs)) return null;
  const capturedAtMs = snapshot.capturedAtMs as number;
  return capturedAtMs + RAG_CAPABILITY_TTL_MS - nowMs + 1;
}

export function positiveRagCapabilityLimit(
  snapshot: RagCapabilitySnapshot,
  key: string,
  localMaximum: number,
) {
  const value = snapshot.limits?.[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return Math.min(value, localMaximum);
}
