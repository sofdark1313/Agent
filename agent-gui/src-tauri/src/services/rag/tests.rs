use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Barrier, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::commands::rag::{
    clear_service_credential_with_dependencies, delete_service_with_dependencies,
    prompt_service_credential_with_dependencies, save_service_with_dependencies,
    RagCredentialPrompt, RagCredentialRepository, RagSaveServiceRequest, RagServiceRepository,
};

use super::credential_store::{credential_account, KEYRING_SERVICE};
use super::gateway::{
    filter_agent_knowledge_bases, normalize_service_config, resolve_search_policy,
    service_test_modes, validate_agent_protocol, validate_capability_audience, RagGatewayService,
};
use super::model::RagPipeline;
use super::sanitizer::{sanitize_remote_text, MAX_REMOTE_RESPONSE_TEXT_CHARS, REDACTION_MARKER};
use super::{
    RagAccessMode, RagCapabilities, RagCredentialKind, RagCredentialProvider, RagError,
    RagIngestionCapabilities, RagIngestionRequest, RagKnowledgeBase, RagPickedDocumentFile,
    RagRerankCandidate, RagRerankRequest, RagSearchRequest, RagSearchResponse, RagServiceConfig,
    RagServiceStore,
};

struct TestCredentials {
    management: String,
    agent: String,
}

struct FakeCredentialPrompt {
    value: Option<String>,
}

impl FakeCredentialPrompt {
    fn returning(value: Option<&str>) -> Self {
        Self {
            value: value.map(str::to_string),
        }
    }
}

impl RagCredentialPrompt for FakeCredentialPrompt {
    fn prompt(
        &self,
        _service: &RagServiceConfig,
        _kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError> {
        Ok(self.value.clone())
    }
}

#[derive(Default)]
struct MutationProbe {
    active: AtomicUsize,
    max_active: AtomicUsize,
    arrivals: Mutex<usize>,
    release: Condvar,
}

impl MutationProbe {
    fn enter(&self) -> MutationProbeGuard<'_> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active.fetch_max(active, Ordering::SeqCst);

        let mut arrivals = self.arrivals.lock().expect("lock mutation probe");
        *arrivals += 1;
        if *arrivals == 1 {
            let (next, _) = self
                .release
                .wait_timeout_while(arrivals, Duration::from_millis(250), |count| *count < 2)
                .expect("wait for concurrent mutation");
            arrivals = next;
        } else {
            self.release.notify_all();
        }
        drop(arrivals);

        MutationProbeGuard { probe: self }
    }

    fn max_active(&self) -> usize {
        self.max_active.load(Ordering::SeqCst)
    }
}

struct MutationProbeGuard<'a> {
    probe: &'a MutationProbe,
}

impl Drop for MutationProbeGuard<'_> {
    fn drop(&mut self) {
        self.probe.active.fetch_sub(1, Ordering::SeqCst);
    }
}

struct FakeServiceRepository {
    service: Mutex<Option<RagServiceConfig>>,
    fail_save: bool,
    fail_delete: bool,
    operations: Arc<Mutex<Vec<String>>>,
    probe: Option<Arc<MutationProbe>>,
}

impl FakeServiceRepository {
    fn new(service: RagServiceConfig) -> Self {
        Self {
            service: Mutex::new(Some(service)),
            fail_save: false,
            fail_delete: false,
            operations: Arc::new(Mutex::new(Vec::new())),
            probe: None,
        }
    }

    fn without_service() -> Self {
        Self {
            service: Mutex::new(None),
            fail_save: false,
            fail_delete: false,
            operations: Arc::new(Mutex::new(Vec::new())),
            probe: None,
        }
    }

    fn failing(service: RagServiceConfig) -> Self {
        Self {
            service: Mutex::new(Some(service)),
            fail_save: true,
            fail_delete: false,
            operations: Arc::new(Mutex::new(Vec::new())),
            probe: None,
        }
    }

    fn failing_delete(service: RagServiceConfig) -> Self {
        Self {
            service: Mutex::new(Some(service)),
            fail_save: false,
            fail_delete: true,
            operations: Arc::new(Mutex::new(Vec::new())),
            probe: None,
        }
    }

    fn with_operations(mut self, operations: Arc<Mutex<Vec<String>>>) -> Self {
        self.operations = operations;
        self
    }

    fn with_probe(mut self, probe: Arc<MutationProbe>) -> Self {
        self.probe = Some(probe);
        self
    }

    fn stored_service(&self) -> Option<RagServiceConfig> {
        self.service
            .lock()
            .expect("lock fake service repository")
            .clone()
    }
}

impl RagServiceRepository for FakeServiceRepository {
    fn get(&self, service_id: &str) -> Result<Option<RagServiceConfig>, RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        Ok(self
            .service
            .lock()
            .expect("lock fake service repository")
            .clone()
            .filter(|service| service.id == service_id))
    }

    fn save(&self, service: &RagServiceConfig) -> Result<(), RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        if self.fail_save {
            return Err(RagError::new("RAG_STORE_ERROR", "simulated store failure"));
        }
        *self.service.lock().expect("lock fake service repository") = Some(service.clone());
        Ok(())
    }

    fn delete(&self, service_id: &str) -> Result<bool, RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        self.operations
            .lock()
            .expect("lock fake service operations")
            .push("delete:service".to_string());
        if self.fail_delete {
            return Err(RagError::new("RAG_STORE_ERROR", "simulated store failure"));
        }
        let mut service = self.service.lock().expect("lock fake service repository");
        let found = service
            .as_ref()
            .is_some_and(|service| service.id == service_id);
        if found {
            service.take();
        }
        Ok(found)
    }
}

struct FakeCredentialRepository {
    values: Mutex<BTreeMap<String, String>>,
    fail_operations: Mutex<VecDeque<String>>,
    operations: Arc<Mutex<Vec<String>>>,
    probe: Option<Arc<MutationProbe>>,
}

impl FakeCredentialRepository {
    fn new(management: Option<&str>, agent: Option<&str>) -> Self {
        let mut values = BTreeMap::new();
        if let Some(value) = management {
            values.insert("management".to_string(), value.to_string());
        }
        if let Some(value) = agent {
            values.insert("agent".to_string(), value.to_string());
        }
        Self {
            values: Mutex::new(values),
            fail_operations: Mutex::new(VecDeque::new()),
            operations: Arc::new(Mutex::new(Vec::new())),
            probe: None,
        }
    }

    fn failing(management: Option<&str>, agent: Option<&str>, operation: &str) -> Self {
        Self::failing_operations(management, agent, &[operation])
    }

    fn failing_operations(
        management: Option<&str>,
        agent: Option<&str>,
        operations: &[&str],
    ) -> Self {
        Self {
            fail_operations: Mutex::new(operations.iter().map(|value| value.to_string()).collect()),
            ..Self::new(management, agent)
        }
    }

    fn with_operations(mut self, operations: Arc<Mutex<Vec<String>>>) -> Self {
        self.operations = operations;
        self
    }

    fn with_probe(mut self, probe: Arc<MutationProbe>) -> Self {
        self.probe = Some(probe);
        self
    }

    fn label(kind: RagCredentialKind) -> &'static str {
        match kind {
            RagCredentialKind::Management => "management",
            RagCredentialKind::Agent => "agent",
        }
    }

    fn value(&self, kind: RagCredentialKind) -> Option<String> {
        self.values
            .lock()
            .expect("lock fake credentials")
            .get(Self::label(kind))
            .cloned()
    }

    fn operations(&self) -> Vec<String> {
        self.operations
            .lock()
            .expect("lock fake credential operations")
            .clone()
    }

    fn record(&self, action: &str, kind: RagCredentialKind) {
        self.operations
            .lock()
            .expect("lock fake credential operations")
            .push(format!("{action}:{}", Self::label(kind)));
    }

    fn should_fail(&self, action: &str, kind: RagCredentialKind) -> bool {
        let expected = format!("{action}:{}", Self::label(kind));
        let mut failures = self
            .fail_operations
            .lock()
            .expect("lock fake credential failure");
        if failures.front().is_some_and(|failure| failure == &expected) {
            failures.pop_front();
            true
        } else {
            false
        }
    }
}

impl RagCredentialRepository for FakeCredentialRepository {
    fn get_optional(
        &self,
        _service_id: &str,
        kind: RagCredentialKind,
    ) -> Result<Option<String>, RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        self.record("get", kind);
        if self.should_fail("get", kind) {
            return Err(RagError::new(
                "RAG_CREDENTIAL_STORE_UNAVAILABLE",
                "simulated credential read failure",
            ));
        }
        Ok(self.value(kind))
    }

    fn set(
        &self,
        _service_id: &str,
        kind: RagCredentialKind,
        api_key: &str,
    ) -> Result<(), RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        self.record("set", kind);
        if self.should_fail("set", kind) {
            return Err(RagError::new(
                "RAG_CREDENTIAL_STORE_UNAVAILABLE",
                format!("simulated credential failure for {api_key}"),
            ));
        }
        self.values
            .lock()
            .expect("lock fake credentials")
            .insert(Self::label(kind).to_string(), api_key.to_string());
        Ok(())
    }

    fn delete(&self, _service_id: &str, kind: RagCredentialKind) -> Result<(), RagError> {
        let _probe = self.probe.as_ref().map(|probe| probe.enter());
        self.record("delete", kind);
        if self.should_fail("delete", kind) {
            return Err(RagError::new(
                "RAG_CREDENTIAL_STORE_UNAVAILABLE",
                "simulated credential failure",
            ));
        }
        self.values
            .lock()
            .expect("lock fake credentials")
            .remove(Self::label(kind));
        Ok(())
    }
}

impl RagCredentialProvider for TestCredentials {
    fn get(&self, _service_id: &str, kind: RagCredentialKind) -> Result<String, RagError> {
        Ok(match kind {
            RagCredentialKind::Management => self.management.clone(),
            RagCredentialKind::Agent => self.agent.clone(),
        })
    }
}

fn test_gateway(base_url: String) -> RagGatewayService {
    test_gateway_with(base_url, |_| {})
}

fn test_gateway_with(
    base_url: String,
    configure: impl FnOnce(&mut RagServiceConfig),
) -> RagGatewayService {
    let store = RagServiceStore::open_in_memory().expect("open test RAG store");
    let mut configured = service("contract", true);
    configured.base_url = base_url;
    configured.agent_knowledge_base_ids = vec!["kb-a".to_string()];
    configure(&mut configured);
    store.save(&configured).expect("save test RAG service");
    RagGatewayService::new_for_test(
        store,
        Arc::new(TestCredentials {
            management: "management-secret".to_string(),
            agent: "agent-secret".to_string(),
        }),
    )
}

fn chunk_ingestion_request() -> RagIngestionRequest {
    RagIngestionRequest {
        process_mode: "chunk".to_string(),
        chunk_strategy: Some("fixed_size".to_string()),
        chunk_config: Some(serde_json::json!({
            "chunkSize": 512,
            "overlapSize": 64
        })),
        pipeline_id: None,
    }
}

fn ingestion_capabilities() -> RagIngestionCapabilities {
    RagIngestionCapabilities {
        allowed_extensions: vec![".md".to_string(), ".pdf".to_string()],
        allowed_mime_types: vec!["text/markdown".to_string(), "application/pdf".to_string()],
        process_modes: vec!["chunk".to_string(), "pipeline".to_string()],
        chunk_strategies: vec!["fixed_size".to_string()],
        chunk_config_schema: BTreeMap::from([(
            "fixed_size".to_string(),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "chunkSize": { "type": "integer", "minimum": 1, "default": 512 },
                    "overlapSize": { "type": "integer", "minimum": 0, "default": 64 }
                },
                "required": ["chunkSize", "overlapSize"],
                "additionalProperties": false
            }),
        )]),
        pipelines: vec![RagPipeline {
            id: "clean".to_string(),
            name: "Clean pipeline".to_string(),
        }],
    }
}

fn spawn_http_server(
    status: &str,
    headers: &[(&str, String)],
    body: &str,
) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test HTTP server");
    let address = listener.local_addr().expect("test HTTP server address");
    let (sender, receiver) = mpsc::channel();
    let status = status.to_string();
    let headers = headers
        .iter()
        .map(|(name, value)| ((*name).to_string(), value.clone()))
        .collect::<Vec<_>>();
    let body = body.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept test HTTP request");
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("set request timeout");
        let mut request = Vec::new();
        let mut expected_length = None;
        loop {
            let mut chunk = [0_u8; 4096];
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    request.extend_from_slice(&chunk[..read]);
                    if expected_length.is_none() {
                        if let Some(header_end) =
                            request.windows(4).position(|part| part == b"\r\n\r\n")
                        {
                            let headers = String::from_utf8_lossy(&request[..header_end]);
                            let content_length = headers
                                .lines()
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())
                                        .flatten()
                                })
                                .unwrap_or(0);
                            expected_length = Some(header_end + 4 + content_length);
                        }
                    }
                    if expected_length.is_some_and(|length| request.len() >= length) {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(error) => panic!("read test HTTP request: {error}"),
            }
        }
        let _ = sender.send(String::from_utf8_lossy(&request).into_owned());

        let has_content_length = headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("content-length"));
        let mut response =
            format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nConnection: close\r\n");
        if !has_content_length {
            response.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        response.push_str("\r\n");
        response.push_str(&body);
        stream
            .write_all(response.as_bytes())
            .expect("write test HTTP response");
    });
    (format!("http://{address}"), receiver)
}

fn spawn_hanging_http_server(delay: Duration) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind hanging test HTTP server");
    let address = listener.local_addr().expect("hanging test HTTP server address");
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept hanging test HTTP request");
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("set hanging request timeout");
        let mut request = [0_u8; 4096];
        let _ = stream.read(&mut request);
        thread::sleep(delay);
    });
    format!("http://{address}")
}

fn spawn_http_response_sequence(
    responses: Vec<(&'static str, &'static str)>,
) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind sequenced test HTTP server");
    let address = listener.local_addr().expect("sequenced test HTTP server address");
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().expect("accept sequenced test request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set sequenced request timeout");
            let mut request = [0_u8; 8192];
            let read = stream.read(&mut request).expect("read sequenced request");
            sender
                .send(String::from_utf8_lossy(&request[..read]).into_owned())
                .expect("capture sequenced request");
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write sequenced test response");
        }
    });
    (format!("http://{address}"), receiver)
}

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
            captured_at_ms: Some(test_now_ms()),
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
            ingestion: Some(ingestion_capabilities()),
        }),
    }
}

fn test_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time after epoch")
        .as_millis() as u64
}

fn rerank_candidate(chunk_id: &str, content: impl Into<String>) -> RagRerankCandidate {
    RagRerankCandidate {
        knowledge_base_id: "kb-a".to_string(),
        document_id: Some("doc-a".to_string()),
        document_name: Some("Policy.pdf".to_string()),
        chunk_id: chunk_id.to_string(),
        content: content.into(),
        score: 0.8,
        source: "vector".to_string(),
        metadata: BTreeMap::from([("page".to_string(), serde_json::json!(3))]),
    }
}

fn rerank_request(candidates: Vec<RagRerankCandidate>) -> RagRerankRequest {
    RagRerankRequest {
        service_id: Some("contract".to_string()),
        query: "annual leave".to_string(),
        candidates,
        top_n: Some(1),
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
fn gateway_sends_management_bearer_key_to_the_versioned_knowledge_base_path() {
    let (base_url, request) =
        spawn_http_server("200 OK", &[], r#"[{"id":"kb-a","name":"Company policy"}]"#);
    let gateway = test_gateway(base_url);

    let result = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect("list knowledge bases through HTTP gateway");

    assert_eq!(result[0].id, "kb-a");
    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured management request")
        .to_ascii_lowercase();
    assert!(request.starts_with("get /api/external/v1/knowledge-bases http/1.1\r\n"));
    assert!(request.contains("\r\nauthorization: bearer management-secret\r\n"));
}

#[test]
fn gateway_maps_client_side_request_timeouts_to_the_stable_timeout_code() {
    let base_url = spawn_hanging_http_server(Duration::from_millis(1_500));
    let gateway = test_gateway_with(base_url, |service| service.timeout_ms = 1_000);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("client timeout must fail");

    assert_eq!(error.code(), "RAG_REQUEST_TIMEOUT");
}

#[test]
fn gateway_sends_agent_bearer_key_and_normalized_search_payload() {
    let (base_url, request) = spawn_http_server("200 OK", &[], r#"{"results":[]}"#);
    let gateway = test_gateway(base_url);

    gateway
        .search(
            RagSearchRequest {
                service_id: Some("contract".to_string()),
                query: "  annual leave  ".to_string(),
                knowledge_base_ids: vec![" kb-a ".to_string(), "kb-a".to_string(), "".to_string()],
                top_k: Some(5),
                rerank: Some(false),
                top_n: Some(3),
            },
            RagAccessMode::Agent,
        )
        .expect("search through agent HTTP gateway");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured agent request");
    let lower = request.to_ascii_lowercase();
    assert!(lower.starts_with("post /api/external/v1/retrieval http/1.1\r\n"));
    assert!(lower.contains("\r\nauthorization: bearer agent-secret\r\n"));
    assert!(request.contains(r#""query":"annual leave""#));
    assert!(request.contains(r#""knowledgeBaseIds":["kb-a"]"#));
}

#[test]
fn rerank_posts_to_the_versioned_endpoint_with_management_credentials() {
    let (base_url, request) = spawn_http_server(
        "200 OK",
        &[],
        r#"{
            "requestId":"rerank-1",
            "results":[{
                "knowledgeBaseId":"kb-a",
                "documentId":"doc-a",
                "documentName":"Policy.pdf",
                "chunkId":"chunk-b",
                "content":"Carry-over policy",
                "score":0.97,
                "source":"reranker",
                "rankBefore":2,
                "rankAfter":1,
                "metadata":{"page":4,"reason":"semantic-match"}
            }]
        }"#,
    );
    let gateway = test_gateway_with(base_url, |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .limits
            .insert("maxTopN".to_string(), 2);
    });
    let mut first = rerank_candidate(" chunk-a ", "Annual leave policy");
    first.knowledge_base_id = " kb-a ".to_string();
    first.document_id = Some(" doc-a ".to_string());

    let response = gateway
        .rerank(RagRerankRequest {
            service_id: Some(" contract ".to_string()),
            query: "  annual leave  ".to_string(),
            candidates: vec![
                first,
                rerank_candidate("chunk-b", "Carry-over policy"),
                rerank_candidate("chunk-c", "Sick leave policy"),
            ],
            top_n: Some(99),
        })
        .expect("rerank through management HTTP gateway");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured rerank request");
    let lower = request.to_ascii_lowercase();
    assert!(lower.starts_with("post /api/external/v1/rerank http/1.1\r\n"));
    assert!(lower.contains("\r\nauthorization: bearer management-secret\r\n"));
    let body = request
        .split_once("\r\n\r\n")
        .expect("rerank request body")
        .1;
    let payload: serde_json::Value = serde_json::from_str(body).expect("rerank JSON payload");
    assert_eq!(payload["query"], "annual leave");
    assert_eq!(payload["topN"], 2);
    assert_eq!(payload["candidates"][0]["knowledgeBaseId"], "kb-a");
    assert_eq!(payload["candidates"][0]["documentId"], "doc-a");
    assert_eq!(payload["candidates"][0]["chunkId"], "chunk-a");
    assert!(payload.get("serviceId").is_none());
    assert!(!body.contains("rankBefore"));
    assert!(!body.contains("rankAfter"));

    assert_eq!(response.request_id.as_deref(), Some("rerank-1"));
    assert_eq!(response.results[0].source, "reranker");
    assert_eq!(response.results[0].rank_before, Some(2));
    assert_eq!(response.results[0].rank_after, Some(1));
    assert_eq!(
        response.results[0].metadata.get("reason"),
        Some(&serde_json::json!("semantic-match"))
    );
}

#[test]
fn rerank_sends_a_clamped_default_top_n_when_the_request_omits_it() {
    let (base_url, request) = spawn_http_server("200 OK", &[], r#"{"results":[]}"#);
    let gateway = test_gateway_with(base_url, |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .limits
            .insert("maxTopN".to_string(), 2);
    });
    let mut rerank = rerank_request(vec![
        rerank_candidate("chunk-a", "Annual leave policy"),
        rerank_candidate("chunk-b", "Carry-over policy"),
        rerank_candidate("chunk-c", "Sick leave policy"),
    ]);
    rerank.top_n = None;

    gateway
        .rerank(rerank)
        .expect("rerank with the default topN through the HTTP gateway");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured rerank request");
    let body = request
        .split_once("\r\n\r\n")
        .expect("rerank request body")
        .1;
    let payload: serde_json::Value = serde_json::from_str(body).expect("rerank JSON payload");
    assert_eq!(payload["topN"], 2);
}

#[test]
fn rerank_requires_a_capabilities_snapshot_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured.capabilities_snapshot = None;
    });

    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate("chunk-a", "content")]))
        .expect_err("missing capabilities must fail locally");

    assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
}

#[test]
fn rerank_rejects_an_incompatible_protocol_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .protocol_version = "2.0".to_string();
    });

    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate("chunk-a", "content")]))
        .expect_err("incompatible capabilities protocol must fail locally");

    assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
}

#[test]
fn rerank_requires_an_explicit_feature_declaration_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .features
            .remove("rerank");
    });

    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate("chunk-a", "content")]))
        .expect_err("missing rerank feature declaration must fail locally");

    assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
}

#[test]
fn rerank_rejects_disabled_capability_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .features
            .insert("rerank".to_string(), false);
    });

    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate(
            "chunk-a",
            "Annual leave policy",
        )]))
        .expect_err("disabled rerank capability must fail locally");

    assert_eq!(error.code(), "RAG_FEATURE_UNAVAILABLE");
}

#[test]
fn rerank_honors_a_smaller_remote_query_length_limit_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .limits
            .insert("maxQueryLength".to_string(), 5);
    });
    let mut request = rerank_request(vec![rerank_candidate("chunk-a", "content")]);
    request.query = "123456".to_string();

    let error = gateway
        .rerank(request)
        .expect_err("remote query length limit must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_counts_query_length_as_utf16_code_units() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .limits
            .insert("maxQueryLength".to_string(), 5);
    });
    let mut request = rerank_request(vec![rerank_candidate("chunk-a", "content")]);
    request.query = "😀😀😀".to_string();

    let error = gateway
        .rerank(request)
        .expect_err("six UTF-16 query code units must exceed a limit of five");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_rejects_duplicate_chunk_ids_after_normalization() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let error = gateway
        .rerank(rerank_request(vec![
            rerank_candidate("chunk-a", "Annual leave policy"),
            rerank_candidate(" chunk-a ", "Carry-over policy"),
        ]))
        .expect_err("duplicate normalized chunk IDs must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_accepts_the_content_limit_and_rejects_one_character_more() {
    let (base_url, request) = spawn_http_server("200 OK", &[], r#"{"results":[]}"#);
    let gateway = test_gateway(base_url);
    gateway
        .rerank(rerank_request(vec![rerank_candidate(
            "chunk-limit",
            "a".repeat(200_000),
        )]))
        .expect("exactly 200000 candidate characters are allowed");
    request
        .recv_timeout(Duration::from_secs(2))
        .expect("content-limit request reached the server");

    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate(
            "chunk-too-large",
            "a".repeat(200_001),
        )]))
        .expect_err("candidate content above 200000 characters must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_TOO_LARGE");
}

#[test]
fn rerank_counts_candidate_content_as_utf16_code_units() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let error = gateway
        .rerank(rerank_request(vec![rerank_candidate(
            "chunk-emoji",
            "😀".repeat(100_001),
        )]))
        .expect_err("200002 UTF-16 content code units must exceed the local limit");

    assert_eq!(error.code(), "RAG_REQUEST_TOO_LARGE");
}

#[test]
fn rerank_rejects_non_finite_scores_before_network_io() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let mut candidate = rerank_candidate("chunk-a", "Annual leave policy");
    candidate.score = f64::NAN;

    let error = gateway
        .rerank(rerank_request(vec![candidate]))
        .expect_err("non-finite scores must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_rejects_scores_that_overflow_java_float_before_network_io() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let mut candidate = rerank_candidate("chunk-a", "Annual leave policy");
    candidate.score = f64::from(f32::MAX) * 2.0;
    assert!(candidate.score.is_finite());
    assert!(!(candidate.score as f32).is_finite());

    let error = gateway
        .rerank(rerank_request(vec![candidate]))
        .expect_err("scores that overflow Java Float must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_rejects_explicit_zero_top_n_before_network_io() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let mut request = rerank_request(vec![rerank_candidate("chunk-a", "Annual leave policy")]);
    request.top_n = Some(0);

    let error = gateway
        .rerank(request)
        .expect_err("explicit topN zero must fail locally");

    assert_eq!(error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn rerank_rejects_invalid_query_and_candidate_shapes_before_network_io() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());

    let mut blank_query = rerank_request(vec![rerank_candidate("chunk-a", "content")]);
    blank_query.query = "  ".to_string();
    assert_eq!(
        gateway
            .rerank(blank_query)
            .expect_err("blank query must fail")
            .code(),
        "RAG_REQUEST_INVALID"
    );

    let mut long_query = rerank_request(vec![rerank_candidate("chunk-a", "content")]);
    long_query.query = "q".repeat(4_001);
    assert_eq!(
        gateway
            .rerank(long_query)
            .expect_err("query above 4000 characters must fail")
            .code(),
        "RAG_REQUEST_INVALID"
    );

    assert_eq!(
        gateway
            .rerank(rerank_request(Vec::new()))
            .expect_err("empty candidates must fail")
            .code(),
        "RAG_REQUEST_INVALID"
    );

    let candidates = (0..101)
        .map(|index| rerank_candidate(&format!("chunk-{index}"), "content"))
        .collect();
    assert_eq!(
        gateway
            .rerank(rerank_request(candidates))
            .expect_err("more than 100 candidates must fail")
            .code(),
        "RAG_REQUEST_INVALID"
    );

    for (label, candidate) in [
        ("knowledgeBaseId", {
            let mut candidate = rerank_candidate("chunk-a", "content");
            candidate.knowledge_base_id = "  ".to_string();
            candidate
        }),
        ("chunkId", rerank_candidate("  ", "content")),
        ("content", rerank_candidate("chunk-a", "  ")),
        ("source", {
            let mut candidate = rerank_candidate("chunk-a", "content");
            candidate.source = "  ".to_string();
            candidate
        }),
    ] {
        assert_eq!(
            gateway
                .rerank(rerank_request(vec![candidate]))
                .expect_err(&format!("blank {label} must fail"))
                .code(),
            "RAG_REQUEST_INVALID"
        );
    }
}

#[test]
fn gateway_does_not_follow_http_redirects() {
    let (base_url, _) = spawn_http_server(
        "302 Found",
        &[("Location", "/api/external/v1/redirected".to_string())],
        "",
    );
    let gateway = test_gateway(base_url);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("RAG gateway must surface redirects instead of following them");

    assert_eq!(error.code(), "RAG_REMOTE_ERROR");
}

#[test]
fn gateway_rejects_an_oversized_response_from_content_length_before_reading_it() {
    let (base_url, _) = spawn_http_server(
        "200 OK",
        &[("Content-Length", (8 * 1024 * 1024 + 1).to_string())],
        "",
    );
    let gateway = test_gateway(base_url);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("oversized RAG response must fail closed");

    assert_eq!(error.code(), "RAG_RESPONSE_INVALID");
}

#[test]
fn gateway_preserves_stable_remote_error_codes() {
    let (base_url, _) = spawn_http_server(
        "403 Forbidden",
        &[],
        r#"{"code":"RAG_KB_FORBIDDEN","message":"forbidden"}"#,
    );
    let gateway = test_gateway(base_url);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("remote RAG error should be mapped");

    assert_eq!(error.code(), "RAG_KB_FORBIDDEN");
    assert_eq!(error.to_string(), "forbidden");
}

#[test]
fn rust_remote_text_sanitizer_removes_controls_bidi_and_credentials_with_a_hard_limit() {
    let sanitized = sanitize_remote_text(
        "policy\u{1b}[31m\u{0085}\u{202e} Authorization: Bearer management-secret token=abc123456",
        80,
    );

    assert!(sanitized.chars().count() <= 80);
    assert!(!sanitized.contains('\u{1b}'));
    assert!(!sanitized.contains('\u{0085}'));
    assert!(!sanitized.contains('\u{202e}'));
    assert!(!sanitized.contains("management-secret"));
    assert!(!sanitized.contains("abc123456"));
    assert!(sanitized.contains(REDACTION_MARKER));
}

#[test]
fn rust_remote_text_sanitizer_uses_an_ascii_truncation_marker() {
    let sanitized = sanitize_remote_text(&"x".repeat(100), 20);

    assert!(sanitized.ends_with("...[TRUNCATED]"));
    assert_eq!(sanitized.chars().count(), 20);
}

#[test]
fn gateway_sanitizes_and_bounds_remote_knowledge_base_fields_without_dropping_counts() {
    let remote = (0..105)
        .map(|index| {
            serde_json::json!({
                "id": format!("kb-{index}\u{202e}"),
                "name": format!("Policy {index} Authorization: Bearer management-secret"),
                "documentCount": index
            })
        })
        .collect::<Vec<_>>();
    let body = serde_json::to_string(&remote).expect("serialize remote knowledge bases");
    let (base_url, _) = spawn_http_server("200 OK", &[], &body);
    let gateway = test_gateway(base_url);

    let result = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect("list sanitized knowledge bases");

    assert_eq!(result.len(), 100);
    assert_eq!(result[42].document_count, Some(42));
    assert!(!result[0].id.contains('\u{202e}'));
    assert!(!result[0].name.contains("management-secret"));
    assert!(result[0].name.contains(REDACTION_MARKER));
}

#[test]
fn gateway_sanitizes_search_hits_metadata_warnings_and_total_text_budget() {
    let oversized_content = format!(
        "{} Authorization: Bearer management-secret",
        "x".repeat(10_000)
    );
    let hits = (0..60)
        .map(|index| {
            serde_json::json!({
                "knowledgeBaseId": format!("kb-{index}"),
                "documentName": format!("Policy\u{202e} {index}"),
                "chunkId": format!("chunk-{index}"),
                "content": oversized_content,
                "score": 0.9,
                "source": "Authorization: Bearer source-secret",
                "metadata": {
                    "apiTo\u{200b}ken": "metadata-secret",
                    "page\u{001b}[31m": "value\u{0085}"
                }
            })
        })
        .collect::<Vec<_>>();
    let body = serde_json::to_string(&serde_json::json!({
        "results": hits,
        "warnings": ["token=warning-secret\u{202e}"],
    }))
    .expect("serialize remote search response");
    let (base_url, _) = spawn_http_server("200 OK", &[], &body);
    let gateway = test_gateway(base_url);

    let response = gateway
        .search(
            RagSearchRequest {
                service_id: Some("contract".to_string()),
                query: "policy".to_string(),
                knowledge_base_ids: vec!["kb-a".to_string()],
                top_k: Some(10),
                rerank: Some(false),
                top_n: Some(5),
            },
            RagAccessMode::Management,
        )
        .expect("search sanitized remote response");

    assert!(response.results.len() <= 50);
    assert!(!response.results[0]
        .document_name
        .as_deref()
        .unwrap()
        .contains('\u{202e}'));
    assert!(!response.results[0].content.contains("management-secret"));
    assert!(!response.results[0].source.contains("source-secret"));
    assert_eq!(
        response.results[0].metadata.get("apiToken"),
        Some(&serde_json::Value::String(REDACTION_MARKER.to_string()))
    );
    assert!(!response.warnings[0].contains("warning-secret"));
    let total_text = response
        .results
        .iter()
        .map(|hit| {
            hit.knowledge_base_id.chars().count()
                + hit
                    .document_name
                    .as_deref()
                    .unwrap_or_default()
                    .chars()
                    .count()
                + hit.chunk_id.chars().count()
                + hit.content.chars().count()
                + hit.source.chars().count()
                + hit
                    .metadata
                    .iter()
                    .map(|(key, value)| key.chars().count() + value.to_string().chars().count())
                    .sum::<usize>()
        })
        .sum::<usize>()
        + response
            .warnings
            .iter()
            .map(|warning| warning.chars().count())
            .sum::<usize>();
    assert!(total_text <= MAX_REMOTE_RESPONSE_TEXT_CHARS);
}

#[test]
fn remote_errors_never_echo_request_bearer_tokens() {
    let (base_url, _) = spawn_http_server(
        "403 Forbidden",
        &[],
        r#"{"code":"RAG_AUTH_FAILED\u001b[31m","message":"Authorization: Bearer management-secret token=remote-secret\u202e"}"#,
    );
    let gateway = test_gateway(base_url);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("remote auth error should be sanitized");

    assert!(!error.to_string().contains("management-secret"));
    assert!(!error.to_string().contains("remote-secret"));
    assert!(!error.to_string().contains('\u{1b}'));
    assert!(!error.to_string().contains('\u{202e}'));
    assert!(error.to_string().contains(REDACTION_MARKER));
}

#[test]
fn upload_rejects_disabled_capability_before_reading_or_sending_the_file() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .features
            .insert("fileUpload".to_string(), false);
    });

    let error = gateway
        .upload_document(
            Some("contract"),
            "kb-a",
            "missing-file.md",
            &chunk_ingestion_request(),
        )
        .expect_err("disabled upload capability must fail before file access");

    assert_eq!(error.code(), "RAG_FEATURE_UNAVAILABLE");
}

#[test]
fn upload_rejects_files_larger_than_the_capability_limit_before_network_io() {
    let temp = tempfile::Builder::new()
        .suffix(".md")
        .tempfile()
        .expect("create upload fixture");
    std::fs::write(temp.path(), b"12345").expect("write upload fixture");
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        let capabilities = configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities");
        capabilities.features.insert("fileUpload".to_string(), true);
        capabilities.limits.insert("maxUploadBytes".to_string(), 4);
    });

    let error = gateway
        .upload_document(
            Some("contract"),
            "kb-a",
            temp.path().to_string_lossy().as_ref(),
            &chunk_ingestion_request(),
        )
        .expect_err("oversized upload must fail locally");

    assert_eq!(error.code(), "RAG_UPLOAD_TOO_LARGE");
}

#[test]
fn upload_sends_a_unique_idempotency_key() {
    let (base_url, request) = spawn_http_server(
        "202 Accepted",
        &[],
        r#"{"documentId":"doc-1","jobId":"job-1","status":"PENDING"}"#,
    );
    let gateway = test_gateway_with(base_url, |configured| {
        let capabilities = configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities");
        capabilities.features.insert("fileUpload".to_string(), true);
        capabilities
            .limits
            .insert("maxUploadBytes".to_string(), 1024);
    });
    let temp = tempfile::Builder::new()
        .suffix(".md")
        .tempfile()
        .expect("create upload fixture");
    std::fs::write(temp.path(), b"policy").expect("write upload fixture");

    gateway
        .upload_document(
            Some("contract"),
            "kb-a",
            temp.path().to_string_lossy().as_ref(),
            &chunk_ingestion_request(),
        )
        .expect("upload through HTTP gateway");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured upload request")
        .to_ascii_lowercase();
    assert!(request
        .starts_with("post /api/external/v1/knowledge-bases/kb-a/documents/upload http/1.1\r\n"));
    let idempotency_key = request
        .lines()
        .find_map(|line| line.strip_prefix("idempotency-key: "))
        .expect("idempotency-key header");
    assert!(!idempotency_key.trim().is_empty());
    assert!(request.contains("name=\"processmode\""));
    assert!(request.contains("\r\n\r\nchunk\r\n"));
    assert!(request.contains("name=\"chunkstrategy\""));
    assert!(request.contains("\r\n\r\nfixed_size\r\n"));
    assert!(request.contains("name=\"chunkconfig\""));
    assert!(request.contains("\"chunksize\":512"));
}

#[test]
fn ingestion_capabilities_remain_optional_for_old_persisted_snapshots() {
    let old_snapshot: RagCapabilities = serde_json::from_value(serde_json::json!({
        "protocolVersion": "1.0",
        "features": { "fileUpload": true },
        "limits": { "maxUploadBytes": 1024 }
    }))
    .expect("deserialize old capabilities snapshot");

    assert_eq!(old_snapshot.ingestion, None);
}

#[test]
fn ingestion_requires_the_optional_contract_before_file_or_network_access() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .ingestion = None;
    });

    let error = gateway
        .upload_document(
            Some("contract"),
            "kb-a",
            "missing-file.md",
            &chunk_ingestion_request(),
        )
        .expect_err("missing ingestion contract must fail closed");

    assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
}

#[test]
fn ingestion_rejects_unknown_process_modes_and_schema_values_before_network_io() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    let mut future_mode = chunk_ingestion_request();
    future_mode.process_mode = "future_mode".to_string();
    let mode_error = gateway
        .import_document_url(
            Some("contract"),
            "kb-a",
            "https://example.com/policy.md",
            &future_mode,
        )
        .expect_err("unknown process modes must fail closed");
    assert_eq!(mode_error.code(), "RAG_PROTOCOL_MISMATCH");

    let mut invalid_config = chunk_ingestion_request();
    invalid_config.chunk_config = Some(serde_json::json!({
        "chunkSize": 0,
        "overlapSize": 64
    }));
    let schema_error = gateway
        .import_document_url(
            Some("contract"),
            "kb-a",
            "https://example.com/policy.md",
            &invalid_config,
        )
        .expect_err("chunk config must follow the capability schema");
    assert_eq!(schema_error.code(), "RAG_REQUEST_INVALID");
}

#[test]
fn picked_document_metadata_and_upload_validation_use_capability_extension_and_mime_lists() {
    let gateway = test_gateway("http://127.0.0.1:9".to_string());
    assert_eq!(
        gateway
            .document_picker_extensions(Some("contract"))
            .expect("resolve capability picker filters"),
        vec![".md", ".pdf"]
    );

    let markdown = tempfile::Builder::new()
        .suffix(".md")
        .tempfile()
        .expect("create markdown fixture");
    std::fs::write(markdown.path(), b"# policy").expect("write markdown fixture");
    let picked: RagPickedDocumentFile = gateway
        .inspect_document_file(Some("contract"), markdown.path().to_string_lossy().as_ref())
        .expect("inspect allowed markdown file");
    assert_eq!(picked.size, 8);
    assert_eq!(picked.extension, ".md");
    assert_eq!(picked.mime_type, "text/markdown");

    let executable = tempfile::Builder::new()
        .suffix(".exe")
        .tempfile()
        .expect("create executable fixture");
    std::fs::write(executable.path(), b"MZ").expect("write executable fixture");
    let error = gateway
        .upload_document(
            Some("contract"),
            "kb-a",
            executable.path().to_string_lossy().as_ref(),
            &chunk_ingestion_request(),
        )
        .expect_err("extension and MIME must be checked again at upload time");
    assert_eq!(error.code(), "RAG_FILE_TYPE_UNSUPPORTED");
}

#[test]
fn url_import_serializes_the_explicit_capability_validated_ingestion_request() {
    let (base_url, request) = spawn_http_server(
        "202 Accepted",
        &[],
        r#"{"documentId":"doc-1","jobId":"job-1","status":"PENDING"}"#,
    );
    let gateway = test_gateway(base_url);
    let ingestion = RagIngestionRequest {
        process_mode: "pipeline".to_string(),
        chunk_strategy: None,
        chunk_config: None,
        pipeline_id: Some("clean".to_string()),
    };

    gateway
        .import_document_url(
            Some("contract"),
            "kb-a",
            "https://example.com/policy.md",
            &ingestion,
        )
        .expect("import URL with explicit pipeline selection");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured URL import request");
    let body = request.split_once("\r\n\r\n").expect("URL import body").1;
    let payload: serde_json::Value = serde_json::from_str(body).expect("URL import JSON payload");
    assert_eq!(payload["processMode"], "pipeline");
    assert_eq!(payload["pipelineId"], "clean");
    assert_eq!(payload.get("chunkStrategy"), None);
    assert_eq!(payload.get("chunkConfig"), None);
}

#[test]
fn failed_connection_test_invalidates_the_old_capability_snapshot_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured.agent_credential_configured = false;
    });

    gateway
        .test_service("contract")
        .expect_err("unreachable service should fail connection test");

    let stored = gateway
        .stored_service_for_test("contract")
        .expect("read stored service")
        .expect("stored service exists");
    assert_eq!(stored.capabilities_snapshot, None);
}

#[test]
fn connection_test_checks_anonymous_health_before_both_credential_capabilities() {
    let management_capabilities = r#"{
        "protocolVersion":"1.0",
        "credentialAudience":"management",
        "features":{"rerank":true},
        "limits":{"maxTopK":50,"maxTopN":20,"maxQueryLength":4000}
    }"#;
    let agent_capabilities = r#"{
        "protocolVersion":"1.0",
        "credentialAudience":"agent",
        "features":{"rerank":true},
        "limits":{"maxTopK":50,"maxTopN":20,"maxQueryLength":4000}
    }"#;
    let (base_url, requests) = spawn_http_response_sequence(vec![
        ("200 OK", r#"{"status":"ok"}"#),
        ("200 OK", management_capabilities),
        ("200 OK", agent_capabilities),
    ]);
    let gateway = test_gateway(base_url);

    gateway
        .test_service("contract")
        .expect("health and both credential capability checks must succeed");

    let health = requests
        .recv_timeout(Duration::from_secs(2))
        .expect("captured health request")
        .to_ascii_lowercase();
    let management = requests
        .recv_timeout(Duration::from_secs(2))
        .expect("captured management capabilities request")
        .to_ascii_lowercase();
    let agent = requests
        .recv_timeout(Duration::from_secs(2))
        .expect("captured agent capabilities request")
        .to_ascii_lowercase();

    assert!(health.starts_with("get /api/external/v1/health http/1.1\r\n"));
    assert!(!health.contains("authorization:"));
    assert!(management.starts_with("get /api/external/v1/capabilities http/1.1\r\n"));
    assert!(management.contains("authorization: bearer management-secret"));
    assert!(agent.starts_with("get /api/external/v1/capabilities http/1.1\r\n"));
    assert!(agent.contains("authorization: bearer agent-secret"));
}

#[test]
fn retry_ingestion_job_sends_a_uuid_idempotency_key() {
    let (base_url, request) = spawn_http_server(
        "200 OK",
        &[],
        r#"{"jobId":"job-2","documentId":"doc-1","status":"PENDING","stage":null,"progress":0,"retryable":false,"error":null}"#,
    );
    let gateway = test_gateway(base_url);

    gateway
        .retry_ingestion_job(Some("contract"), "job-1")
        .expect("retry ingestion job through HTTP gateway");

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured retry request")
        .to_ascii_lowercase();
    assert!(request.starts_with("post /api/external/v1/ingestion-jobs/job-1/retry http/1.1\r\n"));
    let idempotency_key = request
        .lines()
        .find_map(|line| line.strip_prefix("idempotency-key: "))
        .expect("idempotency-key header");
    let parsed = uuid::Uuid::parse_str(idempotency_key.trim()).expect("UUID idempotency key");
    assert_eq!(parsed.get_version(), Some(uuid::Version::Random));
}

#[test]
fn list_ingestion_jobs_restores_document_history_and_retry_lineage() {
    let (base_url, request) = spawn_http_server(
        "200 OK",
        &[],
        r#"{
            "items":[{
                "jobId":"job-2",
                "documentId":"doc-1",
                "operation":"RETRY",
                "rootJobId":"job-1",
                "parentJobId":"job-1",
                "attemptNo":2,
                "status":"FAILED",
                "stage":"EMBEDDING",
                "progress":65,
                "retryable":true,
                "error":{"code":"RAG_INDEX_FAILED","message":"index failed"},
                "startedAt":"2026-08-11T06:00:00Z",
                "completedAt":"2026-08-11T06:01:00Z",
                "createdAt":"2026-08-11T05:59:00Z"
            }],
            "page":1,
            "pageSize":20,
            "total":1
        }"#,
    );
    let gateway = test_gateway(base_url);

    let history = gateway
        .list_ingestion_jobs(Some("contract"), "doc-1", 1, 20)
        .expect("load persisted document ingestion history");

    assert_eq!(history.total, 1);
    assert_eq!(history.items[0].operation.as_deref(), Some("RETRY"));
    assert_eq!(history.items[0].root_job_id.as_deref(), Some("job-1"));
    assert_eq!(history.items[0].parent_job_id.as_deref(), Some("job-1"));
    assert_eq!(history.items[0].attempt_no, Some(2));
    assert_eq!(
        history.items[0].completed_at.as_deref(),
        Some("2026-08-11T06:01:00Z")
    );

    let request = request
        .recv_timeout(Duration::from_secs(2))
        .expect("captured ingestion history request")
        .to_ascii_lowercase();
    assert!(request.starts_with(
        "get /api/external/v1/documents/doc-1/ingestion-jobs?current=1&size=20 http/1.1\r\n"
    ));
}

#[test]
fn url_import_rejects_disabled_capability_before_network_io() {
    let gateway = test_gateway_with("http://127.0.0.1:9".to_string(), |configured| {
        configured
            .capabilities_snapshot
            .as_mut()
            .expect("capabilities")
            .features
            .insert("urlImport".to_string(), false);
    });

    let error = gateway
        .import_document_url(
            Some("contract"),
            "kb-a",
            "https://example.com/policy.md",
            &chunk_ingestion_request(),
        )
        .expect_err("disabled URL import capability must fail locally");

    assert_eq!(error.code(), "RAG_FEATURE_UNAVAILABLE");
}

#[test]
fn saving_any_service_configuration_invalidates_capabilities_snapshot() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials =
        FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));

    let saved = save_service_with_dependencies(
        &services,
        &credentials,
        RagSaveServiceRequest { service: current },
    )
    .expect("save an existing service configuration");

    assert_eq!(saved.capabilities_snapshot, None);
    assert_eq!(
        services
            .stored_service()
            .expect("saved service remains available")
            .capabilities_snapshot,
        None
    );
}

#[test]
fn remote_protocol_error_invalidates_the_persisted_capability_snapshot() {
    let (base_url, _request) = spawn_http_server(
        "409 Conflict",
        &[],
        r#"{"code":"RAG_PROTOCOL_MISMATCH","message":"unsupported protocol"}"#,
    );
    let gateway = test_gateway(base_url);

    let error = gateway
        .list_knowledge_bases(Some("contract"), RagAccessMode::Management)
        .expect_err("remote protocol mismatch must fail the request");

    assert_eq!(error.code(), "RAG_PROTOCOL_MISMATCH");
    let stored = gateway
        .stored_service_for_test("contract")
        .expect("read stored service")
        .expect("stored service exists");
    assert_eq!(stored.capabilities_snapshot, None);
}

#[test]
fn service_save_derives_credential_flags_instead_of_trusting_the_frontend() {
    let services = FakeServiceRepository::without_service();
    let credentials = FakeCredentialRepository::new(None, None);
    let forged = save_service_with_dependencies(
        &services,
        &credentials,
        RagSaveServiceRequest {
            service: service("new", true),
        },
    )
    .expect("save new service with forged configured flags");
    assert!(!forged.management_credential_configured);
    assert!(!forged.agent_credential_configured);

    let current = service("company", true);
    let mut retained = current.clone();
    retained.management_credential_configured = false;
    retained.agent_credential_configured = false;
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));
    let retained = save_service_with_dependencies(
        &services,
        &credentials,
        RagSaveServiceRequest { service: retained },
    )
    .expect("preserve stored configured flags");
    assert!(retained.management_credential_configured);
    assert!(retained.agent_credential_configured);
}

#[test]
fn service_save_ipc_rejects_api_key_fields() {
    let payload = serde_json::json!({
        "service": service("company", true),
        "managementApiKey": "must-never-enter-ipc",
        "agentApiKey": "must-never-enter-ipc"
    });

    let error = serde_json::from_value::<RagSaveServiceRequest>(payload)
        .expect_err("secret-bearing save payload must be rejected");

    let message = error.to_string();
    assert!(message.contains("unknown field"));
    assert!(message.contains("expected `service`"));
}

#[test]
fn native_credential_prompt_writes_keyring_and_returns_only_configured_state() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current);
    let credentials = FakeCredentialRepository::new(None, Some("old-agent"));
    let prompt = FakeCredentialPrompt::returning(Some("  native-management-secret  "));

    let saved = prompt_service_credential_with_dependencies(
        &services,
        &credentials,
        &prompt,
        "company",
        RagCredentialKind::Management,
    )
    .expect("store prompted management credential")
    .expect("prompt accepted");

    assert!(saved.management_credential_configured);
    assert!(saved.agent_credential_configured);
    assert_eq!(saved.capabilities_snapshot, None);
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("native-management-secret")
    );
    let serialized = serde_json::to_string(&saved).expect("serialize safe service response");
    assert!(!serialized.contains("native-management-secret"));
}

#[test]
fn cancelling_native_credential_prompt_leaves_keyring_and_service_unchanged() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));
    let prompt = FakeCredentialPrompt::returning(None);

    let result = prompt_service_credential_with_dependencies(
        &services,
        &credentials,
        &prompt,
        "company",
        RagCredentialKind::Management,
    )
    .expect("cancel prompt without mutation");

    assert_eq!(result, None);
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
}

#[test]
fn clear_credential_command_removes_only_the_selected_key() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));

    let saved = clear_service_credential_with_dependencies(
        &services,
        &credentials,
        "company",
        RagCredentialKind::Management,
    )
    .expect("clear management credential");

    assert!(!saved.management_credential_configured);
    assert!(saved.agent_credential_configured);
    assert_eq!(credentials.value(RagCredentialKind::Management), None);
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(saved.capabilities_snapshot, None);
}

#[test]
fn native_credential_prompt_does_not_change_service_when_keyring_write_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::failing(
        Some("old-management"),
        Some("old-agent"),
        "set:management",
    );
    let prompt = FakeCredentialPrompt::returning(Some("new-management"));

    let error = prompt_service_credential_with_dependencies(
        &services,
        &credentials,
        &prompt,
        "company",
        RagCredentialKind::Management,
    )
    .expect_err("keyring write failure must be explicit");

    assert_eq!(error.code(), "RAG_CREDENTIAL_STORE_UNAVAILABLE");
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(
        services
            .get("company")
            .expect("read fake service")
            .expect("existing fake service"),
        current
    );
}

#[test]
fn native_credential_prompt_rolls_back_keyring_when_sqlite_persistence_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::failing(current.clone());
    let credentials = FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));
    let prompt = FakeCredentialPrompt::returning(Some("new-management"));

    let error = prompt_service_credential_with_dependencies(
        &services,
        &credentials,
        &prompt,
        "company",
        RagCredentialKind::Management,
    )
    .expect_err("credential update must roll back after store failure");

    assert_eq!(error.code(), "RAG_STORE_ERROR");
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
}

#[test]
fn service_delete_removes_both_credentials_before_deleting_the_service() {
    let current = service("company", true);
    let operations = Arc::new(Mutex::new(Vec::new()));
    let services = FakeServiceRepository::new(current).with_operations(Arc::clone(&operations));
    let credentials =
        FakeCredentialRepository::new(Some("management-secret"), Some("agent-secret"))
            .with_operations(Arc::clone(&operations));

    let deleted = delete_service_with_dependencies(&services, &credentials, "company")
        .expect("delete service and credentials");

    assert!(deleted);
    assert_eq!(services.stored_service(), None);
    assert_eq!(credentials.value(RagCredentialKind::Management), None);
    assert_eq!(credentials.value(RagCredentialKind::Agent), None);
    assert_eq!(
        operations
            .lock()
            .expect("lock shared mutation operations")
            .join(","),
        "get:management,get:agent,delete:management,delete:agent,delete:service"
    );
}

#[test]
fn service_delete_restores_both_snapshots_when_the_first_delete_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::failing(
        Some("old-management"),
        Some("old-agent"),
        "delete:management",
    );

    let error = delete_service_with_dependencies(&services, &credentials, "company")
        .expect_err("first credential deletion failure must restore both snapshots");

    assert_eq!(error.code(), "RAG_CREDENTIAL_STORE_UNAVAILABLE");
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent,delete:management,set:agent,set:management"
    );
}

#[test]
fn service_delete_restores_the_first_key_when_the_second_delete_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::failing(
        Some("old-management"),
        Some("old-agent"),
        "delete:agent",
    );

    let error = delete_service_with_dependencies(&services, &credentials, "company")
        .expect_err("partial credential deletion must be rolled back");

    assert_eq!(error.code(), "RAG_CREDENTIAL_STORE_UNAVAILABLE");
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent,delete:management,delete:agent,set:agent,set:management"
    );
}

#[test]
fn service_delete_restores_both_keys_when_sqlite_delete_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::failing_delete(current.clone());
    let credentials = FakeCredentialRepository::new(Some("old-management"), Some("old-agent"));

    let error = delete_service_with_dependencies(&services, &credentials, "company")
        .expect_err("credential deletion must roll back after store failure");

    assert_eq!(error.code(), "RAG_STORE_ERROR");
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent,delete:management,delete:agent,set:agent,set:management"
    );
}

#[test]
fn service_delete_reports_stable_codes_when_credential_rollback_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials = FakeCredentialRepository::failing_operations(
        Some("old-management-secret"),
        Some("old-agent-secret"),
        &["delete:agent", "set:agent"],
    );

    let error = delete_service_with_dependencies(&services, &credentials, "company")
        .expect_err("rollback failure must replace the original error");

    assert_eq!(error.code(), "RAG_CREDENTIAL_ROLLBACK_FAILED");
    assert_eq!(
        error.to_string(),
        "RAG_CREDENTIAL_STORE_UNAVAILABLE -> RAG_CREDENTIAL_STORE_UNAVAILABLE"
    );
    assert!(!error.to_string().contains("old-management-secret"));
    assert!(!error.to_string().contains("old-agent-secret"));
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management-secret")
    );
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent,delete:management,delete:agent,set:agent,set:management"
    );
}

#[test]
fn service_delete_does_not_mutate_state_when_credential_snapshot_fails() {
    let current = service("company", true);
    let services = FakeServiceRepository::new(current.clone());
    let credentials =
        FakeCredentialRepository::failing(Some("old-management"), Some("old-agent"), "get:agent");

    let error = delete_service_with_dependencies(&services, &credentials, "company")
        .expect_err("all credential snapshots must succeed before deletion");

    assert_eq!(error.code(), "RAG_CREDENTIAL_STORE_UNAVAILABLE");
    assert_eq!(services.stored_service(), Some(current));
    assert_eq!(
        credentials.value(RagCredentialKind::Management).as_deref(),
        Some("old-management")
    );
    assert_eq!(
        credentials.value(RagCredentialKind::Agent).as_deref(),
        Some("old-agent")
    );
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent"
    );
}

#[test]
fn service_delete_cleans_orphan_credentials_when_the_service_row_is_missing() {
    let services = FakeServiceRepository::without_service();
    let credentials =
        FakeCredentialRepository::new(Some("orphan-management"), Some("orphan-agent"));

    let deleted = delete_service_with_dependencies(&services, &credentials, "orphan")
        .expect("clean orphan credentials");

    assert!(!deleted);
    assert_eq!(services.stored_service(), None);
    assert_eq!(credentials.value(RagCredentialKind::Management), None);
    assert_eq!(credentials.value(RagCredentialKind::Agent), None);
    assert_eq!(
        credentials.operations().join(","),
        "get:management,get:agent,delete:management,delete:agent"
    );
}

#[test]
fn service_save_and_delete_mutations_are_serialized() {
    let probe = Arc::new(MutationProbe::default());
    let services = Arc::new(
        FakeServiceRepository::new(service("company", true)).with_probe(Arc::clone(&probe)),
    );
    let credentials = Arc::new(
        FakeCredentialRepository::new(Some("old-management"), Some("old-agent"))
            .with_probe(Arc::clone(&probe)),
    );
    let start = Arc::new(Barrier::new(3));

    let delete_services = Arc::clone(&services);
    let delete_credentials = Arc::clone(&credentials);
    let delete_start = Arc::clone(&start);
    let delete = thread::spawn(move || {
        delete_start.wait();
        delete_service_with_dependencies(
            delete_services.as_ref(),
            delete_credentials.as_ref(),
            "company",
        )
    });

    let save_services = Arc::clone(&services);
    let save_credentials = Arc::clone(&credentials);
    let save_start = Arc::clone(&start);
    let save = thread::spawn(move || {
        save_start.wait();
        save_service_with_dependencies(
            save_services.as_ref(),
            save_credentials.as_ref(),
            RagSaveServiceRequest {
                service: service("company", true),
            },
        )
    });

    start.wait();
    delete
        .join()
        .expect("join delete mutation")
        .expect("delete mutation");
    save.join()
        .expect("join save mutation")
        .expect("save mutation");

    assert_eq!(probe.max_active(), 1);
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
fn credential_keyring_namespace_and_account_names_are_stable() {
    assert_eq!(KEYRING_SERVICE, "ai.agent.rag");
    assert_eq!(
        credential_account("company", RagCredentialKind::Management),
        "company:management"
    );
    assert_eq!(
        credential_account("company", RagCredentialKind::Agent),
        "company:agent"
    );
}

#[test]
fn search_policy_uses_remote_limits_without_exceeding_local_safety_caps() {
    let capabilities = RagCapabilities {
        protocol_version: "1.0".to_string(),
        captured_at_ms: Some(test_now_ms()),
        credential_audience: None,
        features: BTreeMap::from([("rerank".to_string(), false)]),
        limits: BTreeMap::from([
            ("maxTopK".to_string(), 8),
            ("maxTopN".to_string(), 3),
            ("maxQueryLength".to_string(), 120),
        ]),
        ingestion: None,
    };
    let policy = resolve_search_policy(Some(&capabilities)).expect("resolve search policy");

    assert_eq!(policy.max_top_k, 8);
    assert_eq!(policy.max_top_n, 3);
    assert_eq!(policy.max_query_length, 120);
    assert!(!policy.rerank_supported);

    let oversized = RagCapabilities {
        protocol_version: "1.0".to_string(),
        captured_at_ms: Some(test_now_ms()),
        credential_audience: None,
        features: BTreeMap::from([("rerank".to_string(), true)]),
        limits: BTreeMap::from([
            ("maxTopK".to_string(), 500),
            ("maxTopN".to_string(), 200),
            ("maxQueryLength".to_string(), 40_000),
        ]),
        ingestion: None,
    };
    let capped = resolve_search_policy(Some(&oversized)).expect("resolve capped search policy");
    assert_eq!(capped.max_top_k, 50);
    assert_eq!(capped.max_top_n, 20);
    assert_eq!(capped.max_query_length, 4_000);
    assert!(capped.rerank_supported);
}

#[test]
fn rag_commands_bind_top_level_arguments_as_snake_case() {
    let source = include_str!("../../commands/integration/rag.rs");
    let command_names = [
        "rag_list_services",
        "rag_save_service",
        "rag_prompt_service_credential",
        "rag_clear_service_credential",
        "rag_delete_service",
        "rag_test_service",
        "rag_hub_list_knowledge_bases",
        "rag_hub_create_knowledge_base",
        "rag_hub_update_knowledge_base",
        "rag_hub_delete_knowledge_base",
        "rag_hub_list_documents",
        "rag_hub_upload_document",
        "rag_hub_import_document_url",
        "rag_hub_get_document",
        "rag_pick_document_file",
        "rag_hub_get_ingestion_job",
        "rag_hub_list_ingestion_jobs",
        "rag_hub_retry_ingestion_job",
        "rag_hub_delete_document",
        "rag_hub_list_document_chunks",
        "rag_hub_search",
        "rag_hub_rerank",
        "rag_agent_list_knowledge_bases",
        "rag_agent_search",
    ];
    let annotation = r#"#[tauri::command(rename_all = "snake_case")]"#;

    assert_eq!(
        source.matches("#[tauri::command").count(),
        command_names.len(),
        "RAG command inventory changed; update this contract intentionally"
    );
    for command_name in command_names {
        let annotated_declaration = format!("{annotation}\npub async fn {command_name}");
        assert!(
            source.contains(&annotated_declaration),
            "{command_name} must be immediately preceded by {annotation}"
        );
    }
}

#[test]
fn rag_delete_command_opens_the_store_before_touching_credentials_and_uses_the_helper() {
    let source = include_str!("../../commands/integration/rag.rs");
    let command = source
        .split_once("pub async fn rag_delete_service")
        .expect("rag_delete_service declaration")
        .1
        .split_once("#[tauri::command")
        .expect("command following rag_delete_service")
        .0;
    let open_store = command
        .find("let store = RagServiceStore::open()?")
        .expect("rag_delete_service must open the SQLite store");
    let create_credentials = command
        .find("let credentials = RagCredentialStore")
        .expect("rag_delete_service must construct the credential repository");
    let call_helper = command
        .find("delete_service_with_dependencies(&store, &credentials, &service_id)")
        .expect("rag_delete_service must use the compensated delete helper");

    assert!(open_store < create_credentials);
    assert!(create_credentials < call_helper);
    assert!(!command.contains("credentials.delete"));
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
    assert!(source.contains("rag_hub_list_ingestion_jobs"));
    assert!(source.contains("rag_hub_retry_ingestion_job"));
    assert!(source.contains("rag_hub_delete_document"));
    assert!(source.contains("rag_hub_list_document_chunks"));
    assert!(source.contains("rag_hub_rerank"));
    assert!(!source.contains("rag_agent_upload"));
    assert!(!source.contains("rag_agent_delete"));
    assert!(!source.contains("rag_agent_retry"));
    assert!(!source.contains("rag_agent_create_knowledge_base"));
    assert!(!source.contains("rag_agent_update_knowledge_base"));
    assert!(!source.contains("rag_agent_delete_knowledge_base"));
    assert!(!source.contains("rag_agent_import_document_url"));
    assert!(!source.contains("rag_agent_rerank"));
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
