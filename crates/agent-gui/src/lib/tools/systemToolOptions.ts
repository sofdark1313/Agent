import { CUSTOM_SYSTEM_TOOL_OPTIONS, type CustomSystemToolId } from "./customSystemTools";

export type SystemToolRuntimeScope = "chat" | "cron_auto_prompt";
export type BuiltinSelectableSystemToolId = never;
export type SystemToolId = CustomSystemToolId | BuiltinSelectableSystemToolId;

export type SystemToolOption = {
  id: SystemToolId;
  label: string;
  description: string;
  kind: "builtin" | "custom";
  runtimeScopes: readonly SystemToolRuntimeScope[];
};

export const BUILTIN_SYSTEM_TOOL_OPTIONS: SystemToolOption[] = [];

export const SYSTEM_TOOL_OPTIONS: SystemToolOption[] = [
  ...BUILTIN_SYSTEM_TOOL_OPTIONS,
  ...CUSTOM_SYSTEM_TOOL_OPTIONS.map((tool) => ({
    ...tool,
    kind: "custom" as const,
    runtimeScopes: ["chat", "cron_auto_prompt"] as const,
  })),
];
