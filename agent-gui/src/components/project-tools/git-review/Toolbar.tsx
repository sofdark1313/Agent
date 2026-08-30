// GitReview toolbar: panel header (branch summary, remote actions, counters,
// mode/pane switchers) plus the modal dialogs and the operation toast shared
// by the status and history views.
//
// MIRROR NOTICE: every file under components/project-tools/git-review exists
// byte-for-byte in both frontends (agent-gui/src and
// agent-gateway/web/src). Keep changes in sync on both ends; only
// relative or @tauri-apps/* imports are allowed here.

import { useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../../i18n";
import { GitBranchSelector } from "../../git/GitBranchSelector";
import { cn } from "../../../lib/shared/utils";
import {
  AlertTriangle,
  BrushCleaning,
  CheckCircle2,
  Cloud,
  Download,
  Eye,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
  XCircle,
} from "../../icons";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  type GitBranchFromCommitState,
  type GitDiscardConfirmState,
  type GitOperationNotice,
  type GitRemoteSetupAction,
  type GitReviewStackedPane,
  remoteSetupDescriptionKey,
  remoteSetupSubmitKey,
} from "./model";
import type { GitReviewData } from "./useGitReviewData";

const GIT_REVIEW_STACKED_PANE_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function GitRemoteSetupModal(props: {
  open: boolean;
  action: GitRemoteSetupAction;
  workdir: string;
  branch: string;
  remoteUrl: string;
  loading: boolean;
  error: string;
  onRemoteUrlChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const {
    open,
    action,
    workdir,
    branch,
    remoteUrl,
    loading,
    error,
    onRemoteUrlChange,
    onClose,
    onSubmit,
  } = props;
  const { t } = useLocale();
  const titleId = useId();
  const remoteUrlId = useId();

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <form
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="border-b border-border/60 px-5 py-4">
          <div id={titleId} className="text-sm font-semibold text-foreground">
            {t("projectTools.gitReview.remoteSetupTitle")}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {t(remoteSetupDescriptionKey(action))}
          </div>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              title={branch}
            >
              {branch}
            </div>
            <div
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              title={workdir}
            >
              {workdir}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={remoteUrlId} className="text-xs text-muted-foreground">
              {t("projectTools.gitReview.remoteUrl")}
            </label>
            <Input
              id={remoteUrlId}
              value={remoteUrl}
              onChange={(event) => onRemoteUrlChange(event.target.value)}
              className="h-9 text-[calc(11px*var(--zone-font-scale,1))] placeholder:text-[calc(11px*var(--zone-font-scale,1))]"
              placeholder={t("projectTools.gitReview.remoteUrlPlaceholder")}
              autoFocus
              disabled={loading}
            />
          </div>
          {error ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("chat.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={loading || !remoteUrl.trim()}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : action === "push" ? (
              <Upload className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t(remoteSetupSubmitKey(action))}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function GitDiscardConfirmModal(props: {
  target: GitDiscardConfirmState | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { target, loading, onClose, onConfirm } = props;
  const { t } = useLocale();
  const titleId = useId();

  if (!target) return null;

  const isAll = target.kind === "all";
  const title = isAll
    ? t("projectTools.gitReview.discardAllChanges")
    : t("projectTools.gitReview.discardChanges");
  const description = isAll
    ? t("projectTools.gitReview.discardAllConfirm")
    : t("projectTools.gitReview.discardConfirm").replace("{path}", target.path);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <div id={titleId} className="text-sm font-semibold text-foreground">
              {title}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("chat.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isAll ? (
              <Trash2 className="h-3.5 w-3.5" />
            ) : (
              <BrushCleaning className="h-3.5 w-3.5" />
            )}
            {title}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GitBranchFromCommitModal(props: {
  target: GitBranchFromCommitState | null;
  branchName: string;
  loading: boolean;
  error: string;
  onBranchNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { target, branchName, loading, error, onBranchNameChange, onClose, onSubmit } = props;
  const { t } = useLocale();
  const titleId = useId();
  const branchNameId = useId();

  if (!target) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <form
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="border-b border-border/60 px-5 py-4">
          <div id={titleId} className="text-sm font-semibold text-foreground">
            {t("projectTools.gitReview.createBranchFromCommitTitle")}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("projectTools.gitReview.createBranchFromCommitDescription")
              .replace("{sha}", target.shortSha)
              .replace("{subject}", target.subject || target.shortSha)}
          </div>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="font-mono text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
              {target.shortSha}
            </div>
            <div className="mt-1 truncate font-medium" title={target.subject}>
              {target.subject || target.commitSha}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={branchNameId} className="text-xs text-muted-foreground">
              {t("projectTools.gitReview.branchName")}
            </label>
            <Input
              id={branchNameId}
              value={branchName}
              onChange={(event) => onBranchNameChange(event.target.value)}
              className="h-9 text-[calc(11px*var(--zone-font-scale,1))] placeholder:text-[calc(11px*var(--zone-font-scale,1))]"
              placeholder={t("projectTools.gitReview.branchNamePlaceholder")}
              autoFocus
              disabled={loading}
            />
          </div>
          {error ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("chat.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={loading || !branchName.trim()}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            {t("projectTools.gitReview.createBranch")}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function GitOperationNoticeToast({
  notice,
  onDismiss,
}: {
  notice: GitOperationNotice | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, notice.kind === "success" ? 4200 : 7000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;

  const isSuccess = notice.kind === "success";
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-50 flex max-w-[calc(100%-1.5rem)] justify-end">
      <div
        role={isSuccess ? "status" : "alert"}
        aria-live={isSuccess ? "polite" : "assertive"}
        className={cn(
          "pointer-events-auto flex w-80 max-w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur-xl",
          isSuccess
            ? "border-emerald-500/25 bg-emerald-50/95 text-emerald-900 dark:bg-emerald-950/85 dark:text-emerald-100"
            : "border-red-500/30 bg-red-50/95 text-red-900 dark:bg-red-950/85 dark:text-red-100",
        )}
      >
        {isSuccess ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-5">{notice.title}</div>
          {notice.message ? (
            <div
              className={cn(
                "mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs leading-5",
                isSuccess
                  ? "text-emerald-800/80 dark:text-emerald-100/75"
                  : "text-red-800/80 dark:text-red-100/75",
              )}
            >
              {notice.message}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-0.5 shrink-0 rounded p-0.5 opacity-55 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function GitReviewToolbar(props: {
  data: GitReviewData;
  stackedPane: GitReviewStackedPane;
  onStackedPaneChange: (pane: GitReviewStackedPane, dir: "forward" | "back") => void;
  useSplitReviewLayout: boolean;
  visibleError: string;
  writeDisabled: boolean;
}) {
  const {
    data,
    stackedPane,
    onStackedPaneChange,
    useSplitReviewLayout,
    visibleError,
    writeDisabled,
  } = props;
  const {
    busy,
    canWrite,
    cwd,
    disabledMessage,
    gitClient,
    historyLoading,
    loadHistory,
    loading,
    refresh,
    reviewMode,
    runOperation,
    setReviewMode,
    state,
    workspaceActivityClient,
  } = data;
  const { t } = useLocale();
  const operationBusy = busy !== "";
  const handleBranchStateChange = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="shrink-0 border-b border-border/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <GitBranchSelector
              workdir={cwd}
              gitClient={gitClient}
              workspaceActivityClient={workspaceActivityClient}
              disabled={writeDisabled}
              canWrite={canWrite}
              disabledMessage={disabledMessage}
              onStateChange={handleBranchStateChange}
            />
          </div>
          <div className="truncate text-[calc(10px*var(--zone-font-scale,1))] text-muted-foreground/60 px-0.5">
            {state.repoRoot || disabledMessage || cwd}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || historyLoading || operationBusy}
            className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
            title={t("projectTools.gitReview.refresh")}
            aria-label={t("projectTools.gitReview.refresh")}
            onClick={() => {
              if (data.isBusy()) return;
              if (reviewMode === "history") {
                void loadHistory();
              } else {
                void refresh();
              }
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || historyLoading) && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={writeDisabled || operationBusy}
            title={t("projectTools.gitReview.fetch")}
            aria-label={t("projectTools.gitReview.fetch")}
            className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
            onClick={() => void runOperation("fetch", () => gitClient!.fetch(cwd), "fetch")}
          >
            {busy === "fetch" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Cloud className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={writeDisabled || operationBusy}
            title={t("projectTools.gitReview.pull")}
            aria-label={t("projectTools.gitReview.pull")}
            className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
            onClick={() => void runOperation("pull", () => gitClient!.pull(cwd), "pull")}
          >
            {busy === "pull" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={writeDisabled || operationBusy}
            title={t("projectTools.gitReview.push")}
            aria-label={t("projectTools.gitReview.push")}
            className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
            onClick={() => void runOperation("push", () => gitClient!.push(cwd), "push")}
          >
            {busy === "push" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="inline-flex shrink-0 items-center gap-1 text-xs">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-muted-foreground/70 transition-colors hover:text-foreground",
              reviewMode === "changes" && "text-foreground font-semibold bg-muted/50",
            )}
            onClick={() => setReviewMode("changes")}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t("projectTools.gitReview.localChangesView")}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-muted-foreground/70 transition-colors hover:text-foreground",
              reviewMode === "history" && "text-foreground font-semibold bg-muted/50",
            )}
            onClick={() => setReviewMode("history")}
          >
            <History className="h-3.5 w-3.5" />
            {t("projectTools.gitReview.commitHistoryView")}
          </button>
        </div>
        {!useSplitReviewLayout ? (
          <div className="ml-auto inline-flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label={t("projectTools.gitReview.listPane")}
              aria-pressed={stackedPane === "list"}
              title={t("projectTools.gitReview.listPane")}
              className={cn(
                GIT_REVIEW_STACKED_PANE_BUTTON_CLASS,
                stackedPane === "list" && "bg-muted text-foreground",
              )}
              onClick={() => onStackedPaneChange("list", "back")}
            >
              {reviewMode === "changes" ? (
                <GitBranch className="h-3.5 w-3.5" />
              ) : (
                <History className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              aria-label={t("projectTools.gitReview.detailPane")}
              aria-pressed={stackedPane === "detail"}
              title={t("projectTools.gitReview.detailPane")}
              className={cn(
                GIT_REVIEW_STACKED_PANE_BUTTON_CLASS,
                stackedPane === "detail" && "bg-muted text-foreground",
              )}
              onClick={() => onStackedPaneChange("detail", "forward")}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      {!canWrite && disabledMessage ? (
        <div className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {disabledMessage}
        </div>
      ) : null}
      {visibleError ? <div className="mt-2 text-xs text-destructive">{visibleError}</div> : null}
    </div>
  );
}
