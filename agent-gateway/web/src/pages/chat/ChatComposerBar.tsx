import {
  type MutableRefObject,
  memo,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  MentionComposer,
  type MentionComposerHandle,
  type MentionComposerSkill,
} from "@/components/chat/MentionComposer";
import { GitBranchSelector } from "@/components/git/GitBranchSelector";
import {
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronUp,
  Clock3,
  Globe2,
  Lightbulb,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Square,
  SquarePen,
  Trash2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/i18n";
import {
  formatUploadedFileSize,
  type PendingUploadedFile,
} from "@/lib/chat/uploadedFiles";
import type { GitClient } from "@/lib/git/types";
import type { ModelOption } from "@/lib/providers/llm";
import {
  type ApprovalPolicy,
  type AppSettings,
  type ChatRuntimeControls,
  DEFAULT_CHAT_RUNTIME_CONTROLS,
  type ExecutionMode,
  type ReasoningLevel,
} from "@/lib/settings";
import { cn } from "@/lib/shared/utils";
import type { WorkspaceActivityClient } from "@/lib/workspace-activity/types";
import type { SectionId } from "@/pages/settings/types";
import { ChatAccessSelector } from "@/pages/chat/ChatAccessSelector";
import { ChatModelSelector } from "@/pages/chat/ChatModelSelector";

const REASONING_I18N_KEYS: Record<ReasoningLevel, string> = {
  off: "settings.reasoning.off",
  minimal: "settings.reasoning.minimal",
  low: "settings.reasoning.low",
  medium: "settings.reasoning.medium",
  high: "settings.reasoning.high",
  xhigh: "settings.reasoning.xhigh",
  max: "settings.reasoning.max",
};

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && Object.hasOwn(REASONING_I18N_KEYS, value);
}

function isFocusVisibleTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    // Engines without :focus-visible keep the legacy show-on-any-focus behavior.
    return true;
  }
}

function RuntimeControlTooltip(props: { label: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const updatePosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const tooltipWidth =
      tooltipRef.current?.offsetWidth ?? Math.min(Math.max(props.label.length * 7 + 16, 48), 240);
    const viewportPadding = 8;
    const centeredLeft = rect.left + rect.width / 2;
    const minLeft = viewportPadding + tooltipWidth / 2;
    const maxLeft = window.innerWidth - viewportPadding - tooltipWidth / 2;
    const left = Math.min(Math.max(centeredLeft, minLeft), Math.max(minLeft, maxLeft));

    setPosition({
      left,
      top: Math.max(viewportPadding, rect.top - viewportPadding),
    });
  }, [props.label]);

  const showTooltip = useCallback(() => {
    if (typeof window === "undefined") return;
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      updatePosition();
      setIsVisible(true);
    }, 150);
  }, [clearOpenTimer, updatePosition]);

  const hideTooltip = useCallback(() => {
    clearOpenTimer();
    setIsVisible(false);
  }, [clearOpenTimer]);

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      // Touch has no hover: a tap would open a tooltip nothing ever closes.
      if (event.pointerType === "touch") return;
      showTooltip();
    },
    [showTooltip],
  );

  const handleFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLSpanElement>) => {
      // Only keyboard focus opens the tooltip; click/window-refocus would
      // otherwise pop it without hover (e.g. after the file picker closes).
      if (!isFocusVisibleTarget(event.target)) return;
      showTooltip();
    },
    [showTooltip],
  );

  useEffect(() => clearOpenTimer, [clearOpenTimer]);

  // Layout effect so the measured-width reposition lands before paint.
  useLayoutEffect(() => {
    if (!isVisible) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isVisible, updatePosition]);

  return (
    <span
      ref={triggerRef}
      className="inline-flex shrink-0"
      onBlurCapture={hideTooltip}
      onFocusCapture={handleFocusCapture}
      onPointerDownCapture={hideTooltip}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={hideTooltip}
    >
      {props.children}
      {isVisible && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              aria-hidden
              className="pointer-events-none fixed z-[1000] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border/60 bg-popover px-2 py-1 text-[calc(11px*var(--zone-font-scale,1))] font-medium text-popover-foreground opacity-100 shadow-md"
              style={{
                left: position.left,
                maxWidth: "calc(100vw - 16px)",
                top: position.top,
              }}
            >
              {props.label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export type ChatQueueTurnPreview = {
  id: string;
  previewText: string;
  fileCount: number;
};

type QueueScrollbarState = {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
};

const QUEUE_SCROLLBAR_MIN_THUMB_HEIGHT = 24;
const DEFAULT_QUEUE_SCROLLBAR_STATE: QueueScrollbarState = {
  visible: false,
  thumbHeight: QUEUE_SCROLLBAR_MIN_THUMB_HEIGHT,
  thumbTop: 0,
};

export const ChatComposerBar = memo(function ChatComposerBar(props: {
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  isSending: boolean;
  isUploadingFiles: boolean;
  isInputDisabled: boolean;
  inputPlaceholder: string;
  workdir: string;
  enabledSkills: MentionComposerSkill[];
  isAgentMode: boolean;
  executionMode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
  hasModels?: boolean;
  currentModelLabel?: string;
  modelOptions?: ModelOption[];
  selectedModelValue?: string;
  chatRuntimeControls: ChatRuntimeControls;
  reasoningOptions: ReasoningLevel[];
  thinkingAlwaysOn: boolean;
  gitClient?: GitClient | null;
  gitWriteEnabled?: boolean;
  gitDisabledMessage?: string;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  setSettings?: (updater: (prev: AppSettings) => AppSettings) => void;
  onOpenSettings?: (section?: SectionId) => void;
  onPrepareChatRuntime?: () => void;
  onSend: () => void;
  onStop: () => void;
  onComposerBusyChange: (isBusy: boolean) => void;
  onChatRuntimeControlsChange: (patch: Partial<ChatRuntimeControls>) => void;
  onPickReadableFiles: () => void;
  onPasteFiles: (files: File[]) => void;
  pendingUploadedFiles: PendingUploadedFile[];
  onRemovePendingUpload: (relativePath: string) => void;
  queuedTurns: ChatQueueTurnPreview[];
  onRunQueuedTurnNow: (id: string) => void;
  onMoveQueuedTurnUp: (id: string) => void;
  onEditQueuedTurn: (id: string) => void;
  onRemoveQueuedTurn: (id: string) => void;
  usagePanel?: ReactNode;
  taskListPanel?: ReactNode;
  onHeightChange?: (height: number) => void;
}) {
  const {
    composerRef,
    isSending,
    isUploadingFiles,
    isInputDisabled,
    inputPlaceholder,
    workdir,
    enabledSkills,
    isAgentMode,
    executionMode,
    approvalPolicy,
    hasModels,
    currentModelLabel,
    modelOptions,
    selectedModelValue,
    chatRuntimeControls,
    reasoningOptions,
    thinkingAlwaysOn,
    gitClient,
    gitWriteEnabled = true,
    gitDisabledMessage,
    workspaceActivityClient,
    setSettings,
    onOpenSettings,
    onSend,
    onStop,
    onComposerBusyChange,
    onChatRuntimeControlsChange,
    onPickReadableFiles,
    onPasteFiles,
    pendingUploadedFiles,
    onRemovePendingUpload,
    queuedTurns,
    onRunQueuedTurnNow,
    onMoveQueuedTurnUp,
    onEditQueuedTurn,
    onRemoveQueuedTurn,
    usagePanel,
    taskListPanel,
    onHeightChange,
  } = props;
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const queuePanelRef = useRef<HTMLDivElement | null>(null);
  const queueListRef = useRef<HTMLUListElement | null>(null);
  const queueScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const queueScrollbarDragRef = useRef<{
    pointerId: number;
    startScrollTop: number;
    startY: number;
  } | null>(null);
  const queueHadTurnsRef = useRef(false);
  const [composerIsEmpty, setComposerIsEmpty] = useState(true);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [queueScrollbar, setQueueScrollbar] = useState<QueueScrollbarState>(
    DEFAULT_QUEUE_SCROLLBAR_STATE,
  );
  const uploadDisabled = isInputDisabled || isUploadingFiles || !isAgentMode || !workdir;
  const controlsDisabled = isInputDisabled;
  const hasSendableDraft = !composerIsEmpty || pendingUploadedFiles.length > 0;
  const thinkingSupported = reasoningOptions.length > 0;
  const sendDisabled = isInputDisabled || isUploadingFiles || !hasSendableDraft;
  const canQueueDraftWhileSending = isSending && !sendDisabled;
  const primaryActionTitle = canQueueDraftWhileSending
    ? t("chat.queue.addToQueue")
    : isSending
      ? t("chat.stopGeneration")
      : t("chat.sendMessage");
  const selectedReasoning = reasoningOptions.includes(chatRuntimeControls.reasoning)
    ? chatRuntimeControls.reasoning
    : DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning;
  const uploadTooltip = isUploadingFiles
    ? t("chat.upload.uploading")
    : !isAgentMode
      ? t("chat.upload.onlyInTools")
      : !workdir
        ? t("chat.upload.requireWorkdir")
        : t("chat.upload.button");
  const thinkingTooltip = !thinkingSupported
    ? t("chat.runtime.thinkingUnavailable")
    : t("chat.runtime.thinkingTooltip");
  const webSearchTooltip = t("chat.runtime.webSearchTooltip");
  const toggleQueueTooltip = queueCollapsed ? t("chat.queue.expand") : t("chat.queue.collapse");

  const toggleQueueCollapsed = useCallback(() => {
    setQueueCollapsed((current) => !current);
  }, []);

  const shouldShowQueueScrollbar = !queueCollapsed && queuedTurns.length > 2;

  const updateQueueScrollbar = useCallback(() => {
    const list = queueListRef.current;
    if (!list || !shouldShowQueueScrollbar) {
      setQueueScrollbar((current) => (current.visible ? DEFAULT_QUEUE_SCROLLBAR_STATE : current));
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = list;
    const trackHeight = Math.max(clientHeight, QUEUE_SCROLLBAR_MIN_THUMB_HEIGHT);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const thumbHeight =
      maxScrollTop <= 1
        ? trackHeight
        : Math.min(
            trackHeight,
            Math.max(
              QUEUE_SCROLLBAR_MIN_THUMB_HEIGHT,
              Math.round((clientHeight / scrollHeight) * trackHeight),
            ),
          );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxScrollTop <= 1 ? 0 : Math.round((scrollTop / maxScrollTop) * maxThumbTop);

    setQueueScrollbar((current) => {
      if (current.visible && current.thumbHeight === thumbHeight && current.thumbTop === thumbTop) {
        return current;
      }
      return { visible: true, thumbHeight, thumbTop };
    });
  }, [shouldShowQueueScrollbar]);

  const scrollQueueToThumbPosition = useCallback(
    (clientY: number) => {
      const list = queueListRef.current;
      const track = queueScrollbarTrackRef.current;
      if (!list || !track || !shouldShowQueueScrollbar) return;

      const rect = track.getBoundingClientRect();
      const maxThumbTop = Math.max(1, rect.height - queueScrollbar.thumbHeight);
      const nextThumbTop = Math.min(
        Math.max(clientY - rect.top - queueScrollbar.thumbHeight / 2, 0),
        maxThumbTop,
      );
      const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      list.scrollTop = (nextThumbTop / maxThumbTop) * maxScrollTop;
      updateQueueScrollbar();
    },
    [queueScrollbar.thumbHeight, shouldShowQueueScrollbar, updateQueueScrollbar],
  );

  const handleQueueScrollbarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!shouldShowQueueScrollbar || event.button !== 0) return;
      const list = queueListRef.current;
      const track = queueScrollbarTrackRef.current;
      if (!list || !track) return;

      event.preventDefault();
      const target = event.target as HTMLElement;
      if (!target.closest(".chat-queue-scrollbar-thumb")) {
        scrollQueueToThumbPosition(event.clientY);
      }

      queueScrollbarDragRef.current = {
        pointerId: event.pointerId,
        startScrollTop: list.scrollTop,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [shouldShowQueueScrollbar, scrollQueueToThumbPosition],
  );

  const handleQueueScrollbarPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = queueScrollbarDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const list = queueListRef.current;
      const track = queueScrollbarTrackRef.current;
      if (!list || !track) return;

      const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      const maxThumbTop = Math.max(1, track.clientHeight - queueScrollbar.thumbHeight);
      list.scrollTop =
        drag.startScrollTop + ((event.clientY - drag.startY) / maxThumbTop) * maxScrollTop;
      updateQueueScrollbar();
    },
    [queueScrollbar.thumbHeight, updateQueueScrollbar],
  );

  const handleQueueScrollbarPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = queueScrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    queueScrollbarDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  useEffect(() => {
    const hasQueuedTurns = queuedTurns.length > 0;
    if (hasQueuedTurns && !queueHadTurnsRef.current) {
      setQueueCollapsed(false);
    }
    queueHadTurnsRef.current = hasQueuedTurns;
  }, [queuedTurns.length]);

  useEffect(() => {
    const list = queueListRef.current;
    if (!list) {
      updateQueueScrollbar();
      return;
    }

    updateQueueScrollbar();
    list.addEventListener("scroll", updateQueueScrollbar, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateQueueScrollbar);
    resizeObserver?.observe(list);
    window.addEventListener("resize", updateQueueScrollbar);

    return () => {
      list.removeEventListener("scroll", updateQueueScrollbar);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateQueueScrollbar);
    };
  }, [updateQueueScrollbar]);

  useEffect(() => {
    const reasoningNeedsReset =
      !(reasoningOptions.length > 0 && reasoningOptions.includes(chatRuntimeControls.reasoning)) &&
      !(
        reasoningOptions.length === 0 &&
        chatRuntimeControls.reasoning === DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning
      );
    const thinkingNeedsEnable = thinkingAlwaysOn && !chatRuntimeControls.thinkingEnabled;
    if (!reasoningNeedsReset && !thinkingNeedsEnable) {
      return;
    }
    onChatRuntimeControlsChange({
      ...(reasoningNeedsReset ? { reasoning: DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning } : {}),
      ...(thinkingNeedsEnable ? { thinkingEnabled: true } : {}),
    });
  }, [
    chatRuntimeControls.reasoning,
    chatRuntimeControls.thinkingEnabled,
    onChatRuntimeControlsChange,
    reasoningOptions,
    thinkingAlwaysOn,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onHeightChange) return;

    let animationFrame: number | null = null;
    const measure = () => {
      animationFrame = null;
      const rootHeight = root.getBoundingClientRect().height;
      const queueHeight = queuePanelRef.current?.getBoundingClientRect().height ?? 0;
      onHeightChange(Math.ceil(Math.max(0, rootHeight - queueHeight)));
    };
    const scheduleMeasure = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(root);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <div
      data-agent-composer
      ref={rootRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4"
    >
      <div className="pointer-events-auto relative w-full max-w-[768px]">
        {usagePanel}
        {taskListPanel}
        {queuedTurns.length > 0 ? (
          <div
            ref={queuePanelRef}
            className="relative z-30 mx-auto mb-[-1px] w-[calc(100%-1.5rem)] max-w-[720px]"
          >
            <div
              aria-hidden={queueCollapsed}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                queueCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="rounded-t-lg border border-b-0 border-black/[0.055] bg-white/70 px-1 pb-1 pt-2 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-2xl backdrop-saturate-[165%] dark:border-white/[0.10] dark:bg-white/[0.06] dark:shadow-[0_8px_24px_-18px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="relative min-h-0">
                    <ul
                      ref={queueListRef}
                      data-scrollable={queuedTurns.length > 2 ? "true" : "false"}
                      className={cn(
                        "chat-queue-scroll flex min-w-0 flex-col gap-1 overflow-x-hidden",
                        queuedTurns.length > 2
                          ? "h-[76px] overflow-y-scroll pr-3"
                          : "max-h-[76px] overflow-y-hidden pr-1",
                      )}
                    >
                      {queuedTurns.map((item, index) => {
                        return (
                          <li
                            key={item.id}
                            className="relative grid h-9 min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-black/[0.035] bg-white/42 px-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] backdrop-blur-xl backdrop-saturate-[150%] transition-[border-color,background-color] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                          >
                            <div className="flex shrink-0 items-center gap-0.5">
                              {index > 0 ? (
                                <button
                                  type="button"
                                  disabled={queueCollapsed}
                                  onClick={() => onMoveQueuedTurnUp(item.id)}
                                  aria-label={t("chat.queue.moveUp")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                              ) : (
                                <span aria-hidden className="h-6 w-6" />
                              )}
                              <Clock3 className="h-3 w-3 shrink-0 text-muted-foreground/65" />
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                              <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-foreground/88">
                                {item.previewText || t("chat.queue.emptyMessage")}
                              </span>
                              {item.fileCount > 0 ? (
                                <span className="max-w-[4.5rem] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[calc(9px*var(--zone-font-scale,1))] leading-4 text-muted-foreground">
                                  {t("chat.queue.fileCount").replace(
                                    "{count}",
                                    String(item.fileCount),
                                  )}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <RuntimeControlTooltip label={t("chat.queue.edit")}>
                                <button
                                  type="button"
                                  disabled={queueCollapsed}
                                  onClick={() => onEditQueuedTurn(item.id)}
                                  aria-label={t("chat.queue.edit")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                                >
                                  <SquarePen className="h-3 w-3" />
                                </button>
                              </RuntimeControlTooltip>
                              <RuntimeControlTooltip label={t("chat.queue.runNow")}>
                                <button
                                  type="button"
                                  disabled={queueCollapsed}
                                  onClick={() => onRunQueuedTurnNow(item.id)}
                                  aria-label={t("chat.queue.runNow")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                                >
                                  <Play className="h-3 w-3" />
                                </button>
                              </RuntimeControlTooltip>
                              <RuntimeControlTooltip label={t("chat.queue.delete")}>
                                <button
                                  type="button"
                                  disabled={queueCollapsed}
                                  onClick={() => onRemoveQueuedTurn(item.id)}
                                  aria-label={t("chat.queue.delete")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </RuntimeControlTooltip>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {shouldShowQueueScrollbar ? (
                      <div
                        ref={queueScrollbarTrackRef}
                        aria-hidden
                        className="chat-queue-scrollbar"
                        onPointerCancel={handleQueueScrollbarPointerUp}
                        onPointerDown={handleQueueScrollbarPointerDown}
                        onPointerMove={handleQueueScrollbarPointerMove}
                        onPointerUp={handleQueueScrollbarPointerUp}
                      >
                        <div
                          className="chat-queue-scrollbar-thumb"
                          style={{
                            height: `${queueScrollbar.thumbHeight}px`,
                            transform: `translateY(${queueScrollbar.thumbTop}px)`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleQueueCollapsed}
              title={toggleQueueTooltip}
              aria-label={toggleQueueTooltip}
              aria-expanded={!queueCollapsed}
              className="absolute left-1/2 top-0 z-40 inline-flex h-[18px] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-black/[0.07] bg-white/90 pl-1.5 pr-2 text-muted-foreground shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl backdrop-saturate-150 transition-[background-color,color,scale] hover:bg-white hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-white/[0.12] dark:bg-zinc-900/90 dark:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.10)] dark:hover:bg-zinc-900"
            >
              {queueCollapsed ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
              <span className="text-[calc(10px*var(--zone-font-scale,1))] font-medium leading-none tabular-nums">
                {queuedTurns.length}
              </span>
            </button>
          </div>
        ) : null}

        <div
          data-agent-composer-surface
          className="agent-codex-composer relative z-10 overflow-hidden rounded-[20px] transition-[border-color,box-shadow,background-color]"
        >
          {pendingUploadedFiles.length > 0 ? (
            <div
              data-agent-composer-attachments
              className="upload-file-list flex gap-2 overflow-x-auto px-3.5 pb-0.5 pt-3.5"
            >
              {pendingUploadedFiles.map((file) => (
                <div
                  key={file.relativePath}
                  title={file.relativePath}
                  className="group flex w-[min(220px,calc(50%-4px))] min-w-[160px] items-center gap-2.5 rounded-[14px] border border-border/65 bg-foreground/[0.025] px-2.5 py-2 text-[calc(11px*var(--zone-font-scale,1))] transition-colors hover:bg-foreground/[0.045] dark:bg-white/[0.045] dark:hover:bg-white/[0.07]"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.055] text-muted-foreground dark:bg-white/[0.07]">
                    <Paperclip className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[calc(12px*var(--zone-font-scale,1))] font-medium tracking-tight text-foreground/90">
                      {file.fileName}
                    </div>
                    <div className="truncate text-[calc(10px*var(--zone-font-scale,1))] text-muted-foreground">
                      {formatUploadedFileSize(file.sizeBytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isInputDisabled}
                    onClick={() => onRemovePendingUpload(file.relativePath)}
                    className="shrink-0 rounded-full p-1 text-muted-foreground/70 opacity-70 transition-all hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none"
                    aria-label={`${t("chat.upload.removeFile")} ${file.fileName}`}
                    title={t("chat.upload.removeFile")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className={cn("relative px-4", pendingUploadedFiles.length > 0 ? "pt-3" : "pt-4")}>
            <MentionComposer
              ref={composerRef}
              onSend={onSend}
              onEmptyChange={setComposerIsEmpty}
              onBusyChange={onComposerBusyChange}
              onPasteFiles={onPasteFiles}
              placeholder={inputPlaceholder}
              disabled={isInputDisabled}
              workdir={workdir}
              enabledSkills={enabledSkills}
              className="px-0 py-0"
            />
          </div>

          <div className="relative flex items-center justify-between gap-3 px-3 pb-3 pt-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-agent-composer-add
                  disabled={isInputDisabled}
                  className="agent-composer-add-trigger relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground outline-hidden transition-[background-color,color,transform] hover:bg-foreground/[0.09] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                  aria-label={t("chat.composer.add")}
                  title={t("chat.composer.add")}
                >
                  <Plus className="h-[18px] w-[18px]" />
                  {pendingUploadedFiles.length > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-semibold leading-none text-background">
                      {pendingUploadedFiles.length}
                    </span>
                  ) : null}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  sideOffset={10}
                  collisionPadding={12}
                  className="agent-composer-add-menu w-[min(330px,calc(100vw-24px))] rounded-[18px] border-border/70 bg-popover/98 p-2 shadow-[var(--agent-shadow-menu)]"
                >
                  <DropdownMenuLabel className="px-2.5 pb-1.5 pt-1 text-[calc(12px*var(--zone-font-scale,1))] font-medium text-muted-foreground">
                    {t("chat.composer.add")}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    data-agent-composer-tool="upload"
                    disabled={uploadDisabled}
                    onSelect={onPickReadableFiles}
                    className="gap-3 rounded-xl px-2.5 py-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.055] text-muted-foreground">
                      {isUploadingFiles ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground">
                        {t("chat.composer.files")}
                      </span>
                      <span className="block truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
                        {uploadTooltip}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-1 my-1.5 bg-border/60" />
                  <DropdownMenuCheckboxItem
                    data-agent-composer-tool="thinking"
                    checked={chatRuntimeControls.thinkingEnabled}
                    disabled={controlsDisabled || !thinkingSupported || thinkingAlwaysOn}
                    onCheckedChange={(checked) =>
                      onChatRuntimeControlsChange({ thinkingEnabled: checked })
                    }
                    className="rounded-xl py-2.5 pl-9 pr-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground">
                          {t("chat.composer.thinking")}
                        </span>
                        <span className="block truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
                          {thinkingTooltip}
                        </span>
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    data-agent-composer-tool="web-search"
                    checked={chatRuntimeControls.nativeWebSearchEnabled}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) =>
                      onChatRuntimeControlsChange({ nativeWebSearchEnabled: checked })
                    }
                    className="rounded-xl py-2.5 pl-9 pr-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground">
                          {t("chat.composer.webSearch")}
                        </span>
                        <span className="block truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
                          {webSearchTooltip}
                        </span>
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {isAgentMode ? (
                <ChatAccessSelector
                executionMode={executionMode ?? ("tools" as ExecutionMode)}
                approvalPolicy={approvalPolicy ?? "ask"}
                setSettings={setSettings ?? (() => {})}
                onOpenSettings={onOpenSettings ?? (() => {})}
              />
              ) : null}
            </div>

            <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
              <GitBranchSelector
                workdir={workdir}
                gitClient={gitClient}
                workspaceActivityClient={workspaceActivityClient}
                disabled={controlsDisabled}
                canWrite={gitWriteEnabled}
                disabledMessage={gitDisabledMessage}
              />

              <ChatModelSelector
                hasModels={hasModels ?? true}
                currentModelLabel={currentModelLabel ?? ""}
                modelOptions={modelOptions ?? []}
                selectedValue={selectedModelValue}
                setSettings={setSettings ?? (() => {})}
              />

              {reasoningOptions.length > 0 ? (
                <Select
                  value={selectedReasoning}
                  onValueChange={(value) =>
                    onChatRuntimeControlsChange({ reasoning: value as ReasoningLevel })
                  }
                  disabled={controlsDisabled || !chatRuntimeControls.thinkingEnabled}
                >
                  <SelectTrigger
                    className={cn(
                      // Base UI wraps the chevron in an Icon <span>, so the
                      // svg is a descendant (not a direct child) of the
                      // trigger; the open state lives on data-popup-open.
                      "composer-reasoning-trigger group/reasoning h-8 w-auto shrink-0 gap-0.5 rounded-full border border-transparent bg-transparent pl-2 pr-1.5 text-xs font-medium text-muted-foreground shadow-none outline-hidden transition-all duration-200 ease-out hover:bg-foreground/[0.055] hover:text-foreground disabled:opacity-45 dark:hover:bg-white/[0.065] [&_svg:last-child]:h-3 [&_svg:last-child]:w-3 [&_svg:last-child]:opacity-50 [&_svg:last-child]:transition-transform [&_svg:last-child]:duration-200 [&[data-popup-open]_svg:last-child]:rotate-180",
                    )}
                    aria-label={t("chat.runtime.reasoning")}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <Brain
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-colors",
                          chatRuntimeControls.thinkingEnabled ? "text-foreground/75" : "",
                        )}
                      />
                      <SelectValue>
                        {(value) =>
                          t(
                            REASONING_I18N_KEYS[
                              isReasoningLevel(value) ? value : selectedReasoning
                            ],
                          )
                        }
                      </SelectValue>
                    </span>
                  </SelectTrigger>
                  <SelectContent className="composer-reasoning-dropdown min-w-32 rounded-xl border border-border/70 bg-popover/98 p-1 shadow-[var(--agent-shadow-menu)]">
                    {reasoningOptions.map((value, index) => (
                      <SelectItem
                        key={value}
                        value={value}
                        className="composer-reasoning-item rounded-lg transition-all duration-150 ease-out data-[highlighted]:bg-foreground/[0.055] data-[highlighted]:text-foreground data-[selected]:bg-foreground/[0.065] data-[selected]:font-medium dark:data-[highlighted]:bg-white/[0.07] dark:data-[selected]:bg-white/[0.08]"
                        style={{ animationDelay: `${Math.min(index, 5) * 0.022}s` }}
                      >
                        {t(REASONING_I18N_KEYS[value])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <Button
                disabled={isSending ? false : sendDisabled}
                onClick={() => {
                  if (canQueueDraftWhileSending) {
                    onSend();
                    return;
                  }
                  if (isSending) {
                    onStop();
                    return;
                  }
                  if (sendDisabled) return;
                  onSend();
                }}
                size="icon"
                title={primaryActionTitle}
                aria-label={primaryActionTitle}
                style={
                  canQueueDraftWhileSending
                    ? {
                        backgroundColor: "hsl(160 84% 39%)",
                        backgroundImage: "none",
                        color: "white",
                      }
                    : isSending
                      ? {
                          backgroundColor: "hsl(var(--destructive))",
                          backgroundImage: "none",
                          color: "hsl(var(--destructive-foreground))",
                        }
                      : undefined
                }
                className={cn(
                  "h-9 w-9 shrink-0 rounded-full shadow-none transition-all",
                  canQueueDraftWhileSending
                    ? "hover:brightness-105 hover:shadow-[0_8px_18px_-8px_rgba(5,150,105,0.72)] active:scale-95"
                    : isSending
                      ? "hover:opacity-90 active:scale-95"
                      : "disabled:opacity-100 [&:not(:disabled)]:bg-foreground [&:not(:disabled)]:text-background [&:not(:disabled)]:hover:bg-foreground/85 [&:not(:disabled)]:hover:shadow-[0_4px_14px_-2px_rgba(15,23,42,0.28)] [&:not(:disabled)]:active:scale-95 disabled:bg-foreground/10 disabled:text-foreground/35",
                )}
              >
                {canQueueDraftWhileSending ? (
                  <ArrowUp className="h-4 w-4" />
                ) : isSending ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
