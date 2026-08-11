/**
 * ⚠️ Mock 数据集中地。
 *
 * 存储与分析层的真实数据尚未接通（S3 采集链路、gs-analysis 通用引擎均未
 * 落地），本文件是 M1-S6「界面先行」的临时数据源。**S3/S5 接通真实数据后，
 * 本文件应当被整体替换**——页面组件只应该依赖下方导出的函数/常量的
 * *形状*，不应该有任何组件反过来引用这里的具体数值做业务判断。
 *
 * 记录形状对齐 `gs-plugin-kit/types`（`gs-codegen` 从 crates/gs-core 生成，
 * 与 Rust 侧结构一一对应），不额外发明字段；确有需要展示但类型里没有的
 * 派生数据（如「保底内第几抽」，属于分析层产物，不是采集层原始字段），
 * 用独立的 `MockRecordRow` 包装，不塞进 `GachaRecord` 本体。
 */
import type { GachaRecord } from "gs-plugin-kit/types";

// ============================================================
// 固定种子伪随机数（mulberry32）——保证同一账号每次渲染产出同一批数据，
// 便于人工核对布局时数字不会一直跳动。移植自
// docs/_internal/ui-demo/records.html 的生成脚本。
// ============================================================
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pickOne：候选数组为空");
  return item;
}

// ============================================================
// 游戏元数据
// ============================================================

export type GameId = "genshin" | "starrail" | "zzz";

export interface MockGameMeta {
  id: GameId;
  displayName: string;
  /** 身份标识层游戏色对应的 CSS 变量名（§3.1）——只在这里引用变量名，
   *  真正的色值只在 theme.css 声明一次。 */
  colorVar: string;
  /** 对应插件 manifest 的 `iconUrl`。原神插件目前未声明该字段（真实现状，
   *  见 plugins/genshin/manifest.ts），刻意保留空缺以验证 §6.4 fallback 路径。 */
  iconUrl?: string;
  /**
   * 最高档/次高档的展示文案。不能全站硬编码「五星/四星」——绝区零的稀有度
   * 阶梯实测是 `["2","3","4"]`（见 milestones/02-M1-原神插件全链路.md S7），
   * 最高档不是「五星」。`MockBanner.pity5/fiveStarCount` 这些字段名沿用
   * 米哈游三游的习惯命名（只是 mock 结构的字段名，不是界面文案），真正渲染
   * 到界面上的文案一律经这里的 tierLabels 转换。
   */
  tierLabels: MockTierLabels;
}

export interface MockTierLabels {
  top: string;
  second: string;
  third: string;
}

export const MOCK_GAMES: readonly MockGameMeta[] = [
  {
    id: "genshin",
    displayName: "原神",
    colorVar: "--game-genshin",
    tierLabels: { top: "五星", second: "四星", third: "三星" },
  },
  {
    id: "starrail",
    displayName: "崩坏：星穹铁道",
    colorVar: "--game-starrail",
    iconUrl: "https://img-tc.tapimg.com/market/images/starrail-icon.png",
    tierLabels: { top: "五星", second: "四星", third: "三星" },
  },
  {
    id: "zzz",
    displayName: "绝区零",
    colorVar: "--game-zzz",
    iconUrl: "https://img-tc.tapimg.com/market/images/zzz-icon.png",
    tierLabels: { top: "S 级", second: "A 级", third: "B 级" },
  },
];

export function getGameMeta(gameId: GameId): MockGameMeta {
  const meta = MOCK_GAMES.find((g) => g.id === gameId);
  if (!meta) throw new Error(`未知游戏 id: ${gameId}`);
  return meta;
}

// ============================================================
// 账号与风险相关字段
// ============================================================

export interface MockAccount {
  id: number;
  gameId: GameId;
  uid: string;
  serverLabel: string;
  /** 上一次成功更新的时刻；`undefined` 表示从未成功更新过。 */
  lastSuccessfulUpdateAt: number | undefined;
  gameDirValid: boolean;
  gameDirPath: string;
  consecutiveFailureCount: number;
  totalDraws: number;
}

/** 与 plugins/genshin/manifest.ts 的 `retention.conservativeDays` 保持一致（6 个月 × 28 天口径）。 */
export const RETENTION_CONSERVATIVE_DAYS = 6 * 28;

const NOW = Date.now();
const DAY = 86_400_000;

export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    id: 1,
    gameId: "genshin",
    uid: "108888432",
    serverLabel: "天空岛（国服）",
    lastSuccessfulUpdateAt: NOW - 3 * DAY,
    gameDirValid: true,
    gameDirPath: String.raw`D:\Genshin Impact\Genshin Impact Game`,
    consecutiveFailureCount: 0,
    totalDraws: 1247,
  },
  {
    id: 2,
    gameId: "genshin",
    uid: "150220917",
    serverLabel: "世界树（国际服）",
    lastSuccessfulUpdateAt: NOW - 3 * DAY,
    gameDirValid: true,
    gameDirPath: String.raw`D:\Genshin Impact\Genshin Impact Game`,
    consecutiveFailureCount: 0,
    totalDraws: 386,
  },
  {
    id: 3,
    gameId: "starrail",
    uid: "132212205",
    serverLabel: "官服",
    lastSuccessfulUpdateAt: NOW - 118 * DAY,
    gameDirValid: true,
    gameDirPath: String.raw`E:\HoyoGames\Star Rail\Game`,
    consecutiveFailureCount: 0,
    totalDraws: 892,
  },
  {
    id: 4,
    gameId: "zzz",
    uid: "137777734",
    serverLabel: "官服",
    // 已超出保留期：与设计稿 index.html 一致，用于演示「阻塞」态与「已失效」文案。
    lastSuccessfulUpdateAt: NOW - 191 * DAY,
    gameDirValid: false,
    gameDirPath: String.raw`D:\Games\ZenlessZoneZero\ZenlessZoneZero Game`,
    consecutiveFailureCount: 6,
    totalDraws: 1366,
  },
];

export function accountsOf(gameId: GameId): MockAccount[] {
  return MOCK_ACCOUNTS.filter((a) => a.gameId === gameId);
}

// ============================================================
// 卡池保底概览、最近五星、时间线、稀有度分布——GameDetail 总视图用
// ============================================================

export interface MockPityTrack {
  current: number;
  cap: number;
}

export interface MockBanner {
  id: string;
  displayName: string;
  totalDraws: number;
  fiveStarCount: number;
  fourStarCount: number;
  /** 一次性卡池（如新手祈愿）已抽完时为 true，不再展示保底进度。 */
  completed?: boolean;
  pity5?: MockPityTrack;
  pity4?: MockPityTrack;
  toNextPity5?: number;
  avgDraws?: number;
  worstGap?: number;
  bestGap?: number;
  note?: string;
  /** 卡池内的稀有度分布，未提供时按 total/five/four 反推三星数近似。 */
  rarityDistribution?: MockRarityDistribution;
  /** 该卡池内的五星记录明细，用于卡池 tab 下的「五星记录」表格。 */
  fiveStarRecords?: readonly MockBannerFiveStarRow[];
}

export interface MockBannerFiveStarRow {
  itemName: string;
  gap: number;
  isLoss: boolean;
  date: number;
}

export interface MockFiveStarEntry {
  itemName: string;
  poolLabel: string;
  occurredAt: number;
  gap: number;
  isLoss?: boolean;
}

export interface MockMonthlyTimelineEntry {
  month: string;
  draws: number;
  fiveStarCount: number;
}

export interface MockRarityDistribution {
  r5: number;
  r4: number;
  r3: number;
}

export interface MockGameDetail {
  banners: readonly MockBanner[];
  recentFiveStars: readonly MockFiveStarEntry[];
  timeline: readonly MockMonthlyTimelineEntry[];
  rarityDistribution: MockRarityDistribution;
}

const GENSHIN_DETAIL: MockGameDetail = {
  banners: [
    {
      id: "301",
      displayName: "角色活动祈愿",
      totalDraws: 752,
      fiveStarCount: 9,
      fourStarCount: 92,
      pity5: { current: 43, cap: 90 },
      pity4: { current: 3, cap: 10 },
      toNextPity5: 47,
      avgDraws: 78.8,
      worstGap: 120,
      bestGap: 55,
      rarityDistribution: { r5: 9, r4: 92, r3: 651 },
      fiveStarRecords: [
        { itemName: "林尼", gap: 68, isLoss: false, date: Date.parse("2026-08-01") },
        { itemName: "基尼奇", gap: 71, isLoss: true, date: Date.parse("2026-06-20") },
        { itemName: "玛拉妮", gap: 81, isLoss: false, date: Date.parse("2026-05-05") },
        { itemName: "丝柯克", gap: 74, isLoss: false, date: Date.parse("2026-03-20") },
        { itemName: "克洛琳德", gap: 120, isLoss: true, date: Date.parse("2026-02-05") },
        { itemName: "莱欧斯利", gap: 55, isLoss: false, date: Date.parse("2025-12-20") },
        { itemName: "阿蕾奇诺", gap: 90, isLoss: true, date: Date.parse("2025-11-05") },
        { itemName: "那维莱特", gap: 62, isLoss: false, date: Date.parse("2025-09-20") },
        { itemName: "娜维娅", gap: 88, isLoss: true, date: Date.parse("2025-08-05") },
      ],
    },
    {
      id: "302",
      displayName: "武器活动祈愿",
      totalDraws: 210,
      fiveStarCount: 2,
      fourStarCount: 26,
      pity5: { current: 12, cap: 80 },
      pity4: { current: 7, cap: 10 },
      toNextPity5: 68,
      avgDraws: 99,
      worstGap: 108,
      bestGap: 90,
      rarityDistribution: { r5: 2, r4: 26, r3: 182 },
      fiveStarRecords: [
        { itemName: "圣显之钥", gap: 90, isLoss: false, date: Date.parse("2026-06-10") },
        { itemName: "图莱杜拉的回忆", gap: 108, isLoss: true, date: Date.parse("2025-11-15") },
      ],
    },
    {
      id: "200",
      displayName: "常驻祈愿",
      totalDraws: 265,
      fiveStarCount: 3,
      fourStarCount: 32,
      pity5: { current: 58, cap: 90 },
      pity4: { current: 1, cap: 10 },
      toNextPity5: 32,
      avgDraws: 69,
      worstGap: 75,
      bestGap: 62,
      rarityDistribution: { r5: 3, r4: 32, r3: 230 },
      fiveStarRecords: [
        { itemName: "天空之翼", gap: 62, isLoss: false, date: Date.parse("2026-05-01") },
        { itemName: "琴", gap: 70, isLoss: true, date: Date.parse("2026-03-01") },
        { itemName: "莫娜", gap: 75, isLoss: false, date: Date.parse("2026-01-15") },
      ],
    },
    {
      id: "100",
      displayName: "新手祈愿",
      totalDraws: 20,
      fiveStarCount: 1,
      fourStarCount: 2,
      completed: true,
      note: "五星仅出现一次，无「平均出货 / 最欧 / 最非欧」统计意义，故不展示。",
      rarityDistribution: { r5: 1, r4: 2, r3: 17 },
      fiveStarRecords: [{ itemName: "诺艾尔", gap: 15, isLoss: false, date: Date.parse("2025-08-09") }],
    },
  ],
  recentFiveStars: [
    { itemName: "林尼", poolLabel: "角色", occurredAt: Date.parse("2026-08-01"), gap: 68 },
    { itemName: "基尼奇", poolLabel: "角色", occurredAt: Date.parse("2026-06-20"), gap: 71, isLoss: true },
    { itemName: "圣显之钥", poolLabel: "武器", occurredAt: Date.parse("2026-06-10"), gap: 90 },
    { itemName: "玛拉妮", poolLabel: "角色", occurredAt: Date.parse("2026-05-05"), gap: 81 },
    { itemName: "天空之翼", poolLabel: "常驻", occurredAt: Date.parse("2026-05-01"), gap: 62 },
    { itemName: "丝柯克", poolLabel: "角色", occurredAt: Date.parse("2026-03-20"), gap: 74 },
    { itemName: "琴", poolLabel: "常驻", occurredAt: Date.parse("2026-03-01"), gap: 70, isLoss: true },
    { itemName: "克洛琳德", poolLabel: "角色", occurredAt: Date.parse("2026-02-05"), gap: 120, isLoss: true },
    { itemName: "莫娜", poolLabel: "常驻", occurredAt: Date.parse("2026-01-15"), gap: 75 },
  ],
  timeline: [
    { month: "2025-08", draws: 105, fiveStarCount: 2 },
    { month: "2025-09", draws: 105, fiveStarCount: 1 },
    { month: "2025-10", draws: 40, fiveStarCount: 0 },
    { month: "2025-11", draws: 130, fiveStarCount: 2 },
    { month: "2025-12", draws: 85, fiveStarCount: 1 },
    { month: "2026-01", draws: 95, fiveStarCount: 1 },
    { month: "2026-02", draws: 140, fiveStarCount: 1 },
    { month: "2026-03", draws: 120, fiveStarCount: 2 },
    { month: "2026-04", draws: 0, fiveStarCount: 0 },
    { month: "2026-05", draws: 125, fiveStarCount: 2 },
    { month: "2026-06", draws: 130, fiveStarCount: 2 },
    { month: "2026-07", draws: 30, fiveStarCount: 0 },
    { month: "2026-08", draws: 142, fiveStarCount: 1 },
  ],
  rarityDistribution: { r5: 15, r4: 152, r3: 1080 },
};

const STARRAIL_DETAIL: MockGameDetail = {
  banners: [
    {
      id: "char-event",
      displayName: "角色活动跃迁",
      totalDraws: 420,
      fiveStarCount: 5,
      fourStarCount: 48,
      pity5: { current: 21, cap: 90 },
      pity4: { current: 4, cap: 10 },
      toNextPity5: 69,
      avgDraws: 84,
      worstGap: 88,
      bestGap: 61,
      fiveStarRecords: [
        { itemName: "黄泉", gap: 61, isLoss: false, date: Date.parse("2026-05-12") },
        { itemName: "遐蝶", gap: 88, isLoss: true, date: Date.parse("2026-02-03") },
      ],
    },
    {
      id: "light-cone-event",
      displayName: "光锥活动跃迁",
      totalDraws: 180,
      fiveStarCount: 2,
      fourStarCount: 22,
      pity5: { current: 8, cap: 80 },
      pity4: { current: 2, cap: 10 },
      toNextPity5: 72,
      avgDraws: 90,
      worstGap: 90,
      bestGap: 90,
      fiveStarRecords: [{ itemName: "以理服人", gap: 90, isLoss: false, date: Date.parse("2026-01-01") }],
    },
    {
      id: "standard",
      displayName: "群星跃迁",
      totalDraws: 292,
      fiveStarCount: 3,
      fourStarCount: 30,
      pity5: { current: 40, cap: 90 },
      pity4: { current: 5, cap: 10 },
      toNextPity5: 50,
      avgDraws: 97,
      worstGap: 130,
      bestGap: 55,
    },
  ],
  recentFiveStars: [
    { itemName: "黄泉", poolLabel: "角色", occurredAt: Date.parse("2026-05-12"), gap: 61 },
    { itemName: "遐蝶", poolLabel: "角色", occurredAt: Date.parse("2026-02-03"), gap: 88, isLoss: true },
    { itemName: "以理服人", poolLabel: "光锥", occurredAt: Date.parse("2026-01-01"), gap: 90 },
  ],
  timeline: [
    { month: "2026-01", draws: 210, fiveStarCount: 2 },
    { month: "2026-02", draws: 180, fiveStarCount: 1 },
    { month: "2026-03", draws: 90, fiveStarCount: 0 },
    { month: "2026-04", draws: 120, fiveStarCount: 1 },
    { month: "2026-05", draws: 200, fiveStarCount: 1 },
    { month: "2026-06", draws: 92, fiveStarCount: 0 },
  ],
  rarityDistribution: { r5: 10, r4: 100, r3: 782 },
};

const ZZZ_DETAIL: MockGameDetail = {
  // 字段沿用 fiveStarCount/pity5 等米哈游三游命名习惯（mock 结构内部字段名），
  // 但渲染到界面上的文案经 MOCK_GAMES 里的 tierLabels 转换成「S 级/A 级」，
  // 不直接展示「五星/四星」——绝区零稀有度阶梯实测是 2/3/4，不是 3/4/5。
  banners: [
    {
      id: "agent-event",
      displayName: "独家代理人调频",
      totalDraws: 260,
      fiveStarCount: 4,
      fourStarCount: 30,
      pity5: { current: 55, cap: 90 },
      pity4: { current: 6, cap: 10 },
      toNextPity5: 35,
      avgDraws: 65,
      worstGap: 82,
      bestGap: 48,
      fiveStarRecords: [
        { itemName: "青衣", gap: 48, isLoss: false, date: Date.parse("2025-12-20") },
        { itemName: "维维安", gap: 82, isLoss: true, date: Date.parse("2025-10-01") },
      ],
    },
    {
      id: "bangboo-standard",
      displayName: "邦布常驻调频",
      totalDraws: 60,
      fiveStarCount: 1,
      fourStarCount: 6,
      pity5: { current: 12, cap: 80 },
      pity4: { current: 1, cap: 10 },
      toNextPity5: 68,
      avgDraws: 60,
      worstGap: 60,
      bestGap: 60,
      fiveStarRecords: [{ itemName: "邦布·电冰箱", gap: 60, isLoss: false, date: Date.parse("2025-12-01") }],
    },
  ],
  recentFiveStars: [
    { itemName: "青衣", poolLabel: "代理人", occurredAt: Date.parse("2025-12-20"), gap: 48 },
    { itemName: "维维安", poolLabel: "代理人", occurredAt: Date.parse("2025-10-01"), gap: 82, isLoss: true },
  ],
  timeline: [
    { month: "2025-09", draws: 60, fiveStarCount: 1 },
    { month: "2025-10", draws: 90, fiveStarCount: 1 },
    { month: "2025-11", draws: 70, fiveStarCount: 0 },
    { month: "2025-12", draws: 100, fiveStarCount: 1 },
  ],
  rarityDistribution: { r5: 5, r4: 36, r3: 279 },
};

const GAME_DETAILS: Record<GameId, MockGameDetail> = {
  genshin: GENSHIN_DETAIL,
  starrail: STARRAIL_DETAIL,
  zzz: ZZZ_DETAIL,
};

export function getGameDetail(gameId: GameId): MockGameDetail {
  return GAME_DETAILS[gameId];
}

/** 卡池内稀有度分布：优先用显式声明的数值，缺失时按 total - five - four 反推三星数近似。 */
export function bannerRarityDistribution(banner: MockBanner): MockRarityDistribution {
  if (banner.rarityDistribution) return banner.rarityDistribution;
  const r3 = Math.max(0, banner.totalDraws - banner.fiveStarCount - banner.fourStarCount);
  return { r5: banner.fiveStarCount, r4: banner.fourStarCount, r3 };
}

// ============================================================
// 跨游戏聚合统计（Overview 页面「聚合数据」层）——由账号/detail 数据汇总得出，
// 不额外硬编码一份数字，避免两处数字对不上。
// ============================================================

export interface MockOverviewStats {
  totalDraws: number;
  totalFiveStars: number;
  avgDrawsPerFiveStar: number;
  gamesCount: number;
  accountsCount: number;
  rarity: MockRarityDistribution;
}

export function computeOverviewStats(): MockOverviewStats {
  const totalDraws = MOCK_ACCOUNTS.reduce((sum, a) => sum + a.totalDraws, 0);
  const rarity = MOCK_GAMES.reduce<MockRarityDistribution>(
    (acc, game) => {
      const d = getGameDetail(game.id).rarityDistribution;
      return { r5: acc.r5 + d.r5, r4: acc.r4 + d.r4, r3: acc.r3 + d.r3 };
    },
    { r5: 0, r4: 0, r3: 0 },
  );
  const totalFiveStars = rarity.r5;
  return {
    totalDraws,
    totalFiveStars,
    avgDrawsPerFiveStar: totalFiveStars > 0 ? Math.round((totalDraws / totalFiveStars) * 10) / 10 : 0,
    gamesCount: MOCK_GAMES.length,
    accountsCount: MOCK_ACCOUNTS.length,
    rarity,
  };
}

// ============================================================
// 全量记录——Records.tsx 用。形状对齐 GachaRecord（gs-plugin-kit/types），
// 「保底内第几抽」属于分析层派生数据，不塞进 GachaRecord 本体，
// 用 MockRecordRow 包一层。
// ============================================================

export interface MockRecordRow {
  record: GachaRecord;
  bannerDisplayName: string;
  pityDisplay: number;
}

/**
 * 按游戏区分的物品名池——早期版本三款游戏共用一套原神角色/武器名，
 * 导致绝区零的记录明细里混进「鹿野院平藏」这类原神角色名，명显违和。
 * 记录明细是「一等公民」（§4.2），连 mock 数据的观感都不较真，
 * 会误导核对界面的人以为是真实接入出了问题。
 */
interface MockItemPool {
  topChar: readonly string[];
  topOther: readonly string[];
  secondChar: readonly string[];
  secondOther: readonly string[];
  third: readonly string[];
  /** 角色类物品的类型文案，如「角色」「代理人」。 */
  charTypeLabel: string;
  /** 非角色类物品的类型文案，如「武器」「光锥」「音擎」。 */
  otherTypeLabel: string;
}

const ITEM_POOLS: Record<GameId, MockItemPool> = {
  genshin: {
    topChar: ["娜维娅", "林尼", "莱欧斯利", "纳西妲", "艾梅莉埃", "玛拉妮", "希诺宁", "闲云"],
    topOther: ["雾切之回光", "赤沙之杖", "护摩之杖", "图莱杜拉的回忆", "裁断"],
    secondChar: ["瑶瑶", "菲米尼", "香菱", "行秋", "北斗", "凝光", "诺艾尔", "迪奥娜", "早柚", "九条裟罗"],
    secondOther: ["西风剑", "黑岩长剑", "匣里龙吟", "祭礼剑", "弓藏", "昭心"],
    third: ["黑缨枪", "弹弓", "翡玉法球", "旅行剑", "冷刃", "白缨枪", "神射手之誓", "信使"],
    charTypeLabel: "角色",
    otherTypeLabel: "武器",
  },
  starrail: {
    topChar: ["黄泉", "遐蝶", "镜流", "刃", "景元", "丹恒·饮月"],
    topOther: ["以理服人", "忘却之庭", "于夜色中"],
    secondChar: ["娜塔莎", "希儿", "瓦尔特", "佩拉", "阿兰", "桑博"],
    secondOther: ["无可取代的东西", "时节不居", "朗道的选择"],
    third: ["禁忌之地", "巡猎丝带", "制胜的瞬息", "俄罗斯套娃"],
    charTypeLabel: "角色",
    otherTypeLabel: "光锥",
  },
  zzz: {
    topChar: ["青衣", "维维安", "柏妮思", "丽娜", "猫又"],
    topOther: ["硬核拳愿", "啄木鸟电音", "古典喇叭"],
    secondChar: ["安比", "可琳", "本", "朔间庭护"],
    secondOther: ["瞬释迅击刃", "强攻手册", "算法预感"],
    third: ["电磁棒", "降噪耳机", "采购凭证", "击晕木棍", "防暴指虎"],
    charTypeLabel: "代理人",
    otherTypeLabel: "音擎",
  },
};

const BANNER_LABELS: Record<GameId, Record<string, string>> = {
  genshin: {
    "301": "角色活动祈愿",
    "302": "武器活动祈愿",
    "200": "常驻祈愿",
    "100": "新手祈愿",
  },
  starrail: {
    "char-event": "角色活动跃迁",
    "light-cone-event": "光锥活动跃迁",
    standard: "群星跃迁",
  },
  zzz: {
    "agent-event": "独家代理人调频",
    "bangboo-standard": "邦布常驻调频",
  },
};

const recordRowCache = new Map<number, MockRecordRow[]>();

/**
 * 为某个账号生成一批确定性的抽卡记录明细，用于 Records 页面。
 * 结果按模块级 Map 缓存，避免组件重渲染时反复重算或数字跳动。
 */
export function getMockRecordRows(account: MockAccount): MockRecordRow[] {
  const cached = recordRowCache.get(account.id);
  if (cached) return cached;

  const rng = mulberry32(1000 + account.id);
  const totalRows = Math.min(account.totalDraws, 200); // 明细页只展示近 200 条，避免 mock 阶段生成过量数据
  const banners = Object.keys(BANNER_LABELS[account.gameId]);
  const nonStandardBanners = banners.filter((b) => b !== "standard" && b !== "200" && b !== "100");
  const pool = ITEM_POOLS[account.gameId];

  const rows: MockRecordRow[] = [];
  let pity5 = 0;
  let pity4 = 0;
  let pity3 = 0;
  const endTime = NOW - 30 * 60_000;
  const startTime = endTime - totalRows * 90 * 60_000; // 平均每 90 分钟一抽，粗略但足够铺开时间线

  for (let i = 0; i < totalRows; i++) {
    const bannerId = pickOne(rng, nonStandardBanners.length > 0 ? nonStandardBanners : banners);
    pity5 += 1;
    pity4 += 1;
    pity3 += 1;

    let rarity: "5" | "4" | "3";
    if (pity5 >= 90) {
      rarity = "5";
    } else if (pity4 >= 10) {
      rarity = "4";
    } else {
      const roll = rng();
      if (roll < 0.02) rarity = "5";
      else if (roll < 0.15) rarity = "4";
      else rarity = "3";
    }

    let itemName: string;
    let itemType: string;
    if (rarity === "5") {
      const useChar = rng() < 0.6;
      itemName = useChar ? pickOne(rng, pool.topChar) : pickOne(rng, pool.topOther);
      itemType = useChar ? pool.charTypeLabel : pool.otherTypeLabel;
    } else if (rarity === "4") {
      const useChar = rng() < 0.55;
      itemName = useChar ? pickOne(rng, pool.secondChar) : pickOne(rng, pool.secondOther);
      itemType = useChar ? pool.charTypeLabel : pool.otherTypeLabel;
    } else {
      itemName = pickOne(rng, pool.third);
      itemType = pool.otherTypeLabel;
    }

    let pityDisplay: number;
    if (rarity === "5") {
      pityDisplay = pity5;
      pity5 = 0;
      pity4 = 0;
    } else if (rarity === "4") {
      pityDisplay = pity4;
      pity4 = 0;
    } else {
      pityDisplay = pity3;
      pity3 = 0;
    }

    const occurredAt = Math.round(startTime + (i / totalRows) * (endTime - startTime));

    // 原神真实插件的现状是 itemId 目前就是本地化物品名（不是真正的物品标识，
    // 见 plugins/genshin/manifest.ts 内注释），meta_state 因此被判定为
    // complete——这是已知且已记录在案的数据质量缺口。星铁/绝区零插件尚不存在，
    // 这里对三款游戏统一沿用同一形状只是为了 mock 结构一致，不代表对它们的
    // 真实行为做了预判；但至少不应该让界面呈现出一个后端实际做不到的完美状态，
    // 所以照样保留 itemId=物品名、metaState="complete" 这组写法。
    const record: GachaRecord = {
      id: account.id * 1_000_000 + i,
      accountId: account.id,
      bannerKey: bannerId,
      pityGroup: account.gameId === "genshin" && (bannerId === "301" || bannerId === "400") ? "characterEventWish" : bannerId,
      recordKey: `${account.id}:${i}`,
      lang: "zh-CN",
      occurredAt,
      occurredRaw: new Date(occurredAt).toISOString(),
      tzOrigin: "assumed",
      itemId: itemName,
      itemType,
      rarity,
      qty: 1,
      metaState: "complete",
      source: "officialApi",
      capturedAt: NOW,
    };

    rows.push({
      record,
      bannerDisplayName: BANNER_LABELS[account.gameId][bannerId] ?? bannerId,
      pityDisplay,
    });
  }

  rows.reverse(); // 展示顺序：最新的在最前
  recordRowCache.set(account.id, rows);
  return rows;
}
