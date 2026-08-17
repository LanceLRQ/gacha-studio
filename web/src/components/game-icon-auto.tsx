import { useEffect, useState } from "react";

import { GameIcon } from "@/components/game-icon";
import { downloadAndVerifyIcon } from "@/lib/game-icon";
import type { GameMeta } from "@/lib/games";

/**
 * 挂载即发起下载——因此调用方必须只在「这个游戏已启用」的场景下渲染本组件
 * （侧栏、总览卡片、设置页），不得在欢迎页的游戏勾选列表里使用，
 * 否则就违反了「启用某游戏时才下载图标，不在启动时批量拉取」（§6.3）。
 * 欢迎页应当直接用 `GameIcon`（不传 iconSrc，恒定走 fallback）。
 */
export function GameIconAuto({
  game,
  size = 26,
  className,
}: {
  game: GameMeta;
  size?: number;
  className?: string;
}) {
  const [iconSrc, setIconSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!game.iconUrl) return;
    let cancelled = false;
    let createdObjectUrl: string | undefined;

    void downloadAndVerifyIcon(game.iconUrl).then((result) => {
      if (cancelled) return;
      // 下载失败时保持 undefined，交给 GameIcon 走 fallback——这是设计文档
      // §6.3「缓存后图标是可靠的，仅在首次下载前与下载失败时缺席」的正常路径，
      // 不重试、不报错打断渲染。
      if (result.ok) {
        createdObjectUrl = result.objectUrl;
        setIconSrc(result.objectUrl);
      }
    });

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [game.iconUrl]);

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
