import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { MOCK_GAMES, type GameId } from "@/lib/mock-data";

/**
 * 应用级状态：已启用的游戏集合 + 是否已完成首次欢迎引导。
 *
 * 真正的持久化（用户配置、已启用插件列表）属于宿主职责，S3 存储链路接通后
 * 应该改为读写 Rust 侧配置；这里用 localStorage 兜底，只是为了让
 * Welcome → Sidebar/Overview → Settings 这条链路在纯前端 mock 阶段也能
 * 真实联动，而不是欢迎页选了之后其余页面毫无反应。
 */

const STORAGE_KEY_ENABLED = "gacha-studio:enabled-games";
const STORAGE_KEY_ONBOARDED = "gacha-studio:onboarded";

const ALL_GAME_IDS = MOCK_GAMES.map((g) => g.id);

function readEnabledGames(): Set<GameId> {
  if (typeof window === "undefined") return new Set(ALL_GAME_IDS);
  const raw = window.localStorage.getItem(STORAGE_KEY_ENABLED);
  if (!raw) return new Set(ALL_GAME_IDS);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("已存储的启用游戏列表格式不是数组");
    const valid = parsed.filter((id): id is GameId => ALL_GAME_IDS.includes(id as GameId));
    return new Set(valid);
  } catch {
    return new Set(ALL_GAME_IDS);
  }
}

function readHasOnboarded(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY_ONBOARDED) === "1";
}

interface AppStateValue {
  enabledGameIds: Set<GameId>;
  setEnabledGameIds: (ids: Set<GameId>) => void;
  hasOnboarded: boolean;
  /** 欢迎页「开始使用」：一并写入启用游戏集合与引导完成标记。 */
  completeOnboarding: (ids: Set<GameId>) => void;
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [enabledGameIds, setEnabledGameIdsState] = useState<Set<GameId>>(readEnabledGames);
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(readHasOnboarded);

  const setEnabledGameIds = (ids: Set<GameId>) => {
    setEnabledGameIdsState(ids);
    window.localStorage.setItem(STORAGE_KEY_ENABLED, JSON.stringify(Array.from(ids)));
  };

  const completeOnboarding = (ids: Set<GameId>) => {
    setEnabledGameIds(ids);
    window.localStorage.setItem(STORAGE_KEY_ONBOARDED, "1");
    setHasOnboarded(true);
  };

  const value = useMemo<AppStateValue>(
    () => ({ enabledGameIds, setEnabledGameIds, hasOnboarded, completeOnboarding }),
    [enabledGameIds, hasOnboarded],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState 必须在 AppStateProvider 内使用");
  return ctx;
}
