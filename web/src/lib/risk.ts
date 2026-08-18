/**
 * 保留期风险状态机——展示层。
 *
 * 判定逻辑（原 `computeAccountRisk`）已经下沉到 Rust
 * （`gs_host::retention::evaluate_account_retention_risk`），随
 * `AccountView.retentionRisk` 一起经 IPC 送到前端，本模块因此只剩两件
 * 纯展示的事：等级 → 文案，以及从一组账号里挑出最紧急的那个
 * （`mostUrgent`，供游戏卡片级状态使用，§4.3）。
 *
 * `RiskLevel` 直接从 codegen 产物导入，**不手写**——HC-3 的机械纪律：
 * Rust 侧四态判据（`Safe`/`Watch`/`Urgent`/`Blocked`）与前端展示层用的是
 * 同一个类型，改 Rust 侧枚举、重跑 `gs-codegen`，这里自动跟着变，不存在
 * "两边手写、迟早漂移"的可能。
 */
import type { RetentionRiskLevel, RetentionRiskView } from "@/lib/ipc/generated";

export type RiskLevel = RetentionRiskLevel;

/** 数值越大越紧急，用于「取一组账号里最紧急的一个」的比较（§4.3）。 */
const RISK_SEVERITY: Record<RiskLevel, number> = {
  safe: 0,
  watch: 1,
  urgent: 2,
  blocked: 3,
};

/** 风险等级 → 展示文案，与设计稿 badge 文案保持一致。 */
export const RISK_LABEL: Record<RiskLevel, string> = {
  safe: "正常",
  watch: "留意",
  urgent: "紧急",
  blocked: "需要处理",
};

/**
 * 从一组账号的保留期风险里取出最紧急的一个。
 *
 * 入参直接是后端返回的 `RetentionRiskView[]`——调用方过滤掉 `null`（"无法
 * 评估"）之后传进来，本函数不处理 `null`，也不替调用方决定"评估不了"该
 * 怎么展示，那是调用方自己的判断（见 `Overview.tsx`）。空数组视为不适用，
 * 由调用方决定兜底展示。
 */
export function mostUrgent(risks: RetentionRiskView[]): RetentionRiskView | undefined {
  return risks.reduce<RetentionRiskView | undefined>((worst, current) => {
    if (!worst) return current;
    return RISK_SEVERITY[current.level] > RISK_SEVERITY[worst.level] ? current : worst;
  }, undefined);
}
