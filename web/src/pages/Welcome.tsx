import { useState } from "react";
import { ArrowRight, Check, HardDrive, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { GameIcon } from "@/components/game-icon";
import { LoadingState, ErrorState } from "@/components/async-view";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/app-state";
import type { GameId, GameMeta } from "@/lib/games";
import { cn } from "@/lib/utils";

/**
 * 欢迎页——对应 ui-demo/welcome.html。单屏欢迎层，只做「说明 + 勾选启用
 * 哪些游戏」，不做多步向导（§4.4）。
 *
 * 游戏列表来自 `list_games()`（经 AppStateProvider 统一拉取），不再是写死
 * 的 mock 常量——四个已注册插件（genshin/wuwa/starrail/zzz）都会出现在
 * 这里，不需要再手工维护"哪些游戏有 mock 数据支撑"这份名单。
 */
export function Welcome() {
  const navigate = useNavigate();
  const { games, gamesStatus, reloadGames, completeOnboarding } = useAppState();
  // 初次进入欢迎页时默认全选——用 undefined 表示"用户还没有手动改过"，
  // 实际渲染时派生成 games 的全量 id 集合，这样即使 games 异步到达也不需要
  // 额外的 effect 去回填默认值。
  const [selectedOverride, setSelectedOverride] = useState<Set<GameId> | undefined>(undefined);
  const selected = selectedOverride ?? new Set(games.map((g) => g.id));

  function toggle(id: GameId) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedOverride(next);
  }

  function handleStart() {
    if (selected.size === 0) return;
    completeOnboarding(selected);
    navigate("/", { replace: true });
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-background p-8">
      <div className="flex max-h-[calc(100vh-64px)] w-[min(720px,calc(100vw-64px))] flex-col overflow-hidden">
        <div className="shrink-0 px-1 pt-1">
          <div className="mb-3.5 flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[calc(var(--radius)*1.5)] bg-primary text-primary-foreground">
              <Layers className="size-5.5" />
            </div>
            <span className="text-[21px] font-bold tracking-tight">Gacha Studio</span>
          </div>
          <p className="mb-2.5 text-sm text-muted-foreground">把多个游戏的抽卡记录，收拢到一处管理</p>
          <p className="mb-5.5 flex items-center gap-1.5 text-[11.5px] text-faint-foreground">
            <HardDrive className="size-3.25 shrink-0" />
            数据仅保存在本机 · 游戏接口通常只保留最近 6 个月的记录，建议定期更新
          </p>
        </div>

        <div className="mb-2.5 shrink-0 px-1 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">
          选择要启用的游戏
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-1">
          {gamesStatus.status === "loading" && <LoadingState label="正在加载已注册的游戏插件…" />}
          {gamesStatus.status === "error" && <ErrorState message={gamesStatus.message} onRetry={reloadGames} />}
          {gamesStatus.status === "ready" && (
            <div className="flex flex-col gap-2 pb-1">
              {games.map((game) => (
                <GameSelectCard
                  key={game.id}
                  game={game}
                  checked={selected.has(game.id)}
                  onToggle={() => toggle(game.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex shrink-0 items-center justify-between gap-4 border-t border-border px-1 pt-4">
          <span className={cn("text-xs text-muted-foreground", selected.size === 0 && "text-warning-foreground")}>
            {selected.size > 0 ? (
              <>
                已选择 <b className="font-mono">{selected.size}</b> 个游戏
              </>
            ) : (
              "请至少选择一个游戏"
            )}
          </span>
          <Button disabled={selected.size === 0} onClick={handleStart}>
            开始使用
            <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function GameSelectCard({
  game,
  checked,
  onToggle,
}: {
  game: GameMeta;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-center gap-3.5 rounded-[var(--radius)] border border-border bg-card px-3.75 py-3.25",
        "hover:border-border-strong",
        checked && "border-primary bg-primary-tint hover:border-primary",
      )}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
      {/* 欢迎页永远走 fallback（游戏名首字 + 游戏色圆底），不在这里发起图标下载——
          此时游戏尚未启用，下载时机要等到「开始使用」提交之后（§6.3）。 */}
      <GameIcon displayName={game.displayName} colorVar={game.colorVar} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold">{game.displayName}</span>
        <span className="text-[11.5px] text-muted-foreground">读取游戏缓存获取记录链接</span>
      </span>
      <span
        className={cn(
          "flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border-strong bg-background text-transparent",
          checked && "border-primary bg-primary text-primary-foreground",
        )}
      >
        <Check className="size-3" />
      </span>
    </label>
  );
}
