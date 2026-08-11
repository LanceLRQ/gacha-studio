//! 保底相关的领域类型：概率曲线、担保规则、共享保底的卡池分组。
//!
//! 鸣潮渐进概率与米哈游软保底数学模型不同，[`ProbabilityCurve`] 从第一天就要
//! 支持多曲线，不能只给米哈游三游的软保底留位置——这是本模块存在判别联合而不是
//! 单一结构体的原因。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 单抽出货概率随抽数变化的曲线。
///
/// `custom` 分支只携带一个 `id`，实际计算逻辑不在 Rust 侧定义——保底算法本身
/// 是宿主通用能力，但「这条曲线具体怎么算」在少数游戏上可能不满足现有三种
/// 预置形状，此时插件用 `id` 指向宿主注册的自定义曲线实现，而不是把公式
/// 塞进可序列化的数据里（公式不是数据）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum ProbabilityCurve {
    /// 全程概率恒定，不随抽数变化。
    Flat { base: f64 },
    /// 米哈游三游形态：`start` 抽之前概率恒为 `base`，之后每抽按 `step` 递增。
    SoftPity { base: f64, start: u32, step: u32 },
    /// 鸣潮形态：`start` 抽之前概率恒为 `base`，之后按 `table` 里显式给出的
    /// 每一档概率取值——渐进概率不是等差递增，必须用查表而不是公式描述。
    Progressive {
        base: f64,
        start: u32,
        table: Vec<f64>,
    },
    /// 预置三种形状都不满足时，指向宿主注册的自定义曲线实现。
    Custom { id: String },
}

/// 保底触发后，下一次出货是否保证命中「歪」之外的那一档。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum GuaranteeRule {
    /// 米哈游三游经典的「大保底」：歪了之后下一次必中 UP。
    FiftyFifty {},
    /// 没有「歪」的概念，保底必中 UP。
    AlwaysRateUp {},
    /// 保底命中 UP 的概率不是 100%，而是按 `rate_up_chance` 加权。
    #[serde(rename_all = "camelCase")]
    #[ts(rename_all = "camelCase")]
    Weighted { rate_up_chance: f64 },
    /// 没有担保机制，保底只保证出货、不保证是哪一档/哪个 UP。
    None {},
}

/// 共享同一个保底计数的卡池集合。
///
/// `members` 存的是 [`crate::record::BannerSpec::id`]，`key` 是这个分组自身的
/// 稳定标识（落库时对应 `gacha_records.pity_group`，见
/// [`crate::record::GachaRecord`] 上的字段注释）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PityGroup {
    pub key: String,
    pub members: Vec<String>,
    pub hard_pity: u32,
    pub curve: ProbabilityCurve,
    pub guarantee: GuaranteeRule,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probability_curve_flat_round_trips_with_kind_tag() {
        let curve = ProbabilityCurve::Flat { base: 0.006 };
        let json = serde_json::to_value(&curve).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "flat", "base": 0.006 }));
        let round_tripped: ProbabilityCurve = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, curve);
    }

    #[test]
    fn probability_curve_soft_pity_round_trips_with_camel_case_fields() {
        let curve = ProbabilityCurve::SoftPity {
            base: 0.006,
            start: 74,
            step: 6,
        };
        let json = serde_json::to_value(&curve).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "softPity", "base": 0.006, "start": 74, "step": 6 })
        );
        let round_tripped: ProbabilityCurve = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, curve);
    }

    #[test]
    fn probability_curve_progressive_round_trips_with_table() {
        // 鸣潮形态：渐进概率是查表而非等差递增，测试值不要求真实准确，
        // 只验证结构能装下「非等差」的一组数字。
        let curve = ProbabilityCurve::Progressive {
            base: 0.008,
            start: 66,
            table: vec![0.008, 0.02, 0.05, 0.12, 0.3],
        };
        let json = serde_json::to_value(&curve).unwrap();
        assert_eq!(json["kind"], serde_json::json!("progressive"));
        assert_eq!(
            json["table"],
            serde_json::json!([0.008, 0.02, 0.05, 0.12, 0.3])
        );
        let round_tripped: ProbabilityCurve = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, curve);
    }

    #[test]
    fn probability_curve_custom_round_trips_with_id() {
        let curve = ProbabilityCurve::Custom {
            id: "wuwa-progressive-v1".to_string(),
        };
        let json = serde_json::to_value(&curve).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "custom", "id": "wuwa-progressive-v1" })
        );
        let round_tripped: ProbabilityCurve = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, curve);
    }

    #[test]
    fn guarantee_rule_weighted_round_trips_with_camel_case_field() {
        let rule = GuaranteeRule::Weighted {
            rate_up_chance: 0.5,
        };
        let json = serde_json::to_value(&rule).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "weighted", "rateUpChance": 0.5 })
        );
        let round_tripped: GuaranteeRule = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, rule);
    }

    #[test]
    fn guarantee_rule_none_round_trips_as_empty_object_with_tag() {
        let rule = GuaranteeRule::None {};
        let json = serde_json::to_value(&rule).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "none" }));
        let round_tripped: GuaranteeRule = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, rule);
    }

    #[test]
    fn pity_group_round_trips_with_camel_case_hard_pity() {
        let group = PityGroup {
            key: "character-event-shared".to_string(),
            members: vec![
                "character-event-1".to_string(),
                "character-event-2".to_string(),
            ],
            hard_pity: 90,
            curve: ProbabilityCurve::SoftPity {
                base: 0.006,
                start: 74,
                step: 6,
            },
            guarantee: GuaranteeRule::FiftyFifty {},
        };
        let json = serde_json::to_value(&group).unwrap();
        assert_eq!(json["hardPity"], serde_json::json!(90));
        assert_eq!(
            json["guarantee"],
            serde_json::json!({ "kind": "fiftyFifty" })
        );

        let round_tripped: PityGroup = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, group);
    }
}
