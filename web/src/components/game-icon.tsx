import { fallbackIconGlyph } from "@/lib/game-icon";
import { cn } from "@/lib/utils";

interface GameIconProps {
  displayName: string;
  /** 游戏色 CSS 变量名，如 "--game-genshin"（§3.1 身份标识层，只在这里当变量名使用）。 */
  colorVar: string;
  /** 已下载并校验通过的图标地址；缺省时走 fallback（§6.4）。 */
  iconSrc?: string;
  size?: number;
  className?: string;
}

/**
 * 展示型组件：有图标画图标，没有就「游戏名首字 + 游戏色圆底」。
 * 是否发起下载不是这个组件的职责，见 {@link ../lib/game-icon.ts} 与
 * `GameIconAuto`（`components/game-icon-auto.tsx`）——保持关注点分离，
 * 这个组件本身没有副作用，纸面测试时不需要 mock 网络请求。
 */
export function GameIcon({ displayName, colorVar, iconSrc, size = 26, className }: GameIconProps) {
  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={displayName}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-[oklch(0.99_0.004_85)]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), background: `var(${colorVar})` }}
      aria-hidden="true"
    >
      {fallbackIconGlyph(displayName)}
    </span>
  );
}
