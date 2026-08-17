//! `gs-analysis`：通用分析引擎。
//!
//! 保底计数、稀有度分布、完整性区间核对全部基于插件声明的领域类型
//! （[`gs_core::RaritySpec`] / [`gs_core::PityGroup`] /
//! [`gs_core::ProbabilityCurve`]）计算，不在判断逻辑里出现任何硬编码的
//! 稀有度数字或保底线常量——`banner_meta_seed` 模块的常量例外：那些数字
//! 就是"原神这个具体游戏的声明值"本身，是种子数据，不是通用判断逻辑。
//!
//! 六个子模块对应六类关注点：
//! - [`pity`]：`PityGroup` 保底计数、`ProbabilityCurve` 概率取值、
//!   `GuaranteeRule` 担保状态机
//! - [`rare_event`]：从 `gacha_record` 派生 `rare_event`（L2 出金事件）
//! - [`rarity`]：稀有度分布统计、按物品维度聚合（含 `meta_state` 分桶）
//! - [`baseline`]：`BaselineProvider::InGamePageCount` 的区间核对
//! - [`banner_meta_seed`]：原神卡池元数据的初始种子（`data_ver = 1`）
//! - [`manifest_lookup`]：按任意已注册插件 id（不止 genshin）读取展示名 /
//!   稀有度阶梯 / 保底组 / 卡池，供 `gs-host` 的 `list_games`/保底进度编排使用

mod banner_meta_seed;
mod baseline;
mod manifest_lookup;
mod pity;
mod rare_event;
mod rarity;

pub use banner_meta_seed::{
    CHARACTER_EVENT_WISH_PITY_GROUP, GENSHIN_PLUGIN_ID, character_event_wish_pity_group,
    genshin_banner_meta_seed, genshin_rarity_spec,
};
pub use baseline::{DrawCountRange, IntegrityGap, evaluate_draw_count_gap};
pub use manifest_lookup::{banners_for, display_name_for, pity_groups_for, rarity_spec_for};
pub use pity::{
    CurveEvaluation, HitOutcome, PityCounter, PityGroupReport, PityPull, analyze_pity_group,
    apply_guarantee_rule, evaluate_curve, hit_outcomes_from_rare_events,
};
pub use rare_event::derive_rare_events;
pub use rarity::{
    ItemAggregation, ItemStat, RarityDistribution, aggregate_by_item, rarity_distribution,
};

/// 全部已注册插件的 id（按字母序），直接转发
/// [`gs_manifest_data::registered_plugin_ids`]——`gs-host` 只依赖本 crate
/// 就能拿到"有哪些游戏"，不需要为此单独在 `Cargo.toml` 里再加一条对
/// `gs-manifest-data` 的直接依赖（本 crate 已经依赖它，见下方模块用法）。
pub fn registered_plugin_ids() -> Vec<&'static str> {
    gs_manifest_data::registered_plugin_ids()
}
