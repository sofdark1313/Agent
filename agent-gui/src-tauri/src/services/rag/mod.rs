mod credential_store;
mod error;
mod gateway;
mod model;
mod sanitizer;
mod service_store;

pub use error::RagError;
pub(crate) use gateway::normalize_service_config;
pub use gateway::RagGatewayService;
pub use model::{
    RagAcceptedJob, RagAccessMode, RagCapabilities, RagChunk, RagDocument,
    RagIngestionCapabilities, RagIngestionJob, RagIngestionRequest, RagKnowledgeBase, RagPage,
    RagPickedDocumentFile, RagRerankCandidate, RagRerankRequest, RagSearchRequest,
    RagSearchResponse, RagServiceConfig,
};
pub use service_store::RagServiceStore;

#[cfg(test)]
mod service_store_tests;
#[cfg(test)]
mod tests;
pub use credential_store::{RagCredentialKind, RagCredentialProvider, RagCredentialStore};
