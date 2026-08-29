import { Check, ChevronDown, MessageSquare, Wrench } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/i18n";
import { type AppSettings, type ExecutionMode, updateSystem } from "@/lib/settings";
import { cn } from "@/lib/shared/utils";

type ChatModeOption = {
  id: "chat" | "agent";
  executionMode: ExecutionMode;
  labelKey: string;
  descriptionKey: string;
  icon: typeof MessageSquare;
};

const CHAT_MODE_OPTIONS: ChatModeOption[] = [
  {
    id: "chat",
    executionMode: "text",
    labelKey: "chat.mode.chatTitle",
    descriptionKey: "chat.mode.chatDescription",
    icon: MessageSquare,
  },
  {
    id: "agent",
    executionMode: "tools",
    labelKey: "chat.mode.agentTitle",
    descriptionKey: "chat.mode.agentDescription",
    icon: Wrench,
  },
];

export function ChatModeSelector(props: {
  executionMode: ExecutionMode;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}) {
  const { executionMode, setSettings } = props;
  const { t } = useLocale();
  const selectedId = executionMode === "text" ? "chat" : "agent";
  const selectedOption =
    CHAT_MODE_OPTIONS.find((option) => option.id === selectedId) ?? CHAT_MODE_OPTIONS[1];
  const SelectedIcon = selectedOption.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-agent-sidebar-mode={selectedId}
          type="button"
          aria-label={t("chat.mode.menuTitle")}
          className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-xl px-2.5 text-[calc(14px*var(--zone-font-scale,1))] font-semibold tracking-tight text-foreground transition-colors hover:bg-foreground/[0.065] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 data-[state=open]:bg-foreground/[0.065]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
            <SelectedIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{t(selectedOption.labelKey)}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-[min(236px,calc(100vw-1rem))] rounded-[14px] border border-border/70 bg-popover/98 p-1.5 shadow-[var(--agent-shadow-menu)]"
      >
        {CHAT_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = selectedId === option.id;
          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => {
                setSettings((current) => updateSystem(current, { executionMode: option.executionMode }));
              }}
              className={cn(
                "items-start gap-3 rounded-[10px] px-2.5 py-2.5 focus:bg-foreground/[0.055]",
                selected && "bg-foreground/[0.055]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground",
                  selected && "text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground">
                  {t(option.labelKey)}
                </span>
                <span className="mt-0.5 block text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground">
                  {t(option.descriptionKey)}
                </span>
              </span>
              {selected ? <Check className="mt-1 h-4 w-4 shrink-0 text-foreground" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
