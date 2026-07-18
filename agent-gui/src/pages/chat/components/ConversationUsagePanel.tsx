import { useMemo, useSyncExternalStore } from "react";

import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { UsagePanel } from "./assistant-bubble/UsagePanel";
import { findLatestConversationUsage } from "./conversationUsageState";

export function ConversationUsagePanel(props: {
  show: boolean;
  historyItems: readonly RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  contextWindow?: number;
}) {
  const { show, historyItems, liveTranscriptStore, contextWindow } = props;
  const liveTranscript = useSyncExternalStore(
    liveTranscriptStore.subscribe,
    liveTranscriptStore.getSnapshot,
    liveTranscriptStore.getSnapshot,
  );
  const usage = useMemo(
    () => findLatestConversationUsage(historyItems, liveTranscript.liveRounds),
    [historyItems, liveTranscript.liveRounds],
  );

  if (!show || !usage) return null;

  return (
    <div
      data-agent-conversation-usage
      className="mx-auto mb-1 w-[calc(100%-1.5rem)] max-w-[720px] overflow-hidden px-1"
    >
      <UsagePanel usage={usage} contextWindow={contextWindow} />
    </div>
  );
}
