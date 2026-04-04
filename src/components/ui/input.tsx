"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div className="relative w-full">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
            {leftIcon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            "w-full rounded-xl bg-surface-light/80 text-sm text-foreground placeholder:text-muted",
            "neu-inset-sm border border-border/50",
            "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40",
            "transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            leftIcon ? "pl-10 pr-4 py-3" : rightIcon ? "pl-4 pr-10 py-3" : "px-4 py-3",
            className
          )}
          ref={ref}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            {rightIcon}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
