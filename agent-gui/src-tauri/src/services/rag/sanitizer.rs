use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use super::model::{
    RagAcceptedJob, RagCapabilities, RagChunk, RagDocument, RagIngestionCapabilities,
    RagHealth, RagIngestionError, RagIngestionJob, RagKnowledgeBase, RagPage, RagPipeline,
    RagSearchHit, RagSearchResponse,
};

pub(crate) const MAX_REMOTE_RESPONSE_TEXT_CHARS: usize = 64_000;
pub(crate) const REDACTION_MARKER: &str = "[REDACTED]";
const TRUNCATION_MARKER: &str = "...[TRUNCATED]";
const MAX_INLINE_CHARS: usize = 256;
const MAX_LOCATION_CHARS: usize = 1_000;
const MAX_CONTENT_CHARS: usize = 4_000;
const MAX_WARNING_CHARS: usize = 500;
const MAX_ERROR_CODE_CHARS: usize = 128;
const MAX_ERROR_MESSAGE_CHARS: usize = 1_000;
const MAX_COLLECTION_ITEMS: usize = 100;
const MAX_SEARCH_HITS: usize = 50;
const MAX_WARNINGS: usize = 20;
const MAX_METADATA_ENTRIES: usize = 20;
const MAX_METADATA_DEPTH: usize = 3;

fn ansi_escape_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)?)")
            .expect("valid ANSI escape regex")
    })
}

fn credential_assignment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(api[\s_-]*key|x[\s_-]*api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|token|auth(?:orization)?|proxy[\s_-]*authorization|cookie|set[\s_-]*cookie|client[\s_-]*secret|secret|password|passwd|credential(?:s)?)\b\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)"#,
        )
        .expect("valid credential assignment regex")
    })
}

fn auth_scheme_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{4,}")
            .expect("valid auth scheme regex")
    })
}

fn prefixed_key_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b(?:sk|rk|pk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9_-]{8,}\b")
            .expect("valid prefixed key regex")
    })
}

fn jwt_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
            .expect("valid JWT regex")
    })
}

fn is_bidi_or_zero_width(character: char) -> bool {
    matches!(
        character as u32,
        0x061c | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x2069 | 0xfeff
    )
}

fn clean_remote_text(value: &str) -> String {
    let without_ansi = ansi_escape_pattern().replace_all(value, " ");
    let without_controls = without_ansi
        .chars()
        .filter_map(|character| {
            let code = character as u32;
            if is_bidi_or_zero_width(character) {
                None
            } else if code <= 0x1f || (0x7f..=0x9f).contains(&code) {
                Some(' ')
            } else {
                Some(character)
            }
        })
        .collect::<String>();
    let redacted = credential_assignment_pattern()
        .replace_all(&without_controls, format!("$1={REDACTION_MARKER}"));
    let redacted = auth_scheme_pattern().replace_all(&redacted, format!("$1 {REDACTION_MARKER}"));
    let redacted = prefixed_key_pattern().replace_all(&redacted, REDACTION_MARKER);
    let redacted = jwt_pattern().replace_all(&redacted, REDACTION_MARKER);
    redacted.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, maximum: usize) -> String {
    let length = value.chars().count();
    if length <= maximum {
        return value.to_string();
    }
    if maximum == 0 {
        return String::new();
    }
    let marker_length = TRUNCATION_MARKER.chars().count();
    if marker_length >= maximum {
        return TRUNCATION_MARKER.chars().take(maximum).collect();
    }
    let mut output = value
        .chars()
        .take(maximum - marker_length)
        .collect::<String>();
    output.push_str(TRUNCATION_MARKER);
    output
}

pub(crate) fn sanitize_remote_text(value: &str, maximum: usize) -> String {
    truncate_chars(&clean_remote_text(value), maximum)
}

pub(crate) fn sanitize_error_code(value: &str) -> String {
    sanitize_remote_text(value, MAX_ERROR_CODE_CHARS)
}

pub(crate) fn sanitize_error_message(value: &str) -> String {
    sanitize_remote_text(value, MAX_ERROR_MESSAGE_CHARS)
}

#[derive(Debug)]
pub(crate) struct SanitizationBudget {
    remaining: usize,
}

impl Default for SanitizationBudget {
    fn default() -> Self {
        Self {
            remaining: MAX_REMOTE_RESPONSE_TEXT_CHARS,
        }
    }
}

impl SanitizationBudget {
    fn text(&mut self, value: &str, maximum: usize) -> String {
        let allowed = maximum.min(self.remaining);
        let sanitized = sanitize_remote_text(value, allowed);
        self.remaining = self.remaining.saturating_sub(sanitized.chars().count());
        sanitized
    }
}

pub(crate) trait RagSanitizeResponse {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget);
}

impl<T: RagSanitizeResponse> RagSanitizeResponse for Vec<T> {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.truncate(MAX_COLLECTION_ITEMS);
        for item in self {
            item.sanitize_response(budget);
        }
    }
}

impl<T: RagSanitizeResponse> RagSanitizeResponse for RagPage<T> {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.items.sanitize_response(budget);
        self.total = self.total.max(self.items.len() as u64);
    }
}

impl RagSanitizeResponse for RagHealth {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.status = budget.text(&self.status, MAX_INLINE_CHARS);
    }
}

impl RagSanitizeResponse for RagKnowledgeBase {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.id = budget.text(&self.id, MAX_INLINE_CHARS);
        self.name = budget.text(&self.name, MAX_INLINE_CHARS);
        self.embedding_model = self
            .embedding_model
            .take()
            .map(|value| budget.text(&value, MAX_INLINE_CHARS));
        self.collection_name = self
            .collection_name
            .take()
            .map(|value| budget.text(&value, MAX_INLINE_CHARS));
    }
}

impl RagSanitizeResponse for RagDocument {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.id = budget.text(&self.id, MAX_INLINE_CHARS);
        self.knowledge_base_id = budget.text(&self.knowledge_base_id, MAX_INLINE_CHARS);
        self.name = budget.text(&self.name, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.source_type, budget, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.source_location, budget, MAX_LOCATION_CHARS);
        sanitize_optional_text(&mut self.file_type, budget, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.created_at, budget, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.updated_at, budget, MAX_INLINE_CHARS);
        self.status = budget.text(&self.status, MAX_INLINE_CHARS);
    }
}

impl RagSanitizeResponse for RagChunk {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.id = budget.text(&self.id, MAX_INLINE_CHARS);
        self.content = budget.text(&self.content, MAX_CONTENT_CHARS);
    }
}

impl RagSanitizeResponse for RagAcceptedJob {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.document_id = budget.text(&self.document_id, MAX_INLINE_CHARS);
        self.job_id = budget.text(&self.job_id, MAX_INLINE_CHARS);
        self.status = budget.text(&self.status, MAX_INLINE_CHARS);
    }
}

impl RagSanitizeResponse for RagIngestionError {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.code = budget.text(&self.code, MAX_ERROR_CODE_CHARS);
        self.message = budget.text(&self.message, MAX_ERROR_MESSAGE_CHARS);
    }
}

impl RagSanitizeResponse for RagIngestionJob {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.job_id = budget.text(&self.job_id, MAX_INLINE_CHARS);
        self.document_id = budget.text(&self.document_id, MAX_INLINE_CHARS);
        self.status = budget.text(&self.status, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.stage, budget, MAX_INLINE_CHARS);
        if let Some(error) = &mut self.error {
            error.sanitize_response(budget);
        }
    }
}

impl RagSanitizeResponse for RagSearchHit {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.knowledge_base_id = budget.text(&self.knowledge_base_id, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.document_id, budget, MAX_INLINE_CHARS);
        sanitize_optional_text(&mut self.document_name, budget, MAX_INLINE_CHARS);
        self.chunk_id = budget.text(&self.chunk_id, MAX_INLINE_CHARS);
        self.content = budget.text(&self.content, MAX_CONTENT_CHARS);
        self.source = budget.text(&self.source, MAX_LOCATION_CHARS);
        sanitize_metadata(&mut self.metadata, budget);
    }
}

impl RagSanitizeResponse for RagSearchResponse {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        sanitize_optional_text(&mut self.request_id, budget, MAX_INLINE_CHARS);
        self.results.truncate(MAX_SEARCH_HITS);
        self.raw_results.truncate(MAX_SEARCH_HITS);
        for hit in &mut self.results {
            hit.sanitize_response(budget);
        }
        for hit in &mut self.raw_results {
            hit.sanitize_response(budget);
        }
        self.warnings.truncate(MAX_WARNINGS);
        for warning in &mut self.warnings {
            *warning = budget.text(warning, MAX_WARNING_CHARS);
        }
        enforce_search_response_size(self);
    }
}

fn enforce_search_response_size(response: &mut RagSearchResponse) {
    while serialized_size(response) > MAX_REMOTE_RESPONSE_TEXT_CHARS
        && response.raw_results.len() > 1
    {
        response.raw_results.pop();
    }
    while serialized_size(response) > MAX_REMOTE_RESPONSE_TEXT_CHARS && response.results.len() > 1 {
        response.results.pop();
    }
    while serialized_size(response) > MAX_REMOTE_RESPONSE_TEXT_CHARS && response.warnings.len() > 1
    {
        response.warnings.pop();
    }
}

fn serialized_size<T: serde::Serialize>(value: &T) -> usize {
    serde_json::to_vec(value)
        .map(|serialized| serialized.len())
        .unwrap_or(usize::MAX)
}

impl RagSanitizeResponse for RagPipeline {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.id = budget.text(&self.id, MAX_INLINE_CHARS);
        self.name = budget.text(&self.name, MAX_INLINE_CHARS);
    }
}

impl RagSanitizeResponse for RagIngestionCapabilities {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        sanitize_string_vec(&mut self.allowed_extensions, budget, MAX_INLINE_CHARS);
        sanitize_string_vec(&mut self.allowed_mime_types, budget, MAX_INLINE_CHARS);
        sanitize_string_vec(&mut self.process_modes, budget, MAX_INLINE_CHARS);
        sanitize_string_vec(&mut self.chunk_strategies, budget, MAX_INLINE_CHARS);
        self.pipelines.sanitize_response(budget);
        let schemas = std::mem::take(&mut self.chunk_config_schema);
        self.chunk_config_schema = schemas
            .into_iter()
            .take(MAX_COLLECTION_ITEMS)
            .map(|(key, mut value)| {
                let key = budget.text(&key, MAX_INLINE_CHARS);
                sanitize_json_value(&mut value, budget, 0);
                (key, value)
            })
            .collect();
    }
}

impl RagSanitizeResponse for RagCapabilities {
    fn sanitize_response(&mut self, budget: &mut SanitizationBudget) {
        self.protocol_version = budget.text(&self.protocol_version, 32);
        sanitize_optional_text(&mut self.credential_audience, budget, 32);
        self.features = sanitize_string_key_map(std::mem::take(&mut self.features), budget);
        self.limits = sanitize_string_key_map(std::mem::take(&mut self.limits), budget);
        if let Some(ingestion) = &mut self.ingestion {
            ingestion.sanitize_response(budget);
        }
    }
}

fn sanitize_optional_text(
    value: &mut Option<String>,
    budget: &mut SanitizationBudget,
    maximum: usize,
) {
    *value = value.take().map(|value| budget.text(&value, maximum));
}

fn sanitize_string_vec(values: &mut Vec<String>, budget: &mut SanitizationBudget, maximum: usize) {
    values.truncate(MAX_COLLECTION_ITEMS);
    for value in values {
        *value = budget.text(value, maximum);
    }
}

fn sanitize_string_key_map<T>(
    values: BTreeMap<String, T>,
    budget: &mut SanitizationBudget,
) -> BTreeMap<String, T> {
    values
        .into_iter()
        .take(MAX_COLLECTION_ITEMS)
        .map(|(key, value)| (budget.text(&key, MAX_INLINE_CHARS), value))
        .collect()
}

fn normalized_sensitive_key(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn is_sensitive_metadata_key(value: &str) -> bool {
    let normalized = normalized_sensitive_key(value);
    let compact = normalized.replace('_', "");
    let segments = normalized.split('_').collect::<HashSet<_>>();
    compact.contains("apikey")
        || [
            "authorization",
            "cookie",
            "credential",
            "credentials",
            "passwd",
            "password",
            "secret",
            "token",
        ]
        .iter()
        .any(|suffix| compact.ends_with(suffix))
        || segments.iter().any(|segment| {
            matches!(
                *segment,
                "authorization"
                    | "cookie"
                    | "credential"
                    | "credentials"
                    | "passwd"
                    | "password"
                    | "secret"
            )
        })
}

fn sanitize_metadata(metadata: &mut BTreeMap<String, Value>, budget: &mut SanitizationBudget) {
    let entries = std::mem::take(metadata);
    *metadata = entries
        .into_iter()
        .take(MAX_METADATA_ENTRIES)
        .filter_map(|(raw_key, mut value)| {
            let available = budget.remaining;
            let mut candidate_budget = SanitizationBudget {
                remaining: available,
            };
            let sensitive = is_sensitive_metadata_key(&raw_key);
            let key = candidate_budget.text(&raw_key, 100);
            if sensitive {
                value = Value::String(candidate_budget.text(REDACTION_MARKER, 500));
            } else {
                sanitize_json_value(&mut value, &mut candidate_budget, 0);
            }
            let entry_chars = key.chars().count() + value.to_string().chars().count();
            if entry_chars > available {
                None
            } else {
                budget.remaining = available - entry_chars;
                Some((key, value))
            }
        })
        .collect();
}

fn sanitize_json_value(value: &mut Value, budget: &mut SanitizationBudget, depth: usize) {
    if depth >= MAX_METADATA_DEPTH {
        *value = Value::Null;
        return;
    }
    match value {
        Value::String(text) => *text = budget.text(text, 500),
        Value::Array(values) => {
            values.truncate(MAX_METADATA_ENTRIES);
            for value in values {
                sanitize_json_value(value, budget, depth + 1);
            }
        }
        Value::Object(values) => {
            let entries = std::mem::take(values);
            *values = entries
                .into_iter()
                .take(MAX_METADATA_ENTRIES)
                .map(|(raw_key, mut value)| {
                    let sensitive = is_sensitive_metadata_key(&raw_key);
                    let key = budget.text(&raw_key, 100);
                    if sensitive {
                        value = Value::String(budget.text(REDACTION_MARKER, 500));
                    } else {
                        sanitize_json_value(&mut value, budget, depth + 1);
                    }
                    (key, value)
                })
                .collect();
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}
