import {
  CheckCircle2,
  Cpu,
  MessageSquare,
  MonitorSmartphone,
  Moon,
  ScanText,
  Sun,
  Terminal,
  Wrench,
} from "../../components/icons";

import { SUPPORTED_LOCALES, useLocale } from "../../i18n";
import {
  type ExecutionMode,
  type FontScaleSettings,
  THEME_OPTIONS,
  type Theme,
  updateCustomSettings,
  updateSystem,
} from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2] as const;

export function SystemSettingsForm(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const executionMode = settings.system.executionMode;
  const fontScale = settings.customSettings.fontScale;

  const executionOptions: Array<{
    mode: ExecutionMode;
    title: string;
    description: string;
    icon: typeof MessageSquare;
  }> = [
    {
      mode: "text",
      title: t("settings.chatMode"),
      description: t("settings.chatModeDesc"),
      icon: MessageSquare,
    },
    {
      mode: "tools",
      title: t("settings.agentMode"),
      description: t("settings.agentModeDesc"),
      icon: Wrench,
    },
    {
      mode: "agent-dev",
      title: t("settings.agentDevMode"),
      description: t("settings.agentDevModeDesc"),
      icon: Cpu,
    },
  ];

  const fontScaleZones: Array<{ key: keyof FontScaleSettings; label: string }> = [
    { key: "sidebar", label: t("settings.fontSizeSidebar") },
    { key: "chat", label: t("settings.fontSizeChat") },
    { key: "rightDock", label: t("settings.fontSizeRightDock") },
  ];

  function getThemeLabel(theme: Theme) {
    if (theme === "light") return t("settings.light");
    if (theme === "dark") return t("settings.dark");
    return t("settings.auto");
  }

  function renderThemeIcon(theme: Theme) {
    if (theme === "light") return <Sun className="h-3.5 w-3.5" />;
    if (theme === "dark") return <Moon className="h-3.5 w-3.5" />;
    return <MonitorSmartphone className="h-3.5 w-3.5" />;
  }

  function getFontScaleLabel(value: number) {
    if (value === 0.9) return t("settings.fontSizeSmall");
    if (value === 1.1) return t("settings.fontSizeLarge");
    if (value === 1.2) return t("settings.fontSizeXLarge");
    return t("settings.fontSizeStandard");
  }

  function setZoneFontScale(zone: keyof FontScaleSettings, value: number) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        fontScale: { ...prev.customSettings.fontScale, [zone]: value },
      }),
    );
  }

  return (
    <div data-agent-settings-document className="agent-settings-document">
      <section className="agent-settings-group">
        <div className="agent-settings-group-header">
          <div>
            <div className="agent-settings-group-title">
              <Terminal className="h-4 w-4" />
              {t("settings.executionMode")}
            </div>
            <p className="agent-settings-group-description">{t("settings.executionModeDesc")}</p>
          </div>
        </div>

        <div className="agent-settings-option-list">
          {executionOptions.map((option) => {
            const selected = executionMode === option.mode;
            const Icon = option.icon;
            return (
              <button
                data-agent-setting-row
                data-selected={selected}
                key={option.mode}
                type="button"
                onClick={() =>
                  setSettings((prev) => updateSystem(prev, { executionMode: option.mode }))
                }
                className="agent-settings-option"
              >
                <span className="agent-settings-option-icon">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {selected ? <CheckCircle2 className="h-4 w-4 text-foreground" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="agent-settings-group">
        <div className="agent-settings-group-header">
          <div className="agent-settings-group-title">
            <Sun className="h-4 w-4" />
            {t("settings.appearance")}
          </div>
        </div>

        <div className="agent-settings-control-list">
          <div data-agent-setting-row className="agent-settings-control-row">
            <div className="agent-settings-control-copy">
              <div className="agent-settings-control-label">{t("settings.appearance")}</div>
              <div className="agent-settings-control-hint">{getThemeLabel(settings.theme)}</div>
            </div>
            <div data-agent-segmented-control className="agent-settings-segmented">
              {THEME_OPTIONS.map((theme) => {
                const selected = settings.theme === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    data-selected={selected}
                    onClick={() => setSettings((prev) => ({ ...prev, theme }))}
                  >
                    {renderThemeIcon(theme)}
                    <span>{getThemeLabel(theme)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div data-agent-setting-row className="agent-settings-control-row">
            <div className="agent-settings-control-copy">
              <div className="agent-settings-control-label">{t("settings.language")}</div>
              <div className="agent-settings-control-hint">{settings.locale}</div>
            </div>
            <div data-agent-segmented-control className="agent-settings-segmented">
              {SUPPORTED_LOCALES.map((locale) => {
                const selected = settings.locale === locale;
                const label = locale === "zh-CN" ? t("settings.chinese") : t("settings.english");
                return (
                  <button
                    key={locale}
                    type="button"
                    data-selected={selected}
                    onClick={() => setSettings((prev) => ({ ...prev, locale }))}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {locale === "zh-CN" ? "ZH" : "EN"}
                    </span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="agent-settings-group">
        <div className="agent-settings-group-header">
          <div>
            <div className="agent-settings-group-title">
              <ScanText className="h-4 w-4" />
              {t("settings.fontSize")}
            </div>
            <p className="agent-settings-group-description">{t("settings.fontSizeDesc")}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateCustomSettings(prev, {
                  fontScale: { sidebar: 1, chat: 1, rightDock: 1 },
                }),
              )
            }
            className="agent-settings-reset"
          >
            {t("settings.fontSizeReset")}
          </button>
        </div>

        <div className="agent-settings-control-list">
          {fontScaleZones.map((zone) => (
            <div data-agent-setting-row key={zone.key} className="agent-settings-control-row">
              <div className="agent-settings-control-copy">
                <div className="agent-settings-control-label">{zone.label}</div>
                <div className="agent-settings-control-hint">
                  {getFontScaleLabel(fontScale[zone.key])}
                </div>
              </div>
              <div data-agent-segmented-control className="agent-settings-segmented">
                {FONT_SCALE_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-selected={fontScale[zone.key] === value}
                    onClick={() => setZoneFontScale(zone.key, value)}
                  >
                    {getFontScaleLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
