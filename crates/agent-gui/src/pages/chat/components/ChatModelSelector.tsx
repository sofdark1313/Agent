import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ClaudeIcon,
  GeminiIcon,
  OpenaiChatgptIcon,
  Search,
} from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useLocale } from "../../../i18n";
import { type ModelOption, parseModelValue } from "../../../lib/providers/llm";
import { type AppSettings, type ProviderId, setSelectedModel } from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";

function ProviderBrandIcon({ type, className }: { type: ProviderId; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (type === "claude_code") return <ClaudeIcon className={cls} />;
  if (type === "gemini") return <GeminiIcon className={cls} />;
  return <OpenaiChatgptIcon className={cn(cls, "fill-current dark:text-white")} />;
}

export function ChatModelSelector(props: {
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}) {
  const { hasModels, currentModelLabel, modelOptions, selectedValue, setSettings } = props;
  const { t } = useLocale();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    setModelSearch("");
    setExpandedGroups({});
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [isModelMenuOpen]);

  const normalizedSearch = modelSearch.trim().toLowerCase();
  const groups: {
    name: string;
    providerType: ProviderId;
    opts: ModelOption[];
  }[] = [];
  const groupMap = new Map<string, ModelOption[]>();
  for (const option of modelOptions) {
    const existing = groupMap.get(option.providerName);
    if (existing) {
      existing.push(option);
      continue;
    }
    const nextGroup = [option];
    groupMap.set(option.providerName, nextGroup);
    groups.push({
      name: option.providerName,
      providerType: option.providerType,
      opts: nextGroup,
    });
  }

  const selectedOption = modelOptions.find((option) => option.value === selectedValue);
  const selectedGroupName = selectedOption?.providerName;
  const compactModelLabel = selectedOption?.model ?? currentModelLabel;
  const isGroupExpanded = (name: string) =>
    normalizedSearch.length > 0 || (expandedGroups[name] ?? name === selectedGroupName);
  const toggleGroup = (name: string) =>
    setExpandedGroups((current) => ({
      ...current,
      [name]: !(current[name] ?? name === selectedGroupName),
    }));

  return (
    <DropdownMenu open={isModelMenuOpen} onOpenChange={setIsModelMenuOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            data-agent-composer-model
            variant="ghost"
            disabled={!hasModels}
            className={cn(
              "model-selector-trigger h-8 min-w-0 max-w-40 shrink px-2 text-xs font-medium text-muted-foreground shadow-none hover:bg-foreground/[0.055] hover:text-foreground dark:hover:bg-white/[0.065]",
              isModelMenuOpen && "bg-foreground/[0.065] text-foreground",
            )}
          />
        }
      >
        <span className="model-selector-current-label flex min-w-0 items-center gap-1.5 text-left">
          {selectedOption ? (
            <ProviderBrandIcon
              type={selectedOption.providerType}
              className="h-3.5 w-3.5 opacity-75"
            />
          ) : null}
          <span className="min-w-0 truncate">{compactModelLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-200",
            isModelMenuOpen && "rotate-180",
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={8}
        className="model-selector-dropdown w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border/70 bg-popover/98 p-0 shadow-[var(--agent-shadow-menu)]"
      >
        <DropdownMenuLabel className="model-selector-menu-title px-3 py-2 text-[calc(11px*var(--zone-font-scale,1))] font-medium uppercase tracking-wider text-muted-foreground/80 dark:text-white/80">
          {t("chat.selectModel")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0 bg-border/40" />
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <input
              ref={searchInputRef}
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder={t("chat.searchModel")}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <div className="max-h-[min(20rem,var(--available-height,20rem))] overflow-y-auto overscroll-contain px-1 pb-1">
          {(() => {
            let animationIndex = 0;
            const filteredGroups = normalizedSearch
              ? groups
                  .map((group) => ({
                    ...group,
                    opts: group.opts.filter(
                      (option) =>
                        option.model.toLowerCase().includes(normalizedSearch) ||
                        option.providerName.toLowerCase().includes(normalizedSearch),
                    ),
                  }))
                  .filter((group) => group.opts.length > 0)
              : groups;

            if (filteredGroups.length === 0) {
              return (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t("chat.noModelFound")}
                </div>
              );
            }

            return filteredGroups.map((group, groupIndex) => {
              const expanded = isGroupExpanded(group.name);
              return (
                <div key={group.name}>
                  {groupIndex > 0 ? <DropdownMenuSeparator className="bg-border/30" /> : null}
                  <DropdownMenuItem
                    closeOnClick={false}
                    onSelect={() => toggleGroup(group.name)}
                    aria-expanded={expanded}
                    title={expanded ? t("chat.collapseProvider") : t("chat.expandProvider")}
                    className="model-selector-group-label sticky top-0 z-10 flex cursor-pointer items-center gap-1.5 rounded-md bg-popover/60 px-2 py-1.5 text-[calc(11px*var(--zone-font-scale,1))] font-medium uppercase tracking-wider text-muted-foreground/80 backdrop-blur-xl transition-colors data-[highlighted]:bg-muted/40 supports-[backdrop-filter]:bg-popover/40 dark:text-white/80"
                  >
                    <ProviderBrandIcon
                      type={group.providerType}
                      className="h-3.5 w-3.5 opacity-90"
                    />
                    <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                      {group.name}
                    </span>
                    <span className="inline-flex h-4 min-w-[1.1rem] shrink-0 items-center justify-center rounded-full bg-muted/70 px-1 text-[calc(10px*var(--zone-font-scale,1))] tabular-nums tracking-normal">
                      {group.opts.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                        expanded && "rotate-180",
                      )}
                    />
                  </DropdownMenuItem>
                  {expanded
                    ? group.opts.map((option) => {
                        const isSelected = option.value === selectedValue;
                        const itemAnimationDelay = `${Math.min(animationIndex, 5) * 0.025}s`;
                        animationIndex += 1;
                        return (
                          <DropdownMenuItem
                            key={option.value}
                            onSelect={() => {
                              const parsed = parseModelValue(option.value);
                              if (!parsed) return;
                              setSettings((current) => setSelectedModel(current, parsed));
                            }}
                            className={cn(
                              "model-selector-item group/item max-w-full justify-between gap-3 overflow-hidden rounded-md text-foreground transition-all duration-150 ease-out data-[highlighted]:translate-x-0.5 data-[highlighted]:bg-muted/40 dark:text-white",
                              isSelected && "bg-muted/60 font-medium text-foreground",
                            )}
                            style={{ animationDelay: itemAnimationDelay }}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <ProviderBrandIcon
                                type={option.providerType}
                                className={cn(
                                  "opacity-70 transition-opacity duration-150 group-data-[highlighted]/item:opacity-100",
                                  isSelected && "opacity-100",
                                )}
                              />
                              <span className="min-w-0 truncate">{option.model}</span>
                            </span>
                            {isSelected ? (
                              <Check className="h-4 w-4 shrink-0 text-primary" />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })
                    : null}
                </div>
              );
            });
          })()}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
