import { memo, useMemo, useState } from "react";

import { ChevronRight, Loader2 } from "../../../../components/icons";
import { Markdown } from "../../../../components/Markdown";
import { useLocale } from "../../../../i18n";
import type { UiRound } from "../../../../lib/chat/messages/uiMessages";
import { normalizeLiveToolStatus, VIBING_STATUS } from "../../../../lib/chat/page/chatPageHelpers";
import { useScrollFollow } from "../../../../lib/chat-scroll/useScrollFollow";
import { groupRoundBlocks } from "./assistantBubbleUtils";
import { HostedSearchGroupView } from "./HostedSearchGroupView";
import { CompactingText, VibingText } from "./StatusText";
import { TodoListBlock } from "./TodoListView";
import { MemoToolCallItem } from "./ToolCallItem";
import { getNativeDisplayImagePayload, NativeDisplayImageBlock } from "./ToolImages";
import { ToolTraceGroup } from "./ToolTraceGroup";
import { UsagePanel } from "./UsagePanel";

function ThinkingBlock({ text }: { text: string }) {
  const hasText = /\S/.test(text || "");
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
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

  if (!hasText) return null;

  return (
    <div data-agent-thinking-block className="group/think text-muted-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
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
  isActive?: boolean;
  // Pinned per row (see AssistantBubble); falls back to the live flag for
  // callers that render outside the transcript row model.
  renderMode?: "streaming" | "static";
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  runningToolCallIds?: string[];
}) {
  const {
    round,
    showLabel,
    showUsage,
    usageContextWindow,
    isLive,
    isActive,
    renderMode,
    toolStatus,
    toolStatusVariant,
    runningToolCallIds,
  } = props;
  const hasContent =
    round.blocks.some((block) => {
      if (block.kind === "tool" || block.kind === "hostedSearch") return true;
      return block.text.trim().length > 0;
    }) ||
    (isActive && isLive);
  const normalizedToolStatus =
    isActive && isLive ? normalizeLiveToolStatus(toolStatus ?? null) : null;
  const isCompactionStatus = toolStatusVariant === "compaction";
  const isVibingStatus = normalizedToolStatus === VIBING_STATUS;
  const groupedBlocks = useMemo(() => groupRoundBlocks(round.blocks), [round.blocks]);

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
          return <ThinkingBlock key={block.key} text={block.text} />;
        }

        if (block.kind === "tool") {
          const displayImagePayload = getNativeDisplayImagePayload(block.item);
          if (displayImagePayload) {
            return <NativeDisplayImageBlock key={block.key} payload={displayImagePayload} />;
          }

          if (block.item.toolCall.name === "Image" && !block.item.toolResult?.isError) {
            return null;
          }

          // TodoWrite renders as a bare checklist in the reply flow; only
          // failed calls fall through to the tool card so the error is visible.
          if (block.item.toolCall.name === "TodoWrite" && !block.item.toolResult?.isError) {
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
            />
          );
        }

        if (block.kind === "toolGroup") {
          return (
            <ToolTraceGroup
              key={block.key}
              items={block.items}
              runningToolCallIds={isLive ? (runningToolCallIds ?? []) : []}
            />
          );
        }

        if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") {
          return (
            <HostedSearchGroupView
              key={block.key}
              items={block.kind === "hostedSearch" ? [block.item] : block.items}
            />
          );
        }

        if (!block.text.trim()) return null;

        return (
          <Markdown
            key={block.key}
            content={block.text}
            className="agent-answer-markdown"
            renderMode={renderMode ?? (isLive ? "streaming" : "static")}
            showCaret={Boolean(isLive && isActive)}
          />
        );
      })}

      {showUsage ? (
        <UsagePanel usage={round.meta?.usage} contextWindow={usageContextWindow} />
      ) : null}
    </div>
  );
});
