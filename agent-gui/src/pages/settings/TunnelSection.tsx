import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMemo } from "react";
import { useLocale } from "../../i18n";
import { Globe } from "../../components/icons";
import { LocalTunnelPanel, type LocalTunnelClient } from "../../components/project-tools/LocalTunnelPanel";
import type {
  TunnelCreateInput,
  TunnelStateSnapshot,
  TunnelUpdateInput,
} from "../../lib/tunnels/constants";
import type { SettingsSectionProps } from "./types";

function createTauriTunnelClient(): LocalTunnelClient {
  const listeners = new Set<(snapshot: TunnelStateSnapshot) => void>();
  let unlistenPromise: Promise<() => void> | null = null;
  const normalizeSnapshot = (payload: unknown): TunnelStateSnapshot => {
    const raw = (payload ?? {}) as Partial<TunnelStateSnapshot>;
    return {
      revision: raw.revision ?? 0,
      agentOnline: raw.agentOnline === true,
      relay: raw.relay ?? null,
      tunnels: raw.tunnels ?? [],
      gatewayUnsupported: raw.gatewayUnsupported === true,
    };
  };
  return {
    subscribeTunnelState: (listener) => {
      listeners.add(listener);
      if (!unlistenPromise) {
        unlistenPromise = listen<TunnelStateSnapshot>("gateway:tunnel-state", (event) => {
          const snapshot = normalizeSnapshot(event.payload);
          for (const subscriber of [...listeners]) {
            subscriber(snapshot);
          }
        });
      }
      void invoke<TunnelStateSnapshot>("gateway_tunnel_state")
        .then((payload) => {
          if (listeners.has(listener)) {
            listener(normalizeSnapshot(payload));
          }
        })
        .catch(() => {});
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unlistenPromise) {
          const pending = unlistenPromise;
          unlistenPromise = null;
          void pending.then((unlisten) => unlisten()).catch(() => {});
        }
      };
    },
    createTunnel: (input: TunnelCreateInput) => invoke<void>("gateway_tunnel_create", { input }),
    updateTunnel: (input: TunnelUpdateInput) => invoke<void>("gateway_tunnel_update", { input }),
    closeTunnel: (id: string) => invoke<void>("gateway_tunnel_close", { tunnel_id: id }),
    checkTunnel: (id?: string) => invoke<void>("gateway_tunnel_check", { tunnel_id: id }),
  };
}

export function TunnelSection(props: SettingsSectionProps) {
  const { t, locale } = useLocale();
  const isEn = locale !== "zh-CN";
  const { settings } = props;
  const client = useMemo(() => createTauriTunnelClient(), []);
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
          client={client}
          enabled={settings.remote.enabled}
          projectPathKey={activeProjectPath}
          publicBaseUrl={publicBaseUrl}
          onOpenExternal={(url) => window.open(url, "_blank")}
        />
      </div>
    </div>
  );
}
