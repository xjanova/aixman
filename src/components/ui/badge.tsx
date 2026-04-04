"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        primary: "bg-primary/15 text-primary-light border border-primary/20 neu-raised-sm",
        secondary: "bg-secondary/15 text-secondary-light border border-secondary/20 neu-raised-sm",
        accent: "bg-accent/15 text-accent-light border border-accent/20 neu-raised-sm",
        success: "bg-success/15 text-success border border-success/20 neu-raised-sm",
        warning: "bg-warning/15 text-warning border border-warning/20 neu-raised-sm",
        error: "bg-error/15 text-error border border-error/20 neu-raised-sm",
        outline: "border border-border text-muted",
        glass: "glass-light text-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        default: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  )
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
