import { useLocale } from "../../i18n";
import { Globe } from "../../components/icons";
import { LocalTunnelPanel } from "../../components/project-tools/LocalTunnelPanel";
import type { SettingsSectionProps } from "./types";

export function TunnelSection(props: SettingsSectionProps) {
  const { t, locale } = useLocale();
  const isEn = locale !== "zh-CN";
  const { settings } = props;
  const activeProject = settings.system.workspaceProjects?.find(
    (p) => p.id === settings.system.activeWorkspaceProjectId,
  );
  const activeProjectPath = activeProject?.path || settings.system.workdir || undefined;
  const publicBaseUrl = settings.remote.gatewayUrl || "http://localhost:50052";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("settings.navTunnel")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isEn
              ? "Securely expose local HTTP services via Gateway, supporting port mapping, TTL countdown, and live health checks."
              : "通过 Gateway 安全暴露本地 HTTP 服务，支持端口映射、TTL 倒计时与实时健康检查。"}
          </p>
        </div>
      </div>

      <div className="min-h-[460px] overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-2xs">
        <LocalTunnelPanel
          active={true}
          client={null}
          enabled={settings.remote.enabled}
          projectPathKey={activeProjectPath}
          publicBaseUrl={publicBaseUrl}
          onOpenExternal={(url) => window.open(url, "_blank")}
        />
      </div>
    </div>
  );
}
