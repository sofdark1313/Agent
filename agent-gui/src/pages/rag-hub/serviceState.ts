import {
  isFreshRagCapabilitySnapshot,
  type RagCapabilitySnapshot,
} from "../../lib/rag/capabilitySnapshot";

export const DEFAULT_RAGENT_BASE_URL = "http://localhost:9090/api/ragent";
export const MIN_RAG_SERVICE_TIMEOUT_MS = 1_000;
export const MAX_RAG_SERVICE_TIMEOUT_MS = 120_000;

export type RagCapabilityHealth = "untested" | "valid" | "expired" | "incompatible";

export type RagServiceState = {
  id: string;
  name: string;
  adapterType: string;
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  agentEnabled: boolean;
  agentKnowledgeBaseIds: string[];
  timeoutMs: number;
  managementCredentialConfigured: boolean;
  agentCredentialConfigured: boolean;
};

export function chooseRagServiceId(services: RagServiceState[], preferredId = "", currentId = "") {
  const available = new Set(services.map((service) => service.id));
  if (preferredId && available.has(preferredId)) return preferredId;
  if (currentId && available.has(currentId)) return currentId;
  return services.find((service) => service.default)?.id ?? services[0]?.id ?? "";
}

function editableSnapshot(service: RagServiceState) {
  return {
    id: service.id,
    name: service.name,
    adapterType: service.adapterType,
    baseUrl: service.baseUrl,
    enabled: service.enabled,
    default: service.default,
    agentEnabled: service.agentEnabled,
    agentKnowledgeBaseIds: service.agentKnowledgeBaseIds,
    timeoutMs: service.timeoutMs,
    managementCredentialConfigured: service.managementCredentialConfigured,
    agentCredentialConfigured: service.agentCredentialConfigured,
  };
}

export function canTestSavedRagService(saved: RagServiceState | null, draft: RagServiceState) {
  if (!saved) return false;
  return JSON.stringify(editableSnapshot(saved)) === JSON.stringify(editableSnapshot(draft));
}

export function resolveRagCapabilityHealth(
  snapshot: RagCapabilitySnapshot | null | undefined,
  nowMs = Date.now(),
): RagCapabilityHealth {
  if (!snapshot) return "untested";
  if (!/^1\.\d+(?:\.\d+)*$/.test(snapshot.protocolVersion?.trim() ?? "")) {
    return "incompatible";
  }
  return isFreshRagCapabilitySnapshot(snapshot, nowMs) ? "valid" : "expired";
}

export function isValidRagServiceTimeout(timeoutMs: number) {
  return (
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs >= MIN_RAG_SERVICE_TIMEOUT_MS &&
    timeoutMs <= MAX_RAG_SERVICE_TIMEOUT_MS
  );
}

export function filterRagKnowledgeBases<T extends { id: string; name: string }>(
  knowledgeBases: T[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return knowledgeBases;
  return knowledgeBases.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(normalizedQuery) ||
      item.id.toLocaleLowerCase().includes(normalizedQuery),
  );
}
