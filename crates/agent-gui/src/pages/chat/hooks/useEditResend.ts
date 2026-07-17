import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type { MentionComposerHandle } from "../../../components/chat/MentionComposer";
import {
  type ConversationViewState,
  type HistoryMessageRef,
  truncateConversationFromMessage,
} from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import {
  collectRetainedSubagentParentToolCallIds,
  pruneSubagentRunsForConversation,
} from "../../../lib/subagents";
import type { SendChatAction } from "../gateway/gatewayBridgeTypes";
import type { ConversationRuntimeEntry } from "../runtime/chatPageRuntime";

type UseEditResendParams = {
  conversationState: ConversationViewState;
  isSending: boolean;
  isConversationHydrating: boolean;
  isConversationHydrationFailed: boolean;
  currentConversationIdRef: MutableRefObject<string>;
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  setPendingUploadsForConversation: (conversationId: string, files: PendingUploadedFile[]) => void;
  updateConversationRuntimeEntry: (
    conversationId: string,
    updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
  ) => ConversationRuntimeEntry;
  invalidateSubagentsForConversation?: (conversationId: string) => void;
  sendActionRef: MutableRefObject<SendChatAction>;
};

type PendingEditResend = {
  expectedState: ConversationViewState;
  text: string;
  uploadedFiles: PendingUploadedFile[];
  baseMessageRef: HistoryMessageRef;
  afterInitialHistoryPersist: () => Promise<void>;
};

export function useEditResend(params: UseEditResendParams) {
  const {
    conversationState,
    isSending,
    isConversationHydrating,
    isConversationHydrationFailed,
    currentConversationIdRef,
    composerRef,
    setPendingUploadsForConversation,
    updateConversationRuntimeEntry,
    invalidateSubagentsForConversation,
    sendActionRef,
  } = params;
  const pendingEditResendRef = useRef<PendingEditResend | null>(null);

  const handleResendFromEdit = useCallback(
    (messageRef: HistoryMessageRef, text: string, uploadedFiles: PendingUploadedFile[]) => {
      if (isSending || isConversationHydrating || isConversationHydrationFailed) {
        return;
      }
      const normalized = text.trim();
      if (!normalized && uploadedFiles.length === 0) return;

      const nextState = truncateConversationFromMessage(conversationState, messageRef);
      const parentConversationId = currentConversationIdRef.current;
      const keepParentToolCallIds = collectRetainedSubagentParentToolCallIds(nextState);
      pendingEditResendRef.current = {
        expectedState: nextState,
        text: normalized,
        uploadedFiles,
        baseMessageRef: messageRef,
        afterInitialHistoryPersist: () => {
          invalidateSubagentsForConversation?.(parentConversationId);
          return pruneSubagentRunsForConversation({
            parentConversationId,
            keepParentToolCallIds,
          }).then(() => undefined);
        },
      };
      setPendingUploadsForConversation(currentConversationIdRef.current, uploadedFiles);
      composerRef.current?.clear();
      updateConversationRuntimeEntry(currentConversationIdRef.current, (prev) => ({
        ...prev,
        state: nextState,
      }));
    },
    [
      composerRef,
      conversationState,
      currentConversationIdRef,
      isConversationHydrationFailed,
      isConversationHydrating,
      isSending,
      setPendingUploadsForConversation,
      invalidateSubagentsForConversation,
      updateConversationRuntimeEntry,
    ],
  );

  useEffect(() => {
    const pending = pendingEditResendRef.current;
    if (!pending) return;
    if (conversationState !== pending.expectedState) return;
    pendingEditResendRef.current = null;
    void sendActionRef.current({
      textOverride: pending.text,
      uploadedFilesOverride: pending.uploadedFiles,
      editResendBaseMessageRef: pending.baseMessageRef,
      afterInitialHistoryPersist: pending.afterInitialHistoryPersist,
    });
  }, [conversationState, sendActionRef]);

  return { handleResendFromEdit };
}
