import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-view";
import { GameIconAuto } from "@/components/game-icon-auto";
import { RarityBar } from "@/components/rarity-bar";
import { RiskBadge } from "@/components/risk-badge";
import { StatsStrip } from "@/components/stats-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardTitleGroup } from "@/components/ui/card";
import { useAppState } from "@/lib/app-state";
import { formatCount, formatDate, maskUid } from "@/lib/format";
import type { GameMeta } from "@/lib/games";
import { listAccounts, overviewStats } from "@/lib/ipc-client";
import type { AccountView } from "@/lib/ipc/generated";
import { useAsync } from "@/lib/use-async";

const ACCOUNT_COLUMNS = "grid-cols-[70px_110px_150px_120px_110px]";

/**
 * 总览页——对应 ui-demo/index.html。
 *
 * 风险徽章（§1.2「风险优先于数据」）现在渲染真实数据：判定逻辑已下沉到
 * `gs_host::retention::evaluate_account_retention_risk`，经
 * `AccountView.retentionRisk` 送到这里，不再是前端自己编的四级状态机。
 * `Blocked` 档暂时不会出现（依赖的 `gameDirValid`/连续失败计数 Rust 侧
 * 还没有，见 `RetentionRiskLevel::Blocked` 文档），但类型与展示样式已经
 * 备好，接线时不需要再改这个页面。
 *
 * ⚠️ `retentionRisk` 为 `null`（插件未声明保留期策略，或账号还没有任何
 * 记录）时**不渲染 `RiskBadge`**——那会把"无法评估"谎报成某个具体等级。
 * 改为渲染一段视觉上明显不是徽章的灰色文案，与任何风险等级（包括视觉上
 * 最弱的 `safe`）都区分得开。
 *
 * 采集/更新链路（"更新全部"按钮）本身没有对应 IPC 命令，保留按钮但禁用，
 * 指向真正可用的入口（设置页 · 导入存档）。
 *
 * ⚠️ min-height:0 落点：本页根节点是 AppShell `.main` 容器的直接子级
 * （经由 <Outlet/>），因此这里必须自己再声明一层 `min-h-0`。
 */
export function Overview() {
  const { games: allGames, enabledGameIds } = useAppState();
  const games = allGames.filter((g) => enabledGameIds.has(g.id));

  const accountsState = useAsync(() => listAccounts(), []);
  const statsState = useAsync(() => overviewStats(), []);

  const loading = accountsState.status === "loading" || statsState.status === "loading";
  const errorMessage =
    accountsState.status === "error" ? accountsState.message : statsState.status === "error" ? statsState.message : undefined;

  const accounts = accountsState.status === "ready" ? accountsState.data : [];
  const enabledAccountsCount = accounts.filter((a) => enabledGameIds.has(a.pluginId)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-7 pt-4.5 pb-3.5">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">总览</h1>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {games.length} 个游戏 · {enabledAccountsCount} 个账号
          </p>
        </div>
        <Button disabled title="采集/更新功能尚未接入 IPC，请到设置页使用「导入存档」">
          <RefreshCw />
          更新全部
        </Button>
      </header>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {loading && <LoadingState label="正在读取账号与统计数据…" />}
        {errorMessage && (
          <ErrorState message={errorMessage} onRetry={() => { accountsState.reload(); statsState.reload(); }} />
        )}
        {!loading && !errorMessage && statsState.status === "ready" && (
          <div className="flex flex-col gap-3 px-7 pt-1 pb-7">
            <section>
              <SectionLabel>账号状态</SectionLabel>
              <div className="flex flex-col gap-2">
                {games.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground">
                    尚未启用任何游戏，前往设置页或欢迎流程启用后即可看到账号状态。
                  </p>
                )}
                {games.map((game) => (
                  <GameAccountsCard key={game.id} game={game} accounts={accounts.filter((a) => a.pluginId === game.id)} />
                ))}
              </div>
            </section>

            <section>
              <SectionLabel>跨游戏数据</SectionLabel>
              {statsState.data.accountsCount === 0 ? (
                <EmptyState
                  title="还没有任何本地数据"
                  description="导入一份抽卡存档后，这里会展示跨账号的抽数、保底命中与稀有度分布统计。"
                  action={
                    <Button asChild size="sm">
                      <Link to="/settings">前往设置页导入</Link>
                    </Button>
                  }
                />
              ) : (
                <>
                  <StatsStrip
                    items={[
                      { value: formatCount(statsState.data.totalDraws), label: "总抽数" },
                      { value: formatCount(statsState.data.totalPityTargetHits), label: "保底最高档命中数" },
                      { value: `${statsState.data.gamesCount} · ${statsState.data.accountsCount}`, label: "已管理游戏 · 账号" },
                    ]}
                  />
                  <div className="mt-3 flex flex-col gap-3">
                    {statsState.data.rarityByPlugin.map((entry) => {
                      // ⚠️ 按插件分组展示，不摊平合并——绝区零的 "4" 是最高档、
                      // 原神的 "4" 是次高档，摊平会产出"错但看起来合理"的数字。
                      const game = allGames.find((g) => g.id === entry.pluginId);
                      if (!game) return null;
                      return (
                        <div key={entry.pluginId}>
                          <p className="mb-1.5 text-[11.5px] text-muted-foreground">{game.displayName}</p>
                          <RarityBar
                            distribution={entry.distribution}
                            rarity={game.rarity}
                            tierLabels={game.tierLabels}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
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

function GameAccountsCard({ game, accounts }: { game: GameMeta; accounts: AccountView[] }) {
  return (
    <Card>
      <CardHeader>
        <GameIconAuto game={game} />
        <CardTitleGroup>
          <Link to={`/game/${game.id}`} className="hover:underline">
            <CardTitle>{game.displayName}</CardTitle>
          </Link>
          <span className="text-[11.5px] text-muted-foreground">{accounts.length} 个账号</span>
        </CardTitleGroup>
      </CardHeader>

      {accounts.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">该游戏下还没有本地账号，前往设置页导入存档后会出现在这里。</p>
      ) : (
        <div className="flex flex-col">
          <div className={`grid gap-x-3.5 border-b border-border pb-1.25 ${ACCOUNT_COLUMNS}`}>
            <ColumnHead>风险</ColumnHead>
            <ColumnHead>UID</ColumnHead>
            <ColumnHead>服务器</ColumnHead>
            <ColumnHead>上次采集</ColumnHead>
            <ColumnHead>记录条数</ColumnHead>
          </div>
          {accounts.map((account) => (
            <div
              key={account.id}
              className={`grid items-center gap-x-3.5 border-b border-border py-1.25 text-[12.5px] last:border-b-0 ${ACCOUNT_COLUMNS}`}
            >
              {account.retentionRisk === null ? (
                <span
                  className="text-[11.5px] text-faint-foreground"
                  title="无法评估保留期风险：该游戏未声明保留期策略，或该账号还没有任何记录"
                >
                  未知
                </span>
              ) : (
                <RiskBadge level={account.retentionRisk.level} className="w-fit" />
              )}
              <span className="font-mono whitespace-nowrap tabular-nums">{maskUid(account.gameUid)}</span>
              <span className="whitespace-nowrap">{account.region}</span>
              {account.lastCollectedAt === null ? (
                <Badge variant="warning" className="w-fit">
                  从未采集
                </Badge>
              ) : (
                <span className="whitespace-nowrap">{formatDate(account.lastCollectedAt)}</span>
              )}
              <span className="font-mono whitespace-nowrap tabular-nums">{formatCount(account.recordCount)} 条</span>
            </div>
          ))}
        </div>
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
