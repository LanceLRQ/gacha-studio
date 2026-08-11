import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-background px-2.5 py-1.5 text-[12.5px] text-foreground outline-none transition-colors",
        "placeholder:text-faint-foreground",
        "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary-tint",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
