import { useMemo, useState } from "react";

import { ChevronRight, Terminal } from "@/components/icons";
import { useLocale } from "@/i18n";
import type { ToolTraceItem } from "@/lib/chat/uiMessages";
import { cn } from "@/lib/shared/utils";
import {
  getDominantToolName,
  getToolGroupComposition,
  getToolGroupCounts,
  getToolMeta,
  getToolTraceKey,
} from "./assistantBubbleUtils";
import { MemoToolCallItem } from "./ToolCallItem";

export function ToolTraceGroup(props: { items: ToolTraceItem[]; runningToolCallIds?: string[] }) {
  const { items, runningToolCallIds = [] } = props;
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const counts = useMemo(
    () => getToolGroupCounts(items, runningToolCallIds),
    [items, runningToolCallIds],
  );
  const composition = useMemo(() => getToolGroupComposition(items), [items]);
  const dominantToolName = useMemo(() => getDominantToolName(items), [items]);
  const allBash = useMemo(() => items.every((item) => item.toolCall.name === "Bash"), [items]);
  const meta = useMemo(
    () => (allBash ? getToolMeta("Bash") : getToolMeta(dominantToolName)),
    [allBash, dominantToolName],
  );
  const ToolIcon = allBash ? Terminal : meta.Icon;
  const titleKey = allBash
    ? items.length === 1
      ? "chat.tool.ranCommand"
      : "chat.tool.ranCommands"
    : items.length === 1
      ? "chat.tool.usedTool"
      : "chat.tool.usedTools";
  const title = t(titleKey).replace("{count}", String(items.length));
  const activityStatus =
    counts.failed > 0
      ? `${counts.failed} ${t("chat.tool.failed")}`
      : counts.running > 0
        ? t("chat.tool.running")
        : counts.waiting > 0
          ? t("chat.tool.waiting")
          : null;
  const statusClass =
    counts.failed > 0
      ? "text-[hsl(var(--chat-error))]"
      : counts.running > 0
        ? "text-[hsl(var(--chat-running))]"
        : "text-muted-foreground/65";

  return (
    <div data-agent-tool-activity className="tool-trace-group min-w-0 text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t("chat.tool.collapseActivity") : t("chat.tool.expandActivity")}
        className="group/activity flex min-h-7 w-full cursor-pointer select-none items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <ToolIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/75" />
        <span className="shrink-0 text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground/78">
          {title}
        </span>
        {composition ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground/50">
            {composition}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {activityStatus ? (
          <span
            className={cn(
              "shrink-0 text-[calc(10.5px*var(--zone-font-scale,1))] font-medium",
              statusClass,
            )}
          >
            {activityStatus}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/45 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="tool-trace-group-body ml-2.5 mt-1 space-y-1 border-l border-border/55 pl-3">
          {items.map((item, index) => (
            <MemoToolCallItem
              key={getToolTraceKey(item, index)}
              item={item}
              variant="grouped"
              isRunning={Boolean(item.toolCall.id && runningToolCallIds.includes(item.toolCall.id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
