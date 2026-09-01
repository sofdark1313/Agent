import appLogoUrl from "../../../src-tauri/icons/icon-simple.png";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from "../../components/icons";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import type { AppUpdateCheckResult, AppUpdateController } from "../../lib/appUpdates";
import { updateUpdateSettings } from "../../lib/settings";
import { formatReleaseDate } from "./aboutDate";
import { AgentActivationSwitch } from "./shared";
import type { SettingsSectionProps } from "./types";

type AboutSectionProps = SettingsSectionProps & {
  appUpdate: AppUpdateController;
};

function releaseTitle(result?: AppUpdateCheckResult) {
  if (!result) return "";
  return result.releaseName?.trim() || result.releaseTag?.trim() || result.version || "";
}

function normalizeTitle(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function releaseNotesBody(result?: AppUpdateCheckResult) {
  const body = result?.body?.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, "").trim();
  if (!body) return "";

  const title = normalizeTitle(releaseTitle(result));
  if (!title) return body;

  const lines = body.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line: string) => line.trim());
  if (firstContentIndex < 0) return "";

  const firstContentLine = lines[firstContentIndex].trim();
  if (/^#\s+/.test(firstContentLine) && normalizeTitle(firstContentLine) === title) {
    return lines
      .slice(firstContentIndex + 1)
      .join("\n")
      .trim();
  }

  return body;
}

export function AboutSection(props: AboutSectionProps) {
  const { settings, setSettings, appUpdate } = props;
  const { t, locale } = useLocale();
  const isEn = locale !== "zh-CN";
  const includePrereleases = settings.updates.includePrereleases;
  const checkState = appUpdate?.state || { status: "ready" };

  async function handleInstallUpdate() {
    await appUpdate?.installOnly?.().catch(() => undefined);
  }

  async function handleRestartApp() {
    if (checkState.status !== "installed") return;
    await appUpdate?.restart?.().catch(() => undefined);
  }

  const latestResult = appUpdate?.result;
  const latestReleaseNotes = releaseNotesBody(latestResult);
  const channelLabel =
    latestResult?.channel === "prerelease"
      ? t("settings.aboutChannelPrerelease")
      : t("settings.aboutChannelStable");
  const currentVersion = latestResult?.currentVersion || "1.0.0";
  const nextVersion = latestResult?.version || latestResult?.releaseTag || "";
  const releaseDate = formatReleaseDate(latestResult?.date);
  const checking = checkState.status === "checking";
  const installing = checkState.status === "installing";
  const installed = checkState.status === "installed";
  const restarting = checkState.status === "restarting";
  const canInstall = appUpdate?.canInstall;

  const isUpToDate = latestResult?.configured && !latestResult?.available && !latestResult?.manualDownload && checkState.status !== "error";
  const hasUpdate = latestResult?.available || latestResult?.manualDownload;

  const statusTitle =
    checkState.status === "error"
      ? t("settings.aboutUpdateError")
      : checking
        ? t("settings.aboutChecking")
        : installing
          ? t("settings.aboutInstalling")
          : restarting
            ? t("settings.aboutRestarting")
            : installed
              ? t("settings.aboutInstalled")
              : latestResult?.available
                ? t("settings.aboutUpdateAvailable")
                : latestResult?.manualDownload
                  ? t("settings.aboutManualUpdate")
                  : latestResult?.configured
                    ? t("settings.aboutUpToDate")
                    : t("settings.aboutUpdaterNotConfigured");

  const statusDescription =
    checkState.status === "error"
      ? appUpdate?.message || t("settings.aboutUpdateError")
      : checking
        ? t("settings.aboutCheckingDesc")
        : installing
          ? t("settings.aboutInstallingDesc")
          : restarting
            ? t("settings.aboutRestartingDesc")
            : installed
              ? t("settings.aboutInstalledDesc")
              : latestResult?.available
                ? t("settings.aboutUpdateAvailableDesc")
                : latestResult?.manualDownload
                  ? t("settings.aboutManualUpdateDesc")
                  : latestResult?.configured
                    ? t("settings.aboutUpToDateDesc")
                    : latestResult?.message || t("settings.aboutUpdaterNotConfiguredDesc");

  function openExternal(url: string) {
    if (!url) return;
    try {
      openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <div className="space-y-6 pb-6">
      {/* 1. Hero Brand Card */}
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card/95 to-muted/30 p-6 sm:p-8 shadow-sm">
        {/* Subtle decorative glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-primary/5 blur-2xl" aria-hidden="true" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4 sm:items-center sm:gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background/80 p-2.5 shadow-md ring-1 ring-border/50">
              <img
                src={appLogoUrl}
                alt="Agent Logo"
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  Agent
                </h2>
                <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
                  v{currentVersion}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {channelLabel}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {isEn
                  ? "High-performance cross-platform AI Agent workspace engineered for full-stack development and automation."
                  : "专为全栈研发与自动化打造的高性能跨平台 AI 智能体应用平台"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:self-center">
            {latestResult?.releaseUrl ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-xl text-xs font-medium"
                onClick={() => openExternal(latestResult.releaseUrl || "")}
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                {t("settings.aboutOpenRelease")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={hasUpdate ? "default" : "outline"}
              size="sm"
              className="h-9 gap-1.5 rounded-xl text-xs font-medium shadow-xs"
              onClick={() => void appUpdate?.runCheck?.().catch(() => undefined)}
              disabled={checking || installing || restarting}
            >
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("settings.aboutCheckUpdate")}
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Update Status Card */}
      <div
        className="relative overflow-hidden rounded-2xl border p-4.5 transition-colors sm:p-5"
        style={{
          borderColor: isUpToDate
            ? "hsl(var(--border) / 0.7)"
            : hasUpdate
              ? "hsl(var(--primary) / 0.4)"
              : "hsl(var(--border) / 0.7)",
          backgroundColor: isUpToDate
            ? "hsl(var(--card))"
            : hasUpdate
              ? "hsl(var(--primary) / 0.04)"
              : "hsl(var(--card))",
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: checkState.status === "error"
                  ? "hsl(var(--destructive) / 0.1)"
                  : isUpToDate
                    ? "rgba(16, 185, 129, 0.1)"
                    : "hsl(var(--primary) / 0.1)",
                color: checkState.status === "error"
                  ? "hsl(var(--destructive))"
                  : isUpToDate
                    ? "rgb(16, 185, 129)"
                    : "hsl(var(--primary))",
              }}
            >
              {checkState.status === "error" ? (
                <AlertTriangle className="h-4.5 w-4.5" />
              ) : restarting || checking || installing ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
              ) : installed ? (
                <CheckCircle2 className="h-4.5 w-4.5" />
              ) : hasUpdate ? (
                <Download className="h-4.5 w-4.5" />
              ) : (
                <CheckCircle2 className="h-4.5 w-4.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{statusTitle}</h3>
                {nextVersion && hasUpdate ? (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                    v{nextVersion}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {statusDescription}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:shrink-0">
            {hasUpdate || installed ? (
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-4 text-xs font-medium shadow-xs"
                onClick={installed ? handleRestartApp : handleInstallUpdate}
                disabled={(installed ? false : !canInstall) || installing || restarting}
              >
                {installing || restarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : installed ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {installed ? t("settings.aboutRestartApp") : t("settings.aboutInstallUpdate")}
              </Button>
            ) : null}
          </div>
        </div>

        {nextVersion && (hasUpdate || releaseDate) ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs sm:grid-cols-4">
            <div className="rounded-xl bg-muted/40 p-2.5">
              <span className="text-[11px] text-muted-foreground">{t("settings.aboutLatestVersion")}</span>
              <div className="mt-0.5 font-mono font-semibold text-foreground">v{nextVersion}</div>
            </div>
            <div className="rounded-xl bg-muted/40 p-2.5">
              <span className="text-[11px] text-muted-foreground">{t("settings.aboutReleaseDate")}</span>
              <div className="mt-0.5 truncate font-medium text-foreground">{releaseDate || "最新"}</div>
            </div>
            <div className="rounded-xl bg-muted/40 p-2.5">
              <span className="text-[11px] text-muted-foreground">更新源通道</span>
              <div className="mt-0.5 font-medium text-foreground">{channelLabel}</div>
            </div>
            <div className="rounded-xl bg-muted/40 p-2.5">
              <span className="text-[11px] text-muted-foreground">代码仓库</span>
              <div className="mt-0.5 truncate font-medium text-foreground">
                {latestResult?.repository || "sofdark1313/Agent"}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 3. Core Architecture & Tech Specs Grid */}
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          {isEn ? "Tech Specs & Architecture" : "技术规格与架构支持 (Tech Specs)"}
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-2xs">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Cpu className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{isEn ? "Native Desktop Core" : "原生桌面核心"}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Tauri v2 + Rust + Tokio</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-2xs">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{isEn ? "Modern Frontend Engine" : "现代前端引擎"}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">React 19 + Tailwind CSS</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-2xs">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{isEn ? "Agents & Protocols" : "智能体与协议"}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">MCP Bridge + Go Gateway</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-2xs">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Terminal className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{isEn ? "Dev & Terminal Workspaces" : "工程与会话"}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">PTY + Monaco + Russh</p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Lower Two-Column Section */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Left Column: Release Notes / Feature Highlights */}
        <section className="flex flex-col rounded-2xl border border-border/60 bg-card p-5 shadow-2xs">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {latestReleaseNotes ? releaseTitle(latestResult) || (isEn ? "Release Notes" : "更新说明") : (isEn ? "Features & Capabilities" : "产品特性与能力")}
              </h3>
            </div>
            {latestResult?.releaseUrl ? (
              <button
                type="button"
                onClick={() => openExternal(latestResult.releaseUrl || "")}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                查看 GitHub <ExternalLink className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          {latestReleaseNotes ? (
            <div className="max-h-72 flex-1 overflow-y-auto rounded-xl border border-border/40 bg-background/50 p-3.5 text-xs leading-relaxed text-muted-foreground">
              <Markdown
                content={latestReleaseNotes}
                className="release-notes-markdown text-xs leading-relaxed text-muted-foreground"
              />
            </div>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-border/40 bg-background/40 p-4 text-xs leading-relaxed text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span><strong>多模型协同</strong>：支持 OpenAI、Claude、Gemini、DeepSeek 及各类本地/代理大模型。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span><strong>工程研发生态</strong>：内置 Monaco 代码编辑、实时 Diff 对比、PTY 终端与 Git 审查。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span><strong>自动化与扩展</strong>：Skills 自定义技能库、Cron 周期调度任务与子 Agent 协同。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span><strong>远程与网关</strong>：支持 gRPC Gateway 远程控制与全功能 Web 控制台访问。</span>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Update Settings & Safe Execution Card */}
        <aside className="space-y-4">
          {/* Pre-release toggle */}
          <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-2xs">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Shield className="h-4 w-4 text-primary" />
                  {t("settings.aboutPrereleaseTitle")}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.aboutPrereleaseDesc")}
                </p>
              </div>
              <AgentActivationSwitch
                checked={includePrereleases}
                title={t("settings.aboutPrereleaseToggle")}
                onToggle={() =>
                  setSettings((prev) =>
                    updateUpdateSettings(prev, {
                      includePrereleases: !prev.updates.includePrereleases,
                    }),
                  )
                }
              />
            </div>
          </section>

          {/* Privacy and Security Notice */}
          <section className="space-y-2.5 rounded-2xl border border-border/60 bg-card p-5 shadow-2xs">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lock className="h-4 w-4 text-emerald-500" />
              <span>{isEn ? "Data Privacy & Local Security" : "数据隐私与安全保障"}</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isEn
                ? "All API keys, conversations, workspaces, and system configurations are stored locally and encrypted."
                : "所有 API 密钥、会话记录、项目工作区及系统配置均采用本地加密存储，绝不上传至任何未经授权的第三方服务器。"}
            </p>
            <div className="pt-1 text-[11px] text-muted-foreground/70">
              MIT License · sofdark1313 / Agent
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
