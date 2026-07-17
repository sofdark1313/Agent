import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  applyCronOps,
  type CronRunRecord,
  type CronTask,
  getAutomationState,
  initAutomation,
  listCronRuns,
  refreshAutomationSnapshot,
} from "../automation";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

type SelectedModelInput = {
  customProviderId: string;
  model: string;
};

type CronTaskAction = "create" | "read" | "update" | "delete" | "list_logs";

const MANAGE_CRON_TASK_PARAMETERS = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("read"),
      Type.Literal("update"),
      Type.Literal("delete"),
      Type.Literal("list_logs"),
    ],
    {
      description:
        "Action for Settings -> Cron. Use create to add a scheduled task, read to list tasks or inspect one task, update to edit an existing task by task_id, delete to remove a task by task_id, and list_logs to view recent execution logs for one task.",
    },
  ),
  task_id: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required for update, delete, and list_logs. Optional for read: omit it to list all cron tasks, or pass it to inspect one task before updating, deleting, or listing logs.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 500,
      description:
        "Maximum number of recent execution logs to return for action=list_logs. Defaults to 100 and is capped at 500.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Task name shown in Settings -> Cron. Required for create. Optional patch field for update.",
    }),
  ),
  description: Type.Optional(
    Type.String({
      description:
        "Optional operator-facing description. For update, omit this field to keep the current description.",
    }),
  ),
  cron: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Six-field cron expression in the format: second minute hour day month weekday. Required for create. Optional patch field for update when changing schedule.",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("bash"), Type.Literal("http"), Type.Literal("prompt")], {
      description:
        "Cron task implementation type. Required for create. Optional for update when switching the task kind.",
    }),
  ),
  enabled: Type.Optional(
    Type.Boolean({
      description:
        "Whether the cron task should be enabled. For create, omitted means true. For update, omit this field to keep the current enabled state.",
    }),
  ),
  remaining_executions: Type.Optional(
    Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
      description:
        "Remaining run count for this cron task. Omit or pass null for unlimited runs. Pass 0 only when the task should be exhausted and disabled.",
    }),
  ),
  script: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Shell script for type=bash. Required for create when type is bash. For update, pass this field only when you want to replace the stored script.",
    }),
  ),
  requests: Type.Optional(
    Type.Array(
      Type.Object({
        url: Type.String({
          minLength: 1,
          description: "Absolute HTTP URL for a scheduled request.",
        }),
        method: Type.Optional(
          Type.String({
            description: "HTTP method for the scheduled request. Defaults to POST when omitted.",
          }),
        ),
        headers: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description: "Optional HTTP headers for the scheduled request.",
          }),
        ),
        body: Type.Optional(
          Type.Any({
            description: "Optional JSON body for the scheduled request.",
          }),
        ),
      }),
      {
        description:
          "HTTP request list for type=http. Required for create when type is http. For update, pass this field only when you want to replace the stored request list.",
      },
    ),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Prompt content for type=prompt. Required for create when type is prompt. For update, pass this field only when you want to replace the stored prompt.",
    }),
  ),
});

function asErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseAction(value: unknown): CronTaskAction {
  const normalized = normalizeText(value);
  switch (normalized) {
    case "create":
    case "read":
    case "update":
    case "delete":
    case "list_logs":
      return normalized;
    default:
      throw new Error(
        `CronTaskManager action must be one of: create, read, update, delete, list_logs. Received: ${JSON.stringify(value)}`,
      );
  }
}

function requireTaskId(args: Record<string, unknown>, action: CronTaskAction) {
  const taskId = normalizeText(args.task_id);
  if (!taskId) {
    throw new Error(`CronTaskManager action=${action} requires task_id.`);
  }
  return taskId;
}

/**
 * Shapes raw tool arguments into the fields understood by the Rust
 * automation store. Deep validation (cron grammar, URL syntax, per-kind
 * required fields) happens exactly once, in Rust — validation errors are
 * surfaced back to the model verbatim.
 */
function collectTaskFields(
  args: Record<string, unknown>,
  options: { requireCreateFields: boolean; currentChatModel?: SelectedModelInput },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of ["name", "description", "cron", "type", "enabled", "script", "prompt"]) {
    if (Object.hasOwn(args, key)) {
      fields[key] = args[key];
    }
  }
  if (Object.hasOwn(args, "remaining_executions")) {
    fields.remainingExecutions = args.remaining_executions;
  }
  if (Object.hasOwn(args, "requests") && Array.isArray(args.requests)) {
    fields.requests = (args.requests as unknown[]).map((entry) => {
      const request = asRecord(entry) ?? {};
      return {
        ...request,
        id: normalizeText(request.id) || crypto.randomUUID(),
      };
    });
  }

  if (options.requireCreateFields) {
    if (!Object.hasOwn(fields, "enabled")) {
      fields.enabled = true;
    }
    if (fields.type === "prompt") {
      // Prompt tasks always inherit the current runtime model.
      if (!options.currentChatModel) {
        throw new Error(
          "CronTaskManager cannot create a prompt task without an active chat model.",
        );
      }
      fields.selectedModel = options.currentChatModel;
    }
  }
  return fields;
}

function formatTaskLine(task: CronTask, index?: number) {
  const prefix = index == null ? "" : `${index + 1}. `;
  const remaining = task.remainingExecutions ?? "unlimited";
  const error = task.lastError ? ` | last_error=${JSON.stringify(task.lastError)}` : "";
  return `${prefix}task_id=${task.id} | name=${JSON.stringify(task.name)} | type=${task.type} | cron=${task.cron} | enabled=${task.enabled ? "true" : "false"} | remaining_executions=${remaining}${error}`;
}

function formatTaskDetails(task: CronTask) {
  const lines = [formatTaskLine(task)];
  if (task.description) lines.push(`description=${JSON.stringify(task.description)}`);
  if (task.script) lines.push(`script:\n${task.script}`);
  if (task.prompt) lines.push(`prompt:\n${task.prompt}`);
  if (task.requests) {
    lines.push(
      `requests: ${task.requests.map((request) => `${request.method} ${request.url}`).join(", ")}`,
    );
  }
  if (task.selectedModel) {
    lines.push(`selected_model=${task.selectedModel.customProviderId}/${task.selectedModel.model}`);
  }
  return lines.join("\n");
}

function formatRunLine(run: CronRunRecord, index: number) {
  const startedAt = new Date(run.startedAt).toISOString();
  const status = run.state === "expired" ? "expired" : run.success ? "success" : "failed";
  const output = run.output.length > 600 ? `${run.output.slice(0, 600)}...[truncated]` : run.output;
  return `${index + 1}. [${status}] started_at=${startedAt} duration_ms=${run.durationMs}\n${output}`;
}

async function executeAction(
  args: Record<string, unknown>,
  currentChatModel?: SelectedModelInput,
): Promise<string> {
  const action = parseAction(args.action);
  await initAutomation();

  switch (action) {
    case "create": {
      const item = collectTaskFields(args, { requireCreateFields: true, currentChatModel });
      const snapshot = await applyCronOps([{ op: "create", item }]);
      const created = snapshot.tasks[snapshot.tasks.length - 1];
      return `Cron task created.\n${created ? formatTaskDetails(created) : ""}`.trim();
    }
    case "update": {
      const taskId = requireTaskId(args, action);
      const patch = collectTaskFields(args, { requireCreateFields: false });
      if (Object.keys(patch).length === 0) {
        throw new Error("CronTaskManager update requires at least one field to change.");
      }
      const snapshot = await applyCronOps([{ op: "update", id: taskId, patch }]);
      const updated = snapshot.tasks.find((task) => task.id === taskId);
      return `Cron task updated.\n${updated ? formatTaskDetails(updated) : ""}`.trim();
    }
    case "delete": {
      const taskId = requireTaskId(args, action);
      await applyCronOps([{ op: "delete", id: taskId }]);
      return `Cron task deleted: ${taskId}`;
    }
    case "list_logs": {
      const taskId = requireTaskId(args, action);
      const limit = typeof args.limit === "number" ? args.limit : 100;
      const runs = await listCronRuns(taskId, limit);
      if (runs.length === 0) {
        return `No execution logs recorded for task ${taskId}.`;
      }
      return [`Found ${runs.length} execution log(s) for task ${taskId}:`]
        .concat(runs.map((run, index) => formatRunLine(run, index)))
        .join("\n");
    }
    case "read": {
      await refreshAutomationSnapshot();
      const tasks = getAutomationState().cron.tasks;
      const taskId = normalizeText(args.task_id);
      if (taskId) {
        const task = tasks.find((item) => item.id === taskId);
        if (!task) {
          throw new Error(`Cron task not found: ${taskId}`);
        }
        return formatTaskDetails(task);
      }
      if (tasks.length === 0) {
        return "No cron tasks found.";
      }
      return [
        `Found ${tasks.length} cron task(s):`,
        ...tasks.map((task, index) => formatTaskLine(task, index)),
        "Use action=read with task_id to inspect one task before action=update, action=delete, or action=list_logs.",
      ].join("\n");
    }
  }
}

export function createCronTools(params: {
  currentChatModel?: SelectedModelInput;
}): BuiltinToolBundle {
  const toolCronTaskManager: Tool = {
    name: "CronTaskManager",
    description:
      "Manage persistent scheduled tasks in Settings -> Cron. This is the built-in tool for scheduled automation in LiveAgent and is always available. Use action=create to create a new recurring task, action=read to list tasks or inspect one task, action=update to edit an existing task by task_id, action=delete to remove an existing task by task_id, and action=list_logs with task_id to view recent execution logs. If the user asks to modify, remove, or inspect logs for an existing scheduled task and you do not know the task_id or current configuration, call action=read first. Scheduled jobs must be represented with this cron tool rather than only described in text or faked with one-off execution. Supports bash, http, and prompt task types. Use remaining_executions for a finite remaining run count; omit it or pass null for unlimited runs. For bash tasks, provide a non-empty script string, not a JSON argv array. For prompt task creation, the cron model always inherits the current runtime model.",
    parameters: MANAGE_CRON_TASK_PARAMETERS,
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    const now = Date.now();

    if (signal?.aborted) {
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "Cancelled" }],
        details: {},
        isError: true,
        timestamp: now,
      };
    }

    if (toolCall.name !== "CronTaskManager") {
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
        details: {},
        isError: true,
        timestamp: now,
      };
    }

    try {
      const text = await executeAction(
        (toolCall.arguments ?? {}) as Record<string, unknown>,
        params.currentChatModel,
      );
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {},
        isError: false,
        timestamp: now,
      };
    } catch (err) {
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `Cron task manager failed: ${asErrorMessage(err)}` }],
        details: {},
        isError: true,
        timestamp: now,
      };
    }
  }

  return {
    groupId: "system",
    tools: [toolCronTaskManager],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "CronTaskManager",
        {
          groupId: "system",
          kind: "system",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
