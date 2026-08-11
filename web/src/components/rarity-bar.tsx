import { formatCount } from "@/lib/format";
import type { MockRarityDistribution, MockTierLabels } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/**
 * 稀有度分布条 —— 数据语义层的核心呈现位（§3.1）。这个组件内部绝对不能
 * 引用任何 `--game-*` 变量：稀有度色（5★金/4★紫/3★蓝）与身份标识色分属
 * 两层，混用会让「这是五星」与「这是原神」两种含义在同一色彩通道里打架。
 *
 * 图例文案默认「五星/四星/三星」，单游戏视图（GameDetail）应传入该游戏的
 * `tierLabels`——绝区零的最高档不叫「五星」（阶梯实测是 2/3/4）。跨游戏
 * 聚合场景（Overview）保留默认文案：把不同游戏的档位强行统一成一句图例本身
 * 就是分析引擎该回答的问题，UI 层不替它下结论。
 */
export function RarityBar({
  r5,
  r4,
  r3,
  labels = { top: "五星", second: "四星", third: "三星" },
  className,
}: MockRarityDistribution & { labels?: MockTierLabels; className?: string }) {
  const total = r5 + r4 + r3;
  const safeTotal = total > 0 ? total : 1;

  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-border">
        <span className="bg-rarity-5" style={{ flex: r5 || 0.0001 }} />
        <span className="bg-rarity-4" style={{ flex: r4 || 0.0001 }} />
        <span className="bg-rarity-3" style={{ flex: r3 || 0.0001 }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <LegendItem colorClass="bg-rarity-5" text={`${labels.top} ${formatCount(r5)}`} />
        <LegendItem colorClass="bg-rarity-4" text={`${labels.second} ${formatCount(r4)}`} />
        <LegendItem colorClass="bg-rarity-3" text={`${labels.third} ${formatCount(r3)}`} />
        <span>
          总抽数 <span className="font-mono font-semibold text-foreground tabular-nums">{formatCount(safeTotal)}</span>
        </span>
      </div>
    </div>
  );
}

function LegendItem({ colorClass, text }: { colorClass: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-[7px] shrink-0 rounded-full", colorClass)} />
      {text}
    </span>
  );
}
