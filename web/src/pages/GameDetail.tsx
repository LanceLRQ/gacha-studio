import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, RefreshCw, Table as TableIcon } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { GameIcon } from "@/components/game-icon";
import { PityBar } from "@/components/pity-bar";
import { RarityBar } from "@/components/rarity-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/lib/app-state";
import { formatCount, formatDate, maskUid } from "@/lib/format";
import {
  MOCK_GAMES,
  RETENTION_CONSERVATIVE_DAYS,
  accountsOf,
  bannerRarityDistribution,
  getGameDetail,
  type MockBanner,
  type MockTierLabels,
} from "@/lib/mock-data";
import { computeAccountRisk } from "@/lib/risk";

/**
 * 游戏详情页——对应 ui-demo/game-genshin.html。总视图 tab + 每卡池一个 tab
 * （§4.7）。栅格自适应卡池数量，不写死列数（`repeat(auto-fit,minmax(...))`，
 * 规避 §4.6 绝区零第四卡池导致换行错位的三方教训）。
 *
 * ⚠️ min-height:0 落点：本页根节点、Tabs 根节点、scroll-area 容器均需要
 * 显式声明——Radix Tabs.Root 默认渲染一个普通 div，不会替你补上 flex 布局，
 * 这一层必须自己接上，否则 TabsList 会被内容撑到跟着滚动。
 */
export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const { enabledGameIds } = useAppState();
  const game = MOCK_GAMES.find((g) => g.id === gameId);

  const accounts = game ? accountsOf(game.id) : [];
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(accounts[0]?.id);
  const [activeTab, setActiveTab] = useState("overview");
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!game || !enabledGameIds.has(game.id)) {
    return <Navigate to="/" replace />;
  }

  const account = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0];
  const detail = getGameDetail(game.id);
  const risk = account
    ? computeAccountRisk({
        gameDirValid: account.gameDirValid,
        lastSuccessfulUpdateAt: account.lastSuccessfulUpdateAt,
        retentionConservativeDays: RETENTION_CONSERVATIVE_DAYS,
      })
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-7 pt-4.5 pb-3.5">
        <div className="flex items-center gap-3">
          <GameIcon displayName={game.displayName} colorVar={game.colorVar} size={36} />
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">{game.displayName}</h1>
            {account && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                UID <span className="font-mono tabular-nums">{maskUid(account.uid)}</span> · {account.serverLabel} ·
                上次更新 {account.lastSuccessfulUpdateAt ? formatDate(account.lastSuccessfulUpdateAt) : "从未更新"}
                {risk && (
                  <>
                    {" "}
                    · {risk.remainingDays <= 0 ? "数据已超出保留期" : (
                      <>
                        还剩 <span className="font-mono font-semibold text-foreground tabular-nums">{risk.remainingDays}</span> 天
                      </>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && account && (
            <Select
              value={String(account.id)}
              onValueChange={(v) => setSelectedAccountId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {maskUid(a.uid)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button>
            <RefreshCw />
            更新记录
          </Button>
          {account && (
            <Button variant="outline" asChild>
              <Link to={`/game/${game.id}/records?account=${account.id}`}>
                <TableIcon />
                查看明细
              </Link>
            </Button>
          )}
        </div>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          scrollRef.current?.scrollTo({ top: 0 });
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="overview">总视图</TabsTrigger>
          {detail.banners.map((banner) => (
            <TabsTrigger key={banner.id} value={banner.id}>
              {banner.displayName}
            </TabsTrigger>
          ))}
        </TabsList>

        <div ref={scrollRef} className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <TabsContent value="overview" className="flex flex-col gap-6 px-7 pt-5 pb-7">
            <section>
              <SectionLabel>卡池保底概览</SectionLabel>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                {detail.banners.map((banner) => (
                  <PoolOverviewCard key={banner.id} banner={banner} topTierLabel={game.tierLabels.top} />
                ))}
              </div>
            </section>

            <section>
              <SectionLabel>最近{game.tierLabels.top}记录</SectionLabel>
              <div className="flex flex-wrap gap-2.5">
                {detail.recentFiveStars.map((entry) => (
                  <div
                    key={`${entry.itemName}-${entry.occurredAt}`}
                    className="flex w-[176px] shrink-0 flex-col gap-1 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5"
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-rarity-5" />
                      <span className="min-w-0 flex-1 overflow-hidden text-[12.5px] font-semibold text-ellipsis whitespace-nowrap">
                        {entry.itemName}
                      </span>
                      <span className="shrink-0 text-[10px] whitespace-nowrap text-faint-foreground">
                        {entry.poolLabel}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {formatDate(entry.occurredAt)}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      距上次 <span className="font-mono font-semibold text-foreground tabular-nums">{entry.gap}</span> 抽
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionLabel>抽卡时间线（按月）</SectionLabel>
              <MonthlyTimeline entries={detail.timeline} />
            </section>

            <section>
              <SectionLabel>稀有度分布</SectionLabel>
              <RarityBar {...detail.rarityDistribution} labels={game.tierLabels} />
            </section>
          </TabsContent>

          {detail.banners.map((banner) => (
            <TabsContent key={banner.id} value={banner.id} className="flex flex-col gap-6 px-7 pt-5 pb-7">
              <BannerPanel banner={banner} tierLabels={game.tierLabels} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">
      {children}
    </div>
  );
}

function PoolOverviewCard({ banner, topTierLabel }: { banner: MockBanner; topTierLabel: string }) {
  return (
    <Card>
      <CardTitle>{banner.displayName}</CardTitle>
      {banner.completed ? (
        <div className="flex min-h-[34px] items-center">
          <Badge variant="neutral">
            <Check />
            已完成
          </Badge>
        </div>
      ) : (
        banner.pity5 && (
          <div className="my-1">
            <PityBar current={banner.pity5.current} cap={banner.pity5.cap} tone="r5" />
          </div>
        )
      )}
      <p className="text-[11.5px] text-muted-foreground">
        总抽数 <span className="font-mono tabular-nums">{formatCount(banner.totalDraws)}</span> · {topTierLabel}{" "}
        <span className="font-mono tabular-nums">{banner.fiveStarCount}</span> 个
      </p>
    </Card>
  );
}

function BannerPanel({
  banner,
  tierLabels,
}: {
  banner: MockBanner;
  tierLabels: MockTierLabels;
}) {
  const rarity = bannerRarityDistribution(banner);
  return (
    <>
      <section>
        <SectionLabel>保底进度</SectionLabel>
        <Card>
          {banner.completed ? (
            <div className="flex items-center gap-2.5">
              <Badge variant="neutral">
                <Check />
                已完成
              </Badge>
              <span className="text-xs text-muted-foreground">
                {banner.displayName}为一次性卡池，{formatCount(banner.totalDraws)} 抽已全部抽完，不再产生新的保底进度。
              </span>
            </div>
          ) : (
            <>
              {banner.pity5 && (
                <PityBar label={`${tierLabels.top}保底`} current={banner.pity5.current} cap={banner.pity5.cap} tone="r5" />
              )}
              {banner.pity4 && (
                <div className="mt-2.5">
                  <PityBar
                    label={`${tierLabels.second}保底`}
                    current={banner.pity4.current}
                    cap={banner.pity4.cap}
                    tone="r4"
                  />
                </div>
              )}
              {banner.toNextPity5 !== undefined && (
                <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  距离下次{tierLabels.top}保底还有{" "}
                  <span className="font-mono font-semibold text-foreground tabular-nums">{banner.toNextPity5}</span> 抽
                </p>
              )}
            </>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>关键指标</SectionLabel>
        <div className="flex overflow-hidden rounded-md border border-border bg-card">
          <StatCell value={formatCount(banner.totalDraws)} label="总抽数" />
          <StatCell value={banner.fiveStarCount} label={`${tierLabels.top}数`} />
          <StatCell value={banner.fourStarCount} label={`${tierLabels.second}数`} />
          {banner.avgDraws !== undefined && <StatCell value={banner.avgDraws} label="平均出货抽数" />}
          {banner.worstGap !== undefined && <StatCell value={banner.worstGap} label="最非欧一次" />}
          {banner.bestGap !== undefined && <StatCell value={banner.bestGap} label="最欧一次" />}
        </div>
        {banner.note && <p className="mt-2.5 text-xs text-muted-foreground">{banner.note}</p>}
      </section>

      {banner.fiveStarRecords && banner.fiveStarRecords.length > 0 && (
        <section>
          <SectionLabel>{tierLabels.top}记录</SectionLabel>
          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>物品</TableHead>
                  <TableHead>稀有度</TableHead>
                  <TableHead>抽数间隔</TableHead>
                  <TableHead>是否歪</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {banner.fiveStarRecords.map((row) => (
                  <TableRow key={`${row.itemName}-${row.date}`}>
                    <TableCell>{row.itemName}</TableCell>
                    <TableCell>
                      <Badge variant="r5">{tierLabels.top}</Badge>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{row.gap}</TableCell>
                    <TableCell>{row.isLoss ? "是" : "否"}</TableCell>
                    <TableCell className="font-mono tabular-nums">{formatDate(row.date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}

      <section>
        <SectionLabel>稀有度分布</SectionLabel>
        <RarityBar {...rarity} labels={tierLabels} />
      </section>
    </>
  );
}

function StatCell({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex-1 border-r border-border px-[18px] py-[13px] last:border-r-0">
      <span className="block font-mono text-[21px] font-bold tracking-tight tabular-nums">{value}</span>
      <span className="block text-[11.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

function MonthlyTimeline({
  entries,
}: {
  entries: readonly { month: string; draws: number; fiveStarCount: number }[];
}) {
  const maxDraws = Math.max(1, ...entries.map((e) => e.draws));
  return (
    <div>
      <div className="flex h-[110px] items-end gap-1 border-b border-border">
        {entries.map((entry) => (
          <div key={entry.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <div className="flex h-3.5 items-end justify-center gap-0.5">
              {Array.from({ length: entry.fiveStarCount }).map((_, i) => (
                <span key={i} className="size-1.5 shrink-0 rounded-full bg-rarity-5" />
              ))}
            </div>
            <div
              className="w-3/5 max-w-8 rounded-t-sm bg-border-strong"
              style={{ height: `${Math.round((entry.draws / maxDraws) * 96)}px` }}
              title={`${entry.month} · ${entry.draws} 抽${entry.fiveStarCount > 0 ? ` · 五星 ${entry.fiveStarCount} 个` : ""}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {entries.map((entry, idx) => (
          <span
            key={entry.month}
            className="min-w-0 flex-1 text-center font-mono text-[10px] text-faint-foreground tabular-nums"
          >
            {idx % 2 === 0 ? entry.month.slice(2) : ""}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-[7px] shrink-0 rounded-full bg-rarity-5" />
          出货月份
        </span>
        <span>
          合计{" "}
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {formatCount(entries.reduce((sum, e) => sum + e.draws, 0))}
          </span>{" "}
          抽 · <span className="font-mono font-semibold text-foreground tabular-nums">{entries.length}</span> 个月
        </span>
      </div>
    </div>
  );
}
