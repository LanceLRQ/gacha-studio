import { useEffect, useReducer } from "react";

import { GameIcon } from "@/components/game-icon";
import { ensureGameIcon } from "@/lib/ipc-client";
import type { GameMeta } from "@/lib/games";

/**
 * 挂载即发起 `ensure_game_icon` 调用——因此调用方必须只在「这个游戏已启用」
 * 的场景下渲染本组件，不得在欢迎页的游戏勾选列表里使用，否则就违反了
 * 「启用某游戏时才下载图标，不在启动时批量拉取」（§6.3）。
 *
 * 目前的实际渲染点：`Sidebar.tsx`（侧栏已接入游戏列表——`Sidebar.tsx:16-17`
 * 同样先过 `allGames.filter(g => enabledGameIds.has(g.id))`，符合 §6.3 的
 * 前提）、`Overview.tsx`（总览卡片）、`GameDetail.tsx`（游戏详情页头部）、
 * `Settings.tsx`（设置页游戏卡，同样先过 `enabledGameIds` 过滤）。反例是
 * `Welcome.tsx` 的游戏勾选列表——那里的游戏还没被启用，必须继续用不发请求
 * 的 `GameIcon`（不传 iconSrc，恒定走 fallback）。
 *
 * 两层缓存，缺一都不够：
 * - `inflightIconRequests`：防「同一时刻的并发调用」——请求一落地就把条目
 *   删掉，所以它不能防止「先挂载一次、卸载、再挂载一次」这种先后来两次都
 *   重新发 IPC 的情况。
 *   ⚠️ 这一层不是防御性冗余，是每次页面加载都会走到的常规路径：`Sidebar`
 *   是 `AppShell` 的常驻部分，与 Overview / GameDetail / Settings 里当前
 *   激活的那一个页面**同时挂载**——打开原神详情页的那一刻，侧栏「原神」项
 *   与详情页头部的 `GameIconAuto` 会在同一次渲染批次里各自对同一个 gameId
 *   发起调用。（旧版本这里写的是"三个渲染点分属互斥路由，只有 StrictMode
 *   能让这层触发"——侧栏加入后这个前提不再成立，如实更正：现在是常规路径，
 *   不是只在开发模式下才会触发的边角情况。）
 * - `resolvedIconCache`：补上面这一层空档，把成功结果留在会话内。渲染时
 *   直接从这里同步读——第二次及以后的挂载能在首次渲染就拿到真图标，不会
 *   像只有 in-flight 去重那版一样，每次挂载都先闪一帧 fallback 字形再换成
 *   真图标。
 *
 * `resolvedIconCache` 只登记成功结果，`null`/IPC 异常一律不缓存——两者都
 * 可能是「这次没网、宿主磁盘缓存还没建好」这类会恢复的临时状态，缓存下来
 * 会让图标在整个会话里永久缺席，即使用户后来联网、宿主后续能成功下载，
 * 组件也不会重试。`iconUrl` 是编译期 manifest 里的常量，改它必须重新构建
 * 应用，因此成功结果不需要过期逻辑，会话内长期有效即可。
 *
 * ⚠️ **`resolvedIconCache` 是唯一事实来源，组件不持有副本**：`GameDetail`
 * 页（`/game/:gameId`）换 `:gameId` 参数不会重新挂载组件——同一个
 * `GameIconAuto` 实例会先渲染游戏 A 的图标、再被要求渲染游戏 B 的。若用
 * `useState` 把某次拿到的图标存进组件自己的状态，`game.id` 变化后的第一次
 * 渲染会先画出「A 的图标 + B 的标题」这种张冠李戴的画面，直到 effect 里的
 * promise resolve 才纠正过来——显示错误内容比显示中性占位符更糟，用户会
 * 以为自己点错了游戏。因此这里改用 `useReducer` 只当渲染触发器，`iconSrc`
 * 每次渲染都从 `resolvedIconCache` 按当前 `game.id` 现取，不存在「渲染出的
 * 图标属于另一个 game.id」这种状态。
 */
const resolvedIconCache = new Map<string, string>();
const inflightIconRequests = new Map<string, Promise<string | null>>();

function ensureGameIconDeduped(gameId: string): Promise<string | null> {
  const cached = resolvedIconCache.get(gameId);
  if (cached) return Promise.resolve(cached);

  const existing = inflightIconRequests.get(gameId);
  if (existing) return existing;

  // IPC 调用本身异常（如命令未注册、序列化失败）与「宿主判断这个游戏没有
  // 可用图标」是两回事，但对本组件而言处理方式相同——都不值得打断渲染或
  // 弹错误提示，统一按「没有图标」处理，走 GameIcon 的 fallback。
  const request = ensureGameIcon(gameId)
    .catch(() => null)
    .then((dataUrl) => {
      // 只把成功结果写进会话缓存，见上方 resolvedIconCache 的说明。
      if (dataUrl) resolvedIconCache.set(gameId, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      inflightIconRequests.delete(gameId);
    });
  inflightIconRequests.set(gameId, request);
  return request;
}

export function GameIconAuto({
  game,
  size = 26,
  className,
}: {
  game: GameMeta;
  size?: number;
  className?: string;
}) {
  // iconSrc 不是 state，是每次渲染按当前 game.id 从缓存现取的派生值——
  // 若该 gameId 此前已经在本会话里成功解析过，首次渲染就能拿到真图标；
  // 换游戏时也不会残留上一个游戏的图标，因为这里读的永远是当前 game.id。
  const iconSrc = resolvedIconCache.get(game.id);
  // 唯一作用是在异步结果落地后强制重渲染一次，好让上面这行重新读缓存——
  // 本身不携带任何图标数据，因此不存在「持有过期副本」的问题。
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let cancelled = false;

    void ensureGameIconDeduped(game.id).then((dataUrl) => {
      if (cancelled) return;
      // 返回 null 时不触发重渲染，交给 GameIcon 走 fallback——这是设计文档
      // §6.3「缓存后图标是可靠的，仅在首次下载前与下载失败时缺席」的正常路径，
      // 不重试、不报错打断渲染。返回值本身就是 data URL，不是 object URL，
      // 不需要 URL.revokeObjectURL 这类清理。
      if (dataUrl) forceRerender();
    });

    return () => {
      cancelled = true;
    };
  }, [game.id]);

  return (
    <GameIcon
      displayName={game.displayName}
      colorVar={game.colorVar}
      iconSrc={iconSrc}
      size={size}
      className={className}
    />
  );
}
