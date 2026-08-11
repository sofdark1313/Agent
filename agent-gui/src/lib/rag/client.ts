import { invoke } from "@tauri-apps/api/core";

import type { RagCapabilitySnapshot } from "./capabilitySnapshot";
import type {
  RagAcceptedJob,
  RagChunk,
  RagCredentialKind,
  RagDocument,
  RagIngestionJob,
  RagIngestionRequest,
  RagKnowledgeBase,
  RagPage,
  RagPickedDocumentFile,
  RagRerankRequest,
  RagSearchRequest,
  RagSearchResponse,
  RagServiceConfig,
} from "./types";

function safeService(service: RagServiceConfig): RagServiceConfig {
  return {
    id: service.id,
    name: service.name,
    adapterType: service.adapterType,
    baseUrl: service.baseUrl,
    enabled: service.enabled,
    default: service.default,
    agentEnabled: service.agentEnabled,
    agentKnowledgeBaseIds: Array.isArray(service.agentKnowledgeBaseIds)
      ? [...service.agentKnowledgeBaseIds]
      : [],
    timeoutMs: service.timeoutMs,
    managementCredentialConfigured: service.managementCredentialConfigured,
    agentCredentialConfigured: service.agentCredentialConfigured,
    capabilitiesSnapshot: service.capabilitiesSnapshot ?? null,
  };
}

async function safeServiceResult(command: string, args?: Record<string, unknown>) {
  return safeService(await invoke<RagServiceConfig>(command, args));
}

export const ragClient = {
  async listServices() {
    const services = await invoke<RagServiceConfig[]>("rag_list_services");
    return services.map(safeService);
  },
  saveService(service: RagServiceConfig) {
    return safeServiceResult("rag_save_service", { request: { service } });
  },
  async promptCredential(serviceId: string, credentialKind: RagCredentialKind) {
    const service = await invoke<RagServiceConfig | null>("rag_prompt_service_credential", {
      service_id: serviceId,
      credential_kind: credentialKind,
    });
    return service ? safeService(service) : null;
  },
  clearCredential(serviceId: string, credentialKind: RagCredentialKind) {
    return safeServiceResult("rag_clear_service_credential", {
      service_id: serviceId,
      credential_kind: credentialKind,
    });
  },
  deleteService(serviceId: string) {
    return invoke<void>("rag_delete_service", { service_id: serviceId });
  },
  testService(serviceId: string) {
    return invoke<RagCapabilitySnapshot>("rag_test_service", { service_id: serviceId });
  },
  listKnowledgeBases(serviceId?: string) {
    return invoke<RagKnowledgeBase[]>("rag_hub_list_knowledge_bases", {
      service_id: serviceId,
    });
  },
  createKnowledgeBase(
    serviceId: string | undefined,
    name: string,
    embeddingModel: string,
    collectionName: string,
  ) {
    return invoke<RagKnowledgeBase>("rag_hub_create_knowledge_base", {
      service_id: serviceId,
      name,
      embedding_model: embeddingModel,
      collection_name: collectionName,
    });
  },
  updateKnowledgeBase(
    serviceId: string | undefined,
    knowledgeBaseId: string,
    updates: { name?: string; embeddingModel?: string },
  ) {
    return invoke<RagKnowledgeBase>("rag_hub_update_knowledge_base", {
      service_id: serviceId,
      knowledge_base_id: knowledgeBaseId,
      name: updates.name,
      embedding_model: updates.embeddingModel,
    });
  },
  deleteKnowledgeBase(serviceId: string | undefined, knowledgeBaseId: string) {
    return invoke<void>("rag_hub_delete_knowledge_base", {
      service_id: serviceId,
      knowledge_base_id: knowledgeBaseId,
    });
  },
  listDocuments(serviceId: string, knowledgeBaseId: string, current = 1, size = 50) {
    return invoke<RagPage<RagDocument>>("rag_hub_list_documents", {
      service_id: serviceId,
      knowledge_base_id: knowledgeBaseId,
      current,
      size,
    });
  },
  pickDocumentFile(serviceId: string) {
    return invoke<RagPickedDocumentFile | null>("rag_pick_document_file", {
      service_id: serviceId,
    });
  },
  uploadDocument(
    serviceId: string,
    knowledgeBaseId: string,
    filePath: string,
    ingestion: RagIngestionRequest,
  ) {
    return invoke<RagAcceptedJob>("rag_hub_upload_document", {
      service_id: serviceId,
      knowledge_base_id: knowledgeBaseId,
      file_path: filePath,
      ingestion,
    });
  },
  importDocumentUrl(
    serviceId: string,
    knowledgeBaseId: string,
    documentUrl: string,
    ingestion: RagIngestionRequest,
  ) {
    return invoke<RagAcceptedJob>("rag_hub_import_document_url", {
      service_id: serviceId,
      knowledge_base_id: knowledgeBaseId,
      document_url: documentUrl,
      ingestion,
    });
  },
  getIngestionJob(serviceId: string, jobId: string) {
    return invoke<RagIngestionJob>("rag_hub_get_ingestion_job", {
      service_id: serviceId,
      job_id: jobId,
    });
  },
  listIngestionJobs(serviceId: string, documentId: string, current = 1, size = 20) {
    return invoke<RagPage<RagIngestionJob>>("rag_hub_list_ingestion_jobs", {
      service_id: serviceId,
      document_id: documentId,
      current,
      size,
    });
  },
  retryIngestionJob(serviceId: string, jobId: string) {
    return invoke<RagIngestionJob>("rag_hub_retry_ingestion_job", {
      service_id: serviceId,
      job_id: jobId,
    });
  },
  deleteDocument(serviceId: string, documentId: string) {
    return invoke<void>("rag_hub_delete_document", {
      service_id: serviceId,
      document_id: documentId,
    });
  },
  listDocumentChunks(serviceId: string, documentId: string, current = 1, size = 100) {
    return invoke<RagPage<RagChunk>>("rag_hub_list_document_chunks", {
      service_id: serviceId,
      document_id: documentId,
      current,
      size,
    });
  },
  search(request: RagSearchRequest) {
    return invoke<RagSearchResponse>("rag_hub_search", { request });
  },
  rerank(request: RagRerankRequest) {
    return invoke<RagSearchResponse>("rag_hub_rerank", { request });
  },
  agentListKnowledgeBases(serviceId?: string) {
    return invoke<RagKnowledgeBase[]>("rag_agent_list_knowledge_bases", {
      service_id: serviceId,
    });
  },
  agentSearch(request: RagSearchRequest) {
    return invoke<RagSearchResponse>("rag_agent_search", { request });
  },
};
