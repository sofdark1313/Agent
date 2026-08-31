import { useLocale } from "../../i18n";
import { BackgroundTasksPanel } from "../../components/project-tools/BackgroundTasksPanel";
import { Terminal } from "../../components/icons";

export function BackgroundTasksSection() {
  const { t, locale } = useLocale();
  const isEn = locale !== "zh-CN";
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Terminal className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("settings.navBackgroundTasks")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isEn
              ? "View and manage background processes running by AI agents (dev servers, async commands, watchers, etc.)."
              : "查看与管理 AI 智能体运行的后台进程（开发服务、异步命令、监听脚本等）。"}
          </p>
        </div>
      </div>

      <div className="min-h-[460px] overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-2xs">
        <BackgroundTasksPanel active={true} />
      </div>
    </div>
  );
}
