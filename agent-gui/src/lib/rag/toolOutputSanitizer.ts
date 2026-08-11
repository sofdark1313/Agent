export const MAX_HIT_CONTENT_CHARS = 4_000;
export const MAX_TOOL_TEXT_CHARS = 16_000;
export const MAX_DETAIL_HITS = 50;
export const MAX_KNOWLEDGE_BASES = 100;
export const MAX_METADATA_ENTRIES = 20;
export const MAX_METADATA_KEY_CHARS = 100;
export const MAX_METADATA_TEXT_CHARS = 500;
export const MAX_WARNING_CHARS = 500;
export const MAX_ERROR_CHARS = 1_000;
export const MAX_INLINE_TEXT_CHARS = 200;
export const MAX_STRUCTURED_TEXT_CHARS = 15_000;

export const CONTENT_TRUNCATION_MARKER = "… [内容已截断]";
export const OUTPUT_TRUNCATION_MARKER = "\n\n[RAG 结果输出已截断；请缩小检索范围或降低 Top N。]";
export const LIST_TRUNCATION_MARKER = "\n[RAG 知识库列表已截断。]";
export const REDACTION_MARKER = "[REDACTED]";

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${String.fromCharCode(0x07)}]*(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)?)`,
  "g",
);
const DIRECTIONAL_FORMATTING_PATTERN = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const RESERVED_BOUNDARY_PATTERN = /\[?\s*RAG_EXTERNAL_UNTRUSTED_CONTENT_(?:BEGIN|END)\b[^\]]*\]?/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(api[\s_-]*key|x[\s_-]*api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|token|auth(?:orization)?|proxy[\s_-]*authorization|cookie|set[\s_-]*cookie|client[\s_-]*secret|secret|password|passwd|credential(?:s)?)\b\s*[:=]\s*(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const PREFIXED_API_KEY_PATTERN =
  /\b(?:sk|rk|pk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9_-]{8,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

type TextBudget = {
  remaining: number;
  truncated: boolean;
};

export type SanitizedKnowledgeBase = {
  id: string;
  name: string;
  documentCount?: number;
};

export type SanitizedSearchHit = {
  knowledgeBaseId: string;
  documentId?: string;
  documentName?: string;
  chunkId: string;
  content: string;
  score: number;
  source: string;
  rankBefore?: number;
  rankAfter?: number;
  metadata: Record<string, string | number | boolean | null>;
};

function createBudget(maximum = MAX_STRUCTURED_TEXT_CHARS): TextBudget {
  return { remaining: maximum, truncated: false };
}

function redactSensitivePatterns(value: string) {
  return value
    .replace(
      CREDENTIAL_ASSIGNMENT_PATTERN,
      (_match, label: string) => `${label}=${REDACTION_MARKER}`,
    )
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTION_MARKER}`)
    .replace(PREFIXED_API_KEY_PATTERN, REDACTION_MARKER)
    .replace(JWT_PATTERN, REDACTION_MARKER);
}

function cleanUntrustedText(value: unknown) {
  if (typeof value !== "string") return "";
  return redactSensitivePatterns(
    value
      .replace(ANSI_ESCAPE_PATTERN, " ")
      .replaceAll(/./gs, (character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
      })
      .replace(DIRECTIONAL_FORMATTING_PATTERN, "")
      .replace(RESERVED_BOUNDARY_PATTERN, "[RESERVED_BOUNDARY_REMOVED]"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(value: string, maximum: number, marker = CONTENT_TRUNCATION_MARKER) {
  const safeMaximum = Math.max(0, Math.floor(maximum));
  if (value.length <= safeMaximum) return { text: value, truncated: false };
  if (safeMaximum === 0) return { text: "", truncated: true };
  if (marker.length >= safeMaximum) {
    return { text: marker.slice(0, safeMaximum), truncated: true };
  }
  return {
    text: `${value.slice(0, safeMaximum - marker.length)}${marker}`,
    truncated: true,
  };
}

function consumeBudget(
  value: string,
  maximum: number,
  budget: TextBudget,
  marker = CONTENT_TRUNCATION_MARKER,
) {
  const allowed = Math.min(Math.max(0, maximum), budget.remaining);
  const result = truncateText(value, allowed, marker);
  budget.remaining -= result.text.length;
  budget.truncated ||= result.truncated;
  return result.text;
}

export function sanitizeUntrustedText(
  value: unknown,
  maximum = MAX_INLINE_TEXT_CHARS,
  budget = createBudget(maximum),
  marker = CONTENT_TRUNCATION_MARKER,
) {
  return consumeBudget(cleanUntrustedText(value), maximum, budget, marker);
}

function normalizedSensitiveKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isSensitiveMetadataKey(value: string) {
  const normalized = normalizedSensitiveKey(value);
  const compact = normalized.replaceAll("_", "");
  const segments = normalized.split("_").filter(Boolean);
  return (
    compact.includes("apikey") ||
    segments.some((segment) =>
      [
        "authorization",
        "cookie",
        "credential",
        "credentials",
        "passwd",
        "password",
        "secret",
      ].includes(segment),
    ) ||
    segments.at(-1) === "token"
  );
}

function sanitizeMetadata(metadata: unknown, budget: TextBudget) {
  const sanitized: Record<string, string | number | boolean | null> = {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return sanitized;

  for (const [rawKey, value] of Object.entries(metadata).slice(0, MAX_METADATA_ENTRIES)) {
    if (budget.remaining <= 0) break;
    const key = sanitizeUntrustedText(rawKey, MAX_METADATA_KEY_CHARS, budget);
    if (!key) continue;
    if (isSensitiveMetadataKey(key)) {
      sanitized[key] = consumeBudget(REDACTION_MARKER, MAX_METADATA_TEXT_CHARS, budget);
    } else if (typeof value === "string") {
      sanitized[key] = sanitizeUntrustedText(value, MAX_METADATA_TEXT_CHARS, budget);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function optionalBoundedInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function sanitizeSearchHit(value: unknown, budget: TextBudget): SanitizedSearchHit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const hit = value as Record<string, unknown>;
  const knowledgeBaseId = sanitizeUntrustedText(hit.knowledgeBaseId, MAX_INLINE_TEXT_CHARS, budget);
  const documentId = sanitizeUntrustedText(hit.documentId, MAX_INLINE_TEXT_CHARS, budget);
  const documentName = sanitizeUntrustedText(hit.documentName, MAX_INLINE_TEXT_CHARS, budget);
  const chunkId = sanitizeUntrustedText(hit.chunkId, MAX_INLINE_TEXT_CHARS, budget);
  const source = sanitizeUntrustedText(hit.source, MAX_INLINE_TEXT_CHARS, budget);
  const content = sanitizeUntrustedText(
    hit.content,
    MAX_HIT_CONTENT_CHARS,
    budget,
    CONTENT_TRUNCATION_MARKER,
  );
  const rankBefore = optionalBoundedInteger(hit.rankBefore);
  const rankAfter = optionalBoundedInteger(hit.rankAfter);
  return {
    knowledgeBaseId,
    documentId: documentId || undefined,
    documentName: documentName || undefined,
    chunkId,
    content,
    score: typeof hit.score === "number" && Number.isFinite(hit.score) ? hit.score : 0,
    source,
    rankBefore,
    rankAfter,
    metadata: sanitizeMetadata(hit.metadata, budget),
  };
}

function sanitizeSearchHits(values: unknown, budget: TextBudget) {
  const input = Array.isArray(values) ? values : [];
  const hits: SanitizedSearchHit[] = [];
  for (const value of input.slice(0, MAX_DETAIL_HITS)) {
    if (budget.remaining < 64) {
      budget.truncated = true;
      break;
    }
    const hit = sanitizeSearchHit(value, budget);
    if (hit) hits.push(hit);
  }
  return { hits, inputCount: input.length };
}

function sanitizeWarnings(values: unknown, budget: TextBudget) {
  const input = Array.isArray(values) ? values : [];
  const warnings: string[] = [];
  for (const value of input.slice(0, 20)) {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      break;
    }
    const warning = sanitizeUntrustedText(value, MAX_WARNING_CHARS, budget);
    if (warning) warnings.push(warning);
  }
  return { warnings, inputCount: input.length };
}

function sanitizeTimings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const timings = value as Record<string, unknown>;
  const number = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : 0;
  return {
    retrievalMs: number(timings.retrievalMs),
    rerankMs: number(timings.rerankMs),
    totalMs: number(timings.totalMs),
  };
}

function serializedLength(value: unknown) {
  return JSON.stringify(value).length;
}

function removeLastMetadataSection(hits: SanitizedSearchHit[]) {
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    if (Object.keys(hits[index].metadata).length === 0) continue;
    hits[index] = { ...hits[index], metadata: {} };
    return true;
  }
  return false;
}

export function sanitizeRagSearchResponse(value: unknown) {
  const response =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const budget = createBudget();
  const requestId = sanitizeUntrustedText(response.requestId, MAX_INLINE_TEXT_CHARS, budget);
  const sanitizedResults = sanitizeSearchHits(response.results, budget);
  const sanitizedRawResults = sanitizeSearchHits(response.rawResults, budget);
  const sanitizedWarnings = sanitizeWarnings(response.warnings, budget);
  const sanitized = {
    requestId: requestId || undefined,
    rawResults: sanitizedRawResults.hits,
    results: sanitizedResults.hits,
    warnings: sanitizedWarnings.warnings,
    timings: sanitizeTimings(response.timings),
    localTruncation: {
      rawResultCount: sanitizedRawResults.inputCount > sanitizedRawResults.hits.length,
      resultCount: sanitizedResults.inputCount > sanitizedResults.hits.length,
      warningCount: sanitizedWarnings.inputCount > sanitizedWarnings.warnings.length,
      hitContent:
        sanitizedRawResults.hits.some((hit) => hit.content.includes(CONTENT_TRUNCATION_MARKER)) ||
        sanitizedResults.hits.some((hit) => hit.content.includes(CONTENT_TRUNCATION_MARKER)),
      structuredText: budget.truncated,
    },
  };

  while (serializedLength(sanitized) > MAX_STRUCTURED_TEXT_CHARS) {
    sanitized.localTruncation.structuredText = true;
    if (sanitized.rawResults.length > 0) {
      sanitized.rawResults.pop();
      sanitized.localTruncation.rawResultCount = true;
    } else if (removeLastMetadataSection(sanitized.results)) {
    } else if (sanitized.warnings.length > 0) {
      sanitized.warnings.pop();
      sanitized.localTruncation.warningCount = true;
    } else if (sanitized.results.length > 0) {
      sanitized.results.pop();
      sanitized.localTruncation.resultCount = true;
    } else if (sanitized.requestId !== undefined) {
      sanitized.requestId = undefined;
    } else if (sanitized.timings !== null) {
      sanitized.timings = null;
    } else {
      break;
    }
  }

  return sanitized;
}

export function sanitizeRagKnowledgeBases(values: unknown) {
  const input = Array.isArray(values) ? values : [];
  const budget = createBudget();
  const knowledgeBases: SanitizedKnowledgeBase[] = [];
  for (const value of input.slice(0, MAX_KNOWLEDGE_BASES)) {
    if (budget.remaining < 16) {
      budget.truncated = true;
      break;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const id = sanitizeUntrustedText(item.id, MAX_INLINE_TEXT_CHARS, budget);
    const name = sanitizeUntrustedText(item.name, MAX_INLINE_TEXT_CHARS, budget);
    const documentCount = optionalBoundedInteger(item.documentCount);
    if (!id && !name) continue;
    knowledgeBases.push({
      id,
      name,
      documentCount: documentCount !== undefined && documentCount >= 0 ? documentCount : undefined,
    });
  }
  const sanitized = {
    knowledgeBases,
    truncated: input.length > knowledgeBases.length || budget.truncated,
  };
  while (serializedLength(sanitized) > MAX_STRUCTURED_TEXT_CHARS) {
    const removed = sanitized.knowledgeBases.pop();
    sanitized.truncated = true;
    if (!removed) break;
  }
  return sanitized;
}

export function sanitizeRagFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeUntrustedText(message, MAX_ERROR_CHARS);
}
