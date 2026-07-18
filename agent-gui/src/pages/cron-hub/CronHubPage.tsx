import { HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import { Clock3 } from "../../components/icons";
import { useLocale } from "../../i18n";
import type { AppSettings } from "../../lib/settings";
import { CronSection } from "../settings/CronSection";

export function CronHubPage(props: {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
}) {
  const { settings, setSettings, sidebarOpen, onOpenSidebar } = props;
  const { t } = useLocale();

  return (
    <div
      data-agent-cron-hub
      className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <HubBackdrop tone="amber" />
      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<Clock3 className="h-5 w-5" />}
          title={t("settings.cronTitle")}
          subtitle={t("settings.cronDesc")}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
        />
        <div className="hub-scroll min-h-0 flex-1 overflow-auto px-5 pb-8 pt-5 sm:px-6 lg:px-8 xl:px-10">
          <div className="hub-content-stage mx-auto w-full max-w-[1320px]">
            <CronSection settings={settings} setSettings={setSettings} hubMode />
          </div>
        </div>
      </div>
    </div>
  );
}
