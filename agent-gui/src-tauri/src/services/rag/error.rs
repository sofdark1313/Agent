use std::fmt;

/// RAG 本地网关的稳定错误。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RagError {
    code: &'static str,
    message: String,
}

impl RagError {
    /// 创建不包含敏感配置的稳定错误。
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// 返回供上层映射的稳定错误码。
    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for RagError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RagError {}
