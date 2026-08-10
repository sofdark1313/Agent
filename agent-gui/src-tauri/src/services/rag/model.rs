use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RagAccessMode {
    Management,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagKnowledgeBase {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub embedding_model: Option<String>,
    #[serde(default)]
    pub collection_name: Option<String>,
    #[serde(default)]
    pub document_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagPage<T> {
    pub items: Vec<T>,
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagDocument {
    pub id: String,
    pub knowledge_base_id: String,
    pub name: String,
    pub source_type: Option<String>,
    pub source_location: Option<String>,
    pub enabled: Option<bool>,
    pub chunk_count: Option<u32>,
    pub file_type: Option<String>,
    pub file_size: Option<u64>,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagChunk {
    pub id: String,
    pub index: Option<u32>,
    pub content: String,
    pub char_count: Option<u32>,
    pub token_count: Option<u32>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagAcceptedJob {
    pub document_id: String,
    pub job_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagIngestionError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagIngestionJob {
    pub job_id: String,
    pub document_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: u32,
    pub retryable: bool,
    pub error: Option<RagIngestionError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    pub knowledge_base_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub document_name: Option<String>,
    pub chunk_id: String,
    pub content: String,
    pub score: f64,
    pub source: String,
    #[serde(default)]
    pub rank_before: Option<u32>,
    #[serde(default)]
    pub rank_after: Option<u32>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchTimings {
    pub retrieval_ms: u64,
    pub rerank_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResponse {
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub raw_results: Vec<RagSearchHit>,
    pub results: Vec<RagSearchHit>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub timings: Option<RagSearchTimings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchRequest {
    pub service_id: Option<String>,
    pub query: String,
    pub knowledge_base_ids: Vec<String>,
    pub top_k: Option<u32>,
    pub rerank: Option<bool>,
    pub top_n: Option<u32>,
}

/// 外部 RAG 服务声明的协议能力快照。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagCapabilities {
    /// 服务协议版本，例如 `1.0`。
    pub protocol_version: String,
    /// 当前请求所使用 API Key 的受众，用于连接测试识别凭证是否放反。
    #[serde(default)]
    pub credential_audience: Option<String>,
    /// 服务支持的功能开关。
    pub features: BTreeMap<String, bool>,
    /// 服务声明的数值限制。
    pub limits: BTreeMap<String, u64>,
}

/// 不含 API Key 的 RAG 服务配置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RagServiceConfig {
    /// Agent 本地稳定服务标识。
    pub id: String,
    /// 用户可见服务名称。
    pub name: String,
    /// 适配器类型，第一版固定支持 `ragent`。
    pub adapter_type: String,
    /// 外部 RAG 服务基础地址。
    pub base_url: String,
    /// 是否允许 Hub 使用该服务。
    pub enabled: bool,
    /// 是否为省略 service_id 时使用的默认服务。
    #[serde(rename = "default")]
    pub is_default: bool,
    /// 是否向聊天 Agent 开放只读能力。
    pub agent_enabled: bool,
    /// Agent 本地允许访问的知识库白名单。
    pub agent_knowledge_base_ids: Vec<String>,
    /// 单次远程调用超时，单位毫秒。
    pub timeout_ms: u64,
    /// 管理凭证是否已写入系统凭证库。
    pub management_credential_configured: bool,
    /// Agent 只读凭证是否已写入系统凭证库。
    pub agent_credential_configured: bool,
    /// 最近一次成功读取的服务能力快照。
    pub capabilities_snapshot: Option<RagCapabilities>,
}
