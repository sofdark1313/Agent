import {
  Check,
  FilePenLine,
  Globe2,
  McpLogo,
  Settings2,
  Shield,
  Terminal,
  Trash2,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
} from "../../../lib/chat/approval/toolApprovalBroker";

function formatArguments(value: unknown) {
  try {
    const text = JSON.stringify(value ?? {}, null, 2);
    return text.length > 3000 ? `${text.slice(0, 3000)}\n…` : text;
  } catch {
    return String(value ?? "");
  }
}

function categoryIcon(category: ToolApprovalRequest["assessment"]["category"]) {
  switch (category) {
    case "command":
      return Terminal;
    case "network":
      return Globe2;
    case "mcp":
      return McpLogo;
    case "write":
      return FilePenLine;
    case "system":
      return Settings2;
    default:
      return Shield;
  }
}

export function ToolApprovalCard(props: {
  request: ToolApprovalRequest;
  queueCount: number;
  onDecision: (id: string, decision: ToolApprovalDecision) => void;
}) {
  const { request, queueCount, onDecision } = props;
  const { t } = useLocale();
  const Icon = request.assessment.destructive ? Trash2 : categoryIcon(request.assessment.category);
  const details = formatArguments(request.toolCall.arguments);

  return (
    <section
      data-agent-tool-approval
      aria-live="assertive"
      className="pointer-events-auto w-full overflow-hidden rounded-[18px] border border-border/75 bg-popover/98 shadow-[0_20px_55px_-24px_rgba(0,0,0,0.42),0_8px_22px_-14px_rgba(0,0,0,0.24)] backdrop-blur-xl dark:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.82)]"
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-orange-500/10 text-orange-600 ring-1 ring-inset ring-orange-500/15 dark:text-orange-300">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              {t("chat.approval.title")}
            </h3>
            {queueCount > 1 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("chat.approval.queueCount").replace("{count}", String(queueCount))}
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-words text-[12px] leading-5 text-foreground/85">
            {request.assessment.summary}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {request.assessment.outsideWorkspace
              ? t("chat.approval.outsideWorkspace")
              : t(`chat.approval.category.${request.assessment.category}`)}
          </p>
        </div>
      </div>

      <div className="mx-4 overflow-hidden rounded-[11px] border border-border/60 bg-muted/35 sm:mx-5">
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[10.5px] leading-[1.55] text-foreground/75">
          {details}
        </pre>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/55 bg-muted/20 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => onDecision(request.id, "deny")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        >
          <X className="h-3.5 w-3.5" />
          {t("chat.approval.deny")}
        </button>
        <button
          type="button"
          onClick={() => onDecision(request.id, "allow-session")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/75 bg-background px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        >
          <Shield className="h-3.5 w-3.5" />
          {t("chat.approval.allowSession")}
        </button>
        <button
          type="button"
          onClick={() => onDecision(request.id, "allow-once")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[12px] font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <Check className="h-3.5 w-3.5" />
          {t("chat.approval.allowOnce")}
        </button>
      </div>
    </section>
  );
}
