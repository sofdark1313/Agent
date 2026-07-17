import { useLocale } from "../../../i18n";
import { VIBING_STATUS } from "../../../lib/chat/chatPageHelpers";
import { cn } from "../../../lib/shared/utils";

export function VibingText({ className }: { className?: string }) {
  return <AnimatedStatusText text={VIBING_STATUS} className={className} />;
}

export function CompactingText({ className }: { className?: string }) {
  const { t } = useLocale();
  return <AnimatedStatusText text={t("chat.compactingContext")} className={className} />;
}

// One element with a background-clip:text shimmer: no per-render span
// allocation, one compositor layer instead of one promoted layer per
// character, and the caller's text color flows through via currentColor.
function AnimatedStatusText(props: { text: string; className?: string }) {
  const { text, className } = props;
  return <span className={cn("vibing-status", className)}>{text}</span>;
}
