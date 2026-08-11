export interface StatsStripItem {
  value: string | number;
  label: string;
}

/** 横向关键指标条——总抽数/五星数/平均出货等，各项等宽、以竖线分隔。 */
export function StatsStrip({ items }: { items: StatsStripItem[] }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border bg-card">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex-1 border-r border-border px-[18px] py-[13px] last:border-r-0"
        >
          <span className="block font-mono text-[21px] font-bold tracking-tight tabular-nums">
            {item.value}
          </span>
          <span className="block text-[11.5px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
