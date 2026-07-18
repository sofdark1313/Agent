import type { SVGProps } from "react";

import { cn } from "../../lib/shared/utils";

type AgentMarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  decorative?: boolean;
  title?: string;
};

export function AgentMark({
  className,
  decorative = true,
  title = "Agent",
  ...props
}: AgentMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      role={decorative ? undefined : "img"}
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M7.25 24.5 14.15 7.9c.68-1.64 3.02-1.64 3.7 0l6.9 16.6"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.65 19.35h10.7" stroke="currentColor" strokeWidth="3.25" strokeLinecap="round" />
      <rect x="14.15" y="13.55" width="3.7" height="3.7" rx="1" fill="currentColor" />
    </svg>
  );
}
