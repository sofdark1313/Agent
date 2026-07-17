import { useLocale } from "../i18n";
import { type AppUpdateController, getAppUpdateDisplayVersion } from "../lib/appUpdates";
import { cn } from "../lib/shared/utils";
import { Download, Loader2 } from "./icons";
import { Button } from "./ui/button";

type AppUpdateButtonProps = {
  appUpdate: AppUpdateController;
  className?: string;
  iconOnly?: boolean;
  iconClassName?: string;
};

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

export function AppUpdateButton({
  appUpdate,
  className,
  iconOnly = false,
  iconClassName,
}: AppUpdateButtonProps) {
  const { t } = useLocale();
  if (!appUpdate.showUpdateButton) {
    return null;
  }

  const version = getAppUpdateDisplayVersion(appUpdate.result);
  const busy = appUpdate.installing || appUpdate.restarting;
  const title =
    appUpdate.status === "error" && appUpdate.message
      ? interpolate(t("appUpdate.failedRetry"), { message: appUpdate.message })
      : version
        ? interpolate(t("appUpdate.updateTo"), { version })
        : t("appUpdate.update");

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      className={cn(
        "h-[22px] shrink-0 gap-[3px] rounded-full bg-[#4096ff] px-2 text-[11px] font-medium leading-none text-white shadow-none hover:bg-[#1677ff] hover:text-white active:bg-[#0958d9]",
        className,
      )}
      disabled={busy}
      title={title}
      aria-label={title}
      onClick={() => void appUpdate.installAndRestart().catch(() => undefined)}
    >
      {busy ? (
        <Loader2
          className={cn(iconOnly ? "h-4 w-4" : "h-[13px] w-[13px]", iconClassName, "animate-spin")}
        />
      ) : (
        <Download className={cn(iconOnly ? "h-4 w-4" : "h-[13px] w-[13px]", iconClassName)} />
      )}
      {iconOnly ? null : t("appUpdate.update")}
    </Button>
  );
}
