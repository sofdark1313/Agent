mod credential_store;
mod error;
mod gateway;
mod model;
mod service_store;

pub use error::RagError;
pub use gateway::RagGatewayService;
pub use model::{
    RagAccessMode, RagCapabilities, RagKnowledgeBase, RagSearchRequest, RagSearchResponse,
    RagServiceConfig,
};
pub use service_store::RagServiceStore;

#[cfg(test)]
mod tests;
pub use credential_store::{RagCredentialKind, RagCredentialStore};
