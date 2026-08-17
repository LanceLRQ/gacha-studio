//! 原神卡池元数据的初始种子（`data_ver = 1`），以及 `pityGroups`/`rarity`/
//! `banners` 的便捷访问函数——全部从 `plugins/genshin/manifest.ts` 打包出的
//! 纯数据 JSON（`gs-manifest-data::plugin_manifest_data`）直接反序列化，
//! **不在这里手抄任何具体数字**。
//!
//! ## 为什么现在能做到"零手抄"
//!
//! [`gs_core::PityGroup`]/[`gs_core::RaritySpec`]/[`gs_core::BannerSpec`]
//! 本就带 `#[serde(rename_all = "camelCase")]` 且字段形状与 manifest JSON
//! 逐一对应（它们的存在意义本来就是要在 Rust/TS 两侧共享同一份契约，见各自
//! 的 round-trip 测试）——直接 `serde_json::from_value` 反序列化出来的就是
//! 这些领域类型本身，不需要先经过一层专属的中间 JSON 结构体。
//!
//! ## 这修的是什么问题
//!
//! 复核时查实：卡池/稀有度声明曾经在 Rust 侧被手抄了四份（本文件、
//! `rarity.rs`/`pity.rs` 的测试 fixture、以及新写的 `rare_event.rs` 与
//! 集成测试各自又抄一份，实际是六份）。手抄版本已经开始漂移——本文件旧版
//! 注释写"`step` 取整数百分点（6 表示 +6%）"，代码却早已改成 `f64` 分数
//! `step: 0.06`，注释没跟上代码变化。这正是 M1 验收标准"新增卡池只需改
//! 单一数据源"要防的事：手抄的地方越多，越难保证每一份都被同步更新。
//! 现在改为直接读 manifest：新增/修改一个卡池只需要改
//! `plugins/genshin/manifest.ts`，重跑 `node scripts/gs-bundle-plugins.mjs`
//! 生成新的 `plugins.manifest.json`，Rust 侧零改动。
//! `pity.rs`/`rarity.rs`/`rare_event.rs` 及其集成测试里原本各自手抄的测试
//! fixture 也一并收敛成调用本文件的函数，不再各自维护一份。
//!
//! `banner_meta` 表的 `curve_type`/`guarantee_rule` 两列只是 `TEXT` 摘要
//! 标签（S2 定的表结构，装不下 `base`/`start`/`step` 这些具体曲线参数），
//! 摘要标签直接复用 [`ProbabilityCurve`]/[`GuaranteeRule`] 已有的 serde
//! `kind` 标签（[`serde_kind_tag`]），不再手写一份平行的 match 分支——
//! 手写映射表会在 `gs-core` 侧新增枚举变体时忘记同步，这里复用 derive
//! 出来的 `Serialize` 实现能让两边天然保持一致（`gs-storage::enum_to_sql`
//! 已经是这个模式的先例）。

use crate::manifest_lookup;
use gs_core::{BannerSpec, PityGroup, RaritySpec};
use gs_storage::NewBannerMeta;

/// 原神插件 id，对应 `plugins/genshin/manifest.ts` 的 `manifest.id`。
pub const GENSHIN_PLUGIN_ID: &str = "genshin";

/// 角色活动祈愿共享保底组的 key，对应 manifest `pityGroups[0].key`——这是
/// 一个跨 Rust/TS 两侧共享的稳定标识符，不是"数据"，与硬编码保底线数字是
/// 两回事（标识符本就该在两侧字面一致，就像表名/JSON 键名）。
pub const CHARACTER_EVENT_WISH_PITY_GROUP: &str = "characterEventWish";

/// `curve`/`guarantee` 在 `banner_meta.curve_type`/`guarantee_rule` 两列上
/// 的摘要标签，直接复用它们已有的 `#[serde(tag = "kind")]` 序列化结果，
/// 不手写一份平行的 match。
fn serde_kind_tag<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|json| {
            json.get("kind")
                .and_then(|kind| kind.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| panic!("枚举序列化后应当带 \"kind\" 标签字段，实际没有"))
}

/// 原神 manifest 声明的全部保底组。当前只有一个（角色活动祈愿），但签名不
/// 假设这一点——manifest 新增第二个保底组（比如武器池未来若也有共享保底）
/// 时，这里不需要改代码。
///
/// 反序列化逻辑已收敛到 [`manifest_lookup::pity_groups_for`]（按任意插件 id
/// 参数化的通用版本），本函数只是绑死 `GENSHIN_PLUGIN_ID` 的薄封装——保留
/// 是因为它是已发布的公共 API，`pity.rs`/`rarity.rs`/`rare_event.rs` 的测试
/// 与集成测试都直接调用它。
pub fn genshin_pity_groups() -> Vec<PityGroup> {
    manifest_lookup::pity_groups_for(GENSHIN_PLUGIN_ID)
}

/// 角色活动祈愿的完整保底声明：`hardPity: 90`、
/// `SoftPity { base: 0.006, start: 74, step: 0.06 }`、`FiftyFifty` 担保，
/// 直接来自 manifest `pityGroups[0]`，不是这里的字面量。
pub fn character_event_wish_pity_group() -> PityGroup {
    genshin_pity_groups()
        .into_iter()
        .find(|group| group.key == CHARACTER_EVENT_WISH_PITY_GROUP)
        .unwrap_or_else(|| {
            panic!(
                "genshin manifest 的 pityGroups 里找不到 key = \"{CHARACTER_EVENT_WISH_PITY_GROUP}\" \
                 的分组——若 manifest.ts 里改了这个 key，这个常量要跟着改"
            )
        })
}

/// 原神的稀有度阶梯声明，直接来自 manifest `rarity` 字段。薄封装，理由同
/// [`genshin_pity_groups`]。
pub fn genshin_rarity_spec() -> RaritySpec {
    manifest_lookup::rarity_spec_for(GENSHIN_PLUGIN_ID)
}

/// 原神 manifest 声明的全部卡池（`banners` 数组），直接来自 manifest，
/// 新增卡池只需要改 `plugins/genshin/manifest.ts`。薄封装，理由同
/// [`genshin_pity_groups`]。
pub fn genshin_banners() -> Vec<BannerSpec> {
    manifest_lookup::banners_for(GENSHIN_PLUGIN_ID)
}

/// `displayName` 只按 `"zh-CN"` 取——M1 阶段只有中文一种展示语言，manifest
/// 目前也只声明了这一个 locale。真正支持多语言展示时需要在这里按调用方的
/// 语言参数取值，不是本 Stage 的范围。
fn zh_cn_name(spec: &BannerSpec) -> Option<String> {
    spec.display_name.0.get("zh-CN").cloned()
}

/// 生成写入 `banner_meta` 表的种子数据：遍历 manifest 声明的全部卡池，
/// 对每个卡池按 `pityGroups[].members` 反查它属于哪个共享保底组——查得到
/// 就带上那个组的 `curve`/`guarantee`/`hardPity` 摘要，查不到就如实反映
/// "未声明"（`curve_type`/`guarantee_rule`/`pity_max` 全部 `None`），不替
/// 它们编造一套猜测的保底参数（原武器/常驻/集录/新手池就是这种情况）。
pub fn genshin_banner_meta_seed() -> Vec<NewBannerMeta> {
    let banners = genshin_banners();
    let pity_groups = genshin_pity_groups();

    banners
        .into_iter()
        .map(|banner| {
            let matched_group = pity_groups
                .iter()
                .find(|group| group.members.contains(&banner.id));

            let (pity_group, curve_type, guarantee_rule, pity_max) = match matched_group {
                Some(group) => (
                    group.key.clone(),
                    Some(serde_kind_tag(&group.curve)),
                    Some(serde_kind_tag(&group.guarantee)),
                    Some(i64::from(group.hard_pity)),
                ),
                // 未被任何 pityGroups 声明覆盖的卡池自成一组：pity_group
                // 就是它自己的 banner_key。
                None => (banner.id.clone(), None, None, None),
            };

            NewBannerMeta {
                plugin_id: GENSHIN_PLUGIN_ID.to_string(),
                banner_key: banner.id.clone(),
                pity_group,
                name: zh_cn_name(&banner),
                start_at: None,
                end_at: None,
                rate_up_items: None,
                pity_max,
                curve_type,
                guarantee_rule,
                data_ver: 1,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    // 只有测试需要按字面量断言具体的曲线/担保变体形状，实现代码本身从不
    // 具名引用这两个类型（只经泛型 `serde_kind_tag<T: Serialize>` 透传），
    // 因此把这两个 `use` 收在这里，避免非测试构建下的 unused-imports 警告。
    use gs_core::{GuaranteeRule, ProbabilityCurve};

    /// 钉住当前 manifest 声明的卡池集合。
    ///
    /// 名字用 `pins_` 而不是 `covers_every_banner_declared_in_the_manifest`：
    /// 后者听起来像"动态比对 manifest"，而这里比的是一份**手写的期望清单**。
    /// 两者的区别在改 manifest 时才显现——动态比对怎么改都不会红，手写清单
    /// 会红，而**红正是想要的效果**：新增/删除卡池是一次有意识的数据变更，
    /// 应当在这里留下一次显式确认，而不是悄悄流过去。
    ///
    /// 实测过（M1-S7 验收）：往 `plugins/genshin/manifest.ts` 的 `banners`
    /// 加一个卡池、重跑 `node scripts/gs-bundle-plugins.mjs`，**Rust 侧一行
    /// 不改**，本测试就会报出 `left` 多了那个新卡池——这既证明了"新增卡池
    /// 只改单一数据源"，也证明了本测试确实在钉。
    #[test]
    fn seed_pins_the_banner_set_currently_declared_in_the_manifest() {
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
        assert!(
            shared
                .iter()
                .all(|m| m.curve_type.as_deref() == Some("softPity"))
        );
        assert!(
            shared
                .iter()
                .all(|m| m.guarantee_rule.as_deref() == Some("fiftyFifty"))
        );
        assert!(shared.iter().all(|m| m.pity_max == Some(90)));
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
            assert!(entry.pity_max.is_none());
        }
    }

    #[test]
    fn seed_names_come_from_manifest_display_name_including_the_400_annotation() {
        // 400 子类型的说明文本（"随 301 一并返回"）本来就在 manifest.ts 的
        // displayName 里——不是这里编出来的，验证它确实原样流过来了，
        // 证明"改 manifest 就不用改这里"这句话成立。
        let seed = genshin_banner_meta_seed();
        let entry_400 = seed
            .iter()
            .find(|m| m.banner_key == "400")
            .expect("应有 400");
        assert_eq!(
            entry_400.name.as_deref(),
            Some("角色活动祈愿（400 子类型，随 301 一并返回）")
        );
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

    /// 同上，钉的是 `genshin_banners()` 这一层（`genshin_banner_meta_seed`
    /// 的上游）。两层各钉一次，是为了在派生逻辑出错时能区分"manifest 读错了"
    /// 与"读对了但派生环节丢了卡池"。
    #[test]
    fn genshin_banners_pins_the_pool_set_currently_declared_in_the_manifest() {
        let banners = genshin_banners();
        let mut ids: Vec<&str> = banners.iter().map(|b| b.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["100", "200", "301", "302", "400", "500"]);
    }
}
