import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Globe,
  Terminal,
  BookOpen,
  Brain,
  Cloud,
  Cpu,
  Key,
  Settings2,
  Wrench,
  Zap,
} from "@/components/icons";
const isMacOsTauri = () => false; const MacOsTitleBarSpacer = (props: any) => null;

import { useLocale } from "@/i18n";
import { AboutSection } from "./settings/AboutSection";
import { AgentsSection } from "./settings/AgentsSection";
import { HooksSection } from "./settings/HooksSection";
import { MemoryPanel } from "./settings/memory/MemoryPanel";
import { ProvidersSection } from "./settings/ProvidersSection";
import { RemoteSection } from "./settings/RemoteSection";
import { TunnelSection } from "./settings/TunnelSection";
import { BackgroundTasksSection } from "./settings/BackgroundTasksSection";
import { SshSection } from "./settings/SshSection";
import { SystemSettingsForm } from "./settings/SystemSettingsForm";
import { SystemToolsSection } from "./settings/SystemToolsSection";
import type { SectionId, SettingsPageProps } from "./settings/types";

function getSaveIndicator(state: SettingsPageProps["saveState"], t: (key: string) => string) {
  switch (state.status) {
    case "saving":
      return {
        dotClass: "bg-amber-500 animate-pulse",
        text: t("settings.saving"),
        title: t("settings.savingDesc"),
      };
    case "error":
      return {
        dotClass: "bg-destructive",
        text: t("settings.saveError"),
        title: state.message,
      };
    default:
      return {
        dotClass: "bg-emerald-500",
        text: t("settings.saved"),
        title: t("settings.savedDesc"),
      };
  }
}

type NavItemProps = {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`settings-nav-item agent-nav-item group relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors duration-150 ${
        active
          ? "settings-nav-item-active bg-foreground/[0.07] font-medium text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center transition-colors ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
      >
        {icon}
      </span>
      <span className="truncate leading-none">{label}</span>
    </button>
  );
}

type NavGroup = {
  labelKey: string;
  items: Array<{ id: SectionId; icon: ReactNode }>;
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "settings.groupPersonal",
    items: [
      { id: "system", icon: <Settings2 className="h-3.5 w-3.5" /> },
      { id: "providers", icon: <Cpu className="h-3.5 w-3.5" /> },
      { id: "agents", icon: <BookOpen className="h-3.5 w-3.5" /> },
    ],
  },
  {
    labelKey: "settings.groupIntegrationsCoding",
    items: [
      { id: "memory", icon: <Brain className="h-3.5 w-3.5" /> },
      { id: "systemTools", icon: <Wrench className="h-3.5 w-3.5" /> },
      { id: "hooks", icon: <Zap className="h-3.5 w-3.5" /> },
      { id: "ssh", icon: <Key className="h-3.5 w-3.5" /> },
      { id: "remote", icon: <Cloud className="h-3.5 w-3.5" /> },
      { id: "tunnel", icon: <Globe className="h-3.5 w-3.5" /> },
      { id: "backgroundTasks", icon: <Terminal className="h-3.5 w-3.5" /> },
    ],
  },
];

export function SettingsPage(props: SettingsPageProps) {
  const {
    settings,
    setSettings,
    saveState,
    onBack,
    initialSection = "system",
    hiddenSections = [],
    appUpdate,
  } = props;
  const { t } = useLocale();
  const [section, setSection] = useState<SectionId>(initialSection);

  const sectionLabels = useMemo<Record<SectionId, string>>(
    () => ({
      system: t("settings.navSystem"),
      systemTools: t("settings.navSystemTools"),
      providers: t("settings.navProviders"),
      agents: t("settings.navAgents"),
      ssh: t("settings.navSsh"),
      memory: t("settings.navMemory"),
      hooks: t("settings.navHooks"),
      remote: t("settings.navRemote"),
      tunnel: t("settings.navTunnel"),
      backgroundTasks: t("settings.navBackgroundTasks"),
      about: t("settings.navAbout"),
    }),
    [t],
  );

  const hiddenSectionSet = useMemo(() => new Set(hiddenSections), [hiddenSections]);
  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        label: t(group.labelKey),
        items: group.items
          .filter((item) => !hiddenSectionSet.has(item.id))
          .map((item) => ({ ...item, label: sectionLabels[item.id] })),
      })).filter((group) => group.items.length > 0),
    [hiddenSectionSet, sectionLabels, t],
  );
  const allNavItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (section === "about" || allNavItems.some((item) => item.id === section)) {
      return;
    }
    setSection(allNavItems[0]?.id ?? "system");
  }, [allNavItems, section]);

  const saveIndicator = getSaveIndicator(saveState, t);
  const sectionContent = (() => {
    switch (section) {
      case "providers":
        return <ProvidersSection settings={settings} setSettings={setSettings} />;
      case "system":
        return <SystemSettingsForm settings={settings} setSettings={setSettings} />;
      case "systemTools":
        return <SystemToolsSection settings={settings} setSettings={setSettings} />;
      case "hooks":
        return <HooksSection settings={settings} setSettings={setSettings} />;
      case "agents":
        return <AgentsSection settings={settings} setSettings={setSettings} />;
      case "ssh":
        return <SshSection settings={settings} setSettings={setSettings} />;
      case "remote":
        return <RemoteSection settings={settings} setSettings={setSettings} />;
      case "tunnel":
        return <TunnelSection settings={settings} setSettings={setSettings} />;
      case "backgroundTasks":
        return <BackgroundTasksSection />;
      case "memory":
        return (
          <MemoryPanel
            workdir={settings.system.workdir}
            settings={settings}
            setSettings={setSettings}
          />
        );
      case "about":
        return <AboutSection settings={settings} setSettings={setSettings} appUpdate={appUpdate} />;
      default: {
        const unreachable: never = section;
        return unreachable;
      }
    }
  })();

  const onMac = isMacOsTauri();

  return (
    <div data-agent-settings className="flex h-full flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <aside
          data-agent-settings-nav
          className="settings-sidebar flex w-[236px] shrink-0 flex-col border-r border-border/60 bg-[hsl(var(--agent-sidebar))]"
        >
          {onMac && <div data-tauri-drag-region className="h-[38px] shrink-0" />}
          <div className="px-3 pb-2 pt-3">
            <button
              type="button"
              onClick={onBack}
              className="settings-back-button flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span>{t("settings.backToChat")}</span>
            </button>

            <div className="mt-3 flex h-8 items-center px-2">
              <span className="text-[15px] font-semibold tracking-[-0.01em]">
                {t("settings.title")}
              </span>
            </div>
          </div>

          <nav className="settings-nav flex-1 overflow-y-auto px-3 pb-3 pt-1">
            {navGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
                <div className="mb-1 px-2 text-[10px] font-medium tracking-wide text-muted-foreground/55">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      active={section === item.id}
                      onClick={() => setSection(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-border/60 px-3 py-2.5">
            <div
              className="flex items-center gap-1.5 px-2.5 text-[11px] text-muted-foreground"
              title={saveIndicator.title}
            >
              <div className={`h-1.5 w-1.5 rounded-full ${saveIndicator.dotClass}`} />
              {saveIndicator.text}
            </div>
          </div>
        </aside>

        <main data-agent-settings-content className="flex min-w-0 flex-1 flex-col">
          <MacOsTitleBarSpacer />
          <div
            data-agent-settings-header
            className="flex h-[52px] shrink-0 items-center border-b border-border/60 px-8"
          >
            <div key={section} className="settings-section-title-enter min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                {sectionLabels[section]}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.title")}</div>
            </div>
          </div>

          <div
            data-agent-settings-body
            key={section}
            className={`settings-section-enter flex-1 px-8 py-7 ${
              section === "hooks" || section === "providers" || section === "memory"
                ? "flex min-h-0 flex-col overflow-hidden"
                : "overflow-auto"
            }`}
          >
            <div
              className={`settings-section-shell w-full ${
                section === "hooks" || section === "providers" || section === "memory"
                  ? "flex min-h-0 flex-1 flex-col"
                  : "min-h-full"
              }`}
            >
              {sectionContent}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
