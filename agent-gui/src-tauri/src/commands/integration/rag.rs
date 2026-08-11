use std::sync::{Mutex, MutexGuard};

use rfd::FileDialog;
use serde::Deserialize;

use crate::services::rag::{
    normalize_service_config, RagAcceptedJob, RagAccessMode, RagCapabilities, RagChunk,
    RagCredentialKind, RagCredentialStore, RagDocument, RagError, RagGatewayService,
    RagIngestionJob, RagIngestionRequest, RagKnowledgeBase, RagPage, RagPickedDocumentFile,
    RagRerankRequest, RagSearchRequest, RagSearchResponse, RagServiceConfig, RagServiceStore,
};

static RAG_SERVICE_MUTATION_LOCK: Mutex<()> = Mutex::new(());

fn lock_service_mutations() -> MutexGuard<'static, ()> {
    RAG_SERVICE_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RagSaveServiceRequest {
    pub service: RagServiceConfig,
}

pub(crate) trait RagServiceRepository {
    fn get(&self, service_id: &str) -> Result<Option<RagServiceConfig>, RagError>;
    fn save(&self, service: &RagServiceConfig) -> Result<(), RagError>;
    fn delete(&self, service_id: &str) -> Result<bool, RagError>;
}

impl RagServiceRepository for RagServiceStore {
    fn get(&self, service_id: &str) -> Result<Option<RagServiceConfig>, RagError> {
        RagServiceStore::get(self, service_id)
    }

    fn save(&self, service: &RagServiceConfig) -> Result<(), RagError> {
        RagServiceStore::save(self, service)
    }

    fn delete(&self, service_id: &str) -> Result<bool, RagError> {
        RagServiceStore::delete(self, service_id)
    }
}

pub(crate) trait RagCredentialRepository {
    fn get_optional(
        &self,
        service_id: &str,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError>;
    fn set(&self, service_id: &str, kind: RagCredentialKind, api_key: &str)
        -> Result<(), RagError>;
    fn delete(&self, service_id: &str, kind: RagCredentialKind) -> Result<(), RagError>;
}

impl RagCredentialRepository for RagCredentialStore {
    fn get_optional(
        &self,
        service_id: &str,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError> {
        RagCredentialStore::get_optional(self, service_id, kind)
    }

    fn set(
        &self,
        service_id: &str,
        kind: RagCredentialKind,
        api_key: &str,
    ) -> Result<(), RagError> {
        RagCredentialStore::set(self, service_id, kind, api_key)
    }

    fn delete(&self, service_id: &str, kind: RagCredentialKind) -> Result<(), RagError> {
        RagCredentialStore::delete(self, service_id, kind)
    }
}

#[derive(Debug)]
struct CredentialSnapshot {
    kind: RagCredentialKind,
    previous: Option<String>,
}

fn rollback_credentials<C: RagCredentialRepository>(
    credentials: &C,
    service_id: &str,
    snapshots: &[CredentialSnapshot],
) -> Result<(), RagError> {
    let mut first_error = None;
    for snapshot in snapshots.iter().rev() {
        let result = match &snapshot.previous {
            Some(value) => credentials.set(service_id, snapshot.kind, value),
            None => credentials.delete(service_id, snapshot.kind),
        };
        if first_error.is_none() {
            first_error = result.err();
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn rollback_or_original<C: RagCredentialRepository>(
    credentials: &C,
    service_id: &str,
    snapshots: &[CredentialSnapshot],
    original: RagError,
) -> RagError {
    match rollback_credentials(credentials, service_id, snapshots) {
        Ok(()) => original,
        Err(rollback) => RagError::new(
            "RAG_CREDENTIAL_ROLLBACK_FAILED",
            format!("{} -> {}", original.code(), rollback.code()),
        ),
    }
}

pub(crate) fn delete_service_with_dependencies<
    S: RagServiceRepository,
    C: RagCredentialRepository,
>(
    store: &S,
    credentials: &C,
    service_id: &str,
) -> Result<bool, RagError> {
    let _mutation_guard = lock_service_mutations();
    let snapshots = [
        CredentialSnapshot {
            kind: RagCredentialKind::Management,
            previous: credentials.get_optional(service_id, RagCredentialKind::Management)?,
        },
        CredentialSnapshot {
            kind: RagCredentialKind::Agent,
            previous: credentials.get_optional(service_id, RagCredentialKind::Agent)?,
        },
    ];

    for snapshot in &snapshots {
        if let Err(error) = credentials.delete(service_id, snapshot.kind) {
            return Err(rollback_or_original(
                credentials,
                service_id,
                &snapshots,
                error,
            ));
        }
    }
    store
        .delete(service_id)
        .map_err(|error| rollback_or_original(credentials, service_id, &snapshots, error))
}

pub(crate) fn save_service_with_dependencies<
    S: RagServiceRepository,
    C: RagCredentialRepository,
>(
    store: &S,
    credentials: &C,
    request: RagSaveServiceRequest,
) -> Result<RagServiceConfig, RagError> {
    let _mutation_guard = lock_service_mutations();
    let RagSaveServiceRequest { mut service } = request;
    normalize_service_config(&mut service)?;
    if service.adapter_type != "ragent" {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "第一版只支持 ragent 适配器",
        ));
    }

    service.capabilities_snapshot = None;
    service.management_credential_configured = credentials
        .get_optional(&service.id, RagCredentialKind::Management)?
        .is_some();
    service.agent_credential_configured = credentials
        .get_optional(&service.id, RagCredentialKind::Agent)?
        .is_some();
    store.save(&service)?;
    Ok(service)
}

pub(crate) trait RagCredentialPrompt {
    fn prompt(
        &self,
        service: &RagServiceConfig,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError>;
}

#[derive(Debug, Default, Clone, Copy)]
struct NativeRagCredentialPrompt;

impl RagCredentialPrompt for NativeRagCredentialPrompt {
    fn prompt(
        &self,
        _service: &RagServiceConfig,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError> {
        let (title, message) = match kind {
            RagCredentialKind::Management => (
                "RAG 管理凭证",
                "请输入管理 API Key。密钥将由 Rust 直接写入系统凭证库，不会传给前端。",
            ),
            RagCredentialKind::Agent => (
                "RAG Agent 凭证",
                "请输入只读 Agent API Key。密钥将由 Rust 直接写入系统凭证库，不会传给前端。",
            ),
        };
        Ok(tinyfiledialogs::password_box(title, message))
    }
}

fn require_saved_service<S: RagServiceRepository>(
    store: &S,
    service_id: &str,
) -> Result<RagServiceConfig, RagError> {
    store
        .get(service_id)?
        .ok_or_else(|| RagError::new("RAG_SERVICE_NOT_FOUND", "未找到指定的 RAG 服务"))
}

fn set_credential_flag(service: &mut RagServiceConfig, kind: RagCredentialKind, value: bool) {
    match kind {
        RagCredentialKind::Management => service.management_credential_configured = value,
        RagCredentialKind::Agent => service.agent_credential_configured = value,
    }
}

fn mutate_service_credential<S: RagServiceRepository, C: RagCredentialRepository>(
    store: &S,
    credentials: &C,
    service_id: &str,
    kind: RagCredentialKind,
    value: Option<&str>,
) -> Result<RagServiceConfig, RagError> {
    let _mutation_guard = lock_service_mutations();
    let mut service = require_saved_service(store, service_id)?;
    let snapshot = CredentialSnapshot {
        kind,
        previous: credentials.get_optional(service_id, kind)?,
    };
    let snapshots = [snapshot];
    let mutation = match value {
        Some(value) => credentials.set(service_id, kind, value),
        None => credentials.delete(service_id, kind),
    };
    if let Err(error) = mutation {
        return Err(rollback_or_original(
            credentials,
            service_id,
            &snapshots,
            error,
        ));
    }

    set_credential_flag(&mut service, kind, value.is_some());
    service.capabilities_snapshot = None;
    if let Err(error) = store.save(&service) {
        return Err(rollback_or_original(
            credentials,
            service_id,
            &snapshots,
            error,
        ));
    }
    Ok(service)
}

pub(crate) fn prompt_service_credential_with_dependencies<
    S: RagServiceRepository,
    C: RagCredentialRepository,
    P: RagCredentialPrompt,
>(
    store: &S,
    credentials: &C,
    prompt: &P,
    service_id: &str,
    kind: RagCredentialKind,
) -> Result<Option<RagServiceConfig>, RagError> {
    let service = require_saved_service(store, service_id)?;
    let Some(value) = prompt.prompt(&service, kind)? else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Err(RagError::new("RAG_REQUEST_INVALID", "RAG API Key 不能为空"));
    }
    mutate_service_credential(store, credentials, service_id, kind, Some(value)).map(Some)
}

pub(crate) fn clear_service_credential_with_dependencies<
    S: RagServiceRepository,
    C: RagCredentialRepository,
>(
    store: &S,
    credentials: &C,
    service_id: &str,
    kind: RagCredentialKind,
) -> Result<RagServiceConfig, RagError> {
    mutate_service_credential(store, credentials, service_id, kind, None)
}

fn parse_credential_kind(value: &str) -> Result<RagCredentialKind, RagError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "management" => Ok(RagCredentialKind::Management),
        "agent" => Ok(RagCredentialKind::Agent),
        _ => Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "credential_kind 必须是 management 或 agent",
        )),
    }
}

fn format_error(error: crate::services::rag::RagError) -> String {
    format!("{}: {error}", error.code())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_list_services() -> Result<Vec<RagServiceConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| RagServiceStore::open()?.list())
        .await
        .map_err(|error| format!("rag_list_services join 失败：{error}"))?
        .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_save_service(request: RagSaveServiceRequest) -> Result<RagServiceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = RagServiceStore::open()?;
        let credentials = RagCredentialStore;
        save_service_with_dependencies(&store, &credentials, request)
    })
    .await
    .map_err(|error| format!("rag_save_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_prompt_service_credential(
    service_id: String,
    credential_kind: String,
) -> Result<Option<RagServiceConfig>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = RagServiceStore::open()?;
        let credentials = RagCredentialStore;
        let prompt = NativeRagCredentialPrompt;
        let kind = parse_credential_kind(&credential_kind)?;
        prompt_service_credential_with_dependencies(
            &store,
            &credentials,
            &prompt,
            &service_id,
            kind,
        )
    })
    .await
    .map_err(|error| format!("rag_prompt_service_credential join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_clear_service_credential(
    service_id: String,
    credential_kind: String,
) -> Result<RagServiceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = RagServiceStore::open()?;
        let credentials = RagCredentialStore;
        let kind = parse_credential_kind(&credential_kind)?;
        clear_service_credential_with_dependencies(&store, &credentials, &service_id, kind)
    })
    .await
    .map_err(|error| format!("rag_clear_service_credential join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_delete_service(service_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = RagServiceStore::open()?;
        let credentials = RagCredentialStore;
        delete_service_with_dependencies(&store, &credentials, &service_id)
    })
    .await
    .map_err(|error| format!("rag_delete_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_test_service(service_id: String) -> Result<RagCapabilities, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.test_service(&service_id)
    })
    .await
    .map_err(|error| format!("rag_test_service join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_hub_upload_document(
    service_id: Option<String>,
    knowledge_base_id: String,
    file_path: String,
    ingestion: RagIngestionRequest,
) -> Result<RagAcceptedJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.upload_document(
            service_id.as_deref(),
            &knowledge_base_id,
            &file_path,
            &ingestion,
        )
    })
    .await
    .map_err(|error| format!("rag_hub_upload_document join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_hub_import_document_url(
    service_id: Option<String>,
    knowledge_base_id: String,
    document_url: String,
    ingestion: RagIngestionRequest,
) -> Result<RagAcceptedJob, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.import_document_url(
            service_id.as_deref(),
            &knowledge_base_id,
            &document_url,
            &ingestion,
        )
    })
    .await
    .map_err(|error| format!("rag_hub_import_document_url join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_pick_document_file(
    service_id: String,
) -> Result<Option<RagPickedDocumentFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let gateway = RagGatewayService::open()?;
        let extensions = gateway
            .document_picker_extensions(Some(&service_id))?
            .into_iter()
            .map(|extension| extension.trim_start_matches('.').to_string())
            .collect::<Vec<_>>();
        let selected = FileDialog::new()
            .add_filter("知识文档", &extensions)
            .pick_file();
        selected
            .map(|path| {
                gateway.inspect_document_file(Some(&service_id), path.to_string_lossy().as_ref())
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("rag_pick_document_file join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_hub_list_ingestion_jobs(
    service_id: Option<String>,
    document_id: String,
    current: Option<u32>,
    size: Option<u32>,
) -> Result<RagPage<RagIngestionJob>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.list_ingestion_jobs(
            service_id.as_deref(),
            &document_id,
            current.unwrap_or(1),
            size.unwrap_or(20),
        )
    })
    .await
    .map_err(|error| format!("rag_hub_list_ingestion_jobs join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_hub_search(request: RagSearchRequest) -> Result<RagSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.search(request, RagAccessMode::Management)
    })
    .await
    .map_err(|error| format!("rag_hub_search join 失败：{error}"))?
    .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_hub_rerank(request: RagRerankRequest) -> Result<RagSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || RagGatewayService::open()?.rerank(request))
        .await
        .map_err(|error| format!("rag_hub_rerank join 失败：{error}"))?
        .map_err(format_error)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn rag_agent_search(request: RagSearchRequest) -> Result<RagSearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        RagGatewayService::open()?.search(request, RagAccessMode::Agent)
    })
    .await
    .map_err(|error| format!("rag_agent_search join 失败：{error}"))?
    .map_err(format_error)
}
