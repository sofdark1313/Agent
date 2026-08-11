import {
  isFreshRagCapabilitySnapshot,
  positiveRagCapabilityLimit,
  type RagCapabilitySnapshot,
} from "../../lib/rag/capabilitySnapshot";

export type RagSearchCapabilities = RagCapabilitySnapshot;

export type RagSearchLimits = {
  maxTopK: number;
  maxTopN: number;
  maxQueryLength: number;
  searchSupported: boolean;
  rerankSupported: boolean;
};

export type RagSearchSettings = {
  topK: number;
  rerank: boolean;
  topN: number;
};

const LOCAL_LIMITS = {
  maxTopK: 50,
  maxTopN: 20,
  maxQueryLength: 4000,
};

function settingValue(value: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return Math.min(fallback, maximum);
  return Math.max(1, Math.min(Math.floor(value), maximum));
}

export function resolveRagSearchLimits(
  capabilities: RagSearchCapabilities | null | undefined,
  nowMs = Date.now(),
): RagSearchLimits {
  if (!capabilities || !isFreshRagCapabilitySnapshot(capabilities, nowMs)) {
    return {
      maxTopK: 1,
      maxTopN: 1,
      maxQueryLength: 1,
      searchSupported: false,
      rerankSupported: false,
    };
  }
  const maxTopK = positiveRagCapabilityLimit(capabilities, "maxTopK", LOCAL_LIMITS.maxTopK);
  const maxTopN = positiveRagCapabilityLimit(capabilities, "maxTopN", LOCAL_LIMITS.maxTopN);
  const maxQueryLength = positiveRagCapabilityLimit(
    capabilities,
    "maxQueryLength",
    LOCAL_LIMITS.maxQueryLength,
  );
  const searchSupported =
    maxTopK !== null &&
    maxTopN !== null &&
    maxQueryLength !== null &&
    typeof capabilities.features?.rerank === "boolean";
  return {
    maxTopK: maxTopK ?? 1,
    maxTopN: maxTopN ?? 1,
    maxQueryLength: maxQueryLength ?? 1,
    searchSupported,
    rerankSupported: searchSupported && maxTopN !== null && capabilities.features?.rerank === true,
  };
}

export function normalizeRagSearchSettings(
  settings: RagSearchSettings,
  limits: RagSearchLimits,
): RagSearchSettings {
  return {
    topK: settingValue(settings.topK, limits.maxTopK, 10),
    rerank: settings.rerank && limits.rerankSupported,
    topN: settingValue(settings.topN, limits.maxTopN, 5),
  };
}

export function toggleRagKnowledgeBase(selected: string[], knowledgeBaseId: string) {
  return selected.includes(knowledgeBaseId)
    ? selected.filter((id) => id !== knowledgeBaseId)
    : [...selected, knowledgeBaseId];
}
