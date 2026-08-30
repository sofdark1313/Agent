import type { ToolCall } from "@earendil-works/pi-ai";
import type { BuiltinToolMetadata } from "./builtinTypes";

export type ApprovalPolicy = "ask" | "agent" | "full" | "custom";

export type ToolApprovalCategory =
  | "read"
  | "write"
  | "command"
  | "network"
  | "mcp"
  | "system"
  | "internal";

export type CustomApprovalRules = {
  allowWorkspaceWrites: boolean;
  allowCommands: boolean;
  allowNetwork: boolean;
  allowMcp: boolean;
  allowOutsideWorkspace: boolean;
};

export const DEFAULT_CUSTOM_APPROVAL_RULES: CustomApprovalRules = {
  allowWorkspaceWrites: false,
  allowCommands: false,
  allowNetwork: false,
  allowMcp: false,
  allowOutsideWorkspace: false,
};

export type ToolApprovalAssessment = {
  category: ToolApprovalCategory;
  destructive: boolean;
  outsideWorkspace: boolean;
  pathCandidates: string[];
  summary: string;
};

export type ToolApprovalRequirement = "auto" | "ask";

export type ToolApprovalRequestInput = {
  sessionId: string;
  toolCall: ToolCall;
  assessment: ToolApprovalAssessment;
  signal?: AbortSignal;
};

export type ToolApprovalRequester = (input: ToolApprovalRequestInput) => Promise<void>;

const INTERNAL_TOOL_NAMES = new Set(["Agent", "SendMessage", "TodoWrite", "ReadTerminal"]);

const PATH_ARGUMENT_KEYS = ["path", "cwd", "root", "directory", "file_path"] as const;
const PATH_ARRAY_ARGUMENT_KEYS = ["paths"] as const;

function stringArgument(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectPathCandidates(toolCall: ToolCall) {
  const args =
    toolCall.arguments &&
    typeof toolCall.arguments === "object" &&
    !Array.isArray(toolCall.arguments)
      ? (toolCall.arguments as Record<string, unknown>)
      : {};
  const candidates: string[] = [];
  for (const key of PATH_ARGUMENT_KEYS) {
    const value = stringArgument(args, key);
    if (value) candidates.push(value);
  }
  for (const key of PATH_ARRAY_ARGUMENT_KEYS) {
    const value = args[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) candidates.push(item.trim());
    }
  }
  return candidates;
}

function normalizeComparablePath(input: string) {
  let value = input.trim().replace(/^file:\/\/(?:localhost)?/i, "");
  value = value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  const isWindows = /^[a-z]:\//i.test(value);
  const prefix = isWindows ? value.slice(0, 2).toLowerCase() : value.startsWith("/") ? "/" : "";
  const body = isWindows ? value.slice(2) : value;
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.pop();
      else segments.push("..");
      continue;
    }
    segments.push(isWindows ? segment.toLowerCase() : segment);
  }
  const joined = segments.join("/");
  return prefix === "/" ? `/${joined}` : `${prefix}${joined ? `/${joined}` : "/"}`;
}

function isAbsolutePath(value: string) {
  return /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(value.trim()) || /^file:\/\//i.test(value.trim());
}

export function isPathOutsideWorkspace(path: string, workdir: string) {
  const value = path.trim();
  if (!value || value.startsWith("skill://") || value.startsWith("workspace:")) return false;
  if (/^(?:https?:|data:)/i.test(value)) return false;
  if (!isAbsolutePath(value)) {
    const normalizedRelative = value.replace(/\\/g, "/");
    return normalizedRelative.split("/").some((segment) => segment === "..");
  }
  const root = normalizeComparablePath(workdir).replace(/\/$/, "");
  const target = normalizeComparablePath(value).replace(/\/$/, "");
  if (!root) return true;
  return target !== root && !target.startsWith(`${root}/`);
}

function resolveCategory(toolCall: ToolCall, metadata?: BuiltinToolMetadata): ToolApprovalCategory {
  const args =
    toolCall.arguments &&
    typeof toolCall.arguments === "object" &&
    !Array.isArray(toolCall.arguments)
      ? (toolCall.arguments as Record<string, unknown>)
      : {};
  const remoteSources = [args.url, args.urls, args.source, args.sources].flatMap((value) =>
    Array.isArray(value) ? value : [value],
  );
  if (INTERNAL_TOOL_NAMES.has(toolCall.name)) return "internal";
  if (toolCall.name === "Bash" || toolCall.name === "ManagedProcess") return "command";
  if (
    toolCall.name === "HttpGetTest" ||
    remoteSources.some((value) => typeof value === "string" && /^https?:\/\//i.test(value.trim()))
  ) {
    return "network";
  }
  if (metadata?.groupId === "mcp" || metadata?.displayCategory === "mcp") return "mcp";
  if (toolCall.name === "Write" || toolCall.name === "Edit" || toolCall.name === "Delete") {
    return "write";
  }
  if (metadata?.isReadOnly) return "read";
  if (metadata?.displayCategory === "terminal") return "command";
  if (metadata?.displayCategory === "file") return "write";
  return "system";
}

function buildSummary(toolCall: ToolCall, category: ToolApprovalCategory, paths: string[]) {
  const args =
    toolCall.arguments &&
    typeof toolCall.arguments === "object" &&
    !Array.isArray(toolCall.arguments)
      ? (toolCall.arguments as Record<string, unknown>)
      : {};
  if (category === "command") {
    const command = stringArgument(args, "command");
    return command ? `${toolCall.name}: ${command}` : toolCall.name;
  }
  if (category === "network") {
    const url = stringArgument(args, "url");
    return url ? `${toolCall.name}: ${url}` : toolCall.name;
  }
  return paths[0] ? `${toolCall.name}: ${paths[0]}` : toolCall.name;
}

export function assessToolCall(input: {
  toolCall: ToolCall;
  metadata?: BuiltinToolMetadata;
  workdir: string;
}): ToolApprovalAssessment {
  const category = resolveCategory(input.toolCall, input.metadata);
  const pathCandidates = collectPathCandidates(input.toolCall);
  return {
    category,
    destructive: input.toolCall.name === "Delete",
    outsideWorkspace: pathCandidates.some((path) => isPathOutsideWorkspace(path, input.workdir)),
    pathCandidates,
    summary: buildSummary(input.toolCall, category, pathCandidates),
  };
}

export function getToolApprovalRequirement(
  policy: ApprovalPolicy,
  assessment: ToolApprovalAssessment,
  customRules: CustomApprovalRules = DEFAULT_CUSTOM_APPROVAL_RULES,
): ToolApprovalRequirement {
  if (policy === "full" || assessment.category === "internal") return "auto";
  if (assessment.outsideWorkspace) {
    if (policy !== "custom" || !customRules.allowOutsideWorkspace) return "ask";
  }
  if (assessment.category === "read") return "auto";
  if (policy === "ask") return "ask";
  if (policy === "agent") {
    return assessment.category === "write" && !assessment.destructive ? "auto" : "ask";
  }
  switch (assessment.category) {
    case "write":
      return customRules.allowWorkspaceWrites && !assessment.destructive ? "auto" : "ask";
    case "command":
      return customRules.allowCommands ? "auto" : "ask";
    case "network":
      return customRules.allowNetwork ? "auto" : "ask";
    case "mcp":
      return customRules.allowMcp ? "auto" : "ask";
    default:
      return "ask";
  }
}

export async function enforceToolApproval(input: {
  policy: ApprovalPolicy;
  customRules: CustomApprovalRules;
  workdir: string;
  sessionId: string;
  toolCall: ToolCall;
  metadata?: BuiltinToolMetadata;
  signal?: AbortSignal;
  requestApproval: ToolApprovalRequester;
}) {
  const assessment = assessToolCall({
    toolCall: input.toolCall,
    metadata: input.metadata,
    workdir: input.workdir,
  });
  if (getToolApprovalRequirement(input.policy, assessment, input.customRules) === "auto") return;
  await input.requestApproval({
    sessionId: input.sessionId,
    toolCall: input.toolCall,
    assessment,
    signal: input.signal,
  });
}
