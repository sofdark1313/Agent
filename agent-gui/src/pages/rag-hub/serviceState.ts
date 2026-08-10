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

export function canTestSavedRagService(
  saved: RagServiceState | null,
  draft: RagServiceState,
  managementApiKey: string,
  agentApiKey: string,
) {
  if (!saved || managementApiKey.trim() || agentApiKey.trim()) return false;
  return JSON.stringify(editableSnapshot(saved)) === JSON.stringify(editableSnapshot(draft));
}
