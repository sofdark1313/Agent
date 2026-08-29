import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "../../../components/icons";
import { Markdown } from "../../../components/Markdown";
import { useLocale } from "../../../i18n";
import { normalizeLiveToolStatus, VIBING_STATUS } from "../../../lib/chat/chatPageHelpers";
import type { UiRound } from "../../../lib/chat/uiMessages";
import { useScrollFollow } from "../../../lib/chat-scroll/useScrollFollow";
import { TodoListBlock } from "../TodoListView";
import {
  groupRoundBlocks,
  isBuiltinShareToolName,
  normalizeAssistantLeadingIndent,
} from "./assistantBubbleUtils";
import { HostedSearchGroupView } from "./HostedSearchGroupView";
import { CompactingText, VibingText } from "./StatusText";
import { MemoToolCallItem } from "./ToolCallItem";
import { getNativeDisplayImagePayload, NativeDisplayImageBlock } from "./ToolImages";
import { ToolTraceGroup } from "./ToolTraceGroup";
import { UsagePanel } from "./UsagePanel";

const EMPTY_RUNNING_TOOL_CALL_IDS: string[] = [];

function ThinkingBlock({ text, open }: { text: string; open?: boolean }) {
  const hasText = /\S/.test(text || "");
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(typeof open === "boolean" ? open : false);
  const userInteractedRef = useRef(false);
  const [thinkingPre, setThinkingPre] = useState<HTMLPreElement | null>(null);
  const [thinkingContent, setThinkingContent] = useState<HTMLElement | null>(null);

  // Same engine as the transcript viewport, minus the reattach zone (there is
  // no reserve band inside the <pre>). The ResizeObserver target must be the
  // inner content element: once max-h-64 clamps the <pre>, its border box
  // stops resizing while scrollHeight keeps growing.
  useScrollFollow({
    viewport: thinkingPre,
    content: thinkingContent,
    enabled: isOpen && hasText,
    config: { reattachZonePx: 0 },
  });

  useEffect(() => {
    if (!userInteractedRef.current && typeof open === "boolean") {
      setIsOpen(open);
    }
  }, [open]);

  if (!hasText) return null;

  return (
    <div data-agent-thinking-block className="group/think text-muted-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          userInteractedRef.current = true;
          setIsOpen((prev) => !prev);
        }}
        className="thinking-block-toggle -ml-1 flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1 py-1.5 text-[calc(13px*var(--zone-font-scale,1))] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        <span className="thinking-block-label font-medium">{t("chat.thinkingProcess")}</span>
      </button>
      {isOpen ? (
        <div className="ml-0.5 border-l border-border/55 pb-1 pl-3 pt-1">
          <pre
            ref={setThinkingPre}
            className="thinking-block-pre max-h-64 overflow-auto whitespace-pre-wrap bg-transparent p-0 text-[calc(12.5px*var(--zone-font-scale,1))] leading-[1.6] text-muted-foreground"
          >
            <code ref={setThinkingContent} className="block font-[inherit]">
              {text}
            </code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export const RoundContent = memo(function RoundContent(props: {
  round: UiRound;
  showLabel: boolean;
  showUsage?: boolean;
  usageContextWindow?: number;
  isLive?: boolean;
  isStreaming?: boolean;
  isActive?: boolean;
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
  renderMode?: "streaming" | "static";
  readOnly?: boolean;
  redactToolContent?: boolean;
}) {
  const {
    round,
    showLabel,
    showUsage,
    usageContextWindow,
    isLive,
    isStreaming = isLive,
    isActive,
    toolStatus,
    toolStatusVariant,
    runningToolCallIds,
    thinkingOpen,
    renderMode,
    readOnly = false,
    redactToolContent = false,
  } = props;
  const groupedBlocks = useMemo(() => groupRoundBlocks(round.blocks), [round.blocks]);
  const hasContent =
    groupedBlocks.some((block) => {
      if (
        block.kind === "tool" ||
        block.kind === "toolGroup" ||
        block.kind === "hostedSearch" ||
        block.kind === "hostedSearchGroup"
      ) {
        return true;
      }
      return block.text.trim().length > 0;
    }) ||
    (isActive && isLive);
  const normalizedToolStatus =
    isActive && isLive ? normalizeLiveToolStatus(toolStatus ?? null) : null;
  const isCompactionStatus = toolStatusVariant === "compaction";
  const isVibingStatus = normalizedToolStatus === VIBING_STATUS;
  const latestThinkingKey = useMemo(() => {
    for (let index = groupedBlocks.length - 1; index >= 0; index -= 1) {
      const block = groupedBlocks[index];
      if (block?.kind === "thinking") return block.key;
    }
    return null;
  }, [groupedBlocks]);
  const autoOpenThinking = isLive ? Boolean(isActive && thinkingOpen) : false;

  if (!hasContent) return null;

  return (
    <div className="space-y-2.5">
      {showLabel ? <div className="h-px bg-border/40" /> : null}

      {isActive && isLive && normalizedToolStatus ? (
        <div className="flex items-center gap-2 py-1 text-[calc(13px*var(--zone-font-scale,1))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          {isCompactionStatus ? (
            <CompactingText className="font-medium text-muted-foreground" />
          ) : isVibingStatus ? (
            <VibingText className="font-medium text-muted-foreground" />
          ) : (
            <span className="font-medium text-muted-foreground">{normalizedToolStatus}</span>
          )}
        </div>
      ) : null}

      {groupedBlocks.map((block) => {
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              key={block.key}
              text={block.text}
              open={autoOpenThinking && block.key === latestThinkingKey}
            />
          );
        }

        if (block.kind === "tool") {
          const isRedactedToolContent =
            redactToolContent && isBuiltinShareToolName(block.item.toolCall.name);
          const displayImagePayload = getNativeDisplayImagePayload(block.item);
          if (!isRedactedToolContent && displayImagePayload) {
            return (
              <NativeDisplayImageBlock
                key={block.key}
                payload={displayImagePayload}
                readOnly={readOnly}
              />
            );
          }

          if (
            !isRedactedToolContent &&
            block.item.toolCall.name === "Image" &&
            !block.item.toolResult?.isError
          ) {
            return null;
          }

          // TodoWrite renders as a bare checklist in the reply flow; only
          // failed calls fall through to the tool card so the error is visible.
          if (
            !isRedactedToolContent &&
            block.item.toolCall.name === "TodoWrite" &&
            !block.item.toolResult?.isError
          ) {
            return <TodoListBlock key={block.key} item={block.item} />;
          }

          return (
            <MemoToolCallItem
              key={block.key}
              item={block.item}
              isRunning={Boolean(
                isLive &&
                  block.item.toolCall.id &&
                  (runningToolCallIds || []).includes(block.item.toolCall.id),
              )}
              readOnly={readOnly}
              redactToolContent={redactToolContent}
            />
          );
        }

        if (block.kind === "toolGroup") {
          return (
            <ToolTraceGroup
              key={block.key}
              items={block.items}
              runningToolCallIds={
                isLive
                  ? (runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS)
                  : EMPTY_RUNNING_TOOL_CALL_IDS
              }
              readOnly={readOnly}
              redactToolContent={redactToolContent}
            />
          );
        }

        if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") {
          return (
            <HostedSearchGroupView
              key={block.key}
              items={block.kind === "hostedSearch" ? [block.item] : block.items}
              readOnly={readOnly}
            />
          );
        }

        if (!block.text.trim()) return null;

        return (
          <Markdown
            key={block.key}
            content={normalizeAssistantLeadingIndent(block.text)}
            className="agent-answer-markdown"
            renderMode={renderMode}
            showCaret={Boolean(isLive && isActive && isStreaming)}
            readOnly={readOnly}
          />
        );
      })}

      {showUsage ? (
        <UsagePanel usage={round.meta?.usage} contextWindow={usageContextWindow} />
      ) : null}
    </div>
  );
});
