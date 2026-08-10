use std::collections::BTreeMap;

use crate::commands::rag::{apply_credential_state, requires_capabilities_retest};

use super::gateway::{
    filter_agent_knowledge_bases, normalize_service_config, resolve_search_policy,
    service_test_modes, validate_agent_protocol, validate_capability_audience,
};
use super::{
    RagAccessMode, RagCapabilities, RagKnowledgeBase, RagSearchResponse, RagServiceConfig,
    RagServiceStore,
};

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
            credential_audience: Some("management".to_string()),
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
fn connection_or_credential_changes_invalidate_capabilities_snapshot() {
    let current = service("company", true);
    let unchanged = current.clone();
    assert!(!requires_capabilities_retest(
        Some(&current),
        &unchanged,
        false,
        false
    ));

    let mut moved = unchanged.clone();
    moved.base_url = "https://new.example.com".to_string();
    assert!(requires_capabilities_retest(
        Some(&current),
        &moved,
        false,
        false
    ));

    assert!(requires_capabilities_retest(
        Some(&current),
        &unchanged,
        true,
        false
    ));
    assert!(requires_capabilities_retest(
        Some(&current),
        &unchanged,
        false,
        true
    ));
    assert!(requires_capabilities_retest(None, &unchanged, false, false));
}

#[test]
fn service_save_derives_credential_flags_instead_of_trusting_the_frontend() {
    let mut forged = service("new", true);
    apply_credential_state(&mut forged, None, None, None);
    assert!(!forged.management_credential_configured);
    assert!(!forged.agent_credential_configured);

    let current = service("company", true);
    let mut retained = current.clone();
    retained.management_credential_configured = false;
    retained.agent_credential_configured = false;
    apply_credential_state(&mut retained, Some(&current), None, None);
    assert!(retained.management_credential_configured);
    assert!(retained.agent_credential_configured);

    apply_credential_state(&mut retained, Some(&current), Some(""), Some("replacement"));
    assert!(!retained.management_credential_configured);
    assert!(retained.agent_credential_configured);
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

#[test]
fn resolve_uses_the_enabled_default_service_for_agent_calls() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store.save(&service("a", true)).expect("save service a");

    let resolved = store
        .resolve(None, RagAccessMode::Agent)
        .expect("resolve default service");

    assert_eq!(resolved.id, "a");
}

#[test]
fn agent_knowledge_base_filter_keeps_only_the_local_allowlist() {
    let service = service("company", true);
    let remote = vec![
        RagKnowledgeBase {
            id: "hr".to_string(),
            name: "HR".to_string(),
            embedding_model: None,
            collection_name: None,
            document_count: None,
        },
        RagKnowledgeBase {
            id: "engineering".to_string(),
            name: "Engineering".to_string(),
            embedding_model: None,
            collection_name: None,
            document_count: None,
        },
    ];

    let filtered = filter_agent_knowledge_bases(&service, remote);

    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].id, "hr");
}

#[test]
fn agent_protocol_gate_requires_a_tested_v1_service() {
    let missing = validate_agent_protocol(None).expect_err("missing capabilities must be rejected");
    assert_eq!(missing.code(), "RAG_PROTOCOL_MISMATCH");

    let mut incompatible = service("company", true)
        .capabilities_snapshot
        .expect("capabilities snapshot");
    incompatible.protocol_version = "2.0".to_string();
    let mismatch = validate_agent_protocol(Some(&incompatible))
        .expect_err("incompatible protocol must be rejected");
    assert_eq!(mismatch.code(), "RAG_PROTOCOL_MISMATCH");

    incompatible.protocol_version = "1.7".to_string();
    validate_agent_protocol(Some(&incompatible)).expect("v1 protocol should be accepted");
}

#[test]
fn connection_test_verifies_every_configured_credential_audience() {
    let configured = service("company", true);
    assert_eq!(
        service_test_modes(&configured),
        vec![RagAccessMode::Management, RagAccessMode::Agent]
    );

    let mut management_only = configured;
    management_only.agent_credential_configured = false;
    assert_eq!(
        service_test_modes(&management_only),
        vec![RagAccessMode::Management]
    );
}

#[test]
fn connection_test_rejects_credential_audience_swaps() {
    let management = service("company", true)
        .capabilities_snapshot
        .expect("capabilities snapshot");
    validate_capability_audience(&management, RagAccessMode::Management)
        .expect("management key should match management audience");

    let mismatch = validate_capability_audience(&management, RagAccessMode::Agent)
        .expect_err("management key must not be accepted as the agent credential");
    assert_eq!(mismatch.code(), "RAG_AUTH_FAILED");

    let mut missing = management;
    missing.credential_audience = None;
    let missing = validate_capability_audience(&missing, RagAccessMode::Management)
        .expect_err("capabilities must identify the authenticated audience");
    assert_eq!(missing.code(), "RAG_PROTOCOL_MISMATCH");
}

#[test]
fn service_config_normalizes_local_connection_values() {
    let mut config = service("company", true);
    config.id = " company-rag ".to_string();
    config.name = " Company RAG ".to_string();
    config.adapter_type = " RAGENT ".to_string();
    config.base_url = " http://127.0.0.1:8080/ ".to_string();
    config.agent_knowledge_base_ids = vec![
        " hr ".to_string(),
        "policy".to_string(),
        "hr".to_string(),
        "".to_string(),
    ];

    normalize_service_config(&mut config).expect("local HTTP service should be accepted");

    assert_eq!(config.id, "company-rag");
    assert_eq!(config.name, "Company RAG");
    assert_eq!(config.adapter_type, "ragent");
    assert_eq!(config.base_url, "http://127.0.0.1:8080");
    assert_eq!(config.agent_knowledge_base_ids, vec!["hr", "policy"]);
}

#[test]
fn service_config_rejects_remote_plain_http_and_unsafe_ids() {
    let mut remote_http = service("company", true);
    remote_http.base_url = "http://rag.example.com".to_string();
    let insecure =
        normalize_service_config(&mut remote_http).expect_err("remote plain HTTP must be rejected");
    assert_eq!(insecure.code(), "RAG_REQUEST_INVALID");

    let mut unsafe_id = service("company", true);
    unsafe_id.id = "company:management".to_string();
    let invalid_id = normalize_service_config(&mut unsafe_id)
        .expect_err("service id must be safe for credential account names");
    assert_eq!(invalid_id.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn search_policy_uses_remote_limits_without_exceeding_local_safety_caps() {
    let capabilities = RagCapabilities {
        protocol_version: "1.0".to_string(),
        credential_audience: None,
        features: BTreeMap::from([("rerank".to_string(), false)]),
        limits: BTreeMap::from([
            ("maxTopK".to_string(), 8),
            ("maxTopN".to_string(), 3),
            ("maxQueryLength".to_string(), 120),
        ]),
    };
    let policy = resolve_search_policy(Some(&capabilities));

    assert_eq!(policy.max_top_k, 8);
    assert_eq!(policy.max_top_n, 3);
    assert_eq!(policy.max_query_length, 120);
    assert!(!policy.rerank_supported);

    let oversized = RagCapabilities {
        protocol_version: "1.0".to_string(),
        credential_audience: None,
        features: BTreeMap::new(),
        limits: BTreeMap::from([
            ("maxTopK".to_string(), 500),
            ("maxTopN".to_string(), 200),
            ("maxQueryLength".to_string(), 40_000),
        ]),
    };
    let capped = resolve_search_policy(Some(&oversized));
    assert_eq!(capped.max_top_k, 50);
    assert_eq!(capped.max_top_n, 20);
    assert_eq!(capped.max_query_length, 4_000);
    assert!(capped.rerank_supported);
}

#[test]
fn hub_command_surface_exposes_management_lifecycle_without_agent_writes() {
    let source = include_str!("../../commands/integration/rag.rs");

    assert!(source.contains("rag_hub_create_knowledge_base"));
    assert!(source.contains("rag_hub_update_knowledge_base"));
    assert!(source.contains("rag_hub_delete_knowledge_base"));
    assert!(source.contains("rag_hub_import_document_url"));
    assert!(source.contains("rag_pick_document_file"));
    assert!(source.contains("rag_hub_get_ingestion_job"));
    assert!(source.contains("rag_hub_retry_ingestion_job"));
    assert!(source.contains("rag_hub_delete_document"));
    assert!(source.contains("rag_hub_list_document_chunks"));
    assert!(!source.contains("rag_agent_upload"));
    assert!(!source.contains("rag_agent_delete"));
    assert!(!source.contains("rag_agent_retry"));
    assert!(!source.contains("rag_agent_create_knowledge_base"));
    assert!(!source.contains("rag_agent_update_knowledge_base"));
    assert!(!source.contains("rag_agent_delete_knowledge_base"));
    assert!(!source.contains("rag_agent_import_document_url"));
}

#[test]
fn enhanced_search_response_preserves_sources_ranking_warnings_and_timings() {
    let response: RagSearchResponse = serde_json::from_value(serde_json::json!({
        "requestId": "request-1",
        "rawResults": [{
            "knowledgeBaseId": "kb-1",
            "documentId": "doc-1",
            "documentName": "员工手册.pdf",
            "chunkId": "chunk-1",
            "content": "年假规则",
            "score": 0.82,
            "source": "vector",
            "rankBefore": 1,
            "rankAfter": null,
            "metadata": { "chunkIndex": 3 }
        }],
        "results": [{
            "knowledgeBaseId": "kb-1",
            "documentId": "doc-1",
            "documentName": "员工手册.pdf",
            "chunkId": "chunk-1",
            "content": "年假规则",
            "score": 0.91,
            "source": "vector",
            "rankBefore": 3,
            "rankAfter": 1,
            "metadata": { "chunkIndex": 3, "tokenCount": 24 }
        }],
        "warnings": ["RAG_RERANK_UNAVAILABLE"],
        "timings": { "retrievalMs": 12, "rerankMs": 8, "totalMs": 22 }
    }))
    .expect("deserialize enhanced search response");

    assert_eq!(response.request_id.as_deref(), Some("request-1"));
    assert_eq!(
        response.raw_results[0].document_id.as_deref(),
        Some("doc-1")
    );
    assert_eq!(
        response.raw_results[0].document_name.as_deref(),
        Some("员工手册.pdf")
    );
    assert_eq!(response.results[0].rank_before, Some(3));
    assert_eq!(response.results[0].rank_after, Some(1));
    assert_eq!(
        response.results[0].metadata.get("tokenCount"),
        Some(&serde_json::json!(24))
    );
    assert_eq!(response.warnings, vec!["RAG_RERANK_UNAVAILABLE"]);
    let timings = response.timings.expect("search timings");
    assert_eq!(timings.retrieval_ms, 12);
    assert_eq!(timings.rerank_ms, 8);
    assert_eq!(timings.total_ms, 22);
}

#[test]
fn legacy_search_response_defaults_new_fields() {
    let response: RagSearchResponse = serde_json::from_value(serde_json::json!({
        "results": [{
            "knowledgeBaseId": "kb-1",
            "chunkId": "chunk-1",
            "content": "旧协议结果",
            "score": 0.75,
            "source": "vector"
        }]
    }))
    .expect("deserialize legacy search response");

    assert_eq!(response.request_id, None);
    assert!(response.raw_results.is_empty());
    assert!(response.warnings.is_empty());
    assert_eq!(response.timings, None);
    assert_eq!(response.results[0].document_id, None);
    assert_eq!(response.results[0].document_name, None);
    assert_eq!(response.results[0].rank_before, None);
    assert_eq!(response.results[0].rank_after, None);
    assert!(response.results[0].metadata.is_empty());
}
