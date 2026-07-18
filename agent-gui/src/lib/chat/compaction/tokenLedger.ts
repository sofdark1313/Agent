import type { Context, Message, Usage } from "@earendil-works/pi-ai";

import { isCompactionAssistantMessage } from "../conversation/conversationState";

const CHARS_PER_TOKEN = 4;
// 逐消息估算只统计正文字符，补一个小常量近似 JSON 包裹（role/键名/引号）的开销。
const MESSAGE_ENVELOPE_TOKENS = 8;

// 消息在本代码库中是不可变值对象（状态变更只新建数组），因此估算结果可跨
// state/segment/临时 state 按对象身份缓存，热路径不再重复序列化。
const messageTokenCache = new WeakMap<object, number>();
const toolsTokenCache = new WeakMap<object, number>();

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.ceil(normalized.length / CHARS_PER_TOKEN);
}

function stringifiedLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value == null) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

function estimateMessageChars(message: Message): number {
  let chars = 0;
  if (message.role === "assistant") {
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" || block.type === "thinking") {
        const text =
          (block as { text?: string; thinking?: string }).text ??
          (block as { thinking?: string }).thinking;
        if (typeof text === "string") chars += text.length;
        continue;
      }
      if (block.type === "toolCall") {
        chars += block.name.length + stringifiedLength(block.arguments);
        continue;
      }
      chars += stringifiedLength(block);
    }
    return chars;
  }

  if (message.role === "toolResult") {
    for (const block of message.content) {
      if (block && typeof block === "object" && block.type === "text") {
        chars += typeof block.text === "string" ? block.text.length : 0;
      } else {
        chars += stringifiedLength(block);
      }
    }
    if (message.details != null) chars += stringifiedLength(message.details);
    return chars;
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
        const text = (block as { text?: string }).text;
        chars += typeof text === "string" ? text.length : 0;
      } else {
        chars += stringifiedLength(block);
      }
    }
    return chars;
  }
  return stringifiedLength(content);
}

export function estimateMessageTokens(message: Message): number {
  const cached = messageTokenCache.get(message);
  if (cached !== undefined) return cached;
  const tokens =
    Math.ceil(estimateMessageChars(message) / CHARS_PER_TOKEN) + MESSAGE_ENVELOPE_TOKENS;
  messageTokenCache.set(message, tokens);
  return tokens;
}

export function estimateToolsTokens(tools: Context["tools"]): number {
  if (!tools || tools.length === 0) return 0;
  const cached = toolsTokenCache.get(tools);
  if (cached !== undefined) return cached;
  const tokens = estimateTextTokens(JSON.stringify(tools));
  toolsTokenCache.set(tools, tokens);
  return tokens;
}

export function getUsageTotalTokens(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;

  const totalTokens = usage.totalTokens;
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) {
    return Math.max(0, Math.floor(totalTokens));
  }

  // usage.reasoning 是 output 的子集（pi-ai types.d.ts），推导时绝不能单独累加。
  const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  const derivedTotal = parts.reduce<number>((sum, value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return sum;
    return sum + value;
  }, 0);
  return derivedTotal > 0 ? Math.floor(derivedTotal) : undefined;
}

export function getMessageObservedTokens(message: Message): number | undefined {
  if (message.role !== "assistant") return undefined;
  // 压缩 checkpoint 消息带的是 summarizer 请求的规模，不代表当前会话上下文。
  // （布尔化避免类型谓词在 else 分支把 AssistantMessage 收窄成 never。）
  const isCheckpoint: boolean = isCompactionAssistantMessage(message);
  if (isCheckpoint) return undefined;
  return getUsageTotalTokens(message.usage);
}

export type TokenLedgerSnapshot = {
  fixedTokens: number;
  observedTokens: number;
  trailingTokens: number;
  hasObservedUsage: boolean;
  totalTokens: number;
};

/**
 * 每会话上下文规模账本：observed（最近一次真实 usage，已含 system/tools/全部历史）
 * + trailing（其后消息的估算增量）。无 usage 锚点时退回 fixed（system+tools 估算）
 * + trailing。所有读数 O(1)，重建仅在每次请求开始时 O(n) 一次。
 */
export class TokenLedger {
  private fixedTokens = 0;
  private observedTokens = 0;
  private trailingTokens = 0;
  private hasObservedUsage = false;

  rebase(context: Context): void {
    this.fixedTokens =
      estimateTextTokens(context.systemPrompt ?? "") + estimateToolsTokens(context.tools);
    this.observedTokens = 0;
    this.trailingTokens = 0;
    this.hasObservedUsage = false;

    const messages = context.messages;
    let anchorIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const observed = getMessageObservedTokens(messages[index]);
      if (typeof observed === "number") {
        this.observedTokens = observed;
        this.hasObservedUsage = true;
        anchorIndex = index;
        break;
      }
    }
    for (let index = anchorIndex + 1; index < messages.length; index += 1) {
      this.trailingTokens += estimateMessageTokens(messages[index]);
    }
  }

  addMessages(messages: readonly Message[]): void {
    for (const message of messages) {
      const observed = getMessageObservedTokens(message);
      if (typeof observed === "number") {
        // 新 usage 已覆盖它之前的全部上下文，trailing 归零重新累计。
        this.observedTokens = observed;
        this.hasObservedUsage = true;
        this.trailingTokens = 0;
        continue;
      }
      this.trailingTokens += estimateMessageTokens(message);
    }
  }

  total(): number {
    const base = this.hasObservedUsage ? this.observedTokens : this.fixedTokens;
    return base + this.trailingTokens;
  }

  totalWithPendingText(pendingChars: number): number {
    if (!Number.isFinite(pendingChars) || pendingChars <= 0) return this.total();
    return this.total() + Math.ceil(pendingChars / CHARS_PER_TOKEN);
  }

  snapshot(): TokenLedgerSnapshot {
    return {
      fixedTokens: this.fixedTokens,
      observedTokens: this.observedTokens,
      trailingTokens: this.trailingTokens,
      hasObservedUsage: this.hasObservedUsage,
      totalTokens: this.total(),
    };
  }
}
