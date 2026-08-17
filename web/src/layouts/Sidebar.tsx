import { LayoutGrid, Layers, Settings as SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";

/**
 * 侧栏——贯通到顶，游戏项常驻文字名（界面设计方向 §4.1）。不做「折叠成
 * 图标条」：图标首次下载前会缺席，纯图标导航对读屏软件等于没有导航。
 *
 * 游戏色在这里只以「圆点」形式出现，是身份标识层的合法落点（§3.1）；
 * 完整的图标/fallback 头像在总览卡片、设置页、游戏详情顶栏才会出现。
 */
export function Sidebar() {
  const { games: allGames, gamesStatus, enabledGameIds } = useAppState();
  const games = allGames.filter((g) => enabledGameIds.has(g.id));

  return (
    <aside className="flex w-[184px] shrink-0 flex-col overflow-hidden bg-sidebar px-3 py-4">
      <div className="flex shrink-0 items-center gap-2 px-1.5 pb-4.5">
        <div className="flex size-[22px] shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary text-primary-foreground">
          <Layers className="size-3.5" />
        </div>
        <span className="text-[13.5px] font-semibold tracking-wide whitespace-nowrap">
          Gacha Studio
        </span>
      </div>

      <SidebarNavLink to="/" icon={<LayoutGrid />} end>
        总览
      </SidebarNavLink>

      <div className="mx-1.5 my-3 h-px shrink-0 bg-border" />

      <div className="shrink-0 px-2 pb-1.5 text-[10.5px] font-semibold tracking-wider text-faint-foreground uppercase">
        已接入游戏
      </div>

      <div className="flex min-h-0 flex-col gap-px overflow-y-auto">
        {games.length === 0 && gamesStatus.status === "loading" && (
          <p className="px-2 py-1.5 text-[11.5px] text-faint-foreground">加载中…</p>
        )}
        {games.length === 0 && gamesStatus.status === "error" && (
          <p className="px-2 py-1.5 text-[11.5px] text-destructive">游戏列表加载失败</p>
        )}
        {games.length === 0 && gamesStatus.status === "ready" && (
          <p className="px-2 py-1.5 text-[11.5px] text-faint-foreground">
            尚未启用任何游戏
          </p>
        )}
        {games.map((game) => (
          <NavLink
            key={game.id}
            to={`/game/${game.id}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-[var(--radius)] px-2 py-1.75 text-[13px] text-foreground",
                "hover:bg-[oklch(0.93_0.005_85)]",
                isActive && "bg-primary-tint font-semibold text-primary hover:bg-primary-tint",
              )
            }
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: `var(${game.colorVar})` }}
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {game.displayName}
            </span>
          </NavLink>
        ))}
      </div>

      <div className="min-h-2 flex-1" />

      <SidebarNavLink to="/settings" icon={<SettingsIcon />}>
        设置
      </SidebarNavLink>
    </aside>
  );
}

function SidebarNavLink({
  to,
  icon,
  end,
  children,
}: {
  to: string;
  icon: ReactNode;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex shrink-0 items-center gap-2.25 rounded-[var(--radius)] px-2 py-1.75 text-[13px] text-muted-foreground",
          "hover:bg-[oklch(0.93_0.005_85)]",
          isActive && "bg-primary-tint font-semibold text-primary hover:bg-primary-tint",
        )
      }
    >
      <span className="[&_svg]:size-[15px]">{icon}</span>
      {children}
    </NavLink>
  );
}
