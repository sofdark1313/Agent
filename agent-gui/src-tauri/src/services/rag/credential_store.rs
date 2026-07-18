use keyring::{Entry, Error as KeyringError};

use super::RagError;

const KEYRING_SERVICE: &str = "Agent RAG";

#[derive(Debug, Clone, Copy)]
pub enum RagCredentialKind {
    Management,
    Agent,
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
        entry(service_id, kind)?.get_password().map_err(|error| {
            if matches!(error, KeyringError::NoEntry) {
                RagError::new("RAG_CREDENTIAL_MISSING", "RAG API Key 未配置")
            } else {
                keyring_error(error)
            }
        })
    }

    pub fn delete(&self, service_id: &str, kind: RagCredentialKind) -> Result<(), RagError> {
        match entry(service_id, kind)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

fn entry(service_id: &str, kind: RagCredentialKind) -> Result<Entry, RagError> {
    Entry::new(KEYRING_SERVICE, &format!("{service_id}:{}", kind.label())).map_err(keyring_error)
}

fn keyring_error(error: impl std::fmt::Display) -> RagError {
    RagError::new(
        "RAG_CREDENTIAL_STORE_UNAVAILABLE",
        format!("系统凭证库不可用：{error}"),
    )
}
