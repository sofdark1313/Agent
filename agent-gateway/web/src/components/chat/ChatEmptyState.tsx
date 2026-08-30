import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
} from "react";

import { Cloud, Lightbulb, Settings, Sparkles, Wrench } from "@/components/icons";
import { useLocale } from "@/i18n";
import type { SectionId } from "@/pages/settings/types";

const SUGGESTION_CARDS = [
  {
    key: "explore",
    icon: Sparkles,
    accent: "199 89% 48%",
    chipClassName: "bg-sky-500/10 text-sky-500 group-hover:bg-sky-500/15",
    title: "探索并理解代码",
    hint: "梳理架构与核心模块职责",
    promptKey: "chat.suggestExplorePrompt",
  },
  {
    key: "fix",
    icon: Wrench,
    accent: "38 92% 50%",
    chipClassName: "bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/15",
    title: "修复问题",
    hint: "描述问题，一起修复",
    promptKey: "chat.suggestFixPrompt",
  },
  {
    key: "ideate",
    icon: Lightbulb,
    accent: "160 84% 39%",
    chipClassName: "bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/15",
    title: "头脑风暴",
    hint: "从想法到落地方案",
    promptKey: "chat.suggestIdeatePrompt",
  },
] as const;

export type ChatEmptyStateProps = {
  variant: "no-models" | "start-chat";
  projectName?: string;
  onOpenSettings?: (section?: SectionId) => void;
  onSuggestionSelect?: (text: string) => void;
  /** Locks the suggestion cards while a picked prompt is still typing in. */
  suggestionsDisabled?: boolean;
};

export function ChatEmptyState({
  variant,
  projectName = "Agent",
  onOpenSettings,
  onSuggestionSelect,
  suggestionsDisabled = false,
}: ChatEmptyStateProps) {
  const { t } = useLocale();

  const handleCardPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  }, []);

  return (
    <div data-agent-empty-state className="relative flex w-full flex-col items-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-foreground/[0.03] text-foreground shadow-xs">
        <Cloud className="h-7 w-7 text-foreground/80" />
      </div>

      {variant === "no-models" ? (
        <>
          <div className="mb-2 text-center text-[calc(24px*var(--zone-font-scale,1))] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {t("chat.welcome")}
          </div>
          <div className="hero-entrance-delay-2 mb-1 text-center text-sm leading-relaxed text-muted-foreground">
            {t("chat.noModelSelected")}
          </div>
          <div className="hero-entrance-delay-2 mb-7 text-center text-sm leading-relaxed text-muted-foreground">
            {t("chat.configureModel")}
          </div>
          {onOpenSettings ? (
            <button
              type="button"
              onClick={() => onOpenSettings("providers")}
              className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground/85 shadow-xs transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5 text-foreground/55 transition-colors group-hover:text-foreground/80" />
              {t("chat.goToSettings")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="mb-8 text-center text-[calc(26px*var(--zone-font-scale,1))] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            你想让我们在{" "}
            <span className="underline decoration-muted-foreground/40 underline-offset-8">
              {projectName}
            </span>{" "}
            中构建什么？
          </div>
          {onSuggestionSelect ? (
            <div className="grid w-full max-w-[640px] grid-cols-1 gap-2.5 px-6 sm:grid-cols-3 sm:px-4">
              {SUGGESTION_CARDS.map((card, index) => (
                <button
                  key={card.key}
                  type="button"
                  disabled={suggestionsDisabled}
                  onClick={() => onSuggestionSelect(t(card.promptKey))}
                  onPointerMove={handleCardPointerMove}
                  style={
                    {
                      "--hero-delay": `${0.26 + index * 0.06}s`,
                      "--card-accent": card.accent,
                    } as CSSProperties
                  }
                  className="group flex items-center gap-3 rounded-2xl border border-border/50 bg-foreground/[0.025] px-4 py-3.5 text-left transition-all hover:bg-foreground/[0.06] hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-55"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 ${card.chipClassName}`}
                  >
                    <card.icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[calc(13px*var(--zone-font-scale,1))] font-medium leading-tight text-foreground/90 group-hover:text-foreground">
                      {card.title}
                    </span>
                    <span className="truncate text-xs leading-tight text-muted-foreground">
                      {card.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
