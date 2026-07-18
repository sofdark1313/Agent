import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/shared/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 disabled:active:scale-100",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/88",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/72",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input/90 bg-background shadow-none hover:bg-accent/70 hover:text-accent-foreground",
        ghost: "text-foreground/78 hover:bg-foreground/[0.055] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    render?: React.ReactElement;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, render: renderProp, children, ...props }, ref) => {
    const mergedClass = cn(buttonVariants({ variant, size }), className);

    if (renderProp) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rp = renderProp as React.ReactElement<any>;
      return React.cloneElement(rp, {
        className: cn(mergedClass, rp.props.className),
        ...props,
        children: children ?? rp.props.children,
      });
    }

    return (
      <button ref={ref} className={mergedClass} {...props}>
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export { buttonVariants };
