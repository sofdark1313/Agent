use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::*;

const NOW_MS: u64 = 1_800_000_000_000;

struct TestCredentials;

impl RagCredentialProvider for TestCredentials {
    fn get(&self, _service_id: &str, _kind: RagCredentialKind) -> Result<String, RagError> {
        Ok("test-secret".to_string())
    }
}

fn capabilities(protocol_version: &str, captured_at_ms: Option<u64>) -> RagCapabilities {
    RagCapabilities {
        protocol_version: protocol_version.to_string(),
        captured_at_ms,
        credential_audience: Some("management".to_string()),
        features: BTreeMap::from([
            ("fileUpload".to_string(), true),
            ("urlImport".to_string(), true),
            ("rerank".to_string(), true),
        ]),
        limits: BTreeMap::from([
            ("maxTopK".to_string(), 50),
            ("maxTopN".to_string(), 20),
            ("maxQueryLength".to_string(), 4_000),
            ("maxUploadBytes".to_string(), 25 * 1024 * 1024),
        ]),
        ingestion: None,
    }
}

fn policy_error(result: Result<RagSearchPolicy, RagError>, message: &str) -> RagError {
    match result {
        Ok(_) => panic!("{message}"),
        Err(error) => error,
    }
}

fn service(base_url: String) -> RagServiceConfig {
    RagServiceConfig {
        id: "contract".to_string(),
        name: "Contract".to_string(),
        adapter_type: "ragent".to_string(),
        base_url,
        enabled: true,
        is_default: true,
        agent_enabled: true,
        agent_knowledge_base_ids: vec!["hr".to_string()],
        timeout_ms: 5_000,
        management_credential_configured: true,
        agent_credential_configured: false,
        capabilities_snapshot: None,
    }
}

fn spawn_capabilities_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind capability server");
    let address = listener.local_addr().expect("capability server address");
    thread::spawn(move || {
        let responses = [
            r#"{"status":"ok"}"#,
            r#"{"protocolVersion":"1.0","capturedAtMs":1,"credentialAudience":"management","features":{"fileUpload":true,"urlImport":true,"rerank":true},"limits":{"maxTopK":50,"maxTopN":20,"maxQueryLength":4000,"maxUploadBytes":26214400}}"#,
        ];
        for body in responses {
            let (mut stream, _) = listener.accept().expect("accept capability request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set request timeout");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write capability response");
        }
    });
    format!("http://{address}")
}

fn system_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time after epoch")
        .as_millis() as u64
}

#[test]
fn connection_test_stamps_and_persists_a_local_capability_time() {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    store
        .save(&service(spawn_capabilities_server()))
        .expect("save RAG service");
    let gateway = RagGatewayService::new_for_test(store, Arc::new(TestCredentials));
    let before = system_now_ms();

    let returned = gateway.test_service("contract").expect("test service");
    let after = system_now_ms();
    let captured_at_ms = returned.captured_at_ms.expect("local capture timestamp");

    assert!((before..=after).contains(&captured_at_ms));
    let stored = gateway
        .store
        .get("contract")
        .expect("reload service")
        .expect("stored service");
    assert_eq!(stored.capabilities_snapshot, Some(returned));
}

#[test]
fn cached_protocol_gate_requires_a_fresh_local_1_x_snapshot() {
    validate_agent_protocol_at(Some(&capabilities("1.7", Some(NOW_MS - 1_000))), NOW_MS)
        .expect("fresh 1.x snapshot");

    for snapshot in [
        None,
        Some(capabilities("1.0", None)),
        Some(capabilities("1.0", Some(NOW_MS + 1))),
        Some(capabilities("1.0", Some(NOW_MS - 5 * 60 * 1_000 - 1))),
        Some(capabilities("1", Some(NOW_MS - 1_000))),
        Some(capabilities("1.foo", Some(NOW_MS - 1_000))),
        Some(capabilities("2.0", Some(NOW_MS - 1_000))),
    ] {
        let error = validate_agent_protocol_at(snapshot.as_ref(), NOW_MS)
            .expect_err("invalid or stale snapshot must fail closed");
        assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
    }
}

#[test]
fn legacy_capability_json_deserializes_but_requires_a_retest() {
    let legacy: RagCapabilities = serde_json::from_str(
        r#"{"protocolVersion":"1.0","features":{"rerank":true},"limits":{"maxTopK":50}}"#,
    )
    .expect("deserialize legacy capability snapshot");

    assert_eq!(legacy.captured_at_ms, None);
    assert_eq!(
        validate_agent_protocol_at(Some(&legacy), NOW_MS)
            .expect_err("legacy snapshots require a connection retest")
            .code(),
        "RAG_PROTOCOL_MISMATCH"
    );
}

#[test]
fn search_policy_requires_complete_positive_capabilities() {
    let fresh = capabilities("1.0", Some(NOW_MS - 1_000));
    let policy = resolve_search_policy_at(Some(&fresh), NOW_MS).expect("valid search policy");
    assert_eq!(policy.max_top_k, 50);
    assert_eq!(policy.max_top_n, 20);
    assert_eq!(policy.max_query_length, 4_000);
    assert!(policy.rerank_supported);

    let mut rerank_disabled = fresh.clone();
    rerank_disabled.features.insert("rerank".to_string(), false);
    assert!(
        !resolve_search_policy_at(Some(&rerank_disabled), NOW_MS)
            .expect("explicitly disabled rerank remains a valid retrieval policy")
            .rerank_supported
    );

    let mut missing_feature = fresh.clone();
    missing_feature.features.remove("rerank");
    assert_eq!(
        policy_error(
            resolve_search_policy_at(Some(&missing_feature), NOW_MS),
            "missing rerank declaration must fail",
        )
        .code(),
        "RAG_PROTOCOL_MISMATCH"
    );

    for key in ["maxTopK", "maxTopN", "maxQueryLength"] {
        let mut missing = fresh.clone();
        missing.limits.remove(key);
        assert_eq!(
            policy_error(
                resolve_search_policy_at(Some(&missing), NOW_MS),
                "missing search limit must fail",
            )
            .code(),
            "RAG_PROTOCOL_MISMATCH"
        );

        let mut zero = fresh.clone();
        zero.limits.insert(key.to_string(), 0);
        assert_eq!(
            policy_error(
                resolve_search_policy_at(Some(&zero), NOW_MS),
                "zero search limit must fail",
            )
            .code(),
            "RAG_PROTOCOL_MISMATCH"
        );
    }
}

#[test]
fn feature_and_upload_limit_checks_fail_closed() {
    let mut fresh = capabilities("1.0", Some(NOW_MS - 1_000));
    require_feature_at(Some(&fresh), "fileUpload", "文件上传", NOW_MS)
        .expect("declared upload feature");
    assert_eq!(
        max_upload_bytes_at(Some(&fresh), NOW_MS).expect("upload limit"),
        25 * 1024 * 1024
    );

    fresh.features.remove("fileUpload");
    assert_eq!(
        require_feature_at(Some(&fresh), "fileUpload", "文件上传", NOW_MS)
            .expect_err("missing feature declaration")
            .code(),
        "RAG_PROTOCOL_MISMATCH"
    );

    let mut zero_limit = capabilities("1.0", Some(NOW_MS - 1_000));
    zero_limit.limits.insert("maxUploadBytes".to_string(), 0);
    assert_eq!(
        max_upload_bytes_at(Some(&zero_limit), NOW_MS)
            .expect_err("zero upload limit")
            .code(),
        "RAG_PROTOCOL_MISMATCH"
    );
}

fn gateway_with_snapshot(snapshot: Option<RagCapabilities>) -> RagGatewayService {
    let store = RagServiceStore::open_in_memory().expect("open RAG service store");
    let mut configured = service("http://127.0.0.1:9".to_string());
    configured.agent_credential_configured = true;
    configured.capabilities_snapshot = snapshot;
    store.save(&configured).expect("save RAG service");
    RagGatewayService::new_for_test(store, Arc::new(TestCredentials))
}

fn search_request(query: &str) -> RagSearchRequest {
    RagSearchRequest {
        service_id: Some("contract".to_string()),
        query: query.to_string(),
        knowledge_base_ids: vec!["hr".to_string()],
        top_k: Some(5),
        rerank: Some(false),
        top_n: Some(5),
    }
}

#[test]
fn hub_and_agent_search_both_require_a_fresh_capability_snapshot() {
    for mode in [RagAccessMode::Management, RagAccessMode::Agent] {
        let error = gateway_with_snapshot(None)
            .search(search_request("policy"), mode)
            .expect_err("untested search must fail before network I/O");
        assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
    }
}

#[test]
fn search_query_length_uses_utf16_code_units() {
    let mut snapshot = capabilities("1.0", Some(system_now_ms()));
    snapshot.limits.insert("maxQueryLength".to_string(), 2);

    let error = gateway_with_snapshot(Some(snapshot))
        .search(search_request("😀a"), RagAccessMode::Management)
        .expect_err("three UTF-16 units must exceed a two-unit limit");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}
