import * as React from "react";

import { cn } from "../../lib/shared/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input/90 bg-background px-3 py-1 text-sm shadow-none transition-[border-color,background-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/75 focus-visible:border-foreground/25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
