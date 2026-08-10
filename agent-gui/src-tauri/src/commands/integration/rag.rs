use rfd::FileDialog;
use serde::Deserialize;

use crate::services::rag::{
    normalize_service_config, RagAcceptedJob, RagAccessMode, RagCapabilities, RagChunk,
    RagCredentialKind, RagCredentialStore, RagDocument, RagGatewayService, RagIngestionJob,
    RagKnowledgeBase, RagPage, RagSearchRequest, RagSearchResponse, RagServiceConfig,
    RagServiceStore,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSaveServiceRequest {
    pub service: RagServiceConfig,
    pub management_api_key: Option<String>,
    pub agent_api_key: Option<String>,
}

pub(crate) fn requires_capabilities_retest(
    existing: Option<&RagServiceConfig>,
    next: &RagServiceConfig,
    management_api_key_updated: bool,
    agent_api_key_updated: bool,
) -> bool {
    let Some(existing) = existing else {
        return true;
    };
    management_api_key_updated
        || agent_api_key_updated
        || existing.adapter_type != next.adapter_type
        || existing.base_url != next.base_url
}

pub(crate) fn apply_credential_state(
    service: &mut RagServiceConfig,
    existing: Option<&RagServiceConfig>,
    management_api_key: Option<&str>,
    agent_api_key: Option<&str>,
) {
    service.management_credential_configured = management_api_key
        .map(|key| !key.trim().is_empty())
        .unwrap_or_else(|| {
            existing.is_some_and(|current| current.management_credential_configured)
        });
    service.agent_credential_configured = agent_api_key
        .map(|key| !key.trim().is_empty())
        .unwrap_or_else(|| existing.is_some_and(|current| current.agent_credential_configured));
}

fn format_error(error: crate::services::rag::RagError) -> String {
    format!("{}: {error}", error.code())
}

#[tauri::command]
pub async fn rag_list_services() -> Result<Vec<RagServiceConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| RagServiceStore::open()?.list())
        .await
        .map_err(|error| format!("rag_list_services join 失败：{error}"))?
        .map_err(format_error)
}

#[tauri::command]
pub async fn rag_save_service(request: RagSaveServiceRequest) -> Result<RagServiceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = RagServiceStore::open()?;
        let credentials = RagCredentialStore;
        let mut service = request.service;
        normalize_service_config(&mut service)?;
        if service.adapter_type != "ragent" {
            return Err(crate::services::rag::RagError::new(
                "RAG_PROTOCOL_MISMATCH",
                "第一版只支持 ragent 适配器",
            ));
        }
        let existing = store.get(&service.id)?;
        let management_api_key_updated = request.management_api_key.is_some();
        let agent_api_key_updated = request.agent_api_key.is_some();
        if requires_capabilities_retest(
            existing.as_ref(),
            &service,
            management_api_key_updated,
            agent_api_key_updated,
        ) {
            service.capabilities_snapshot = None;
        }
        apply_credential_state(
            &mut service,
            existing.as_ref(),
            request.management_api_key.as_deref(),
            request.agent_api_key.as_deref(),
        );
        if let Some(api_key) = request.management_api_key {
            credentials.set(&service.id, RagCredentialKind::Management, &api_key)?;
        }
        if let Some(api_key) = request.agent_api_key {
            credentials.set(&service.id, RagCredentialKind::Agent, &api_key)?;
        }
        store.save(&service)?;
        Ok(service)
    })
    .await
    .map_err(|error| format!("rag_save_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_delete_service(service_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credentials = RagCredentialStore;
        credentials.delete(&service_id, RagCredentialKind::Management)?;
        credentials.delete(&service_id, RagCredentialKind::Agent)?;
        RagServiceStore::open()?.delete(&service_id)
    })
    .await
    .map_err(|error| format!("rag_delete_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_test_service(service_id: String) -> Result<RagCapabilities, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.test_service(&service_id)
    })
    .await
    .map_err(|error| format!("rag_test_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_list_knowledge_bases(
    service_id: Option<String>,
) -> Result<Vec<RagKnowledgeBase>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?
            .list_knowledge_bases(service_id.as_deref(), RagAccessMode::Management)
    })
    .await
    .map_err(|error| format!("rag_hub_list_knowledge_bases join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_create_knowledge_base(
    service_id: Option<String>,
    name: String,
    embedding_model: String,
    collection_name: String,
) -> Result<RagKnowledgeBase, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.create_knowledge_base(
            service_id.as_deref(),
            &name,
            &embedding_model,
            &collection_name,
        )
    })
    .await
    .map_err(|error| format!("rag_hub_create_knowledge_base join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_update_knowledge_base(
    service_id: Option<String>,
    knowledge_base_id: String,
    name: Option<String>,
    embedding_model: Option<String>,
) -> Result<RagKnowledgeBase, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.update_knowledge_base(
            service_id.as_deref(),
            &knowledge_base_id,
            name.as_deref(),
            embedding_model.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("rag_hub_update_knowledge_base join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_delete_knowledge_base(
    service_id: Option<String>,
    knowledge_base_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.delete_knowledge_base(service_id.as_deref(), &knowledge_base_id)
    })
    .await
    .map_err(|error| format!("rag_hub_delete_knowledge_base join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_list_documents(
    service_id: Option<String>,
    knowledge_base_id: String,
    current: Option<u32>,
    size: Option<u32>,
) -> Result<RagPage<RagDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.list_documents(
            service_id.as_deref(),
            &knowledge_base_id,
            current.unwrap_or(1),
            size.unwrap_or(50),
        )
    })
    .await
    .map_err(|error| format!("rag_hub_list_documents join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_upload_document(
    service_id: Option<String>,
    knowledge_base_id: String,
    file_path: String,
) -> Result<RagAcceptedJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.upload_document(
            service_id.as_deref(),
            &knowledge_base_id,
            &file_path,
        )
    })
    .await
    .map_err(|error| format!("rag_hub_upload_document join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_import_document_url(
    service_id: Option<String>,
    knowledge_base_id: String,
    document_url: String,
) -> Result<RagAcceptedJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.import_document_url(
            service_id.as_deref(),
            &knowledge_base_id,
            &document_url,
        )
    })
    .await
    .map_err(|error| format!("rag_hub_import_document_url join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_get_document(
    service_id: Option<String>,
    document_id: String,
) -> Result<RagDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.get_document(service_id.as_deref(), &document_id)
    })
    .await
    .map_err(|error| format!("rag_hub_get_document join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_pick_document_file() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(FileDialog::new()
            .add_filter(
                "知识文档",
                &["pdf", "md", "markdown", "txt", "csv", "xls", "xlsx", "docx"],
            )
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("rag_pick_document_file join 失败：{error}"))?
}

#[tauri::command]
pub async fn rag_hub_get_ingestion_job(
    service_id: Option<String>,
    job_id: String,
) -> Result<RagIngestionJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.get_ingestion_job(service_id.as_deref(), &job_id)
    })
    .await
    .map_err(|error| format!("rag_hub_get_ingestion_job join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_retry_ingestion_job(
    service_id: Option<String>,
    job_id: String,
) -> Result<RagIngestionJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.retry_ingestion_job(service_id.as_deref(), &job_id)
    })
    .await
    .map_err(|error| format!("rag_hub_retry_ingestion_job join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_delete_document(
    service_id: Option<String>,
    document_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.delete_document(service_id.as_deref(), &document_id)
    })
    .await
    .map_err(|error| format!("rag_hub_delete_document join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_list_document_chunks(
    service_id: Option<String>,
    document_id: String,
    current: Option<u32>,
    size: Option<u32>,
) -> Result<RagPage<RagChunk>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.list_document_chunks(
            service_id.as_deref(),
            &document_id,
            current.unwrap_or(1),
            size.unwrap_or(50),
        )
    })
    .await
    .map_err(|error| format!("rag_hub_list_document_chunks join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_hub_search(request: RagSearchRequest) -> Result<RagSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.search(request, RagAccessMode::Management)
    })
    .await
    .map_err(|error| format!("rag_hub_search join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_agent_list_knowledge_bases(
    service_id: Option<String>,
) -> Result<Vec<RagKnowledgeBase>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.list_knowledge_bases(service_id.as_deref(), RagAccessMode::Agent)
    })
    .await
    .map_err(|error| format!("rag_agent_list_knowledge_bases join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command]
pub async fn rag_agent_search(request: RagSearchRequest) -> Result<RagSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.search(request, RagAccessMode::Agent)
    })
    .await
    .map_err(|error| format!("rag_agent_search join 失败：{error}"))?
    .map_err(format_error)
}
