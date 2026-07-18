import { memo, type ReactNode } from "react";
import { Moon, PanelLeft, Settings, Sun } from "../../../components/icons";
import { isMacOsTauri } from "../../../components/MacOsTitleBarSpacer";
import { Button } from "../../../components/ui/button";
import { useLocale } from "../../../i18n";
import {
  type AppSettings,
  type EffectiveTheme,
  getNextTheme,
  resolveEffectiveTheme,
} from "../../../lib/settings";
import type { SectionId } from "../../settings/types";

function ThemeToggleIcon(props: { theme: EffectiveTheme }) {
  if (props.theme === "light") return <Sun className="h-4.5 w-4.5" />;
  return <Moon className="h-4.5 w-4.5" />;
}

export const ChatHeader = memo(function ChatHeader(props: {
  settings: AppSettings;
  sidebarOpen: boolean;
  onOpenSettings: (section?: SectionId) => void;
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  preThemeActions?: ReactNode;
  trailingActions?: ReactNode;
}) {
  const {
    settings,
    sidebarOpen,
    onOpenSettings,
    onToggleTheme,
    onOpenSidebar,
    preThemeActions,
    trailingActions,
  } = props;
  const { t } = useLocale();
  const effectiveTheme = resolveEffectiveTheme(settings.theme);
  const nextTheme = getNextTheme(settings.theme);
  const themeToggleTitle =
    nextTheme === "light" ? t("tooltip.switchToLight") : t("tooltip.switchToDark");

  return (
    <header
      data-agent-topbar
      data-tauri-drag-region
      className="agent-topbar flex h-11 items-center justify-between gap-2 border-b border-border/55 bg-background/96 px-3"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {!sidebarOpen && !isMacOsTauri() ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSidebar}
            title={t("tooltip.openSidebar")}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <PanelLeft className="h-4.5 w-4.5" />
          </Button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {preThemeActions}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          title={themeToggleTitle}
          aria-label={themeToggleTitle}
          className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <ThemeToggleIcon theme={effectiveTheme} />
        </Button>
        {!sidebarOpen && !isMacOsTauri() ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenSettings()}
            title={t("tooltip.settings")}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4.5 w-4.5" />
          </Button>
        ) : null}
        {trailingActions}
      </div>
    </header>
  );
});
