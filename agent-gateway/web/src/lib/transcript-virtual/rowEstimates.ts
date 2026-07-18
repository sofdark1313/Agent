// Row height estimates for the transcript virtualizer, derived from cheap
// per-row metadata computed once at row build time. Estimates only ever apply
// to rows that have never been measured — the virtualizer's measurement cache
// is keyed by row key and survives folding — but a fixed one-size guess
// (rows really range from ~40px to thousands) made scroll positions jump
// while reading history; shaping the guess by content removes most of the
// correction distance.

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Bubble padding plus one line per ~60 chars of prompt text.
export function estimateUserRowHeight(textChars: number): number {
  return clamp(72 + 22 * Math.ceil(textChars / 60), 80, 400);
}

export type AssistantRowEstimateStats = {
  textChars: number;
  toolCount: number;
  thinkingCount: number;
};

// Avatar row base, prose at ~3.2 chars/px capped per block sum, a collapsed
// card per tool, a collapsed header per thinking block.
export function estimateAssistantRowHeight(stats: AssistantRowEstimateStats): number {
  const textHeight = Math.min(600, 28 + stats.textChars / 3.2);
  return clamp(64 + textHeight + 56 * stats.toolCount + 48 * stats.thinkingCount, 80, 1600);
}

// Collapsed checkpoint/summary card.
export const CHECKPOINT_ROW_ESTIMATE_PX = 88;
