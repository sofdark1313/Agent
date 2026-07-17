import { memo } from "react";

import { Check, Copy, RefreshCw } from "../../../components/icons";
import { ConfirmActionPopover } from "../../../components/ui/confirm-action-popover";
import { useLocale } from "../../../i18n";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { VIBING_STATUS } from "../../../lib/chat/page/chatPageHelpers";
import {
  AssistantAvatar,
  AssistantBubble,
  CompactingText,
  VibingText,
} from "../components/AssistantBubble";
import type { AssistantRow as AssistantRowData } from "./rowModel";
import { TypingDots } from "./TranscriptLoadingStates";
import { formatMessageTimestamp } from "./transcriptUtils";
import { useCopiedFlag } from "./useCopiedFlag";

export type AssistantRowProps = {
  row: AssistantRowData;
  isSending: boolean;
  showUsage?: boolean;
  usageContextWindow?: number;
  // Live-row status inputs; settled rows receive the idle values so memo
  // comparisons stay cheap and stable.
  isAgentMode: boolean;
  isCompactionRunning: boolean;
  toolStatus: string | null;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
};

// One body for the streaming reply and the settled reply. The live row and
// its committed twin share the row key, the round keys and the block ids, so
// when a run settles React reconciles this same tree in place — Streamdown
// state, shiki output and thinking-block scroll positions all survive.
export const AssistantRow = memo(function AssistantRow(props: AssistantRowProps) {
  const {
    row,
    isSending,
    showUsage,
    usageContextWindow,
    isAgentMode,
    isCompactionRunning,
    toolStatus,
    onResendFromEdit,
  } = props;
  const { t } = useLocale();
  const { copied, markCopied } = useCopiedFlag();

  const retryTarget = row.retryTarget;
  const retryMessageRef = retryTarget?.messageRef;
  const retryDisabled = isSending || !retryMessageRef;
  const retryTitle = retryMessageRef ? t("chat.retry") : "旧历史缺少稳定消息标识，无法重试";

  return (
    <div className={`group/assistant w-full max-w-full ${row.compacted ? "opacity-70" : ""}`}>
      {row.rounds.length > 0 ? (
        <AssistantBubble
          rounds={row.rounds}
          showUsage={showUsage}
          usageContextWindow={usageContextWindow}
          isLive={row.live}
          renderMode={row.renderMode}
          toolStatus={row.live ? toolStatus : null}
          toolStatusVariant={row.live && isCompactionRunning ? "compaction" : "default"}
        />
      ) : row.live ? (
        <div className="flex w-full max-w-full items-start gap-3">
          <AssistantAvatar />
          <div className={`min-w-0 flex-1 ${isAgentMode ? "pt-1" : "pt-0.5"}`}>
            {isCompactionRunning ? (
              <div className="flex items-center py-1">
                <CompactingText className="text-sm font-medium text-muted-foreground" />
              </div>
            ) : toolStatus === VIBING_STATUS ? (
              <div className="flex items-center py-1">
                <VibingText className="text-sm font-medium text-muted-foreground" />
              </div>
            ) : toolStatus ? (
              <div className="py-1 text-sm text-muted-foreground">{toolStatus}</div>
            ) : (
              <TypingDots />
            )}
          </div>
        </div>
      ) : null}
      {row.live ? null : (
        <div className="mt-1 flex items-center justify-start gap-1.5 pl-10">
          <span className="select-none text-[calc(11px*var(--zone-font-scale,1))] tabular-nums text-muted-foreground/70">
            {formatMessageTimestamp(row.timestamp ?? 0)}
          </span>
          <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within/assistant:opacity-100 group-hover/assistant:opacity-100">
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={t("chat.copy")}
              disabled={!row.replyText}
              onClick={() => {
                navigator.clipboard.writeText(row.replyText);
                markCopied();
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <ConfirmActionPopover
              title={t("chat.retryConfirmTitle")}
              description={t("chat.retryConfirmDescription")}
              confirmLabel={t("chat.retry")}
              align="start"
              side="top"
              onConfirm={() => {
                if (!retryTarget || !retryMessageRef) return;
                onResendFromEdit(retryMessageRef, retryTarget.text, retryTarget.attachments);
              }}
            >
              {() => (
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title={retryTitle}
                  disabled={retryDisabled}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </ConfirmActionPopover>
          </div>
        </div>
      )}
    </div>
  );
});
