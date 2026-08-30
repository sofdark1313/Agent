import type { TranscriptRow } from "@/lib/chat/transcript/types";
import type { UiRound } from "@/lib/chat/uiMessages";
import type { TodoItem, TodoWriteResultDetails } from "@/lib/tools/builtinTypes";

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

function applyTodoWrites(rounds: readonly UiRound[], current: TodoItem[] | null) {
  let latest = current;

  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool" || block.item.toolCall.name !== "TodoWrite") continue;

      const result = block.item.toolResult;
      if (result) {
        if (result.isError || !result.details || typeof result.details !== "object") continue;
        const details = result.details as Partial<TodoWriteResultDetails>;
        if (details.kind !== "todo_write" || !Array.isArray(details.todos)) continue;
        latest = sanitizeTodoItems(details.todos);
        continue;
      }

      const streamingTodos = sanitizeTodoItems(block.item.toolCall.arguments?.todos);
      if (streamingTodos.length > 0) {
        latest = streamingTodos;
      }
    }
  }

  return latest;
}

export function findLatestConversationTodosFromTranscriptRows(
  rows: readonly TranscriptRow[],
): TodoItem[] | null {
  let latest: TodoItem[] | null = null;

  for (const item of rows) {
    if (item.kind !== "assistant") continue;
    latest = applyTodoWrites(item.rounds, latest);
  }

  return latest;
}
