use super::{RagAccessMode, RagServiceConfig, RagServiceStore};

fn service(id: &str, is_default: bool) -> RagServiceConfig {
    RagServiceConfig {
        id: id.to_string(),
        name: format!("Service {id}"),
        adapter_type: "ragent".to_string(),
        base_url: format!("https://{id}.example.com"),
        enabled: true,
        is_default,
        agent_enabled: true,
        agent_knowledge_base_ids: vec!["hr".to_string()],
        timeout_ms: 30_000,
        management_credential_configured: true,
        agent_credential_configured: true,
        capabilities_snapshot: None,
    }
}

#[test]
fn resolve_without_default_uses_the_only_enabled_management_service() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    let mut disabled = service("disabled", false);
    disabled.enabled = false;
    store.save(&disabled).expect("save disabled service");
    store
        .save(&service("eligible", false))
        .expect("save eligible service");

    let resolved = store
        .resolve(None, RagAccessMode::Management)
        .expect("resolve unique enabled service");

    assert_eq!(resolved.id, "eligible");
}

#[test]
fn resolve_without_default_uses_the_only_agent_eligible_service() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    let mut hub_only = service("hub-only", false);
    hub_only.agent_enabled = false;
    store.save(&hub_only).expect("save Hub-only service");
    store
        .save(&service("agent", false))
        .expect("save Agent service");

    let resolved = store
        .resolve(None, RagAccessMode::Agent)
        .expect("resolve unique Agent service");

    assert_eq!(resolved.id, "agent");
}

#[test]
fn resolve_without_default_rejects_ambiguous_enabled_services() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store.save(&service("a", false)).expect("save service a");
    store.save(&service("b", false)).expect("save service b");

    let error = store
        .resolve(None, RagAccessMode::Management)
        .expect_err("multiple services without a default must be explicit");

    assert_eq!(error.code(), "RAG_SERVICE_NOT_FOUND");
    assert!(error.to_string().contains("多个"));
    assert!(error.to_string().contains("service_id"));
}

#[test]
fn resolve_keeps_an_explicit_default_failure_instead_of_switching_services() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    let mut disabled_default = service("default", true);
    disabled_default.enabled = false;
    store
        .save(&disabled_default)
        .expect("save disabled default");
    store
        .save(&service("eligible", false))
        .expect("save eligible service");

    let error = store
        .resolve(None, RagAccessMode::Management)
        .expect_err("disabled default must not silently switch services");

    assert_eq!(error.code(), "RAG_SERVICE_DISABLED");
}

#[test]
fn corrupt_capability_snapshot_is_dropped_without_hiding_the_service() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store
        .save(&service("healthy", false))
        .expect("save healthy service");
    store
        .save(&service("repair", false))
        .expect("save repairable service");
    store
        .overwrite_json_for_test("repair", "capabilities_snapshot_json", "{broken")
        .expect("corrupt capability snapshot");

    let services = store
        .list()
        .expect("list services despite corrupt capability snapshot");

    assert_eq!(services.len(), 2);
    let repair = services
        .iter()
        .find(|item| item.id == "repair")
        .expect("repairable service remains visible");
    assert_eq!(repair.capabilities_snapshot, None);
}

#[test]
fn corrupt_core_service_json_still_fails_closed() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store.save(&service("broken", false)).expect("save service");
    store
        .overwrite_json_for_test("broken", "agent_knowledge_base_ids_json", "{broken")
        .expect("corrupt core service JSON");

    let error = store
        .list()
        .expect_err("core allowlist corruption must not be silently discarded");

    assert_eq!(error.code(), "RAG_STORE_ERROR");
}
