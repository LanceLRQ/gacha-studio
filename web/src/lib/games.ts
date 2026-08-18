/**
 * 游戏元数据——运行时数据驱动，取代早期 `mock-data.ts` 里写死的
 * `"genshin" | "starrail" | "zzz"` 联合类型。
 *
 * 真实 `list_games()` 会返回四个已注册插件（genshin/wuwa/starrail/zzz），
 * 写死的联合类型会让新增插件时前端静默漏掉一个游戏——`GameId` 因此退化成
 * 裸 `string`，"这是不是一个合法游戏 id" 这个问题交给运行时数据本身回答
 * （在 `games` 数组里能找到就是合法的），不再是类型系统能表达的约束。
 */
import type { BannerSpec, LocalizedText, RaritySpec } from "gs-plugin-kit/types";

import type { GameView } from "@/lib/ipc/generated";

export type GameId = string;

export interface GameMeta {
  id: GameId;
  displayName: string;
  /** 身份标识层游戏色对应的 CSS 变量名，形如 `--game-<id>`。 */
  colorVar: string;
  rarity: RaritySpec;
  /**
   * 稀有度码 → 本地化展示文案，已由 Rust 侧
   * （`gs_analysis::tier_labels_for`）解析成单个字符串——不是裸的
   * `RaritySpec.tierLabels`（那是 `Record<string, LocalizedText>`，需要
   * 再挑一遍语言）。绝区零的 `"4"` 在这里取值是 `"S"`，不是"4星"。
   */
  tierLabels: Record<string, string>;
  banners: BannerSpec[];
}

/**
 * `GameView` → `GameMeta` 的投影。colorVar 采用 `--game-<pluginId>` 的
 * 固定命名约定——`web/src/styles/theme.css` 因此必须为每一个已注册插件都
 * 声明一个同名变量（新增插件时需要补一行，见该文件里 `--game-wuwa` 旁的
 * 注释），这里不做运行时兜底色，缺失时希望在视觉上直接暴露成透明/继承色，
 * 而不是悄悄呈现出一个「看起来正常」但其实没人维护的默认色。
 */
export function toGameMeta(view: GameView): GameMeta {
  return {
    id: view.pluginId,
    displayName: view.displayName,
    colorVar: `--game-${view.pluginId}`,
    rarity: view.rarity,
    tierLabels: view.tierLabels,
    banners: view.banners,
  };
}

/**
 * 从 `LocalizedText`（`Record<string,string>`）里挑一个展示用字符串。
 * 优先级与 Rust 侧 `gs_analysis::display_name_for` 保持一致（zh-CN 优先，
 * 否则取任意一个已有值，都没有就回落到调用方提供的 id），这样 `BannerSpec`
 * 这类未经服务端解析的裸 `LocalizedText` 字段在前端也能用同一套取值规则，
 * 不会出现"账号名走一套规则、卡池名走另一套规则"的不一致。
 */
export function localizedText(text: LocalizedText, fallback: string): string {
  return text["zh-CN"] ?? Object.values(text)[0] ?? fallback;
}

/**
 * 按稀有度码取本地化展示档位文案（真正的"S/A/B"、"五星/四星/三星"这类
 * 本地化名词，来自插件 manifest 各自声明的 `RaritySpec.tierLabels`，
 * 经 Rust 侧 `gs_analysis::tier_labels_for` 解析后由 `GameView.tierLabels`
 * 透出）——绝区零因此会显示"S"而不是"4星"。
 *
 * `tierLabels` 未覆盖这个码时才回落到"码 + 星"这个通用规则——四个已注册
 * 插件当前都已经为自己 `ladder` 声明的每一档补齐了文案，这条回落路径是
 * 防御性的，不是正常路径（理由同 Rust 侧 `tier_labels_for` 的兜底）。
 */
export function tierLabel(tierLabels: Record<string, string>, code: string): string {
  return tierLabels[code] ?? `${code}星`;
}

export interface RarityTiers {
  /** 最高档稀有度码（通常等于 `RaritySpec.pityTarget`）。 */
  top: string;
  /** 次高档稀有度码，阶梯长度不足 2 时不存在。 */
  second?: string;
  /** 其余（第三档及以下）稀有度码，按从高到低排列。 */
  rest: string[];
}

/**
 * 把 `RaritySpec.ladder`（升序排列的稀有度码数组）拆成"最高档 / 次高档 /
 * 其余"三段，供 `RarityBar` 这类只有三个视觉色阶（`--rarity-5/4/3`）的
 * 组件消费。不假设阶梯长度恒为 3——当前四个已注册插件确实都是 3 档，但这里
 * 按数组实际长度取值，阶梯变长时"其余"桶会自然吸收多出来的档位，不会越界。
 */
export function rarityTiers(rarity: RaritySpec): RarityTiers {
  const ladder = rarity.ladder;
  const top = ladder[ladder.length - 1] ?? rarity.pityTarget;
  const second = ladder.length >= 2 ? ladder[ladder.length - 2] : undefined;
  const rest = ladder.slice(0, Math.max(0, ladder.length - 2)).reverse();
  return { top, second, rest };
}
