//! 原神卡池元数据的初始种子（`data_ver = 1`）。
//!
//! 卡池元数据来源已裁定为 M1 阶段自建维护：直接照抄
//! `plugins/genshin/manifest.ts` 的 `banners`/`pityGroups`/`rarity` 声明值，
//! 不依赖任何社区数据源或远程接口。
//!
//! ⚠️ **已知的重复，不在本 Stage 解决**：Rust 侧目前读不到 TS manifest
//! （插件宿主桥接尚未落地，见 `milestones/00-实施总览.md` §6），这份种子
//! 只能在这里把 manifest 的取值再抄一遍。两份声明必须保持一致——这正是
//! "新增卡池只改单一数据源"这条 M1 验收标准在插件桥接落地前的一个已知
//! 反例。桥接落地后应当删除本文件，改为运行时直接从 manifest 派生。
//!
//! `banner_meta` 表的 `curve_type`/`guarantee_rule` 两列只是 `TEXT` 摘要
//! 标签（S2 定的表结构，装不下 `base`/`start`/`step` 这些具体曲线参数），
//! 所以本文件额外提供 [`character_event_wish_pity_group`] 与
//! [`genshin_rarity_spec`] 两个返回完整领域对象的函数，供分析引擎直接
//! 使用；它们与写入 `banner_meta` 表的摘要标签描述的是同一份声明，必须
//! 保持一致（见文件末尾的一致性测试）。

use gs_core::{GuaranteeRule, PityGroup, ProbabilityCurve, RaritySpec};
use gs_storage::NewBannerMeta;

/// 原神插件 id，对应 `plugins/genshin/manifest.ts` 的 `manifest.id`。
pub const GENSHIN_PLUGIN_ID: &str = "genshin";

/// 角色活动祈愿共享保底组的 key，对应 manifest `pityGroups[0].key`。
pub const CHARACTER_EVENT_WISH_PITY_GROUP: &str = "characterEventWish";

/// 角色活动祈愿的完整保底声明：`hardPity: 90`、`SoftPity { base: 0.006,
/// start: 74, step: 0.06 }`、`FiftyFifty` 担保，取值抄自 manifest
/// `pityGroups[0]`。`step` 取整数百分点（6 表示 +6%），理由见
/// `crates/gs-analysis/src/pity.rs` 顶部对 `evaluate_curve` 的说明。
pub fn character_event_wish_pity_group() -> PityGroup {
    PityGroup {
        key: CHARACTER_EVENT_WISH_PITY_GROUP.to_string(),
        members: vec!["301".to_string(), "400".to_string()],
        hard_pity: 90,
        curve: ProbabilityCurve::SoftPity {
            base: 0.006,
            start: 74,
            step: 0.06,
        },
        guarantee: GuaranteeRule::FiftyFifty {},
    }
}

/// 原神的稀有度阶梯声明，抄自 manifest `rarity: { ladder: ["3","4","5"],
/// pityTarget: "5" }`。
pub fn genshin_rarity_spec() -> RaritySpec {
    RaritySpec {
        ladder: vec!["3".to_string(), "4".to_string(), "5".to_string()],
        pity_target: "5".to_string(),
    }
}

/// 生成写入 `banner_meta` 表的种子数据，对应 manifest 里声明的全部 6 个
/// `banners` 条目。
///
/// 未被任何 `pityGroups` 声明覆盖的卡池（武器/常驻/集录/新手）没有共享
/// 保底组，各自的 `pity_group` 取自己的 `banner_key`——manifest 目前没有
/// 为它们声明 `curve`/`guarantee`，本函数如实反映"未声明"，不替它们编造
/// 一套猜测的保底参数。
pub fn genshin_banner_meta_seed() -> Vec<NewBannerMeta> {
    let character_event_wish = character_event_wish_pity_group();
    let curve_type = Some("softPity".to_string());
    let guarantee_rule = Some("fiftyFifty".to_string());
    let pity_max = Some(i64::from(character_event_wish.hard_pity));

    vec![
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "301".to_string(),
            pity_group: CHARACTER_EVENT_WISH_PITY_GROUP.to_string(),
            name: Some("角色活动祈愿".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max,
            curve_type: curve_type.clone(),
            guarantee_rule: guarantee_rule.clone(),
            data_ver: 1,
        },
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "400".to_string(),
            pity_group: CHARACTER_EVENT_WISH_PITY_GROUP.to_string(),
            name: Some("角色活动祈愿（400 子类型，随 301 一并返回）".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max,
            curve_type,
            guarantee_rule,
            data_ver: 1,
        },
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "302".to_string(),
            pity_group: "302".to_string(),
            name: Some("武器活动祈愿".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max: None,
            curve_type: None,
            guarantee_rule: None,
            data_ver: 1,
        },
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "200".to_string(),
            pity_group: "200".to_string(),
            name: Some("常驻祈愿".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max: None,
            curve_type: None,
            guarantee_rule: None,
            data_ver: 1,
        },
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "500".to_string(),
            pity_group: "500".to_string(),
            name: Some("集录祈愿".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max: None,
            curve_type: None,
            guarantee_rule: None,
            data_ver: 1,
        },
        NewBannerMeta {
            plugin_id: GENSHIN_PLUGIN_ID.to_string(),
            banner_key: "100".to_string(),
            pity_group: "100".to_string(),
            name: Some("新手祈愿".to_string()),
            start_at: None,
            end_at: None,
            rate_up_items: None,
            pity_max: None,
            curve_type: None,
            guarantee_rule: None,
            data_ver: 1,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_covers_every_banner_declared_in_the_manifest() {
        let seed = genshin_banner_meta_seed();
        let mut banner_keys: Vec<&str> = seed.iter().map(|m| m.banner_key.as_str()).collect();
        banner_keys.sort_unstable();
        assert_eq!(banner_keys, vec!["100", "200", "301", "302", "400", "500"]);
        assert!(seed.iter().all(|m| m.plugin_id == GENSHIN_PLUGIN_ID));
        assert!(seed.iter().all(|m| m.data_ver == 1));
    }

    #[test]
    fn seed_merges_301_and_400_into_the_shared_pity_group() {
        let seed = genshin_banner_meta_seed();
        let shared: Vec<&NewBannerMeta> = seed
            .iter()
            .filter(|m| m.pity_group == CHARACTER_EVENT_WISH_PITY_GROUP)
            .collect();
        let mut shared_keys: Vec<&str> = shared.iter().map(|m| m.banner_key.as_str()).collect();
        shared_keys.sort_unstable();
        assert_eq!(shared_keys, vec!["301", "400"]);
    }

    #[test]
    fn seed_leaves_undeclared_banners_without_a_shared_pity_group() {
        let seed = genshin_banner_meta_seed();
        for banner_key in ["302", "200", "500", "100"] {
            let entry = seed
                .iter()
                .find(|m| m.banner_key == banner_key)
                .expect("应当能找到这个卡池");
            // 自成一组：pity_group 就是它自己的 banner_key。
            assert_eq!(entry.pity_group, banner_key);
            assert!(entry.curve_type.is_none());
            assert!(entry.guarantee_rule.is_none());
        }
    }

    #[test]
    fn character_event_wish_pity_group_matches_manifest_declared_curve() {
        let group = character_event_wish_pity_group();
        assert_eq!(group.hard_pity, 90);
        assert_eq!(group.members, vec!["301".to_string(), "400".to_string()]);
        assert_eq!(
            group.curve,
            ProbabilityCurve::SoftPity {
                base: 0.006,
                start: 74,
                step: 0.06,
            }
        );
        assert_eq!(group.guarantee, GuaranteeRule::FiftyFifty {});
    }

    #[test]
    fn genshin_rarity_spec_matches_manifest_declared_ladder() {
        let spec = genshin_rarity_spec();
        assert_eq!(spec.ladder, vec!["3", "4", "5"]);
        assert_eq!(spec.pity_target, "5");
    }
}
