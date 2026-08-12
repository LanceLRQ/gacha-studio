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
    ///
    /// ⚠️ `step` 与 `base` **同单位**，都是概率分数而非百分点——原神的软保底是
    /// 0.6% 起、每抽 +6%，因此 `base: 0.006, step: 0.06`，不是 `step: 6`。
    /// 这里曾把 `step` 写成 `u32`（百分点整数），与 `base`/`table` 的 `f64` 分数
    /// 混了两种单位，而生成的 TS 两者都是 `number`，插件写 `0.06` 或 `6` 都能过
    /// 类型检查——**类型本身在诱导这个错误**，故统一为 `f64`。
    SoftPity { base: f64, start: u32, step: f64 },
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
    /// 本组保底命中判定的目标稀有度码。缺省时回落到
    /// [`crate::record::RaritySpec::pity_target`]（米哈游三游只有一档保底，
    /// 沿用这个缺省值即可，签名与行为都不变）。
    ///
    /// 新增动机：鸣潮每个卡池同时存在两套独立保底计数——5★ 硬保底（80/50/1
    /// 三种值，与 `rarity.pity_target` 一致）与 4★ 硬保底（恒为 10，需要一个
    /// **不同于**最高档的目标）。一个 `RaritySpec` 只能声明一个
    /// `pity_target`，装不下"同一游戏有两档独立保底"，因此在 `PityGroup`
    /// 这一层加可选覆盖——鸣潮为 5★/4★ 各声明一个 `PityGroup`（`members`
    /// 可以指向同一批卡池），4★ 那份显式填 `pityTarget: "4"`，5★ 那份省略、
    /// 继续回落到 `rarity.pity_target`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pity_target: Option<String>,
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
            step: 0.06,
        };
        let json = serde_json::to_value(&curve).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "softPity", "base": 0.006, "start": 74, "step": 0.06 })
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
                step: 0.06,
            },
            guarantee: GuaranteeRule::FiftyFifty {},
            pity_target: None,
        };
        let json = serde_json::to_value(&group).unwrap();
        assert_eq!(json["hardPity"], serde_json::json!(90));
        assert_eq!(
            json["guarantee"],
            serde_json::json!({ "kind": "fiftyFifty" })
        );
        assert!(
            json.get("pityTarget").is_none(),
            "未提供时不应出现 pityTarget 键: {json}"
        );

        let round_tripped: PityGroup = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, group);
    }

    #[test]
    fn pity_group_round_trips_with_explicit_pity_target_override() {
        // 鸣潮形态：4★ 硬保底组显式声明 pityTarget，与 rarity.pityTarget（通常是
        // 最高档 "5"）不同。
        let group = PityGroup {
            key: "wuwaResonator4Star".to_string(),
            members: vec!["standard".to_string()],
            hard_pity: 10,
            curve: ProbabilityCurve::Flat { base: 0.06 },
            guarantee: GuaranteeRule::None {},
            pity_target: Some("4".to_string()),
        };
        let json = serde_json::to_value(&group).unwrap();
        assert_eq!(json["pityTarget"], serde_json::json!("4"));

        let round_tripped: PityGroup = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, group);
    }
}
