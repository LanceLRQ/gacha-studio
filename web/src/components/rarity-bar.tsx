import type { RaritySpec } from "gs-plugin-kit/types";

import type { RarityDistributionView } from "@/lib/ipc/generated";
import { formatCount } from "@/lib/format";
import { rarityTiers, tierLabel } from "@/lib/games";
import { cn } from "@/lib/utils";

/**
 * 稀有度分布条 —— 数据语义层的核心呈现位（§3.1）。这个组件内部绝对不能
 * 引用任何 `--game-*` 变量：稀有度色（顶档金/次档紫/其余蓝）与身份标识色
 * 分属两层，混用会让「这是顶档」与「这是原神」两种含义在同一色彩通道里
 * 打架。
 *
 * 输入直接是 IPC 返回的 `RarityDistributionView`（`counts` 是
 * `Record<稀有度码, 计数>`，覆盖插件 `RaritySpec.ladder` 声明的全部档位）
 * + 对应的 `RaritySpec`，由 {@link rarityTiers} 拆成"最高档/次高档/其余"
 * 三段去对应仅有的三个视觉色阶（`--rarity-5/4/3`，见 theme.css）。文案走
 * {@link tierLabel} 的"稀有度码 + 星"通用规则——真实 IPC 不提供"五星/S级"
 * 这类本地化档位名，不编造没有数据支撑的文案（见 games.ts 头部说明）。
 */
export function RarityBar({
  distribution,
  rarity,
  className,
}: {
  distribution: RarityDistributionView;
  rarity: RaritySpec;
  className?: string;
}) {
  const tiers = rarityTiers(rarity);
  const topCount = distribution.counts[tiers.top] ?? 0;
  const secondCount = tiers.second ? (distribution.counts[tiers.second] ?? 0) : 0;
  const restCount = tiers.rest.reduce((sum, code) => sum + (distribution.counts[code] ?? 0), 0);
  const total = topCount + secondCount + restCount;
  const safeTotal = total > 0 ? total : 1;

  const restLabel =
    tiers.rest.length > 0 ? tiers.rest.map(tierLabel).join("/") : (tiers.second ?? "其余");

  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-border">
        <span className="bg-rarity-5" style={{ flex: topCount || 0.0001 }} />
        <span className="bg-rarity-4" style={{ flex: secondCount || 0.0001 }} />
        <span className="bg-rarity-3" style={{ flex: restCount || 0.0001 }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <LegendItem colorClass="bg-rarity-5" text={`${tierLabel(tiers.top)} ${formatCount(topCount)}`} />
        {tiers.second && (
          <LegendItem colorClass="bg-rarity-4" text={`${tierLabel(tiers.second)} ${formatCount(secondCount)}`} />
        )}
        <LegendItem colorClass="bg-rarity-3" text={`${restLabel} ${formatCount(restCount)}`} />
        <span>
          总抽数 <span className="font-mono font-semibold text-foreground tabular-nums">{formatCount(safeTotal)}</span>
        </span>
      </div>
      {(distribution.unknownCount > 0 || distribution.unrecognizedCount > 0) && (
        <p className="mt-1.5 text-[10.5px] text-faint-foreground">
          {distribution.unknownCount > 0 && (
            <>
              另有 <span className="font-mono tabular-nums">{formatCount(distribution.unknownCount)}</span> 条记录稀有度未知，未计入上方统计
            </>
          )}
          {distribution.unknownCount > 0 && distribution.unrecognizedCount > 0 && "；"}
          {distribution.unrecognizedCount > 0 && (
            <>
              <span className="font-mono tabular-nums">{formatCount(distribution.unrecognizedCount)}</span> 条记录稀有度不在插件声明范围内
            </>
          )}
        </p>
      )}
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
