"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  // Base styles
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-primary via-secondary to-accent text-white neu-raised-sm neu-btn-press hover:shadow-[0_6px_20px_rgba(59,130,246,0.3),0_3px_10px_rgba(139,92,246,0.2)] hover:brightness-110",
        secondary:
          "glass-neu text-foreground hover:border-primary/20 hover:brightness-110 neu-btn-press",
        outline:
          "border border-border bg-transparent text-foreground neu-raised-sm hover:bg-surface-light/50 hover:border-primary/20 neu-btn-press",
        ghost:
          "text-muted hover:text-foreground hover:bg-surface-light/50 transition-colors",
        destructive:
          "bg-gradient-to-r from-error to-red-700 text-white neu-raised-sm neu-btn-press hover:brightness-110",
        icon:
          "text-muted hover:text-foreground neu-raised-sm hover:bg-surface-light/50 neu-btn-press",
        link:
          "text-primary-light underline-offset-4 hover:underline hover:text-primary p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        default: "h-10 px-5 text-sm rounded-xl",
        lg: "h-12 px-8 text-base rounded-xl",
        xl: "h-14 px-10 text-lg rounded-2xl",
        icon: "h-9 w-9 rounded-lg",
        "icon-sm": "h-7 w-7 rounded-md",
        "icon-lg": "h-11 w-11 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : leftIcon ? (
          leftIcon
        ) : null}
        {children}
        {rightIcon && !loading ? rightIcon : null}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
