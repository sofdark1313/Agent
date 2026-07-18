import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import { AgentMark } from "../../../components/brand/AgentMark";
import { FolderTree, Lightbulb, Settings, Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SectionId } from "../../settings/types";

type GreetingPeriod = "morning" | "noon" | "afternoon" | "evening" | "night";

const GREETING_KEYS: Record<GreetingPeriod, string> = {
  morning: "chat.greetingMorning",
  noon: "chat.greetingNoon",
  afternoon: "chat.greetingAfternoon",
  evening: "chat.greetingEvening",
  night: "chat.greetingNight",
};

function resolveGreetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function useGreetingPeriod() {
  const [period, setPeriod] = useState<GreetingPeriod>(() =>
    resolveGreetingPeriod(new Date().getHours()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPeriod(resolveGreetingPeriod(new Date().getHours()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return period;
}

const SUGGESTION_CARDS = [
  {
    key: "explore",
    icon: FolderTree,
    accent: "199 89% 48%",
    chipClassName: "bg-foreground/[0.055] text-foreground/70 group-hover:bg-foreground/[0.08]",
    titleKey: "chat.suggestExploreTitle",
    hintKey: "chat.suggestExploreHint",
    promptKey: "chat.suggestExplorePrompt",
  },
  {
    key: "fix",
    icon: Wrench,
    accent: "38 92% 50%",
    chipClassName: "bg-foreground/[0.055] text-foreground/70 group-hover:bg-foreground/[0.08]",
    titleKey: "chat.suggestFixTitle",
    hintKey: "chat.suggestFixHint",
    promptKey: "chat.suggestFixPrompt",
  },
  {
    key: "ideate",
    icon: Lightbulb,
    accent: "160 84% 39%",
    chipClassName: "bg-foreground/[0.055] text-foreground/70 group-hover:bg-foreground/[0.08]",
    titleKey: "chat.suggestIdeateTitle",
    hintKey: "chat.suggestIdeateHint",
    promptKey: "chat.suggestIdeatePrompt",
  },
] as const;

export type ChatEmptyStateProps = {
  variant: "no-models" | "start-chat";
  onOpenSettings?: (section?: SectionId) => void;
  onSuggestionSelect?: (text: string) => void;
  /** Locks the suggestion cards while a picked prompt is still typing in. */
  suggestionsDisabled?: boolean;
};

export function ChatEmptyState({
  variant,
  onOpenSettings,
  onSuggestionSelect,
  suggestionsDisabled = false,
}: ChatEmptyStateProps) {
  const { t } = useLocale();
  const period = useGreetingPeriod();

  // Drives the accent spotlight that follows the cursor inside each card.
  const handleCardPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  }, []);

  return (
    <div data-agent-empty-state className="relative flex w-full flex-col items-center">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
        <AgentMark className="h-7 w-7" />
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
          <div className="mb-2.5 text-center text-[calc(24px*var(--zone-font-scale,1))] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {t(GREETING_KEYS[period])}
          </div>
          <div className="hero-entrance-delay-2 flex items-center justify-center gap-1.5 text-center text-sm leading-relaxed text-muted-foreground">
            <Lightbulb
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400"
            />
            {t("chat.greetingSubtitle")}
          </div>
          {onSuggestionSelect ? (
            <div className="mt-8 grid w-full max-w-[640px] grid-cols-1 gap-2 px-6 sm:grid-cols-3 sm:px-4">
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
                  className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background px-3.5 py-3 text-left transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-55"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${card.chipClassName}`}
                  >
                    <card.icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[calc(13px*var(--zone-font-scale,1))] font-medium leading-tight text-foreground/90">
                      {t(card.titleKey)}
                    </span>
                    <span className="truncate text-xs leading-tight text-muted-foreground">
                      {t(card.hintKey)}
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
