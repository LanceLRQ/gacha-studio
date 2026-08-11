import { OctagonAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { RISK_LABEL, type RiskLevel } from "@/lib/risk";

/**
 * 风险等级 → badge variant 的映射写死在组件内部，不作为 prop 开放给调用方
 * 覆盖——这是界面设计方向 §5.2 那条硬约束的落点：「正常」必须永远是最弱的
 * 视觉权重，不能因为某个调用点想要更醒目而悄悄改掉，否则状态色迟早贬值到
 * 三个游戏都健康却全部着色的地步。
 */
const VARIANT_BY_LEVEL: Record<RiskLevel, "neutral" | "warning" | "destructive"> = {
  normal: "neutral",
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
