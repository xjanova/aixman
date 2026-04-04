"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "w-full rounded-xl bg-surface-light/80 text-sm text-foreground placeholder:text-muted",
          "neu-inset-sm border border-border/50 resize-none",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40",
          "transition-all duration-200 min-h-[100px]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "px-4 py-3",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
