use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use super::{
    RagAccessMode, RagCapabilities, RagCredentialKind, RagCredentialStore, RagError,
    RagKnowledgeBase, RagSearchRequest, RagSearchResponse, RagServiceConfig, RagServiceStore,
};

pub struct RagGatewayService {
    store: RagServiceStore,
    credentials: RagCredentialStore,
}

impl RagGatewayService {
    pub fn open() -> Result<Self, RagError> {
        Ok(Self {
            store: RagServiceStore::open()?,
            credentials: RagCredentialStore,
        })
    }

    pub fn test_service(&self, service_id: &str) -> Result<RagCapabilities, RagError> {
        let service = self
            .store
            .resolve(Some(service_id), RagAccessMode::Management)?;
        self.get_json(&service, RagAccessMode::Management, "/capabilities")
    }

    pub fn list_knowledge_bases(
        &self,
        service_id: Option<&str>,
        mode: RagAccessMode,
    ) -> Result<Vec<RagKnowledgeBase>, RagError> {
        let service = self.store.resolve(service_id, mode)?;
        let result = self.get_json(&service, mode, "/knowledge-bases")?;
        Ok(if mode == RagAccessMode::Agent {
            filter_agent_knowledge_bases(&service, result)
        } else {
            result
        })
    }

    pub fn list_documents(
        &self,
        service_id: Option<&str>,
        knowledge_base_id: &str,
        current: u32,
        size: u32,
    ) -> Result<Value, RagError> {
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
    ) -> Result<Value, RagError> {
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
    ) -> Result<Value, RagError> {
        let service = self.store.resolve(service_id, RagAccessMode::Management)?;
        let path = Path::new(file_path);
        if !path.is_file() {
            return Err(RagError::new("RAG_REQUEST_INVALID", "待上传文件不存在"));
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
            .multipart(form);
        self.send_json(self.authorize(request, &service, RagAccessMode::Management)?)
    }

    pub fn search(
        &self,
        mut request: RagSearchRequest,
        mode: RagAccessMode,
    ) -> Result<RagSearchResponse, RagError> {
        let service = self.store.resolve(request.service_id.as_deref(), mode)?;
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
        let payload = SearchPayload {
            query: request.query,
            knowledge_base_ids: request.knowledge_base_ids,
            top_k: request.top_k.unwrap_or(10).clamp(1, 50),
            rerank: request.rerank.unwrap_or(true),
            top_n: request.top_n.unwrap_or(5).clamp(1, 20),
        };
        self.post_json(&service, mode, "/retrieval", &payload)
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
    let base = service.base_url.trim_end_matches('/');
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

fn parse_response<T: DeserializeOwned>(response: Response) -> Result<T, RagError> {
    let status = response.status();
    if status.is_success() {
        return response.json().map_err(|error| {
            RagError::new("RAG_RESPONSE_INVALID", format!("RAG 响应无法解析：{error}"))
        });
    }
    let body = response.json::<Value>().unwrap_or(Value::Null);
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
