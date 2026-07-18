use std::collections::BTreeMap;

use super::{RagCapabilities, RagServiceConfig, RagServiceStore};

fn service(id: &str, is_default: bool) -> RagServiceConfig {
    RagServiceConfig {
        id: id.to_string(),
        name: format!("Service {id}"),
        adapter_type: "ragent".to_string(),
        base_url: format!("https://{id}.example.com"),
        enabled: true,
        is_default,
        agent_enabled: true,
        agent_knowledge_base_ids: vec!["hr".to_string(), "policy".to_string()],
        timeout_ms: 30_000,
        management_credential_configured: true,
        agent_credential_configured: true,
        capabilities_snapshot: Some(RagCapabilities {
            protocol_version: "1.0".to_string(),
            features: BTreeMap::from([("rerank".to_string(), true)]),
            limits: BTreeMap::from([("maxTopK".to_string(), 50)]),
        }),
    }
}

#[test]
fn saving_a_new_default_clears_the_previous_default() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store.save(&service("a", true)).expect("save service a");
    store.save(&service("b", true)).expect("save service b");

    let services = store.list().expect("list services");
    assert_eq!(services.iter().filter(|item| item.is_default).count(), 1);
    assert!(
        services
            .iter()
            .find(|item| item.id == "b")
            .expect("service b")
            .is_default
    );
}

#[test]
fn service_store_round_trips_non_sensitive_configuration() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    let expected = service("company", false);
    store.save(&expected).expect("save service");

    assert_eq!(store.get("company").expect("get service"), Some(expected));
}

#[test]
fn deleting_the_default_service_does_not_guess_a_replacement() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store.save(&service("a", true)).expect("save service a");
    store.save(&service("b", false)).expect("save service b");

    assert!(store.delete("a").expect("delete default service"));
    assert!(store
        .list()
        .expect("list services")
        .iter()
        .all(|item| !item.is_default));
}
