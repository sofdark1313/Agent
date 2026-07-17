import { memo } from "react";

import { Check, Copy, Pencil } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import {
  type CommitDetailsLoader,
  UserMessageContent,
} from "../../../lib/chat/messages/userMessageContent";
import { EditableUserMessageBubble } from "./EditableUserMessageBubble";
import type { UserRow } from "./rowModel";
import { formatMessageTimestamp, splitUserAttachmentsForDisplay } from "./transcriptUtils";
import { UserAttachmentCards } from "./UserAttachmentCards";
import { useCopiedFlag } from "./useCopiedFlag";

export type UserMessageRowProps = {
  row: UserRow;
  isEditing: boolean;
  isSending: boolean;
  // True only in the row's birth window — never on virtualizer re-entry.
  animateEntrance: boolean;
  workspaceRoot?: string;
  loadCommitDetails: CommitDetailsLoader;
  onStartEdit: (key: string) => void;
  onCancelEdit: () => void;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
};

export const UserMessageRow = memo(function UserMessageRow(props: UserMessageRowProps) {
  const {
    row,
    isEditing,
    isSending,
    animateEntrance,
    workspaceRoot,
    loadCommitDetails,
    onStartEdit,
    onCancelEdit,
    onResendFromEdit,
  } = props;
  const { t } = useLocale();
  const { copied, markCopied } = useCopiedFlag();
  const item = row.item;

  const effectiveMessageRef = item.messageRef;
  const missingStableRef = !effectiveMessageRef;
  const editDisabled = isSending || missingStableRef;
  const editTitle = missingStableRef ? "旧历史缺少稳定消息标识，无法编辑重发" : t("chat.edit");
  const compactedClass = item.isFromCompactedSegment ? "opacity-70" : "";
  const { visibleFiles, pastedTextFiles } = splitUserAttachmentsForDisplay(
    item.attachments,
    item.text,
  );

  if (isEditing && effectiveMessageRef) {
    return (
      <EditableUserMessageBubble
        initialText={item.text}
        attachments={item.attachments}
        workspaceRoot={workspaceRoot}
        compactedClass={compactedClass}
        onCancel={onCancelEdit}
        onSubmit={(newText, nextAttachments) => {
          onCancelEdit();
          onResendFromEdit(effectiveMessageRef, newText, nextAttachments);
        }}
      />
    );
  }

  return (
    <div
      className={`chat-user-bubble-wrap group relative ml-auto max-w-[min(85%,calc(50em+2rem))] ${compactedClass}`}
    >
      <div
        className={`${animateEntrance ? "chat-bubble-enter " : ""}chat-user-bubble ml-auto w-fit max-w-full rounded-2xl rounded-br-md bg-[hsl(var(--chat-user-bg))] px-4 py-2.5 font-openai-chat text-[calc(14.5px*var(--zone-font-scale,1))] leading-relaxed text-[hsl(var(--chat-user-fg))]`}
      >
        <UserAttachmentCards files={visibleFiles} workspaceRoot={workspaceRoot} />
        {item.text ? (
          <UserMessageContent
            text={item.text}
            pastedTextFiles={pastedTextFiles}
            loadCommitDetails={loadCommitDetails}
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title={t("chat.copy")}
            onClick={() => {
              navigator.clipboard.writeText(item.text);
              markCopied();
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={editTitle}
            disabled={editDisabled}
            onClick={() => {
              if (!effectiveMessageRef) return;
              onStartEdit(item.key);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="select-none text-[calc(11px*var(--zone-font-scale,1))] tabular-nums text-muted-foreground/70">
          {formatMessageTimestamp(item.timestamp)}
        </span>
      </div>
    </div>
  );
});
