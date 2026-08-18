import { useState } from "react";
import type { ReactNode } from "react";
import { RefreshCw, Table as TableIcon } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-view";
import { GameIconAuto } from "@/components/game-icon-auto";
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
import { localizedText, rarityTiers, tierLabel, type GameMeta } from "@/lib/games";
import { accountAnalysis, listAccounts, listRecords, monthlyActivity } from "@/lib/ipc-client";
import type {
  AccountAnalysisView,
  AccountView,
  CurveEvaluationView,
  HitOutcomeView,
  MonthlyActivityView,
  PityPullView,
} from "@/lib/ipc/generated";
import { useAsync } from "@/lib/use-async";
import type { BannerSpec, GuaranteeRule, RaritySpec } from "gs-plugin-kit/types";

/**
 * 单个卡池的统计口径——由两条独立数据源拼出来，两者覆盖范围不同，务必分清楚：
 *
 * - `totalDraws`/`rarityCounts`/`otherCount`：来自 `list_records` 按
 *   `bannerKey`/`rarities` 过滤后的 `total`（每档一次轻量调用，`pageSize=1`
 *   只为拿计数，不拉记录正文）。覆盖**这个卡池的全部记录**，与是否声明
 *   共享保底无关。
 * - `pity`：来自 `account_analysis` 的 `pityProgress`。**只覆盖 manifest
 *   `pityGroups` 声明过的卡池**——原神的 302/200/500/100 这类未声明共享
 *   保底的卡池，这里恒为 `undefined`，如实反映"没有声明就没有保底数据"。
 */
interface BannerStats {
  banner: BannerSpec;
  totalDraws: number;
  /** 键为稀有度码，值为该卡池内命中该档的记录数（来自 list_records total）。 */
  rarityCounts: Record<string, number>;
  /** `totalDraws` 减去 `rarityCounts` 已知档位之和——稀有度未知/不在声明范围内的记录，两者混在一起，因为这里的计数口径拿不到再细分的依据。 */
  otherCount: number;
  pity?: {
    groupKey: string;
    hardPity: number;
    currentPity: number;
    nextPullProbability: CurveEvaluationView;
    unknownRarityCount: number;
    /** 担保规则——决定"是否歪"这一列该不该渲染成是/否，见 {@link hitOutcomeLabel}。 */
    guarantee: GuaranteeRule;
    /** 命中该卡池顶级保底目标的抽取，按时间倒序。 */
    topTierPulls: PityPullView[];
    /** 与本卡池共享同一保底池的其它卡池展示名（不含本卡池自己）。 */
    sharedWith: string[];
    avgGap?: number;
    worstGap?: number;
    bestGap?: number;
  };
}

async function loadBannerStats(
  accountId: number,
  banners: BannerSpec[],
  ladder: string[],
  analysis: AccountAnalysisView,
  bannerLabel: (id: string) => string,
): Promise<BannerStats[]> {
  return Promise.all(
    banners.map(async (banner) => {
      const [totalPage, ...rarityPages] = await Promise.all([
        listRecords({ accountId, bannerKey: banner.id, pageSize: 1 }),
        ...ladder.map((code) => listRecords({ accountId, bannerKey: banner.id, rarities: [code], pageSize: 1 })),
      ]);
      const rarityCounts: Record<string, number> = {};
      ladder.forEach((code, i) => {
        rarityCounts[code] = rarityPages[i]?.total ?? 0;
      });
      const knownSum = Object.values(rarityCounts).reduce((sum, n) => sum + n, 0);
      const otherCount = Math.max(0, totalPage.total - knownSum);

      const group = analysis.pityProgress.find((g) => g.pulls.some((p) => p.bannerKey === banner.id));
      let pity: BannerStats["pity"];
      if (group) {
        const bannerPulls = group.pulls.filter((p) => p.bannerKey === banner.id);
        const topTierPulls = bannerPulls.filter((p) => p.isPityHit).slice().reverse();
        const gaps = topTierPulls.map((p) => p.pullsSinceLastHit);
        const sharedWith = Array.from(new Set(group.pulls.map((p) => p.bannerKey)))
          .filter((id) => id !== banner.id)
          .map(bannerLabel);
        pity = {
          groupKey: group.pityGroupKey,
          hardPity: group.hardPity,
          currentPity: group.currentPity,
          nextPullProbability: group.nextPullProbability,
          unknownRarityCount: group.unknownRarityCount,
          guarantee: group.guarantee,
          topTierPulls,
          sharedWith,
          avgGap: gaps.length > 0 ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : undefined,
          worstGap: gaps.length > 0 ? Math.max(...gaps) : undefined,
          bestGap: gaps.length > 0 ? Math.min(...gaps) : undefined,
        };
      }

      return { banner, totalDraws: totalPage.total, rarityCounts, otherCount, pity };
    }),
  );
}

/**
 * "是否歪"这一列该显示什么，取决于这个保底组的 [`GuaranteeRule`]：
 *
 * - **只有 `fiftyFifty` 才有"歪"这个概念**——`alwaysRateUp` 结构上不存在
 *   "歪"的可能，`none` 没有担保机制，`weighted` 虽然理论上也有"未中 UP"
 *   的结果，但 `gs_analysis::apply_guarantee_rule` 本 Stage 未把它展开成
 *   具体的加权状态机（恒返回 `false`，见该函数文档）——这三种规则下都
 *   不渲染"是/否"，回落"不适用"，不显示一片假的"没歪"（那是噪音，不是
 *   数据，尤其是 `alwaysRateUp` 的卡池——它结构上就不可能歪）。
 * - `fiftyFifty` 规则下，`hitOutcome` 是三态：`"off"` → 歪了（"是"）、
 *   `"rateUp"` → 没歪（"否"）、`"unknown"`/`null` → **不知道**——`null`
 *   只出现在非命中的 pull 上（这里不会拿到，调用方只传 topTierPulls），
 *   `"unknown"` 是当前没有任何数据源能提供当期 UP 物品列表的真实状态，
 *   不能显示成"否"（那是把"不知道"伪装成"没歪"）。
 */
function hitOutcomeLabel(guarantee: GuaranteeRule, hitOutcome: HitOutcomeView | null): string {
  if (guarantee.kind !== "fiftyFifty") return "不适用";
  if (hitOutcome === "off") return "是";
  if (hitOutcome === "rateUp") return "否";
  return "不知道";
}

/**
 * 「不知道」这一格的悬停说明。
 *
 * ⚠️ **当前这一列在 `fiftyFifty` 卡池下会 100% 显示「不知道」**，因为
 * `is_rate_up` 全仓唯一的生产写入点是 `gs_analysis::derive_rare_events`
 * 里硬写的 `None`（该函数文档解释了为什么不能退而写 `Some(false)`：
 * 那会把「不知道」伪装成「没歪」，污染 `GuaranteeRule::FiftyFifty`
 * 状态机）。真正缺的是**当期 UP 物品列表**这个数据源，属看板上
 * 「卡池元数据（版本 UP 表）的数据源方案」这个未决问题。
 *
 * 那为什么还渲染这一列？——因为「不知道」是**诚实且可解释**的状态，
 * 与被摘掉的风险徽章不同：那个若硬渲染会输出**编造的**风险等级。
 * 但一整列没有任何解释的「不知道」同样是噪音，用户会以为是自己的数据
 * 有问题。所以照 `Overview` 对 `retentionRisk === null` 的同一套做法
 * ——显示未知值，但把「为什么未知」讲清楚。
 */
function hitOutcomeHint(guarantee: GuaranteeRule, hitOutcome: HitOutcomeView | null): string | undefined {
  if (guarantee.kind !== "fiftyFifty") {
    return "该卡池的担保规则不是「50/50」，结构上不存在「歪」这个概念";
  }
  if (hitOutcome === "off" || hitOutcome === "rateUp") return undefined;
  return "判断是否歪需要当期 UP 物品列表，本地暂无该数据源——这里不猜，也不会把「不知道」显示成「没歪」";
}

/**
 * "抽卡时间线（按月）"——对应 ui-demo/game-genshin.html 的柱状图形态：
 * 柱高按当月抽数与该账号全部月份里的最大抽数比例缩放，柱顶的圆点数量
 * （封顶 5 个，避免出货特别多的月份把柱子挤变形）标出当月命中顶级保底
 * 目标的次数。数据来自 `monthly_activity` 命令——聚合在 SQL 里完成，
 * 不是前端把全量记录拉过来自己 group by，见该命令的文档。
 */
function MonthlyTimeline({ months }: { months: MonthlyActivityView[] }) {
  if (months.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        暂无抽卡记录，导入存档或采集后这里会展示按月的抽数与顶级保底命中趋势。
      </p>
    );
  }

  const maxDraws = Math.max(...months.map((m) => m.draws), 1);

  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1">
      {months.map((m) => (
        <div
          key={m.month}
          className="flex w-9 shrink-0 flex-col items-center gap-1"
          title={`${m.month} · ${formatCount(m.draws)} 抽${m.topTierHits > 0 ? ` · 顶级 ${formatCount(m.topTierHits)} 个` : ""}`}
        >
          <div className="flex h-2.5 items-end gap-0.5">
            {Array.from({ length: Math.min(m.topTierHits, 5) }).map((_, i) => (
              <span key={i} className="size-1 shrink-0 rounded-full bg-rarity-5" />
            ))}
          </div>
          <div className="flex h-20 w-full items-end overflow-hidden rounded-t-sm bg-border/40">
            <div
              className="w-full rounded-t-sm bg-rarity-4/70"
              style={{ height: `${Math.round((m.draws / maxDraws) * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[9.5px] whitespace-nowrap text-faint-foreground">
            {m.month.slice(2).replace("-", "")}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 游戏详情页——对应 ui-demo/game-genshin.html。总视图 tab + 每卡池一个 tab。
 *
 * ⚠️ 与原始设计稿的偏差（均因真实 IPC 面没有对应数据，不编造）：
 * 1. 账号头部不再展示"保留期风险倒计时"——原始实现依赖
 *    `RetentionPolicy.conservativeDays`，`GameView` 未透出该字段。
 *
 * 下面两条此前也在这份偏差清单里，本轮已补齐对应的 Rust 侧字段/命令，
 * 恢复成设计稿原始形态，不再是偏差：
 * - "抽卡时间线（按月）"——`monthly_activity` 命令新增，聚合下沉到 SQL。
 * - 每卡池"五星记录"表的"是否歪"列——`PityPullView.hitOutcome` +
 *   `PityGroupProgressView.guarantee` 新增，见 {@link hitOutcomeLabel}。
 *
 * ⚠️ min-height:0 落点同旧版注释：本页根节点、Tabs 根节点、scroll-area
 * 容器均需要显式声明。
 */
export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const { games, enabledGameIds } = useAppState();
  const game = games.find((g) => g.id === gameId);

  const accountsState = useAsync(() => listAccounts(), []);
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("overview");

  // ⚠️ 下面两个 useAsync/useState 调用不能放到「game 不存在就 Navigate」这条
  // 早退之后——React 的 Hooks 规则要求每次渲染调用的 hook 数量与顺序一致，
  // 一旦某次渲染因为早退跳过了后面的 hook 调用，下一次渲染只要 game 又存在
  // 了就会对不上顺序。因此这里先把依赖 game 的计算都算出来（用可选链兜底
  // game 可能是 undefined 的情况），早退判断挪到所有 hook 调用之后。
  const accounts: AccountView[] =
    accountsState.status === "ready" && game ? accountsState.data.filter((a) => a.pluginId === game.id) : [];
  const account = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0];

  const detailState = useAsync(async () => {
    if (!account || !game) return undefined;
    const [analysis, months] = await Promise.all([accountAnalysis(account.id), monthlyActivity(account.id)]);
    const bannerStats = await loadBannerStats(account.id, game.banners, game.rarity.ladder, analysis, (id) => {
      const banner = game.banners.find((b) => b.id === id);
      return banner ? localizedText(banner.displayName, id) : id;
    });
    return { analysis, bannerStats, months };
  }, [account?.id, game?.id]);

  if (!game || !enabledGameIds.has(game.id)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-7 pt-4.5 pb-3.5">
        <div className="flex items-center gap-3">
          <GameIconAuto game={game} size={36} />
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">{game.displayName}</h1>
            {account && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                UID <span className="font-mono tabular-nums">{maskUid(account.gameUid)}</span> · {account.region} ·
                上次采集 {account.lastCollectedAt ? formatDate(account.lastCollectedAt) : "从未采集"}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && account && (
            <Select value={String(account.id)} onValueChange={(v) => setSelectedAccountId(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {maskUid(a.gameUid)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button disabled title="采集/更新功能尚未接入 IPC，请到设置页使用「导入存档」">
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

      {accountsState.status === "loading" && <LoadingState label="正在加载账号列表…" />}
      {accountsState.status === "error" && <ErrorState message={accountsState.message} onRetry={accountsState.reload} />}
      {accountsState.status === "ready" && accounts.length === 0 && (
        <EmptyState
          title="该游戏下还没有本地账号"
          description="前往设置页导入一份抽卡存档后，这里会展示保底进度与稀有度分布。"
          action={
            <Button asChild size="sm">
              <Link to="/settings">前往设置页导入</Link>
            </Button>
          }
        />
      )}
      {accountsState.status === "ready" && account && (
        <>
          {detailState.status === "loading" && <LoadingState label="正在计算保底进度与卡池统计…" />}
          {detailState.status === "error" && <ErrorState message={detailState.message} onRetry={detailState.reload} />}
          {detailState.status === "ready" && detailState.data && (
            <GameDetailTabs
              game={game}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              analysis={detailState.data.analysis}
              bannerStats={detailState.data.bannerStats}
              months={detailState.data.months}
            />
          )}
        </>
      )}
    </div>
  );
}

function GameDetailTabs({
  game,
  activeTab,
  onTabChange,
  analysis,
  bannerStats,
  months,
}: {
  game: GameMeta;
  activeTab: string;
  onTabChange: (value: string) => void;
  analysis: AccountAnalysisView;
  bannerStats: BannerStats[];
  months: MonthlyActivityView[];
}) {
  const tiers = rarityTiers(game.rarity);
  const topTierLabel = tierLabel(game.tierLabels, tiers.top);
  const recentTopTier = bannerStats
    .flatMap((s) => (s.pity ? s.pity.topTierPulls.map((p) => ({ pull: p, bannerName: localizedText(s.banner.displayName, s.banner.id) })) : []))
    .sort((a, b) => b.pull.occurredAt - a.pull.occurredAt)
    .slice(0, 10);

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col">
      <TabsList>
        <TabsTrigger value="overview">总视图</TabsTrigger>
        {bannerStats.map((s) => (
          <TabsTrigger key={s.banner.id} value={s.banner.id}>
            {localizedText(s.banner.displayName, s.banner.id)}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <TabsContent value="overview" className="flex flex-col gap-6 px-7 pt-5 pb-7">
          <section>
            <SectionLabel>卡池保底概览</SectionLabel>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              {bannerStats.map((s) => (
                <PoolOverviewCard key={s.banner.id} stats={s} topCode={tiers.top} topTierLabel={topTierLabel} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>最近{topTierLabel}记录</SectionLabel>
            {recentTopTier.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                暂无{topTierLabel}记录，或该账号所有卡池均未声明共享保底（无法计算命中记录）。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {recentTopTier.map(({ pull, bannerName }) => (
                  <div
                    key={pull.recordId}
                    className="flex w-[176px] shrink-0 flex-col gap-1 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5"
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-rarity-5" />
                      <span className="min-w-0 flex-1 overflow-hidden text-[12.5px] font-semibold text-ellipsis whitespace-nowrap">
                        {pull.itemId}
                      </span>
                      <span className="shrink-0 text-[10px] whitespace-nowrap text-faint-foreground">{bannerName}</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">{formatDate(pull.occurredAt)}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      距上次 <span className="font-mono font-semibold text-foreground tabular-nums">{pull.pullsSinceLastHit}</span> 抽
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionLabel>抽卡时间线（按月）</SectionLabel>
            <MonthlyTimeline months={months} />
          </section>

          <section>
            <SectionLabel>稀有度分布</SectionLabel>
            <RarityBar distribution={analysis.rarityDistribution} rarity={game.rarity} tierLabels={game.tierLabels} />
          </section>
        </TabsContent>

        {bannerStats.map((s) => (
          <TabsContent key={s.banner.id} value={s.banner.id} className="flex flex-col gap-6 px-7 pt-5 pb-7">
            <BannerPanel stats={s} rarity={game.rarity} tierLabels={game.tierLabels} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">{children}</div>
  );
}

function PoolOverviewCard({ stats, topCode, topTierLabel }: { stats: BannerStats; topCode: string; topTierLabel: string }) {
  return (
    <Card>
      <CardTitle>{localizedText(stats.banner.displayName, stats.banner.id)}</CardTitle>
      {stats.pity ? (
        <div className="my-1">
          <PityBar current={stats.pity.currentPity} cap={stats.pity.hardPity} tone="r5" />
        </div>
      ) : (
        <p className="text-[11px] text-faint-foreground">未声明共享保底，无进度数据</p>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        总抽数 <span className="font-mono tabular-nums">{formatCount(stats.totalDraws)}</span> · {topTierLabel}{" "}
        <span className="font-mono tabular-nums">{formatCount(stats.rarityCounts[topCode] ?? 0)}</span> 个
      </p>
    </Card>
  );
}

function BannerPanel({
  stats,
  rarity,
  tierLabels,
}: {
  stats: BannerStats;
  rarity: RaritySpec;
  tierLabels: Record<string, string>;
}) {
  const tiers = rarityTiers(rarity);
  const topTierLabel = tierLabel(tierLabels, tiers.top);
  const distribution = {
    counts: stats.rarityCounts,
    unknownCount: stats.otherCount,
    unrecognizedCount: 0,
  };

  return (
    <>
      <section>
        <SectionLabel>保底进度</SectionLabel>
        <Card>
          {stats.pity ? (
            <>
              <PityBar label={`${topTierLabel}保底`} current={stats.pity.currentPity} cap={stats.pity.hardPity} tone="r5" />
              {stats.pity.nextPullProbability.kind === "value" ? (
                <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  下一抽命中概率约{" "}
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {(stats.pity.nextPullProbability.value * 100).toFixed(1)}%
                  </span>
                </p>
              ) : (
                <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  概率曲线暂不支持计算：{stats.pity.nextPullProbability.reason}
                </p>
              )}
              {stats.pity.sharedWith.length > 0 && (
                <p className="mt-1.5 text-[11px] text-faint-foreground">
                  该保底与「{stats.pity.sharedWith.join("、")}」共享同一计数
                </p>
              )}
              {stats.pity.unknownRarityCount > 0 && (
                <p className="mt-1.5 text-[11px] text-faint-foreground">
                  另有 {stats.pity.unknownRarityCount} 条记录稀有度未知，未计入保底计数
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <Badge variant="neutral">未声明共享保底</Badge>
              <span className="text-xs text-muted-foreground">该卡池未在插件 manifest 的 pityGroups 中声明，没有保底进度数据。</span>
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>关键指标</SectionLabel>
        <div className="flex overflow-hidden rounded-md border border-border bg-card">
          <StatCell value={formatCount(stats.totalDraws)} label="总抽数" />
          <StatCell value={formatCount(stats.rarityCounts[tiers.top] ?? 0)} label={`${topTierLabel}数`} />
          {tiers.second && (
            <StatCell
              value={formatCount(stats.rarityCounts[tiers.second] ?? 0)}
              label={`${tierLabel(tierLabels, tiers.second)}数`}
            />
          )}
          {stats.pity?.avgGap !== undefined && <StatCell value={stats.pity.avgGap} label="平均出货抽数" />}
          {stats.pity?.worstGap !== undefined && <StatCell value={stats.pity.worstGap} label="最非欧一次" />}
          {stats.pity?.bestGap !== undefined && <StatCell value={stats.pity.bestGap} label="最欧一次" />}
        </div>
      </section>

      {stats.pity && stats.pity.topTierPulls.length > 0 && (
        <TopTierRecordsTable pity={stats.pity} topTierLabel={topTierLabel} />
      )}

      <section>
        <SectionLabel>稀有度分布</SectionLabel>
        <RarityBar distribution={distribution} rarity={rarity} tierLabels={tierLabels} />
      </section>
    </>
  );
}

/**
 * 拆成独立组件（而不是内联在 `BannerPanel` 的 JSX 里）纯粹是为了让
 * `pity` 参数的类型收窄在整个组件体内保持非 `undefined`——`BannerPanel`
 * 里 `stats.pity` 是可选属性，TS 不会跨闭包边界（`.map` 的回调）保留对
 * 属性访问表达式的非空 narrowing，拆成参数是标准处理方式，不需要非空断言。
 */
function TopTierRecordsTable({
  pity,
  topTierLabel,
}: {
  pity: NonNullable<BannerStats["pity"]>;
  topTierLabel: string;
}) {
  return (
    <section>
      <SectionLabel>{topTierLabel}记录</SectionLabel>
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
            {pity.topTierPulls.map((pull) => (
              <TableRow key={pull.recordId}>
                <TableCell>{pull.itemId}</TableCell>
                <TableCell>
                  <Badge variant="r5">{topTierLabel}</Badge>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{pull.pullsSinceLastHit}</TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={hitOutcomeHint(pity.guarantee, pull.hitOutcome)}
                >
                  {hitOutcomeLabel(pity.guarantee, pull.hitOutcome)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{formatDate(pull.occurredAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
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
