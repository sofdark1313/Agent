import type { Usage } from "@earendil-works/pi-ai";

import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveRound, UiRound } from "../../../lib/chat/messages/uiMessages";

function hasDisplayableUsage(usage: Usage | undefined): usage is Usage {
  if (!usage) return false;

  return (
    usage.totalTokens > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    (usage.cost?.total ?? 0) > 0
  );
}

function applyRoundUsage(rounds: readonly UiRound[], current: Usage | null) {
  let latest = current;

  for (const round of rounds) {
    if (hasDisplayableUsage(round.meta?.usage)) {
      latest = round.meta.usage;
    }
  }

  return latest;
}

export function findLatestConversationUsage(
  historyItems: readonly RenderTimelineItem[],
  liveRounds: readonly LiveRound[],
): Usage | null {
  let latest: Usage | null = null;

  for (const item of historyItems) {
    if (item.kind !== "assistant") continue;
    latest = applyRoundUsage(item.rounds, latest);
  }

  return applyRoundUsage(liveRounds, latest);
}
