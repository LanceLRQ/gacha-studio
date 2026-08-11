import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * variant 分两类，不得混用（界面设计方向 §3.1 双层规则）：
 * - neutral/warning/destructive/outline —— 状态语义，随处可用
 * - r5/r4/r3 —— 数据语义层的稀有度标签，只允许出现在记录/图表/卡池内部，
 *   禁止出现在身份标识（游戏）相关的展示位
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-[calc(var(--radius)-1px)] border px-2 py-0.5 text-[11px] font-semibold [&_svg]:size-[11px]",
  {
    variants: {
      variant: {
        neutral: "border-border bg-background text-faint-foreground",
        warning: "border-warning bg-warning-bg text-warning-foreground",
        destructive: "border-destructive bg-destructive text-destructive-foreground",
        outline: "border-border-strong bg-transparent text-foreground",
        primary: "border-primary bg-primary text-primary-foreground",
        r5: "border-transparent bg-rarity-5 text-[oklch(0.99_0.004_85)]",
        r4: "border-transparent bg-rarity-4 text-[oklch(0.99_0.004_85)]",
        r3: "border-transparent bg-rarity-3 text-[oklch(0.99_0.004_85)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
