import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Terminal } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { ToolTraceItem } from "../../../lib/chat/uiMessages";
import { cn } from "../../../lib/shared/utils";
import { getToolDisplayName, getToolMeta, getToolTraceKey } from "./assistantBubbleUtils";
import { MemoToolCallItem } from "./ToolCallItem";

function getToolGroupCounts(items: ToolTraceItem[], runningToolCallIds: string[]) {
  const runningIds = new Set(runningToolCallIds);
  let running = 0;
  let failed = 0;
  let completed = 0;
  let waiting = 0;

  for (const item of items) {
    if (item.toolCall.id && runningIds.has(item.toolCall.id)) {
      running += 1;
      continue;
    }
    if (!item.toolResult) {
      waiting += 1;
      continue;
    }
    if (item.toolResult.isError) {
      failed += 1;
      continue;
    }
    completed += 1;
  }

  return { running, failed, completed, waiting };
}

function getToolGroupComposition(items: ToolTraceItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = getToolDisplayName(item.toolCall.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
}

function getDominantToolName(items: ToolTraceItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.toolCall.name, (counts.get(item.toolCall.name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Tool";
}

export function ToolTraceGroup(props: {
  items: ToolTraceItem[];
  runningToolCallIds?: string[];
  readOnly?: boolean;
  redactToolContent?: boolean;
}) {
  const { items, runningToolCallIds = [], readOnly = false, redactToolContent = false } = props;
  const { t } = useLocale();
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
  const shouldAutoOpen = counts.failed > 0 || (counts.running > 0 && items.length <= 3);
  // Auto-collapse is state-driven, not remount-driven: the live article keeps
  // its instance mounted after the run settles (folding only happens at the
  // next run_started), so the group must fold itself once every call has a
  // non-error result. Failed groups stay open (mirroring auto-open);
  // `waiting` keeps groups whose results never landed (e.g. aborted runs)
  // untouched.
  const shouldAutoClose = counts.running === 0 && counts.waiting === 0 && counts.failed === 0;
  const [open, setOpen] = useState(readOnly ? false : shouldAutoOpen);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (readOnly || userInteractedRef.current) return;
    if (shouldAutoOpen) {
      setOpen(true);
    } else if (shouldAutoClose) {
      setOpen(false);
    }
  }, [readOnly, shouldAutoOpen, shouldAutoClose]);

  const statusLabel =
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
  const titleKey = allBash
    ? items.length === 1
      ? "chat.tool.ranCommand"
      : "chat.tool.ranCommands"
    : items.length === 1
      ? "chat.tool.usedTool"
      : "chat.tool.usedTools";
  const title = t(titleKey).replace("{count}", String(items.length));

  return (
    <div data-agent-tool-activity className="tool-trace-group min-w-0 text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t("chat.tool.collapseActivity") : t("chat.tool.expandActivity")}
        className="group/activity flex min-h-7 w-full cursor-pointer select-none items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => {
          userInteractedRef.current = true;
          setOpen((prev) => !prev);
        }}
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
        {statusLabel ? (
          <span
            className={cn("shrink-0 text-[calc(10.5px*var(--zone-font-scale,1))] font-medium", statusClass)}
          >
            {statusLabel}
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
              readOnly={readOnly}
              redactToolContent={redactToolContent}
              isRunning={Boolean(item.toolCall.id && runningToolCallIds.includes(item.toolCall.id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
