import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { listGames } from "@/lib/ipc-client";
import { toGameMeta, type GameId, type GameMeta } from "@/lib/games";

/**
 * 应用级状态：已注册游戏列表（真实数据，`list_games()` 只在这里发起一次，
 * 全站共享）+ 已启用的游戏集合 + 是否已完成首次欢迎引导。
 *
 * 真正的持久化（用户配置、已启用插件列表）属于宿主职责，本 Stage 的 IPC
 * 面尚未提供设置项读写命令（需要新的 kv 表 + Rust 迁移，见
 * `docs/_internal/milestones/00-实施总览.md`）——这里继续用 localStorage
 * 兜底，只是把「游戏列表从哪来」换成真实数据，持久化方式本身留作 TODO。
 */

const STORAGE_KEY_ENABLED = "gacha-studio:enabled-games";
const STORAGE_KEY_ONBOARDED = "gacha-studio:onboarded";

function readStoredEnabledGames(): Set<GameId> | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(STORAGE_KEY_ENABLED);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("已存储的启用游戏列表格式不是数组");
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return undefined;
  }
}

function readHasOnboarded(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY_ONBOARDED) === "1";
}

type GamesStatus = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

interface AppStateValue {
  /** 已注册插件（游戏）列表。加载完成前为空数组，配合 `gamesStatus` 判断。 */
  games: GameMeta[];
  gamesStatus: GamesStatus;
  reloadGames: () => void;
  /**
   * 已启用游戏 id 集合。⚠️ 在 `games` 还没加载完成、且用户从未完成过引导
   * 流程（`hasOnboarded === false`）时，这个集合意义不大——欢迎页此时应当
   * 展示"全部已发现的游戏"作为默认勾选态，而不是读这个字段，因为它此刻
   * 可能是空集合（既没有存储值，也还不知道有哪些游戏）。
   */
  enabledGameIds: Set<GameId>;
  setEnabledGameIds: (ids: Set<GameId>) => void;
  hasOnboarded: boolean;
  /** 欢迎页「开始使用」：一并写入启用游戏集合与引导完成标记。 */
  completeOnboarding: (ids: Set<GameId>) => void;
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [gamesStatus, setGamesStatus] = useState<GamesStatus>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const [storedEnabledGameIds, setStoredEnabledGameIds] = useState<Set<GameId> | undefined>(readStoredEnabledGames);
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(readHasOnboarded);

  useEffect(() => {
    let cancelled = false;
    setGamesStatus({ status: "loading" });
    listGames().then(
      (views) => {
        if (cancelled) return;
        setGames(views.map(toGameMeta));
        setGamesStatus({ status: "ready" });
      },
      (err: unknown) => {
        if (cancelled) return;
        setGamesStatus({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // 从未持久化过启用集合时（新装/清过 localStorage），默认视为"全部已发现的
  // 游戏都启用"——游戏列表异步到达，因此这里不能像 mock 阶段那样在模块顶层
  // 同步算出一个默认值，只能在 games 就绪后派生。
  const enabledGameIds = storedEnabledGameIds ?? new Set(games.map((g) => g.id));

  const setEnabledGameIds = (ids: Set<GameId>) => {
    setStoredEnabledGameIds(ids);
    window.localStorage.setItem(STORAGE_KEY_ENABLED, JSON.stringify(Array.from(ids)));
  };

  const completeOnboarding = (ids: Set<GameId>) => {
    setEnabledGameIds(ids);
    window.localStorage.setItem(STORAGE_KEY_ONBOARDED, "1");
    setHasOnboarded(true);
  };

  const value = useMemo<AppStateValue>(
    () => ({
      games,
      gamesStatus,
      reloadGames: () => setReloadToken((t) => t + 1),
      enabledGameIds,
      setEnabledGameIds,
      hasOnboarded,
      completeOnboarding,
    }),
    // enabledGameIds 每次渲染都可能是新派生出的 Set 实例（storedEnabledGameIds
    // 为 undefined 时），不适合直接放依赖数组——用它的两个真正来源代替。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, gamesStatus, storedEnabledGameIds, hasOnboarded],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState 必须在 AppStateProvider 内使用");
  return ctx;
}
