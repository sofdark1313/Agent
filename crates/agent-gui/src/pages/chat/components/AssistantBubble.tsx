import { memo } from "react";

import type { UiRound } from "../../../lib/chat/messages/uiMessages";

import { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
import { RoundContent } from "./assistant-bubble/RoundContent";

export { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
export { CompactingText, VibingText } from "./assistant-bubble/StatusText";

const EMPTY_RUNNING_TOOL_CALL_IDS: string[] = [];

export const AssistantBubble = memo(function AssistantBubble(props: {
  rounds: (UiRound & {
    runningToolCallIds?: string[];
    thinkingOpen?: boolean;
  })[];
  showUsage?: boolean;
  usageContextWindow?: number;
  isLive?: boolean;
  // Pinned per row: stream-born content renders in streaming mode forever,
  // history renders static. Never flips for a given row.
  renderMode?: "streaming" | "static";
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
}) {
  const {
    rounds,
    showUsage,
    usageContextWindow,
    isLive,
    renderMode,
    toolStatus,
    toolStatusVariant,
  } = props;
  const showLabels = rounds.length > 1;

  return (
    <div className="flex w-full max-w-full items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {rounds.map((round, idx) => (
          <RoundContent
            key={round.key}
            round={round}
            showLabel={showLabels}
            showUsage={showUsage}
            usageContextWindow={usageContextWindow}
            isLive={isLive}
            isActive={isLive && idx === rounds.length - 1}
            renderMode={renderMode}
            toolStatus={idx === rounds.length - 1 ? toolStatus : null}
            toolStatusVariant={idx === rounds.length - 1 ? toolStatusVariant : "default"}
            runningToolCallIds={round.runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS}
            thinkingOpen={round.thinkingOpen}
          />
        ))}
      </div>
    </div>
  );
});
