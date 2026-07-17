import { useLocale } from "../../i18n";
import type { AppUpdateController } from "../../lib/appUpdates";
import type { SectionId } from "../../pages/settings/types";
import { AppUpdateButton } from "../AppUpdateButton";
import { AgentMark } from "../brand/AgentMark";
import { APP_NAME } from "../brand/brand";
import { Info, Moon, MoreHorizontal, Settings, Sun } from "../icons";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type AgentAppMenuProps = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: (section?: SectionId) => void;
  appUpdate?: AppUpdateController;
};

export function AgentAppMenu({
  theme,
  onToggleTheme,
  onOpenSettings,
  appUpdate,
}: AgentAppMenuProps) {
  const { t } = useLocale();
  const ThemeIcon = theme === "dark" ? Moon : Sun;

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="agent-nav-item h-9 w-full min-w-0 justify-start gap-2.5 px-2 text-[13px] font-normal"
            />
          }
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <AgentMark className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">{APP_NAME}</span>
          <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="min-w-56 rounded-xl border-border/70 bg-popover/98 p-1.5 shadow-[var(--agent-shadow-menu)]"
        >
          <DropdownMenuItem
            onSelect={() => onOpenSettings()}
            className="gap-2 rounded-lg px-2.5 py-2"
          >
            <Settings className="h-4 w-4" />
            {t("tooltip.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleTheme} className="gap-2 rounded-lg px-2.5 py-2">
            <ThemeIcon className="h-4 w-4" />
            {t("settings.appearance")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-border/60" />
          <DropdownMenuItem
            onSelect={() => onOpenSettings("about")}
            className="gap-2 rounded-lg px-2.5 py-2"
          >
            <Info className="h-4 w-4" />
            {t("settings.navAbout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {appUpdate?.showUpdateButton ? (
        <AppUpdateButton
          appUpdate={appUpdate}
          iconOnly
          iconClassName="h-3.5 w-3.5"
          className="h-8 w-8 rounded-lg bg-foreground px-0 text-background hover:bg-foreground/85 hover:text-background"
        />
      ) : null}
    </div>
  );
}
