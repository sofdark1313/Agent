import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { Type } from "typebox";

import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import type { SystemToolRuntimeScope } from "./systemToolOptions";

type SystemHttpGetResponse = {
  url: string;
  status: number;
  ok: boolean;
  body: string;
  content_type?: string | null;
};

type SystemToolDefinition = {
  id: string;
  label: string;
  name: string;
  description: string;
  parameters: Tool["parameters"];
  isReadOnly: boolean;
  runtimeScopes: readonly SystemToolRuntimeScope[];
  execute: (toolCall: ToolCall, signal?: AbortSignal) => Promise<ToolResultMessage>;
};

function asErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function executeHttpGetTest(
  toolCall: ToolCall,
  _signal?: AbortSignal,
): Promise<ToolResultMessage> {
  const now = Date.now();

  try {
    const result = await invoke<SystemHttpGetResponse>("system_http_get_test");
    const text = [
      `GET ${result.url}`,
      `status: ${result.status}`,
      result.content_type ? `content-type: ${result.content_type}` : "",
      "",
      result.body || "(empty body)",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text }],
      details: result,
      isError: !result.ok,
      timestamp: now,
    };
  } catch (err) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: `Test endpoint request failed: ${asErrorMessage(err)}` }],
      details: {},
      isError: true,
      timestamp: now,
    };
  }
}

const SELECTABLE_SYSTEM_TOOL_DEFINITIONS = [
  {
    id: "http_get_test",
    label: "本地 HTTP Test",
    name: "HttpGetTest",
    description: "Call the network test endpoint and return the response body.",
    parameters: Type.Object({}),
    isReadOnly: true,
    runtimeScopes: ["chat", "cron_auto_prompt"],
    execute: executeHttpGetTest,
  },
] as const satisfies readonly SystemToolDefinition[];

export type CustomSystemToolId = (typeof SELECTABLE_SYSTEM_TOOL_DEFINITIONS)[number]["id"];

export const CUSTOM_SYSTEM_TOOL_OPTIONS: Array<{
  id: CustomSystemToolId;
  label: string;
  description: string;
}> = SELECTABLE_SYSTEM_TOOL_DEFINITIONS.map(({ id, label, description }) => ({
  id,
  label,
  description,
}));

function supportsRuntimeScope(
  definition: SystemToolDefinition,
  runtimeScope: SystemToolRuntimeScope,
) {
  return definition.runtimeScopes.includes(runtimeScope);
}

export function createCustomSystemTools(params: {
  selectedToolIds: readonly string[];
  runtimeScope: SystemToolRuntimeScope;
  currentChatModel?: {
    customProviderId: string;
    model: string;
  };
}): BuiltinToolBundle {
  const selected = new Set(params.selectedToolIds);
  const activeDefinitions = SELECTABLE_SYSTEM_TOOL_DEFINITIONS.filter(
    (definition) =>
      selected.has(definition.id) && supportsRuntimeScope(definition, params.runtimeScope),
  );
  const activeDefinitionByName = new Map<string, SystemToolDefinition>(
    activeDefinitions.map((definition) => [definition.name, definition]),
  );
  const tools: Tool[] = activeDefinitions.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

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

    const toolDefinition = activeDefinitionByName.get(toolCall.name);
    if (toolDefinition) {
      return toolDefinition.execute(toolCall, signal);
    }

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

  return {
    groupId: "system",
    tools,
    executeToolCall,
    metadataByName: createBuiltinMetadataMap(
      activeDefinitions.map(({ name, isReadOnly }) => [
        name,
        {
          groupId: "system" as const,
          kind: "system",
          isReadOnly,
          displayCategory: "system" as const,
        },
      ]),
    ),
  };
}
