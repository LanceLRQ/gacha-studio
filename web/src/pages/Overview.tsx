import { FolderOpen, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { GameIconAuto } from "@/components/game-icon-auto";
import { RarityBar } from "@/components/rarity-bar";
import { RiskBadge } from "@/components/risk-badge";
import { StatsStrip } from "@/components/stats-strip";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardTitle, CardTitleGroup } from "@/components/ui/card";
import { useAppState } from "@/lib/app-state";
import { formatCount, maskUid } from "@/lib/format";
import {
  MOCK_GAMES,
  RETENTION_CONSERVATIVE_DAYS,
  accountsOf,
  computeOverviewStats,
  type GameId,
} from "@/lib/mock-data";
import { computeAccountRisk, mostUrgent } from "@/lib/risk";
import { cn } from "@/lib/utils";

const ACCOUNT_COLUMNS = "grid-cols-[110px_150px_110px_140px_110px]";

/**
 * 总览页——对应 ui-demo/index.html。三层信息架构（§1.2）：
 * 风险状态 → 聚合数据 → 操作入口，此顺序不是排版偏好，是「风险优先于数据」
 * 这条设计原则本身（§1.2）。
 *
 * ⚠️ min-height:0 落点：本页根节点是 AppShell `.main` 容器的直接子级
 * （经由 <Outlet/>），因此这里必须自己再声明一层 `min-h-0`——不能假设
 * AppShell 已经清过一次就够了，滚动容器（下方 scroll-area）的直接 flex
 * 祖先链条上，每一层都要显式写。
 */
export function Overview() {
  const { enabledGameIds } = useAppState();
  const games = MOCK_GAMES.filter((g) => enabledGameIds.has(g.id));
  const stats = computeOverviewStats();

  const updateAges = games
    .flatMap((g) => accountsOf(g.id))
    .map((a) => (a.lastSuccessfulUpdateAt ? Math.floor((Date.now() - a.lastSuccessfulUpdateAt) / 86_400_000) : undefined))
    .filter((v): v is number => v !== undefined);
  const lastFullUpdateDays = updateAges.length > 0 ? Math.min(...updateAges) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-7 pt-4.5 pb-3.5">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">总览</h1>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {games.length} 个游戏 · {games.reduce((sum, g) => sum + accountsOf(g.id).length, 0)} 个账号
            {lastFullUpdateDays !== undefined && ` · 最近一次全量更新 ${lastFullUpdateDays} 天前`}
          </p>
        </div>
        <Button>
          <RefreshCw />
          更新全部
        </Button>
      </header>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-3 px-7 pt-1 pb-7">
          <section>
            <SectionLabel>风险与状态</SectionLabel>
            <div className="flex flex-col gap-2">
              {games.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  尚未启用任何游戏，前往设置页或欢迎流程启用后即可看到风险状态。
                </p>
              )}
              {games.map((game) => (
                <GameRiskCard key={game.id} gameId={game.id} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>跨游戏数据</SectionLabel>
            <StatsStrip
              items={[
                { value: formatCount(stats.totalDraws), label: "总抽数" },
                { value: formatCount(stats.totalFiveStars), label: "五星" },
                { value: stats.avgDrawsPerFiveStar, label: "平均出货（抽）" },
                { value: `${stats.gamesCount} · ${stats.accountsCount}`, label: "已管理游戏 · 账号" },
              ]}
            />
            <p className="mt-2 mb-1.5 text-[11.5px] text-muted-foreground">跨游戏稀有度分布</p>
            <RarityBar {...stats.rarity} />
          </section>
        </div>
      </div>
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

function GameRiskCard({ gameId }: { gameId: GameId }) {
  const game = MOCK_GAMES.find((g) => g.id === gameId);
  if (!game) return null;
  const accounts = accountsOf(gameId);
  const risks = accounts.map((account) => ({
    account,
    risk: computeAccountRisk({
      gameDirValid: account.gameDirValid,
      lastSuccessfulUpdateAt: account.lastSuccessfulUpdateAt,
      retentionConservativeDays: RETENTION_CONSERVATIVE_DAYS,
    }),
  }));
  // 卡片级风险状态取该游戏下最紧急的账号（§4.3）。
  const cardRisk = mostUrgent(risks.map((r) => r.risk));

  return (
    <Card
      className={cn(
        cardRisk?.level === "watch" && "border-warning bg-warning-bg",
        cardRisk?.level === "blocked" && "border-destructive bg-destructive-bg",
      )}
    >
      <CardHeader>
        <GameIconAuto game={game} />
        <CardTitleGroup>
          <Link to={`/game/${game.id}`} className="hover:underline">
            <CardTitle>{game.displayName}</CardTitle>
          </Link>
          <span className="text-[11.5px] text-muted-foreground">{accounts.length} 个账号</span>
        </CardTitleGroup>
        {cardRisk && <RiskBadge level={cardRisk.level} className="ml-auto" />}
      </CardHeader>

      <div className="flex flex-col">
        <div className={cn("grid gap-x-3.5 border-b border-border pb-1.25", ACCOUNT_COLUMNS)}>
          <ColumnHead>UID</ColumnHead>
          <ColumnHead>服务器</ColumnHead>
          <ColumnHead>上次更新</ColumnHead>
          <ColumnHead>距数据丢失</ColumnHead>
          <ColumnHead>累计抽数</ColumnHead>
        </div>
        {risks.map(({ account, risk }) => (
          <div
            key={account.id}
            className={cn(
              "items-center gap-x-3.5 border-b border-border py-1.25 text-[12.5px] last:border-b-0",
              "grid",
              ACCOUNT_COLUMNS,
            )}
          >
            <span className="font-mono whitespace-nowrap tabular-nums">{maskUid(account.uid)}</span>
            <span className="whitespace-nowrap">{account.serverLabel}</span>
            {account.consecutiveFailureCount > 0 ? (
              <span className="flex flex-col gap-px leading-tight">
                <span className="whitespace-nowrap">
                  {account.lastSuccessfulUpdateAt
                    ? `${Math.floor((Date.now() - account.lastSuccessfulUpdateAt) / 86_400_000)} 天前`
                    : "从未成功"}
                </span>
                <span className="text-[10px] whitespace-nowrap text-destructive">连续更新失败</span>
              </span>
            ) : (
              <span className="whitespace-nowrap">
                {account.lastSuccessfulUpdateAt
                  ? `${Math.floor((Date.now() - account.lastSuccessfulUpdateAt) / 86_400_000)} 天前`
                  : "从未更新"}
              </span>
            )}
            <span
              className={cn(
                "font-mono font-semibold whitespace-nowrap tabular-nums",
                risk.level === "watch" && "text-warning-foreground",
                (risk.level === "urgent" || risk.level === "blocked") && "text-destructive",
              )}
            >
              {risk.remainingDays <= 0 ? "已失效" : `还剩 ${risk.remainingDays} 天`}
            </span>
            <span className="font-mono whitespace-nowrap tabular-nums">
              {formatCount(account.totalDraws)} 抽
            </span>
          </div>
        ))}
      </div>

      {cardRisk?.level === "blocked" && (
        <CardFooter>
          <Button variant="destructive" asChild>
            <Link to="/settings">
              <FolderOpen />
              重新选择目录
            </Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ColumnHead({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold tracking-wide whitespace-nowrap text-faint-foreground uppercase">
      {children}
    </span>
  );
}
