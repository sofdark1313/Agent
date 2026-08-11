use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::sanitizer::{
    sanitize_error_code, sanitize_error_message, RagSanitizeResponse, SanitizationBudget,
};
use super::model::RagHealth;
use super::{
    RagAcceptedJob, RagAccessMode, RagCapabilities, RagChunk, RagCredentialKind,
    RagCredentialProvider, RagCredentialStore, RagDocument, RagError, RagIngestionCapabilities,
    RagIngestionJob, RagIngestionRequest, RagKnowledgeBase, RagPage, RagPickedDocumentFile,
    RagRerankCandidate, RagRerankRequest, RagSearchRequest, RagSearchResponse, RagServiceConfig,
    RagServiceStore,
};

const MAX_JSON_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const SUPPORTED_PROTOCOL_MAJOR: &str = "1";
const LOCAL_MAX_TOP_K: u32 = 50;
const LOCAL_MAX_TOP_N: u32 = 20;
const LOCAL_MAX_QUERY_LENGTH: usize = 4_000;
const LOCAL_MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;
const LOCAL_MAX_RERANK_CANDIDATES: usize = 100;
const LOCAL_MAX_RERANK_CONTENT_LENGTH: usize = 200_000;
const CAPABILITY_TTL_MS: u64 = 5 * 60 * 1_000;

pub struct RagGatewayService {
    store: RagServiceStore,
    credentials: Arc<dyn RagCredentialProvider>,
}

impl RagGatewayService {
    pub fn open() -> Result<Self, RagError> {
        Ok(Self {
            store: RagServiceStore::open()?,
            credentials: Arc::new(RagCredentialStore),
        })
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(
        store: RagServiceStore,
        credentials: Arc<dyn RagCredentialProvider>,
    ) -> Self {
        Self { store, credentials }
    }

    pub fn test_service(&self, service_id: &str) -> Result<RagCapabilities, RagError> {
        let mut service = self
            .store
            .resolve(Some(service_id), RagAccessMode::Management)?;
        service.capabilities_snapshot = None;
        self.store.save(&service)?;
        let health: RagHealth = self.get_public_json(&service, "/health")?;
        if !health.status.trim().eq_ignore_ascii_case("ok") {
            return Err(RagError::new(
                "RAG_RESPONSE_INVALID",
                "RAG 健康检查未返回可用状态",
            ));
        }
        let mut capabilities = None;
        for mode in service_test_modes(&service) {
            let mut current: RagCapabilities = self.get_json(&service, mode, "/capabilities")?;
            let captured_at_ms = unix_time_ms();
            current.captured_at_ms = Some(captured_at_ms);
            validate_agent_protocol_at(Some(&current), captured_at_ms)?;
            validate_capability_audience(&current, mode)?;
            if capabilities.is_none() {
                capabilities = Some(current);
            }
        }
        let capabilities = capabilities
            .ok_or_else(|| RagError::new("RAG_RESPONSE_INVALID", "RAG 服务未返回能力信息"))?;
        service.capabilities_snapshot = Some(capabilities.clone());
        self.store.save(&service)?;
        Ok(capabilities)
    }

    #[cfg(test)]
    pub(crate) fn stored_service_for_test(
        &self,
        service_id: &str,
    ) -> Result<Option<RagServiceConfig>, RagError> {
        self.store.get(service_id)
    }

    pub fn list_knowledge_bases(
        &self,
        service_id: Option<&str>,
        mode: RagAccessMode,
    ) -> Result<Vec<RagKnowledgeBase>, RagError> {
        let service = self.store.resolve(service_id, mode)?;
        if mode == RagAccessMode::Agent {
            self.complete_protocol_checked(
                &service,
                validate_agent_protocol(service.capabilities_snapshot.as_ref()),
            )?;
        }
        let result = self.get_json(&service, mode, "/knowledge-bases")?;
        Ok(if mode == RagAccessMode::Agent {
            filter_agent_knowledge_bases(&service, result)
        } else {
            result
        })
    }

    pub fn create_knowledge_base(
        &self,
        service_id: Option<&str>,
        name: &str,
        embedding_model: &str,
        collection_name: &str,
    ) -> Result<RagKnowledgeBase, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let payload = CreateKnowledgeBasePayload {
            name: required_value(name, "知识库名称")?,
            embedding_model: required_value(embedding_model, "嵌入模型")?,
            collection_name: required_value(collection_name, "集合名称")?,
        };
        self.post_json(
            &service,
            RagAccessMode::Management,
            "/knowledge-bases",
            &payload,
        )
    }

    pub fn update_knowledge_base(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        name: Option<&str>,
        embedding_model: Option<&str>,
    ) -> Result<RagKnowledgeBase, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let payload = UpdateKnowledgeBasePayload {
            name: optional_value(name),
            embedding_model: optional_value(embedding_model),
        };
        if payload.name.is_none() && payload.embedding_model.is_none() {
            return Err(RagError::new(
                "RAG_REQUEST_INVALID",
                "知识库名称和嵌入模型不能同时为空",
            ));
        }
        self.put_json(
            &service,
            RagAccessMode::Management,
            &format!("/knowledge-bases/{}", url_segment(knowledge_base_id)),
            &payload,
        )
    }

    pub fn delete_knowledge_base(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
    ) -> Result<(), RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let request = self.client(&service)?.delete(endpoint(
            &service,
            &format!("/knowledge-bases/{}", url_segment(knowledge_base_id)),
        )?);
        self.send_empty(
            &service,
            self.authorize(request, &service, RagAccessMode::Management)?,
        )
    }

    pub fn list_documents(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        current: u32,
        size: u32,
    ) -> Result<RagPage<RagDocument>, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let path = format!(
            "/knowledge-bases/{}/documents?current={}&size={}",
            url_segment(knowledge_base_id),
            current.max(1),
            size.clamp(1, 100)
        );
        self.get_json(&service, RagAccessMode::Management, &path)
    }

    pub fn get_document(
        &self,
        service_id: Option<&str>,
        document_id: &str,
    ) -> Result<RagDocument, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.get_json(
            &service,
            RagAccessMode::Management,
            &format!("/documents/{}", url_segment(document_id)),
        )
    }

    pub fn document_picker_extensions(
        &self,
        service_id: Option<&str>,
    ) -> Result<Vec<String>, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.complete_protocol_checked(
            &service,
            require_feature(
                service.capabilities_snapshot.as_ref(),
                "fileUpload",
                "文件上传",
            ),
        )?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_ingestion_policy(service.capabilities_snapshot.as_ref()),
        )?;
        Ok(policy.allowed_extensions)
    }

    pub fn inspect_document_file(
        &self,
        service_id: Option<&str>,
        file_path: &str,
    ) -> Result<RagPickedDocumentFile, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.complete_protocol_checked(
            &service,
            require_feature(
                service.capabilities_snapshot.as_ref(),
                "fileUpload",
                "文件上传",
            ),
        )?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_ingestion_policy(service.capabilities_snapshot.as_ref()),
        )?;
        inspect_document_path(Path::new(file_path), &policy)
    }

    pub fn upload_document(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        file_path: &str,
        ingestion: &RagIngestionRequest,
    ) -> Result<RagAcceptedJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.complete_protocol_checked(
            &service,
            require_feature(
                service.capabilities_snapshot.as_ref(),
                "fileUpload",
                "文件上传",
            ),
        )?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_ingestion_policy(service.capabilities_snapshot.as_ref()),
        )?;
        validate_ingestion_request(&policy, ingestion)?;
        let path = Path::new(file_path);
        inspect_document_path(path, &policy)?;
        let mut form = multipart::Form::new()
            .file("file", path)
            .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?
            .text("processMode", ingestion.process_mode.clone());
        if let Some(chunk_strategy) = &ingestion.chunk_strategy {
            form = form.text("chunkStrategy", chunk_strategy.clone());
        }
        if let Some(chunk_config) = &ingestion.chunk_config {
            form = form.text(
                "chunkConfig",
                serde_json::to_string(chunk_config).map_err(|error| {
                    RagError::new(
                        "RAG_REQUEST_INVALID",
                        format!("分块配置序列化失败：{error}"),
                    )
                })?,
            );
        }
        if let Some(pipeline_id) = &ingestion.pipeline_id {
            form = form.text("pipelineId", pipeline_id.clone());
        }
        let request = self
            .client(&service)?
            .post(endpoint(
                &service,
                &format!(
                    "/knowledge-bases/{}/documents/upload",
                    url_segment(knowledge_base_id)
                ),
            )?)
            .header("Idempotency-Key", Uuid::new_v4().to_string())
            .multipart(form);
        self.send_json(
            &service,
            self.authorize(request, &service, RagAccessMode::Management)?,
        )
    }

    pub fn import_document_url(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        document_url: &str,
        ingestion: &RagIngestionRequest,
    ) -> Result<RagAcceptedJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.complete_protocol_checked(
            &service,
            require_feature(
                service.capabilities_snapshot.as_ref(),
                "urlImport",
                "URL 入库",
            ),
        )?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_ingestion_policy(service.capabilities_snapshot.as_ref()),
        )?;
        validate_ingestion_request(&policy, ingestion)?;
        let document_url = required_value(document_url, "文档 URL")?;
        let parsed = Url::parse(&document_url)
            .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(RagError::new(
                "RAG_REQUEST_INVALID",
                "文档 URL 必须是无用户信息的 HTTP(S) 地址",
            ));
        }
        let payload = UrlImportPayload {
            url: document_url,
            ingestion,
        };
        let request = self
            .client(&service)?
            .post(endpoint(
                &service,
                &format!(
                    "/knowledge-bases/{}/documents/import-url",
                    url_segment(knowledge_base_id)
                ),
            )?)
            .header("Idempotency-Key", Uuid::new_v4().to_string())
            .json(&payload);
        self.send_json(
            &service,
            self.authorize(request, &service, RagAccessMode::Management)?,
        )
    }

    pub fn get_ingestion_job(
        &self,
        service_id: Option<&str>,
        job_id: &str,
    ) -> Result<RagIngestionJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.get_json(
            &service,
            RagAccessMode::Management,
            &format!("/ingestion-jobs/{}", url_segment(job_id)),
        )
    }

    pub fn list_ingestion_jobs(
        &self,
        service_id: Option<&str>,
        document_id: &str,
        current: u32,
        size: u32,
    ) -> Result<RagPage<RagIngestionJob>, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.get_json(
            &service,
            RagAccessMode::Management,
            &format!(
                "/documents/{}/ingestion-jobs?current={}&size={}",
                url_segment(document_id),
                current.max(1),
                size.clamp(1, 100)
            ),
        )
    }

    pub fn retry_ingestion_job(
        &self,
        service_id: Option<&str>,
        job_id: &str,
    ) -> Result<RagIngestionJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let request = self
            .client(&service)?
            .post(endpoint(
                &service,
                &format!("/ingestion-jobs/{}/retry", url_segment(job_id)),
            )?)
            .header("Idempotency-Key", Uuid::new_v4().to_string());
        self.send_json(
            &service,
            self.authorize(request, &service, RagAccessMode::Management)?,
        )
    }

    pub fn delete_document(
        &self,
        service_id: Option<&str>,
        document_id: &str,
    ) -> Result<(), RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let request = self.client(&service)?.delete(endpoint(
            &service,
            &format!("/documents/{}", url_segment(document_id)),
        )?);
        self.send_empty(
            &service,
            self.authorize(request, &service, RagAccessMode::Management)?,
        )
    }

    pub fn list_document_chunks(
        &self,
        service_id: Option<&str>,
        document_id: &str,
        current: u32,
        size: u32,
    ) -> Result<RagPage<RagChunk>, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        self.get_json(
            &service,
            RagAccessMode::Management,
            &format!(
                "/documents/{}/chunks?current={}&size={}",
                url_segment(document_id),
                current.max(1),
                size.clamp(1, 100)
            ),
        )
    }

    pub fn search(
        &self,
        mut request: RagSearchRequest,
        mode: RagAccessMode,
    ) -> Result<RagSearchResponse, RagError> {
        let service = self.store.resolve(request.service_id.as_deref(), mode)?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_search_policy(service.capabilities_snapshot.as_ref()),
        )?;
        if request.query.trim().is_empty() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "检索问题不能为空"));
        }
        request.knowledge_base_ids = normalize_knowledge_base_ids(request.knowledge_base_ids);
        if mode == RagAccessMode::Agent {
            if request.knowledge_base_ids.is_empty() {
                request.knowledge_base_ids = service.agent_knowledge_base_ids.clone();
            }
            let allowed = service
                .agent_knowledge_base_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            if request
                .knowledge_base_ids
                .iter()
                .any(|id| !allowed.contains(id.as_str()))
            {
                return Err(RagError::new(
                    "RAG_KB_FORBIDDEN",
                    "请求包含 Agent 未授权的知识库",
                ));
            }
        }
        if request.knowledge_base_ids.is_empty() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "至少选择一个知识库"));
        }
        let query = request.query.trim().to_string();
        if query.encode_utf16().count() > policy.max_query_length {
            return Err(RagError::new(
                "RAG_REQUEST_INVALID",
                format!("检索问题不能超过 {} 个字符", policy.max_query_length),
            ));
        }
        let rerank_requested = request.rerank.unwrap_or(true);
        let payload = SearchPayload {
            query,
            knowledge_base_ids: request.knowledge_base_ids,
            top_k: request.top_k.unwrap_or(10).clamp(1, policy.max_top_k),
            rerank: rerank_requested && policy.rerank_supported,
            top_n: request.top_n.unwrap_or(5).clamp(1, policy.max_top_n),
        };
        let mut response: RagSearchResponse =
            self.post_json(&service, mode, "/retrieval", &payload)?;
        if rerank_requested
            && !policy.rerank_supported
            && !response
                .warnings
                .iter()
                .any(|warning| warning == "RAG_RERANK_UNAVAILABLE")
        {
            response.warnings.push("RAG_RERANK_UNAVAILABLE".to_string());
        }
        Ok(response)
    }

    pub fn rerank(&self, request: RagRerankRequest) -> Result<RagSearchResponse, RagError> {
        let RagRerankRequest {
            service_id,
            query,
            candidates,
            top_n,
        } = request;
        let service = self
            .store
            .resolve(service_id.as_deref(), RagAccessMode::Management)?;
        self.complete_protocol_checked(
            &service,
            validate_rerank_capability(service.capabilities_snapshot.as_ref()),
        )?;
        let policy = self.complete_protocol_checked(
            &service,
            resolve_search_policy(service.capabilities_snapshot.as_ref()),
        )?;

        let query = query.trim().to_string();
        if query.is_empty() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "重排问题不能为空"));
        }
        if query.encode_utf16().count() > policy.max_query_length {
            return Err(RagError::new(
                "RAG_REQUEST_INVALID",
                format!("重排问题不能超过 {} 个字符", policy.max_query_length),
            ));
        }
        if candidates.is_empty() || candidates.len() > LOCAL_MAX_RERANK_CANDIDATES {
            return Err(RagError::new(
                "RAG_REQUEST_INVALID",
                format!("重排候选数量必须在 1 到 {LOCAL_MAX_RERANK_CANDIDATES} 之间"),
            ));
        }
        if top_n == Some(0) {
            return Err(RagError::new("RAG_REQUEST_INVALID", "重排 topN 必须大于 0"));
        }

        let candidate_count = candidates.len();
        let mut seen_chunk_ids = HashSet::with_capacity(candidate_count);
        let mut total_content_length = 0_usize;
        let mut normalized_candidates = Vec::with_capacity(candidate_count);
        for mut candidate in candidates {
            candidate.knowledge_base_id =
                required_value(&candidate.knowledge_base_id, "knowledgeBaseId")?;
            candidate.chunk_id = required_value(&candidate.chunk_id, "chunkId")?;
            candidate.source = required_value(&candidate.source, "source")?;
            if !seen_chunk_ids.insert(candidate.chunk_id.clone()) {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "重排候选的 chunkId 不能重复",
                ));
            }
            if candidate.content.trim().is_empty() {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "重排候选 content 不能为空",
                ));
            }
            if !candidate.score.is_finite() || !(candidate.score as f32).is_finite() {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "重排候选 score 必须能表示为有限的 Java Float",
                ));
            }
            total_content_length =
                total_content_length.saturating_add(candidate.content.encode_utf16().count());
            if total_content_length > LOCAL_MAX_RERANK_CONTENT_LENGTH {
                return Err(RagError::new(
                    "RAG_REQUEST_TOO_LARGE",
                    format!("重排候选总内容不能超过 {LOCAL_MAX_RERANK_CONTENT_LENGTH} 个字符"),
                ));
            }
            candidate.document_id = optional_value(candidate.document_id.as_deref());
            candidate.document_name = optional_value(candidate.document_name.as_deref());
            normalized_candidates.push(candidate);
        }

        let max_top_n = policy
            .max_top_n
            .min(LOCAL_MAX_TOP_N)
            .min(candidate_count as u32);
        let payload = RerankPayload {
            query,
            candidates: normalized_candidates,
            top_n: top_n.unwrap_or(5).min(max_top_n),
        };
        self.post_json(&service, RagAccessMode::Management, "/rerank", &payload)
    }

    fn complete_protocol_checked<T>(
        &self,
        service: &RagServiceConfig,
        result: Result<T, RagError>,
    ) -> Result<T, RagError> {
        match result {
            Err(error) if error.code() == "RAG_PROTOCOL_MISMATCH" => {
                if service.capabilities_snapshot.is_some() {
                    let mut invalidated = service.clone();
                    invalidated.capabilities_snapshot = None;
                    self.store.save(&invalidated)?;
                }
                Err(error)
            }
            result => result,
        }
    }

    fn get_json<T: DeserializeOwned + RagSanitizeResponse>(
        &self,
        service: &RagServiceConfig,
        mode: RagAccessMode,
        path: &str,
    ) -> Result<T, RagError> {
        let request = self.client(service)?.get(endpoint(service, path)?);
        self.send_json(service, self.authorize(request, service, mode)?)
    }

    fn get_public_json<T: DeserializeOwned + RagSanitizeResponse>(
        &self,
        service: &RagServiceConfig,
        path: &str,
    ) -> Result<T, RagError> {
        let request = self.client(service)?.get(endpoint(service, path)?);
        self.send_json(service, request)
    }

    fn post_json<T: DeserializeOwned + RagSanitizeResponse>(
        &self,
        service: &RagServiceConfig,
        mode: RagAccessMode,
        path: &str,
        payload: &impl Serialize,
    ) -> Result<T, RagError> {
        let request = self
            .client(service)?
            .post(endpoint(service, path)?)
            .json(payload);
        self.send_json(service, self.authorize(request, service, mode)?)
    }

    fn put_json<T: DeserializeOwned + RagSanitizeResponse>(
        &self,
        service: &RagServiceConfig,
        mode: RagAccessMode,
        path: &str,
        payload: &impl Serialize,
    ) -> Result<T, RagError> {
        let request = self
            .client(service)?
            .put(endpoint(service, path)?)
            .json(payload);
        self.send_json(service, self.authorize(request, service, mode)?)
    }

    fn client(&self, service: &RagServiceConfig) -> Result<Client, RagError> {
        Client::builder()
            .timeout(Duration::from_millis(
                service.timeout_ms.clamp(1_000, 120_000),
            ))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(reqwest_error)
    }

    fn authorize(
        &self,
        request: RequestBuilder,
        service: &RagServiceConfig,
        mode: RagAccessMode,
    ) -> Result<RequestBuilder, RagError> {
        let kind = match mode {
            RagAccessMode::Management => RagCredentialKind::Management,
            RagAccessMode::Agent => RagCredentialKind::Agent,
        };
        Ok(request.bearer_auth(self.credentials.get(&service.id, kind)?))
    }

    fn send_json<T: DeserializeOwned + RagSanitizeResponse>(
        &self,
        service: &RagServiceConfig,
        request: RequestBuilder,
    ) -> Result<T, RagError> {
        let response = request.send().map_err(reqwest_error)?;
        self.complete_protocol_checked(service, parse_response(response))
    }

    fn send_empty(
        &self,
        service: &RagServiceConfig,
        request: RequestBuilder,
    ) -> Result<(), RagError> {
        let response = request.send().map_err(reqwest_error)?;
        if response.status().is_success() {
            return Ok(());
        }
        self.complete_protocol_checked(service, parse_error_response(response))
    }
}

fn normalize_knowledge_base_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchPayload {
    query: String,
    knowledge_base_ids: Vec<String>,
    top_k: u32,
    rerank: bool,
    top_n: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RerankPayload {
    query: String,
    candidates: Vec<RagRerankCandidate>,
    top_n: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeBasePayload {
    name: String,
    embedding_model: String,
    collection_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateKnowledgeBasePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    embedding_model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UrlImportPayload<'a> {
    url: String,
    #[serde(flatten)]
    ingestion: &'a RagIngestionRequest,
}

pub fn filter_agent_knowledge_bases(
    service: &RagServiceConfig,
    knowledge_bases: Vec<RagKnowledgeBase>,
) -> Vec<RagKnowledgeBase> {
    let allowed = service
        .agent_knowledge_base_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    knowledge_bases
        .into_iter()
        .filter(|item| allowed.contains(item.id.as_str()))
        .collect()
}

fn endpoint(service: &RagServiceConfig, path: &str) -> Result<Url, RagError> {
    let base = normalize_base_url(&service.base_url)?;
    let url = Url::parse(&format!("{base}/api/external/v1{path}"))
        .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "RAG 服务地址不能包含用户名或密码",
        ));
    }
    Ok(url)
}

pub(crate) fn normalize_service_config(service: &mut RagServiceConfig) -> Result<(), RagError> {
    service.id = service.id.trim().to_string();
    if service.id.is_empty()
        || service.id.len() > 64
        || !service.id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "服务 ID 只能包含字母、数字、点、短横线和下划线，且不能超过 64 个字符",
        ));
    }

    service.name = required_value(&service.name, "服务名称")?;
    if service.name.chars().count() > 128 {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "服务名称不能超过 128 个字符",
        ));
    }

    service.adapter_type = required_value(&service.adapter_type, "适配器类型")?.to_lowercase();
    service.base_url = normalize_base_url(&service.base_url)?;
    service.timeout_ms = service.timeout_ms.clamp(1_000, 120_000);

    let mut seen = HashSet::new();
    service.agent_knowledge_base_ids = service
        .agent_knowledge_base_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert((*id).to_string()))
        .map(str::to_string)
        .collect();
    Ok(())
}

fn normalize_base_url(value: &str) -> Result<String, RagError> {
    let value = required_value(value, "Base URL")?;
    let url = Url::parse(&value)
        .map_err(|_| RagError::new("RAG_REQUEST_INVALID", "Base URL 格式无效"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "Base URL 必须是 HTTP(S) 地址",
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "Base URL 不能包含用户信息、查询参数或片段",
        ));
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if url.scheme() == "http" && !loopback {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            "远程 RAG 服务必须使用 HTTPS；HTTP 仅允许 localhost 或回环地址",
        ));
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

pub(crate) fn validate_agent_protocol(
    capabilities: Option<&RagCapabilities>,
) -> Result<(), RagError> {
    validate_agent_protocol_at(capabilities, unix_time_ms())
}

fn validate_agent_protocol_at(
    capabilities: Option<&RagCapabilities>,
    now_ms: u64,
) -> Result<(), RagError> {
    let Some(capabilities) = capabilities else {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "请先在 RAG Hub 测试服务连接并确认协议版本",
        ));
    };
    let version = capabilities.protocol_version.trim();
    if !is_supported_protocol(version) {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            format!("RAG 协议主版本不兼容：需要 1.x，收到 {version}"),
        ));
    }
    let Some(captured_at_ms) = capabilities.captured_at_ms else {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "RAG capabilities 快照缺少本地采集时间，请重新测试服务连接",
        ));
    };
    if now_ms
        .checked_sub(captured_at_ms)
        .is_none_or(|age_ms| age_ms > CAPABILITY_TTL_MS)
    {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "RAG capabilities 快照已过期，请重新测试服务连接",
        ));
    }
    Ok(())
}

fn is_supported_protocol(version: &str) -> bool {
    let mut segments = version.split('.');
    if segments.next() != Some(SUPPORTED_PROTOCOL_MAJOR) {
        return false;
    }
    let Some(minor) = segments.next() else {
        return false;
    };
    !minor.is_empty()
        && minor.bytes().all(|byte| byte.is_ascii_digit())
        && segments
            .all(|segment| !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit()))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_rerank_capability(capabilities: Option<&RagCapabilities>) -> Result<(), RagError> {
    validate_agent_protocol(capabilities)?;
    match capabilities.and_then(|snapshot| snapshot.features.get("rerank")) {
        Some(true) => Ok(()),
        Some(false) => Err(RagError::new(
            "RAG_FEATURE_UNAVAILABLE",
            "当前 RAG 服务未启用独立重排能力",
        )),
        None => Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "RAG 服务 capabilities 未声明 rerank 能力",
        )),
    }
}

pub(crate) fn validate_capability_audience(
    capabilities: &RagCapabilities,
    mode: RagAccessMode,
) -> Result<(), RagError> {
    let expected = match mode {
        RagAccessMode::Management => "management",
        RagAccessMode::Agent => "agent",
    };
    let Some(actual) = capabilities
        .credential_audience
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "RAG 服务 capabilities 未返回 credentialAudience",
        ));
    };
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(RagError::new(
            "RAG_AUTH_FAILED",
            format!("RAG API Key 受众不匹配：当前凭证槽需要 {expected}，收到 {actual}"),
        ));
    }
    Ok(())
}

pub(crate) fn service_test_modes(service: &RagServiceConfig) -> Vec<RagAccessMode> {
    let mut modes = vec![RagAccessMode::Management];
    if service.agent_credential_configured {
        modes.push(RagAccessMode::Agent);
    }
    modes
}

pub(crate) struct RagSearchPolicy {
    pub(crate) max_top_k: u32,
    pub(crate) max_top_n: u32,
    pub(crate) max_query_length: usize,
    pub(crate) rerank_supported: bool,
}

pub(crate) fn resolve_search_policy(
    capabilities: Option<&RagCapabilities>,
) -> Result<RagSearchPolicy, RagError> {
    resolve_search_policy_at(capabilities, unix_time_ms())
}

fn resolve_search_policy_at(
    capabilities: Option<&RagCapabilities>,
    now_ms: u64,
) -> Result<RagSearchPolicy, RagError> {
    validate_agent_protocol_at(capabilities, now_ms)?;
    let capabilities = capabilities.ok_or_else(|| {
        RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "请先在 RAG Hub 测试服务连接并确认协议版本",
        )
    })?;
    let rerank_supported = match capabilities.features.get("rerank") {
        Some(value) => *value,
        None => {
            return Err(RagError::new(
                "RAG_PROTOCOL_MISMATCH",
                "RAG 服务 capabilities 未声明 rerank 能力",
            ));
        }
    };
    Ok(RagSearchPolicy {
        max_top_k: capability_limit(capabilities, "maxTopK", LOCAL_MAX_TOP_K)?,
        max_top_n: capability_limit(capabilities, "maxTopN", LOCAL_MAX_TOP_N)?,
        max_query_length: capability_limit(
            capabilities,
            "maxQueryLength",
            LOCAL_MAX_QUERY_LENGTH as u32,
        )? as usize,
        rerank_supported,
    })
}

fn capability_limit(
    capabilities: &RagCapabilities,
    key: &str,
    local_maximum: u32,
) -> Result<u32, RagError> {
    match capabilities.limits.get(key).copied() {
        Some(value) if value > 0 => Ok(value.min(u64::from(local_maximum)) as u32),
        _ => Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            format!("RAG 服务 capabilities 未声明有效的 {key} 限制"),
        )),
    }
}

fn require_feature(
    capabilities: Option<&RagCapabilities>,
    feature: &str,
    label: &str,
) -> Result<(), RagError> {
    require_feature_at(capabilities, feature, label, unix_time_ms())
}

fn require_feature_at(
    capabilities: Option<&RagCapabilities>,
    feature: &str,
    label: &str,
    now_ms: u64,
) -> Result<(), RagError> {
    validate_agent_protocol_at(capabilities, now_ms)?;
    match capabilities.and_then(|snapshot| snapshot.features.get(feature)) {
        Some(true) => Ok(()),
        Some(false) => Err(RagError::new(
            "RAG_FEATURE_UNAVAILABLE",
            format!("当前 RAG 服务未启用{label}能力"),
        )),
        None => Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            format!("RAG 服务 capabilities 未声明{label}能力"),
        )),
    }
}

fn max_upload_bytes(capabilities: Option<&RagCapabilities>) -> Result<u64, RagError> {
    max_upload_bytes_at(capabilities, unix_time_ms())
}

fn max_upload_bytes_at(
    capabilities: Option<&RagCapabilities>,
    now_ms: u64,
) -> Result<u64, RagError> {
    validate_agent_protocol_at(capabilities, now_ms)?;
    match capabilities.and_then(|snapshot| snapshot.limits.get("maxUploadBytes")) {
        Some(value) if *value > 0 => Ok((*value).min(LOCAL_MAX_UPLOAD_BYTES)),
        _ => Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "RAG 服务 capabilities 未声明有效的 maxUploadBytes 限制",
        )),
    }
}

#[derive(Debug, Clone)]
struct RagIngestionPolicy {
    allowed_extensions: Vec<String>,
    allowed_extension_set: HashSet<String>,
    allowed_mime_types: HashSet<String>,
    process_modes: HashSet<String>,
    chunk_strategies: HashSet<String>,
    chunk_schemas: BTreeMap<String, ControlledObjectSchema>,
    pipeline_ids: HashSet<String>,
    max_upload_bytes: u64,
}

#[derive(Debug, Clone)]
struct ControlledObjectSchema {
    properties: BTreeMap<String, ControlledFieldSchema>,
    required: HashSet<String>,
}

#[derive(Debug, Clone)]
enum ControlledFieldSchema {
    Integer {
        minimum: Option<i64>,
        maximum: Option<i64>,
    },
    String {
        min_length: Option<usize>,
        max_length: Option<usize>,
        enum_values: Option<HashSet<String>>,
    },
    Boolean,
}

fn ingestion_protocol_error(message: impl Into<String>) -> RagError {
    RagError::new("RAG_PROTOCOL_MISMATCH", message)
}

fn normalize_capability_values(
    values: &[String],
    label: &str,
    normalize: impl Fn(&str) -> String,
) -> Result<Vec<String>, RagError> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let value = normalize(value.trim());
        if value.is_empty() {
            return Err(ingestion_protocol_error(format!(
                "RAG ingestion capabilities 的 {label} 包含空值"
            )));
        }
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    if normalized.is_empty() {
        return Err(ingestion_protocol_error(format!(
            "RAG ingestion capabilities 未声明 {label}"
        )));
    }
    Ok(normalized)
}

fn normalize_extension(value: &str) -> String {
    let value = value.to_ascii_lowercase();
    if value.starts_with('.') {
        value
    } else {
        format!(".{value}")
    }
}

fn resolve_ingestion_policy(
    capabilities: Option<&RagCapabilities>,
) -> Result<RagIngestionPolicy, RagError> {
    validate_agent_protocol(capabilities)?;
    let capabilities = capabilities.ok_or_else(|| {
        ingestion_protocol_error("请先测试 RAG 服务连接并获取 ingestion capabilities")
    })?;
    let ingestion = capabilities.ingestion.as_ref().ok_or_else(|| {
        ingestion_protocol_error("RAG 服务 capabilities 未声明 ingestion 能力契约")
    })?;
    validate_ingestion_capabilities(ingestion, capabilities)
}

fn validate_ingestion_capabilities(
    ingestion: &RagIngestionCapabilities,
    capabilities: &RagCapabilities,
) -> Result<RagIngestionPolicy, RagError> {
    let allowed_extensions = normalize_capability_values(
        &ingestion.allowed_extensions,
        "allowedExtensions",
        normalize_extension,
    )?;
    if allowed_extensions.iter().any(|value| {
        value.len() < 2 || value.contains(['/', '\\']) || value.chars().any(char::is_whitespace)
    }) {
        return Err(ingestion_protocol_error(
            "RAG ingestion allowedExtensions 包含无效扩展名",
        ));
    }
    let allowed_mime_types =
        normalize_capability_values(&ingestion.allowed_mime_types, "allowedMimeTypes", |value| {
            value.to_ascii_lowercase()
        })?;
    if allowed_mime_types
        .iter()
        .any(|value| !value.contains('/') || value.chars().any(char::is_whitespace))
    {
        return Err(ingestion_protocol_error(
            "RAG ingestion allowedMimeTypes 包含无效 MIME 类型",
        ));
    }
    let process_modes =
        normalize_capability_values(&ingestion.process_modes, "processModes", str::to_string)?;
    if process_modes
        .iter()
        .any(|mode| !matches!(mode.as_str(), "chunk" | "pipeline"))
    {
        return Err(ingestion_protocol_error(
            "RAG ingestion capabilities 包含未知 processMode",
        ));
    }

    let chunk_strategies = if ingestion.chunk_strategies.is_empty() {
        Vec::new()
    } else {
        normalize_capability_values(
            &ingestion.chunk_strategies,
            "chunkStrategies",
            str::to_string,
        )?
    };
    let process_mode_set = process_modes.iter().cloned().collect::<HashSet<_>>();
    if process_mode_set.contains("chunk") && chunk_strategies.is_empty() {
        return Err(ingestion_protocol_error(
            "RAG ingestion capabilities 缺少 chunkStrategies",
        ));
    }
    if ingestion.chunk_config_schema.len() != chunk_strategies.len() {
        return Err(ingestion_protocol_error(
            "RAG ingestion chunkConfigSchema 与 chunkStrategies 不一致",
        ));
    }
    let mut chunk_schemas = BTreeMap::new();
    for strategy in &chunk_strategies {
        let schema = ingestion.chunk_config_schema.get(strategy).ok_or_else(|| {
            ingestion_protocol_error(format!(
                "RAG ingestion 未声明 {strategy} 的 chunkConfigSchema"
            ))
        })?;
        chunk_schemas.insert(strategy.clone(), parse_controlled_object_schema(schema)?);
    }

    let mut pipeline_ids = HashSet::new();
    for pipeline in &ingestion.pipelines {
        let id = pipeline.id.trim();
        if id.is_empty() || pipeline.name.trim().is_empty() || !pipeline_ids.insert(id.to_string())
        {
            return Err(ingestion_protocol_error(
                "RAG ingestion pipelines 包含空值或重复 ID",
            ));
        }
    }
    if process_mode_set.contains("pipeline") && pipeline_ids.is_empty() {
        return Err(ingestion_protocol_error(
            "RAG ingestion capabilities 缺少 pipelines",
        ));
    }

    Ok(RagIngestionPolicy {
        allowed_extension_set: allowed_extensions.iter().cloned().collect(),
        allowed_extensions,
        allowed_mime_types: allowed_mime_types.into_iter().collect(),
        process_modes: process_mode_set,
        chunk_strategies: chunk_strategies.into_iter().collect(),
        chunk_schemas,
        pipeline_ids,
        max_upload_bytes: max_upload_bytes(Some(capabilities))?,
    })
}

fn schema_object<'a>(
    value: &'a Value,
    label: &str,
) -> Result<&'a serde_json::Map<String, Value>, RagError> {
    value.as_object().ok_or_else(|| {
        ingestion_protocol_error(format!("RAG ingestion {label} 必须是 JSON object"))
    })
}

fn reject_unknown_schema_keys(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), RagError> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(ingestion_protocol_error(format!(
            "RAG ingestion {label} 包含未知字段 {key}"
        )));
    }
    Ok(())
}

fn schema_i64(
    object: &serde_json::Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<Option<i64>, RagError> {
    object
        .get(key)
        .map(|value| {
            value.as_i64().ok_or_else(|| {
                ingestion_protocol_error(format!("RAG ingestion {label}.{key} 必须是整数"))
            })
        })
        .transpose()
}

fn schema_usize(
    object: &serde_json::Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<Option<usize>, RagError> {
    object
        .get(key)
        .map(|value| {
            value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| {
                    ingestion_protocol_error(format!("RAG ingestion {label}.{key} 必须是非负整数"))
                })
        })
        .transpose()
}

fn parse_controlled_object_schema(value: &Value) -> Result<ControlledObjectSchema, RagError> {
    let object = schema_object(value, "chunkConfigSchema")?;
    reject_unknown_schema_keys(
        object,
        &["type", "properties", "required", "additionalProperties"],
        "chunkConfigSchema",
    )?;
    if object.get("type").and_then(Value::as_str) != Some("object")
        || object.get("additionalProperties").and_then(Value::as_bool) != Some(false)
    {
        return Err(ingestion_protocol_error(
            "RAG ingestion chunkConfigSchema 必须是 additionalProperties=false 的 object",
        ));
    }
    let properties = object
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            ingestion_protocol_error("RAG ingestion chunkConfigSchema 缺少 properties")
        })?;
    let mut controlled_properties = BTreeMap::new();
    for (name, property) in properties {
        if name.trim().is_empty() || name.trim() != name {
            return Err(ingestion_protocol_error(
                "RAG ingestion chunkConfigSchema 包含无效属性名",
            ));
        }
        controlled_properties.insert(name.clone(), parse_controlled_field_schema(name, property)?);
    }
    let required_values: &[Value] = match object.get("required") {
        None => &[],
        Some(Value::Array(values)) => values.as_slice(),
        Some(_) => {
            return Err(ingestion_protocol_error(
                "RAG ingestion chunkConfigSchema.required 必须是数组",
            ))
        }
    };
    let mut required = HashSet::new();
    for value in required_values {
        let name = value.as_str().ok_or_else(|| {
            ingestion_protocol_error("RAG ingestion chunkConfigSchema.required 必须只包含字符串")
        })?;
        if !controlled_properties.contains_key(name) || !required.insert(name.to_string()) {
            return Err(ingestion_protocol_error(
                "RAG ingestion chunkConfigSchema.required 引用了未知或重复属性",
            ));
        }
        if properties
            .get(name)
            .and_then(Value::as_object)
            .is_none_or(|property| !property.contains_key("default"))
        {
            return Err(ingestion_protocol_error(
                "RAG ingestion 必填 chunkConfig 属性必须声明安全默认值",
            ));
        }
    }
    Ok(ControlledObjectSchema {
        properties: controlled_properties,
        required,
    })
}

fn parse_controlled_field_schema(
    name: &str,
    value: &Value,
) -> Result<ControlledFieldSchema, RagError> {
    let object = schema_object(value, name)?;
    let schema_type = object.get("type").and_then(Value::as_str).ok_or_else(|| {
        ingestion_protocol_error(format!("RAG ingestion {name} schema 缺少 type"))
    })?;
    match schema_type {
        "integer" => {
            reject_unknown_schema_keys(object, &["type", "minimum", "maximum", "default"], name)?;
            let minimum = schema_i64(object, "minimum", name)?;
            let maximum = schema_i64(object, "maximum", name)?;
            if minimum
                .zip(maximum)
                .is_some_and(|(minimum, maximum)| minimum > maximum)
            {
                return Err(ingestion_protocol_error(format!(
                    "RAG ingestion {name} schema 的 minimum 大于 maximum"
                )));
            }
            if let Some(default) = object.get("default") {
                let default = default.as_i64().ok_or_else(|| {
                    ingestion_protocol_error(format!("RAG ingestion {name}.default 必须是整数"))
                })?;
                if minimum.is_some_and(|value| default < value)
                    || maximum.is_some_and(|value| default > value)
                {
                    return Err(ingestion_protocol_error(format!(
                        "RAG ingestion {name}.default 超出 schema 范围"
                    )));
                }
            }
            Ok(ControlledFieldSchema::Integer { minimum, maximum })
        }
        "string" => {
            reject_unknown_schema_keys(
                object,
                &["type", "minLength", "maxLength", "default", "enum"],
                name,
            )?;
            let min_length = schema_usize(object, "minLength", name)?;
            let max_length = schema_usize(object, "maxLength", name)?;
            if min_length
                .zip(max_length)
                .is_some_and(|(minimum, maximum)| minimum > maximum)
            {
                return Err(ingestion_protocol_error(format!(
                    "RAG ingestion {name} schema 的 minLength 大于 maxLength"
                )));
            }
            let enum_values = match object.get("enum") {
                None => None,
                Some(Value::Array(values)) if !values.is_empty() => {
                    let mut result = HashSet::new();
                    for value in values {
                        let value = value.as_str().ok_or_else(|| {
                            ingestion_protocol_error(format!(
                                "RAG ingestion {name}.enum 必须只包含字符串"
                            ))
                        })?;
                        if !result.insert(value.to_string()) {
                            return Err(ingestion_protocol_error(format!(
                                "RAG ingestion {name}.enum 包含重复值"
                            )));
                        }
                    }
                    Some(result)
                }
                Some(_) => {
                    return Err(ingestion_protocol_error(format!(
                        "RAG ingestion {name}.enum 必须是非空字符串数组"
                    )))
                }
            };
            if let Some(default) = object.get("default") {
                let default = default.as_str().ok_or_else(|| {
                    ingestion_protocol_error(format!("RAG ingestion {name}.default 必须是字符串"))
                })?;
                let length = default.chars().count();
                if min_length.is_some_and(|value| length < value)
                    || max_length.is_some_and(|value| length > value)
                    || enum_values
                        .as_ref()
                        .is_some_and(|values| !values.contains(default))
                {
                    return Err(ingestion_protocol_error(format!(
                        "RAG ingestion {name}.default 不符合 schema"
                    )));
                }
            }
            Ok(ControlledFieldSchema::String {
                min_length,
                max_length,
                enum_values,
            })
        }
        "boolean" => {
            reject_unknown_schema_keys(object, &["type", "default"], name)?;
            if object
                .get("default")
                .is_some_and(|value| !value.is_boolean())
            {
                return Err(ingestion_protocol_error(format!(
                    "RAG ingestion {name}.default 必须是 boolean"
                )));
            }
            Ok(ControlledFieldSchema::Boolean)
        }
        _ => Err(ingestion_protocol_error(format!(
            "RAG ingestion {name} 使用了不受支持的 schema 类型 {schema_type}"
        ))),
    }
}

fn validate_ingestion_request(
    policy: &RagIngestionPolicy,
    ingestion: &RagIngestionRequest,
) -> Result<(), RagError> {
    if !policy.process_modes.contains(&ingestion.process_mode) {
        return Err(ingestion_protocol_error(format!(
            "RAG capabilities 不支持 processMode {}",
            ingestion.process_mode
        )));
    }
    match ingestion.process_mode.as_str() {
        "chunk" => {
            if ingestion.pipeline_id.is_some() {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "chunk 模式不能同时提交 pipelineId",
                ));
            }
            let strategy = ingestion.chunk_strategy.as_deref().ok_or_else(|| {
                RagError::new("RAG_REQUEST_INVALID", "chunk 模式必须提交 chunkStrategy")
            })?;
            if !policy.chunk_strategies.contains(strategy) {
                return Err(ingestion_protocol_error(format!(
                    "RAG capabilities 不支持 chunkStrategy {strategy}"
                )));
            }
            let schema = policy.chunk_schemas.get(strategy).ok_or_else(|| {
                ingestion_protocol_error(format!(
                    "RAG capabilities 缺少 chunkStrategy {strategy} 的 schema"
                ))
            })?;
            let config = ingestion
                .chunk_config
                .as_ref()
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    RagError::new(
                        "RAG_REQUEST_INVALID",
                        "chunk 模式必须提交对象型 chunkConfig",
                    )
                })?;
            if config
                .keys()
                .any(|name| !schema.properties.contains_key(name))
            {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "chunkConfig 包含 capabilities 未声明的字段",
                ));
            }
            if schema
                .required
                .iter()
                .any(|name| !config.contains_key(name))
            {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "chunkConfig 缺少 capabilities schema 的必填字段",
                ));
            }
            for (name, value) in config {
                validate_controlled_value(
                    name,
                    schema.properties.get(name).expect("schema property exists"),
                    value,
                )?;
            }
            Ok(())
        }
        "pipeline" => {
            if ingestion.chunk_strategy.is_some() || ingestion.chunk_config.is_some() {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "pipeline 模式不能提交 chunkStrategy 或 chunkConfig",
                ));
            }
            let pipeline_id = ingestion.pipeline_id.as_deref().ok_or_else(|| {
                RagError::new("RAG_REQUEST_INVALID", "pipeline 模式必须提交 pipelineId")
            })?;
            if !policy.pipeline_ids.contains(pipeline_id) {
                return Err(RagError::new(
                    "RAG_REQUEST_INVALID",
                    "pipelineId 不在 capabilities 声明的列表中",
                ));
            }
            Ok(())
        }
        _ => Err(ingestion_protocol_error("未知 ingestion processMode")),
    }
}

fn validate_controlled_value(
    name: &str,
    schema: &ControlledFieldSchema,
    value: &Value,
) -> Result<(), RagError> {
    let valid = match schema {
        ControlledFieldSchema::Integer { minimum, maximum } => {
            value.as_i64().is_some_and(|value| {
                minimum.is_none_or(|minimum| value >= minimum)
                    && maximum.is_none_or(|maximum| value <= maximum)
            })
        }
        ControlledFieldSchema::String {
            min_length,
            max_length,
            enum_values,
        } => value.as_str().is_some_and(|value| {
            let length = value.chars().count();
            min_length.is_none_or(|minimum| length >= minimum)
                && max_length.is_none_or(|maximum| length <= maximum)
                && enum_values
                    .as_ref()
                    .is_none_or(|values| values.contains(value))
        }),
        ControlledFieldSchema::Boolean => value.is_boolean(),
    };
    if valid {
        Ok(())
    } else {
        Err(RagError::new(
            "RAG_REQUEST_INVALID",
            format!("chunkConfig.{name} 不符合 capabilities schema"),
        ))
    }
}

fn inspect_document_path(
    path: &Path,
    policy: &RagIngestionPolicy,
) -> Result<RagPickedDocumentFile, RagError> {
    if !path.is_file() {
        return Err(RagError::new("RAG_REQUEST_INVALID", "待上传文件不存在"));
    }
    let size = path
        .metadata()
        .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?
        .len();
    if size > policy.max_upload_bytes {
        return Err(RagError::new(
            "RAG_UPLOAD_TOO_LARGE",
            format!(
                "待上传文件超过允许的大小（最大 {} 字节）",
                policy.max_upload_bytes
            ),
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(normalize_extension)
        .ok_or_else(|| RagError::new("RAG_FILE_TYPE_UNSUPPORTED", "待上传文件缺少扩展名"))?;
    let mime_type = mime_guess::from_path(path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_ascii_lowercase();
    if !policy.allowed_extension_set.contains(&extension)
        || !policy.allowed_mime_types.contains(&mime_type)
    {
        return Err(RagError::new(
            "RAG_FILE_TYPE_UNSUPPORTED",
            format!("待上传文件的扩展名 {extension} 或 MIME 类型 {mime_type} 不在 capabilities 白名单中"),
        ));
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RagError::new("RAG_REQUEST_INVALID", "待上传文件名称无效"))?;
    Ok(RagPickedDocumentFile {
        path: path.to_string_lossy().into_owned(),
        name: name.to_string(),
        size,
        extension,
        mime_type,
    })
}

fn url_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn required_value(value: &str, field_name: &str) -> Result<String, RagError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RagError::new(
            "RAG_REQUEST_INVALID",
            format!("{field_name}不能为空"),
        ));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod capability_tests;

fn optional_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_response<T: DeserializeOwned + RagSanitizeResponse>(
    mut response: Response,
) -> Result<T, RagError> {
    let status = response.status();
    let body = read_response_body(&mut response)?;
    if status.is_success() {
        let mut value: T = serde_json::from_slice(&body).map_err(|error| {
            RagError::new(
                "RAG_RESPONSE_INVALID",
                sanitize_error_message(&format!("RAG 响应无法解析：{error}")),
            )
        })?;
        value.sanitize_response(&mut SanitizationBudget::default());
        return Ok(value);
    }
    parse_error_body(status, &body)
}

fn parse_error_response(mut response: Response) -> Result<(), RagError> {
    let status = response.status();
    let body = read_response_body(&mut response)?;
    parse_error_body(status, &body)
}

fn parse_error_body<T>(status: StatusCode, body: &[u8]) -> Result<T, RagError> {
    let body = serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
    let fallback_code = status_code(status);
    let code = body
        .get("code")
        .and_then(Value::as_str)
        .map(sanitize_error_code)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback_code.to_string());
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .map(sanitize_error_message)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "RAG 服务调用失败".to_string());
    Err(RagError::new(code, message))
}

fn read_response_body(response: &mut Response) -> Result<Vec<u8>, RagError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON_RESPONSE_BYTES)
    {
        return Err(RagError::new(
            "RAG_RESPONSE_INVALID",
            "RAG 响应超过允许的大小",
        ));
    }
    let mut body = Vec::new();
    response
        .take(MAX_JSON_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(io_error)?;
    if body.len() as u64 > MAX_JSON_RESPONSE_BYTES {
        return Err(RagError::new(
            "RAG_RESPONSE_INVALID",
            "RAG 响应超过允许的大小",
        ));
    }
    Ok(body)
}

fn status_code(status: StatusCode) -> &'static str {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => "RAG_AUTH_FAILED",
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => "RAG_REQUEST_TIMEOUT",
        _ => "RAG_REMOTE_ERROR",
    }
}

fn reqwest_error(error: reqwest::Error) -> RagError {
    let code = if error.is_timeout() {
        "RAG_REQUEST_TIMEOUT"
    } else {
        "RAG_REQUEST_FAILED"
    };
    transport_error(code, error)
}

fn io_error(error: std::io::Error) -> RagError {
    let code = if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        "RAG_REQUEST_TIMEOUT"
    } else {
        "RAG_REQUEST_FAILED"
    };
    transport_error(code, error)
}

fn transport_error(code: &'static str, error: impl std::fmt::Display) -> RagError {
    RagError::new(
        code,
        sanitize_error_message(&format!("RAG 请求失败：{error}")),
    )
}
