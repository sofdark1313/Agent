import { CheckCircle2, Circle, ListChecks, Loader2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import type { ToolTraceItem } from "../../lib/chat/uiMessages";
import type { TodoItem, TodoWriteResultDetails } from "../../lib/tools/builtinTypes";
import { getBuiltinResultKind } from "./assistant-bubble/assistantBubbleUtils";

/**
 * Defensive shape filter for rendering todos straight from streaming tool-call
 * arguments: partially parsed items (missing fields, wrong types) are dropped
 * instead of crashing the checklist.
 */
export function sanitizeTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TodoItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.content === "string" &&
      (candidate.status === "pending" ||
        candidate.status === "in_progress" ||
        candidate.status === "completed") &&
      typeof candidate.activeForm === "string"
    );
  });
}

function TodoRow(props: { todo: TodoItem }) {
  const { todo } = props;
  const label = todo.status === "in_progress" ? todo.activeForm : todo.content;

  return (
    <li className="flex items-start gap-2 px-3 py-1.5 text-[13px] leading-5">
      <span className="mt-0.5 shrink-0">
        {todo.status === "completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--chat-success))]" />
        ) : todo.status === "in_progress" ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            style={{ color: "hsl(var(--tool-list-accent))" }}
          />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </span>
      <span
        className={
          todo.status === "completed"
            ? "text-muted-foreground line-through"
            : todo.status === "in_progress"
              ? "font-medium text-foreground"
              : "text-foreground/80"
        }
      >
        {label}
      </span>
    </li>
  );
}

export function TodoListView(props: { todos: TodoItem[] }) {
  const { todos } = props;
  const { t } = useLocale();

  if (!Array.isArray(todos) || todos.length === 0) {
    return (
      <div className="tool-text-scroll rounded-[10px] border border-black/[0.06] bg-white/[0.58] px-3 py-2 text-[13px] text-muted-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none">
        {t("chat.tool.todoEmpty")}
      </div>
    );
  }

  return (
    <ul className="todo-list-view tool-text-scroll divide-y divide-black/[0.06] overflow-y-hidden rounded-[10px] border border-black/[0.06] bg-white/[0.58] shadow-sm dark:divide-white/[0.06] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none">
      {todos.map((todo, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: todos are a full-replace snapshot with no stable id
        <TodoRow key={index} todo={todo} />
      ))}
    </ul>
  );
}

/**
 * Standalone checklist block rendered directly in the reply flow (no tool
 * card). Reads the settled result when available and falls back to the
 * streaming tool-call arguments so the list appears live while the model is
 * still writing it. Error results keep the regular tool card instead (see
 * RoundContent), so this only renders the happy path.
 */
export function TodoListBlock({ item }: { item: ToolTraceItem }) {
  const { t } = useLocale();
  const result = item.toolResult;
  const resultDetails =
    result && !result.isError && getBuiltinResultKind(result) === "todo_write"
      ? (result.details as TodoWriteResultDetails)
      : null;
  const todos = resultDetails
    ? resultDetails.todos
    : sanitizeTodoItems(item.toolCall.arguments?.todos);

  // While arguments are still streaming in, wait for the first complete item
  // instead of flashing an empty frame.
  if (!resultDetails && todos.length === 0) return null;

  return (
    <div className="tool-card-enter overflow-hidden rounded-[12px] border border-black/[0.06] bg-white/[0.72] shadow-[0_0_0_0.5px_rgba(0,0,0,0.03),0_1px_2px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.02)] backdrop-blur-xl backdrop-saturate-[1.8] dark:border-white/[0.1] dark:bg-white/[0.06] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.2),0_3px_8px_rgba(0,0,0,0.12)] dark:backdrop-saturate-[1.4]">
      <div className="flex items-center gap-2 border-b border-black/[0.04] px-2.5 py-[7px] dark:border-white/[0.05]">
        <div
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--tool-list-accent) / 0.13), hsl(var(--tool-list-accent) / 0.06))",
          }}
        >
          <ListChecks className="h-3 w-3" style={{ color: "hsl(var(--tool-list-accent))" }} />
        </div>
        <span className="font-sans text-[calc(12.5px*var(--zone-font-scale,1))] font-semibold tracking-[-0.01em] text-foreground/90">
          {t("chat.tool.todoTitle")}
        </span>
      </div>
      {todos.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-muted-foreground">
          {t("chat.tool.todoEmpty")}
        </div>
      ) : (
        <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {todos.map((todo, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: todos are a full-replace snapshot with no stable id
            <TodoRow key={index} todo={todo} />
          ))}
        </ul>
      )}
    </div>
  );
}
