use std::collections::HashSet;
use std::io::Read;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::{
    RagAcceptedJob, RagAccessMode, RagCapabilities, RagChunk, RagCredentialKind,
    RagCredentialProvider, RagCredentialStore, RagDocument, RagError, RagIngestionJob,
    RagKnowledgeBase, RagPage, RagSearchRequest, RagSearchResponse, RagServiceConfig,
    RagServiceStore,
};

const MAX_JSON_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const SUPPORTED_PROTOCOL_MAJOR: &str = "1";
const LOCAL_MAX_TOP_K: u32 = 50;
const LOCAL_MAX_TOP_N: u32 = 20;
const LOCAL_MAX_QUERY_LENGTH: usize = 4_000;
const LOCAL_MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

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
        let mut capabilities = None;
        for mode in service_test_modes(&service) {
            let current = self.get_json(&service, mode, "/capabilities")?;
            validate_agent_protocol(Some(&current))?;
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

    pub fn list_knowledge_bases(
        &self,
        service_id: Option<&str>,
        mode: RagAccessMode,
    ) -> Result<Vec<RagKnowledgeBase>, RagError> {
        let service = self.store.resolve(service_id, mode)?;
        if mode == RagAccessMode::Agent {
            validate_agent_protocol(service.capabilities_snapshot.as_ref())?;
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
        self.send_empty(self.authorize(request, &service, RagAccessMode::Management)?)
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

    pub fn upload_document(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        file_path: &str,
    ) -> Result<RagAcceptedJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        require_feature(
            service.capabilities_snapshot.as_ref(),
            "fileUpload",
            "文件上传",
        )?;
        let path = Path::new(file_path);
        if !path.is_file() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "待上传文件不存在"));
        }
        let file_size = path
            .metadata()
            .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?
            .len();
        let upload_limit = max_upload_bytes(service.capabilities_snapshot.as_ref());
        if file_size > upload_limit {
            return Err(RagError::new(
                "RAG_UPLOAD_TOO_LARGE",
                format!("待上传文件超过允许的大小（最大 {upload_limit} 字节）"),
            ));
        }
        let form = multipart::Form::new()
            .file("file", path)
            .map_err(|error| RagError::new("RAG_REQUEST_INVALID", error.to_string()))?
            .text("processMode", "chunk")
            .text("chunkStrategy", "fixed_size")
            .text("chunkConfig", r#"{"chunkSize":512,"overlapSize":64}"#);
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
        self.send_json(self.authorize(request, &service, RagAccessMode::Management)?)
    }

    pub fn import_document_url(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        document_url: &str,
    ) -> Result<RagAcceptedJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        require_feature(
            service.capabilities_snapshot.as_ref(),
            "urlImport",
            "URL 入库",
        )?;
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
            process_mode: "chunk",
            chunk_strategy: "fixed_size",
            chunk_config: r#"{"chunkSize":512,"overlapSize":64}"#,
            pipeline_id: None,
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
        self.send_json(self.authorize(request, &service, RagAccessMode::Management)?)
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

    pub fn retry_ingestion_job(
        &self,
        service_id: Option<&str>,
        job_id: &str,
    ) -> Result<RagIngestionJob, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let request = self.client(&service)?.post(endpoint(
            &service,
            &format!("/ingestion-jobs/{}/retry", url_segment(job_id)),
        )?);
        self.send_json(self.authorize(request, &service, RagAccessMode::Management)?)
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
        self.send_empty(self.authorize(request, &service, RagAccessMode::Management)?)
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
        if mode == RagAccessMode::Agent {
            validate_agent_protocol(service.capabilities_snapshot.as_ref())?;
        }
        if request.query.trim().is_empty() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "检索问题不能为空"));
        }
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
        let policy = resolve_search_policy(service.capabilities_snapshot.as_ref());
        let query = request.query.trim().to_string();
        if query.chars().count() > policy.max_query_length {
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

    fn get_json<T: DeserializeOwned>(
        &self,
        service: &RagServiceConfig,
        mode: RagAccessMode,
        path: &str,
    ) -> Result<T, RagError> {
        let request = self.client(service)?.get(endpoint(service, path)?);
        self.send_json(self.authorize(request, service, mode)?)
    }

    fn post_json<T: DeserializeOwned>(
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
        self.send_json(self.authorize(request, service, mode)?)
    }

    fn put_json<T: DeserializeOwned>(
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
        self.send_json(self.authorize(request, service, mode)?)
    }

    fn client(&self, service: &RagServiceConfig) -> Result<Client, RagError> {
        Client::builder()
            .timeout(Duration::from_millis(
                service.timeout_ms.clamp(1_000, 120_000),
            ))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(http_error)
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

    fn send_json<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, RagError> {
        let response = request.send().map_err(http_error)?;
        parse_response(response)
    }

    fn send_empty(&self, request: RequestBuilder) -> Result<(), RagError> {
        let response = request.send().map_err(http_error)?;
        if response.status().is_success() {
            return Ok(());
        }
        parse_error_response(response)
    }
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
    process_mode: &'a str,
    chunk_strategy: &'a str,
    chunk_config: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pipeline_id: Option<&'a str>,
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
    let Some(capabilities) = capabilities else {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            "请先在 RAG Hub 测试服务连接并确认协议版本",
        ));
    };
    let version = capabilities.protocol_version.trim();
    if version.split('.').next() != Some(SUPPORTED_PROTOCOL_MAJOR) {
        return Err(RagError::new(
            "RAG_PROTOCOL_MISMATCH",
            format!("RAG 协议主版本不兼容：需要 1.x，收到 {version}"),
        ));
    }
    Ok(())
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

pub(crate) fn resolve_search_policy(capabilities: Option<&RagCapabilities>) -> RagSearchPolicy {
    RagSearchPolicy {
        max_top_k: capability_limit(capabilities, "maxTopK", LOCAL_MAX_TOP_K),
        max_top_n: capability_limit(capabilities, "maxTopN", LOCAL_MAX_TOP_N),
        max_query_length: capability_limit(
            capabilities,
            "maxQueryLength",
            LOCAL_MAX_QUERY_LENGTH as u32,
        ) as usize,
        rerank_supported: capabilities
            .and_then(|snapshot| snapshot.features.get("rerank"))
            .copied()
            .unwrap_or(true),
    }
}

fn capability_limit(capabilities: Option<&RagCapabilities>, key: &str, local_maximum: u32) -> u32 {
    capabilities
        .and_then(|snapshot| snapshot.limits.get(key))
        .copied()
        .filter(|value| *value > 0)
        .map(|value| value.min(u64::from(local_maximum)) as u32)
        .unwrap_or(local_maximum)
}

fn require_feature(
    capabilities: Option<&RagCapabilities>,
    feature: &str,
    label: &str,
) -> Result<(), RagError> {
    if capabilities
        .and_then(|snapshot| snapshot.features.get(feature))
        .is_some_and(|supported| !supported)
    {
        return Err(RagError::new(
            "RAG_FEATURE_UNAVAILABLE",
            format!("当前 RAG 服务未启用{label}能力"),
        ));
    }
    Ok(())
}

fn max_upload_bytes(capabilities: Option<&RagCapabilities>) -> u64 {
    capabilities
        .and_then(|snapshot| snapshot.limits.get("maxUploadBytes"))
        .copied()
        .filter(|value| *value > 0)
        .map(|value| value.min(LOCAL_MAX_UPLOAD_BYTES))
        .unwrap_or(LOCAL_MAX_UPLOAD_BYTES)
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

fn optional_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_response<T: DeserializeOwned>(mut response: Response) -> Result<T, RagError> {
    let status = response.status();
    let body = read_response_body(&mut response)?;
    if status.is_success() {
        return serde_json::from_slice(&body).map_err(|error| {
            RagError::new("RAG_RESPONSE_INVALID", format!("RAG 响应无法解析：{error}"))
        });
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
    let code = body
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_else(|| status_code(status));
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("RAG 服务调用失败");
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
        .map_err(http_error)?;
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

fn http_error(error: impl std::fmt::Display) -> RagError {
    RagError::new("RAG_REQUEST_FAILED", format!("RAG 请求失败：{error}"))
}
