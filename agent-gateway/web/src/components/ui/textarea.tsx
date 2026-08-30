import * as React from "react";

import { cn } from "../../lib/shared/utils";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-input/90 bg-background px-3 py-2 text-sm shadow-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/75 focus-visible:border-foreground/25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
