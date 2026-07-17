import { CheckCircle2, Circle, Loader2 } from "../../../../components/icons";
import { useLocale } from "../../../../i18n";
import type { TodoItem } from "../../../../lib/tools/builtinTypes";

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
