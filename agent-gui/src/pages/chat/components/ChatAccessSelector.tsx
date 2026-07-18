import {
  Check,
  Cpu,
  MessageSquare,
  Settings2,
  type Shield,
  Wrench,
} from "../../../components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useLocale } from "../../../i18n";
import {
  type ApprovalPolicy,
  type AppSettings,
  type ExecutionMode,
  updateSystem,
} from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";
import type { SectionId } from "../../settings/types";

type AccessOption = {
  approvalPolicy: ApprovalPolicy;
  executionMode: ExecutionMode;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Shield;
};

const ACCESS_OPTIONS: AccessOption[] = [
  {
    approvalPolicy: "ask",
    executionMode: "tools",
    labelKey: "chat.access.askApproval",
    descriptionKey: "chat.access.askApprovalDesc",
    icon: MessageSquare,
  },
  {
    approvalPolicy: "agent",
    executionMode: "tools",
    labelKey: "chat.access.agentAutomatic",
    descriptionKey: "chat.access.agentAutomaticDesc",
    icon: Wrench,
  },
  {
    approvalPolicy: "full",
    executionMode: "agent-dev",
    labelKey: "chat.access.fullAccess",
    descriptionKey: "chat.access.fullAccessDesc",
    icon: Cpu,
  },
];

export function ChatAccessSelector(props: {
  executionMode: ExecutionMode;
  approvalPolicy: ApprovalPolicy;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onOpenSettings: (section?: SectionId) => void;
}) {
  const { approvalPolicy, setSettings, onOpenSettings } = props;
  const { t } = useLocale();
  const selectedOption =
    ACCESS_OPTIONS.find((option) => option.approvalPolicy === approvalPolicy) ?? ACCESS_OPTIONS[1];
  const SelectedIcon = selectedOption.icon;
  const hasAutomaticAccess = approvalPolicy !== "ask";

  const selectPolicy = (option: AccessOption) => {
    setSettings((current) =>
      updateSystem(current, {
        approvalPolicy: option.approvalPolicy,
        executionMode: option.executionMode,
      }),
    );
  };

  const selectCustomPolicy = () => {
    setSettings((current) =>
      updateSystem(current, { approvalPolicy: "custom", executionMode: "tools" }),
    );
    onOpenSettings("systemTools");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            data-agent-composer-access={approvalPolicy}
            type="button"
            className={cn(
              "inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium transition-colors hover:bg-foreground/[0.055] dark:hover:bg-white/[0.065]",
              hasAutomaticAccess
                ? "text-orange-600 dark:text-orange-300"
                : "text-muted-foreground hover:text-foreground",
            )}
          />
        }
      >
        <SelectedIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t(selectedOption.labelKey)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-[min(22rem,calc(100vw-1rem))] rounded-[14px] border border-border/70 bg-popover/98 p-1.5 shadow-[var(--agent-shadow-menu)]"
      >
        <DropdownMenuLabel className="px-2.5 pb-1.5 pt-1 text-[calc(12px*var(--zone-font-scale,1))] font-medium text-muted-foreground">
          {t("chat.access.menuTitle")}
        </DropdownMenuLabel>

        {ACCESS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = approvalPolicy === option.approvalPolicy;
          return (
            <DropdownMenuItem
              key={option.approvalPolicy}
              onSelect={() => selectPolicy(option)}
              className={cn(
                "items-start gap-3 rounded-[10px] px-2.5 py-2.5",
                selected && "bg-foreground/[0.055]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground",
                  selected && "text-orange-600 dark:text-orange-300",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground",
                    selected && "text-orange-600 dark:text-orange-300",
                  )}
                >
                  {t(option.labelKey)}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground",
                    selected && "text-orange-600/85 dark:text-orange-300/85",
                  )}
                >
                  {t(option.descriptionKey)}
                </span>
              </span>
              {selected ? (
                <Check className="mt-1 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
              ) : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator className="my-1 bg-border/60" />
        <DropdownMenuItem
          onSelect={selectCustomPolicy}
          className={cn(
            "items-start gap-3 rounded-[10px] px-2.5 py-2.5",
            approvalPolicy === "custom" && "bg-foreground/[0.055]",
          )}
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            <Settings2
              className={cn(
                "h-4 w-4",
                approvalPolicy === "custom" && "text-orange-600 dark:text-orange-300",
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block text-[calc(13px*var(--zone-font-scale,1))] font-medium text-foreground",
                approvalPolicy === "custom" && "text-orange-600 dark:text-orange-300",
              )}
            >
              {t("chat.access.custom")}
            </span>
            <span className="mt-0.5 block text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground">
              {t("chat.access.customDesc")}
            </span>
          </span>
          {approvalPolicy === "custom" ? (
            <Check className="mt-1 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
