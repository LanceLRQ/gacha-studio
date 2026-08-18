import { OctagonAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { RISK_LABEL, type RiskLevel } from "@/lib/risk";

/**
 * 账号保留期风险徽章——数据来自 `AccountView.retentionRisk`
 * （`gs_host::retention::evaluate_account_retention_risk` 的计算结果），
 * 由 `Overview.tsx` 的账号行渲染。
 *
 * `blocked` 档目前不会被真实数据触发——它依赖 `gameDirValid`/
 * `consecutiveFailureCount` 两个信号，Rust 侧还没有（见
 * `RetentionRiskLevel::Blocked` 的文档）。这里预先备好它的展示样式，
 * 不是因为现在会用到，而是一旦上述两个信号接线，不需要再改这个组件。
 *
 * 风险等级 → badge variant 的映射写死在组件内部，不作为 prop 开放给调用方
 * 覆盖——这是界面设计方向 §5.2 那条硬约束的落点：「正常」必须永远是最弱的
 * 视觉权重，不能因为某个调用点想要更醒目而悄悄改掉，否则状态色迟早贬值到
 * 三个游戏都健康却全部着色的地步。
 */
const VARIANT_BY_LEVEL: Record<RiskLevel, "neutral" | "warning" | "destructive"> = {
  safe: "neutral",
  watch: "warning",
  urgent: "destructive",
  blocked: "destructive",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const variant = VARIANT_BY_LEVEL[level];
  return (
    <Badge variant={variant} className={className}>
      {level === "watch" && <TriangleAlert />}
      {(level === "urgent" || level === "blocked") && <OctagonAlert />}
      {RISK_LABEL[level]}
    </Badge>
  );
}
