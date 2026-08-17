/**
 * 首屏风险状态机——界面设计方向 §5。
 *
 * ⚠️ **本模块当前无人引用（2026-08-17 起），是刻意保留的孤儿，不是漏删。**
 * 前端接线时 Overview 的风险徽章体系被整体摘掉了，因为它依赖三样 Rust 侧
 * 还没有的数据：`gameDirValid`（游戏目录是否有效）、`consecutiveFailureCount`
 * （连续采集失败次数）、`RetentionPolicy.conservativeDays`（保留期保守天数）
 * ——`AccountView` 一个都不含，也没有任何"校验游戏目录"的命令。
 * 硬渲染只能靠编造，那正是这套界面最不该做的事（风险提示编错了比不提示更坏）。
 *
 * **解冻条件**：上述三个字段进入 `AccountView`/`GameView` 之后，
 * 本模块与 `components/risk-badge.tsx` 可以原样复用，不需要重写——
 * `computeAccountRisk` 的入参形状就是照那三个信号设计的。
 * 在那之前它不参与构建（Vite 会把它 tree-shake 掉），留着是为了不丢失
 * §5.1 那条"目录状态与更新时效是同一条风险链上的两环"的判断。
 *
 * 目录状态与更新时效是同一条风险链上的两环（§5.1）：目录未配置/已失效会
 * 直接导致「无法更新」，与「长期未更新」共同汇入「数据停止增长 → 官方接口
 * 保留期耗尽后永久丢失」这一后果。因此本模块只暴露一个入口
 * {@link computeAccountRisk}，调用方不需要（也不应该）自己拼接这两个信号。
 */

export type RiskLevel = "normal" | "watch" | "urgent" | "blocked";

/** 数值越大越紧急，用于「取该游戏下最紧急账号」的比较（§4.3）。 */
const RISK_SEVERITY: Record<RiskLevel, number> = {
  normal: 0,
  watch: 1,
  urgent: 2,
  blocked: 3,
};

export interface AccountRiskInput {
  /** 游戏目录是否仍然有效（未配置也视为无效）。 */
  gameDirValid: boolean;
  /** 上一次成功更新的时刻（UTC 毫秒）。从未成功更新过时传 `undefined`。 */
  lastSuccessfulUpdateAt: number | undefined;
  /** 官方接口保留期的保守估算天数，对应插件 manifest 的 `retention.conservativeDays`。 */
  retentionConservativeDays: number;
  /** 用于计算「距今」的当前时刻，默认 `Date.now()`；纸面测试/固定截图时可传入固定值。 */
  now?: number;
}

export interface AccountRisk {
  level: RiskLevel;
  /** 距官方保留期耗尽的剩余天数，可能为负（表示已超出保留期，官方大概率已丢弃早期记录）。 */
  remainingDays: number;
  /** 距上次成功更新的天数；从未更新过时为 `undefined`。 */
  daysSinceUpdate: number | undefined;
}

/**
 * 计算单个账号的风险等级。
 *
 * 用剩余天数而非已过天数驱动分级（§5.2「还剩 23 天」比「已过 158 天」更能
 * 驱动行动）：
 * - 阻塞：目录未配置 / 已失效——不管剩余天数多少，这是需要立即处理的状态，
 *   因为不修复目录，后面三档都不会自然恢复。
 * - 紧急：剩余 < 1 个月（按插件声明保留期使用的 28 天口径折算）。
 * - 留意：剩余 1–3 个月。
 * - 正常：剩余 > 3 个月。
 */
export function computeAccountRisk(input: AccountRiskInput): AccountRisk {
  const now = input.now ?? Date.now();
  const daysSinceUpdate =
    input.lastSuccessfulUpdateAt === undefined
      ? undefined
      : Math.floor((now - input.lastSuccessfulUpdateAt) / 86_400_000);

  const remainingDays =
    daysSinceUpdate === undefined
      ? input.retentionConservativeDays
      : input.retentionConservativeDays - daysSinceUpdate;

  if (!input.gameDirValid) {
    return { level: "blocked", remainingDays, daysSinceUpdate };
  }
  if (remainingDays < 28) {
    return { level: "urgent", remainingDays, daysSinceUpdate };
  }
  if (remainingDays < 28 * 3) {
    return { level: "watch", remainingDays, daysSinceUpdate };
  }
  return { level: "normal", remainingDays, daysSinceUpdate };
}

/**
 * 从一组账号风险里取出最紧急的一个，供游戏卡片级状态使用（§4.3）。
 * 空数组视为不适用，由调用方决定兜底展示。
 */
export function mostUrgent(risks: AccountRisk[]): AccountRisk | undefined {
  return risks.reduce<AccountRisk | undefined>((worst, current) => {
    if (!worst) return current;
    return RISK_SEVERITY[current.level] > RISK_SEVERITY[worst.level] ? current : worst;
  }, undefined);
}

/** 风险等级 → 展示文案，与设计稿 badge 文案保持一致。 */
export const RISK_LABEL: Record<RiskLevel, string> = {
  normal: "正常",
  watch: "留意",
  urgent: "紧急",
  blocked: "需要处理",
};
