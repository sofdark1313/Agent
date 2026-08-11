use keyring::{Entry, Error as KeyringError};

use super::RagError;

pub(crate) const KEYRING_SERVICE: &str = "ai.agent.rag";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RagCredentialKind {
    Management,
    Agent,
}

pub trait RagCredentialProvider: Send + Sync {
    fn get(&self, service_id: &str, kind: RagCredentialKind) -> Result<String, RagError>;
}

impl RagCredentialKind {
    fn label(self) -> &'static str {
        match self {
            Self::Management => "management",
            Self::Agent => "agent",
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct RagCredentialStore;

impl RagCredentialStore {
    pub fn set(
        &self,
        service_id: &str,
        kind: RagCredentialKind,
        api_key: &str,
    ) -> Result<(), RagError> {
        if api_key.trim().is_empty() {
            return self.delete(service_id, kind);
        }
        entry(service_id, kind)?
            .set_password(api_key.trim())
            .map_err(keyring_error)
    }

    pub fn get(&self, service_id: &str, kind: RagCredentialKind) -> Result<String, RagError> {
        self.get_optional(service_id, kind)?
            .ok_or_else(|| RagError::new("RAG_CREDENTIAL_MISSING", "RAG API Key 未配置"))
    }

    pub fn get_optional(
        &self,
        service_id: &str,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError> {
        match entry(service_id, kind)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    pub fn delete(&self, service_id: &str, kind: RagCredentialKind) -> Result<(), RagError> {
        match entry(service_id, kind)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

impl RagCredentialProvider for RagCredentialStore {
    fn get(&self, service_id: &str, kind: RagCredentialKind) -> Result<String, RagError> {
        RagCredentialStore::get(self, service_id, kind)
    }
}

pub(crate) fn credential_account(service_id: &str, kind: RagCredentialKind) -> String {
    format!("{service_id}:{}", kind.label())
}

fn entry(service_id: &str, kind: RagCredentialKind) -> Result<Entry, RagError> {
    Entry::new(KEYRING_SERVICE, &credential_account(service_id, kind)).map_err(keyring_error)
}

fn keyring_error(error: impl std::fmt::Display) -> RagError {
    RagError::new(
        "RAG_CREDENTIAL_STORE_UNAVAILABLE",
        format!("系统凭证库不可用：{error}"),
    )
}
