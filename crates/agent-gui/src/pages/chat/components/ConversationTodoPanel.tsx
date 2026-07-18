import { useMemo, useState, useSyncExternalStore } from "react";

import { ChevronDown, ListChecks } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { cn } from "../../../lib/shared/utils";
import { TodoListView } from "./assistant-bubble/TodoListView";
import { findLatestConversationTodos } from "./conversationTodoState";

export function ConversationTodoPanel(props: {
  historyItems: readonly RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
}) {
  const { historyItems, liveTranscriptStore } = props;
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const liveTranscript = useSyncExternalStore(
    liveTranscriptStore.subscribe,
    liveTranscriptStore.getSnapshot,
    liveTranscriptStore.getSnapshot,
  );
  const todos = useMemo(
    () => findLatestConversationTodos(historyItems, liveTranscript.liveRounds),
    [historyItems, liveTranscript.liveRounds],
  );

  if (!todos || todos.length === 0) return null;

  const completedCount = todos.filter((todo) => todo.status === "completed").length;
  const summaryTodo =
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    todos.at(-1);
  const summary =
    summaryTodo?.status === "in_progress" ? summaryTodo.activeForm : summaryTodo?.content;

  return (
    <div
      data-agent-conversation-todos
      className="mx-auto mb-2 w-[calc(100%-1.5rem)] max-w-[720px] overflow-hidden rounded-xl border border-black/[0.055] bg-white/88 shadow-[0_8px_28px_-22px_rgba(15,23,42,0.38),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-2xl backdrop-saturate-[160%] dark:border-white/[0.1] dark:bg-zinc-900/88 dark:shadow-[0_8px_28px_-22px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.04]"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[calc(12px*var(--zone-font-scale,1))] font-medium text-foreground/90">
          {t("chat.tool.todoTitle")}
        </span>
        <span className="shrink-0 rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[calc(10px*var(--zone-font-scale,1))] font-medium leading-none tabular-nums text-muted-foreground dark:bg-white/[0.07]">
          {completedCount}/{todos.length}
        </span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div className="border-t border-black/[0.05] bg-black/[0.012] p-1.5 dark:border-white/[0.07] dark:bg-white/[0.018]">
          <TodoListView todos={todos} />
        </div>
      ) : null}
    </div>
  );
}
