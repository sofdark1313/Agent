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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    pub knowledge_base_id: String,
    pub chunk_id: String,
    pub content: String,
    pub score: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResponse {
    pub results: Vec<RagSearchHit>,
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
