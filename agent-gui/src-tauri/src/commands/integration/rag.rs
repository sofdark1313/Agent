use serde::Deserialize;
use serde_json::Value;

use crate::services::rag::{
    RagAccessMode, RagCapabilities, RagCredentialKind, RagCredentialStore, RagGatewayService,
    RagKnowledgeBase, RagSearchRequest, RagSearchResponse, RagServiceConfig, RagServiceStore,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSaveServiceRequest {
    pub service: RagServiceConfig,
    pub management_api_key: Option<String>,
    pub agent_api_key: Option<String>,
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
        if service.adapter_type != "ragent" {
            return Err(crate::services::rag::RagError::new(
                "RAG_PROTOCOL_MISMATCH",
                "第一版只支持 ragent 适配器",
            ));
        }
        if let Some(api_key) = request.management_api_key {
            credentials.set(&service.id, RagCredentialKind::Management, &api_key)?;
            service.management_credential_configured = !api_key.trim().is_empty();
        }
        if let Some(api_key) = request.agent_api_key {
            credentials.set(&service.id, RagCredentialKind::Agent, &api_key)?;
            service.agent_credential_configured = !api_key.trim().is_empty();
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
pub async fn rag_hub_list_documents(
    service_id: Option<String>,
    knowledge_base_id: String,
    current: Option<u32>,
    size: Option<u32>,
) -> Result<Value, String> {
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
) -> Result<Value, String> {
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
pub async fn rag_hub_get_document(
    service_id: Option<String>,
    document_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.get_document(service_id.as_deref(), &document_id)
    })
    .await
    .map_err(|error| format!("rag_hub_get_document join 失败：{error}"))?
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
