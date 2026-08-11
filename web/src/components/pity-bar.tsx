import { cn } from "@/lib/utils";

interface PityBarProps {
  label?: string;
  current: number;
  cap: number;
  /** 数据语义层——只允许 5/4 星两档颜色，不接受任意色值（§3.1）。 */
  tone: "r5" | "r4";
  className?: string;
}

/** 保底进度条：进度条 + 当前/上限分数（界面设计方向 §4.5，采纳演进后的形态）。 */
export function PityBar({ label, current, cap, tone, className }: PityBarProps) {
  const percent = cap > 0 ? Math.min(100, (current / cap) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {label && <span className="w-[60px] shrink-0 text-xs text-muted-foreground">{label}</span>}
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={cap}
      >
        <div
          className={cn("h-full rounded-full", tone === "r5" ? "bg-rarity-5" : "bg-rarity-4")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-[58px] shrink-0 text-right text-[12.5px] font-mono tabular-nums">
        <span className="font-semibold">{current}</span>
        <span className="text-muted-foreground">/{cap}</span>
      </span>
    </div>
  );
}
