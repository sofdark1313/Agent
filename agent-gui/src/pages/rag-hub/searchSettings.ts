export type RagSearchCapabilities = {
  limits?: Record<string, number>;
  features?: Record<string, boolean>;
};

export type RagSearchLimits = {
  maxTopK: number;
  maxTopN: number;
  maxQueryLength: number;
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

function capabilityLimit(value: unknown, localMaximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return localMaximum;
  }
  return Math.min(Math.floor(value), localMaximum);
}

function settingValue(value: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return Math.min(fallback, maximum);
  return Math.max(1, Math.min(Math.floor(value), maximum));
}

export function resolveRagSearchLimits(
  capabilities: RagSearchCapabilities | null | undefined,
): RagSearchLimits {
  return {
    maxTopK: capabilityLimit(capabilities?.limits?.maxTopK, LOCAL_LIMITS.maxTopK),
    maxTopN: capabilityLimit(capabilities?.limits?.maxTopN, LOCAL_LIMITS.maxTopN),
    maxQueryLength: capabilityLimit(
      capabilities?.limits?.maxQueryLength,
      LOCAL_LIMITS.maxQueryLength,
    ),
    rerankSupported: capabilities?.features?.rerank !== false,
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
