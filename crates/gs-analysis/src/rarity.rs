//! 稀有度维度的查询与聚合：一切判断都走调用方传入的 [`RaritySpec`]，
//! 本模块不出现任何具体稀有度码的字面量（测试构造数据除外）——绝区零
//! `rank_type` 实测取值 `['2','3','4']`，任何 `rarity == "5"` 的判定在
//! 绝区零上都会静默把出金统计成零。
//!
//! `Repository::find_records_by_rarity(account_id, &spec.pity_target)`
//! 已经是"按插件声明的稀有度码查询"的落点（`gs-storage` 侧不接受字面量，
//! 只接受调用方传入的具体值），本模块处理的是查询结果拿到手之后的统计。

use gs_core::{GachaRecord, MetaState, RaritySpec};
use std::collections::BTreeMap;

/// `RaritySpec` 视角下的稀有度分布。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RarityDistribution {
    /// 键覆盖 `RaritySpec.ladder` 声明的全部稀有度码（即使某一档计数为 0
    /// 也会出现在这里，调用方不需要自己判断"缺的档位是不是原本就是 0"）。
    pub counts: BTreeMap<String, u32>,
    /// `rarity IS NULL` 的记录数——字典未同步导致的"稀有度未知"，不计入
    /// `counts`，单独暴露而不是静默丢弃（星铁 5372 条真实存档中的那 1 条
    /// 正是这种情况）。
    pub unknown_count: u32,
    /// `rarity` 有值但不在 `RaritySpec.ladder` 声明范围内的记录数。
    /// 正常情况下应当恒为 0；不为 0 说明插件声明的阶梯和实际落库数据
    /// 对不上，这本身就是一个需要暴露而不是吞掉的信号。
    pub unrecognized_count: u32,
}

/// 统计 `records` 在 `spec.ladder` 各档位上的分布。
///
/// 接收整个 [`RaritySpec`] 而不是裸的 `ladder: &[String]`，是为了让调用方
/// 不需要自己拆字段——本模块的定位就是"稀有度查询全部走 RaritySpec"，
/// 签名上直接体现这一点。
pub fn rarity_distribution(records: &[GachaRecord], spec: &RaritySpec) -> RarityDistribution {
    let mut distribution = RarityDistribution::default();
    for code in &spec.ladder {
        distribution.counts.entry(code.clone()).or_insert(0);
    }
    for record in records {
        match &record.rarity {
            None => distribution.unknown_count += 1,
            Some(code) if spec.ladder.contains(code) => {
                *distribution.counts.entry(code.clone()).or_insert(0) += 1;
            }
            Some(_) => distribution.unrecognized_count += 1,
        }
    }
    distribution
}

/// 单个物品的聚合统计。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ItemStat {
    /// 出现的抽取次数（记录条数，不是数量）。
    pub pull_count: u32,
    /// 累计获得数量（`GachaRecord::qty` 求和；米哈游三游恒为抽取次数，
    /// 但字段语义是"数量"不是"抽数"，异环等游戏会出现单条记录数量大于 1
    /// 的情况，因此单独累加而不是直接复用 `pull_count`）。
    pub total_qty: i64,
}

/// 按 `item_id` 聚合的结果。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ItemAggregation {
    /// 仅 `meta_state == Complete` 的记录参与聚合。
    pub items: BTreeMap<String, ItemStat>,
    /// `meta_state == Pending` 的记录数，单独计数、不与 `items` 混算。
    ///
    /// 原神记录落库时 `item_id` 实为本地化物品名而非真正的物品标识
    /// （见 `plugins/genshin/manifest.ts` `extractRecord` 的说明：原神
    /// API 不返回 `item_id`，字段值只能先用 `name` 顶替）。若不分开计数，
    /// 跨语言采集的同一物品会被按名字拆成两个不同的 `item_id`，聚合结果
    /// 是"错但不报错"——这正是本 Stage 第一次真正消费这条约束的地方。
    pub pending_count: u32,
    /// `meta_state == Unresolvable` 的记录数，理由同 `pending_count`：
    /// 这类记录的 `item_id` 同样不可信，且不会再被字典补全，但仍然不该
    /// 被悄悄并入正常聚合，需要单独暴露供 UI 标注"有 N 条记录物品身份
    /// 无法确定"。
    pub unresolvable_count: u32,
}

/// 按 `item_id` 聚合 `records`，聚合前显式按 `meta_state` 分桶。
pub fn aggregate_by_item(records: &[GachaRecord]) -> ItemAggregation {
    let mut aggregation = ItemAggregation::default();
    for record in records {
        match record.meta_state {
            MetaState::Complete => {
                let stat = aggregation.items.entry(record.item_id.clone()).or_default();
                stat.pull_count += 1;
                stat.total_qty += record.qty;
            }
            MetaState::Pending => aggregation.pending_count += 1,
            MetaState::Unresolvable => aggregation.unresolvable_count += 1,
        }
    }
    aggregation
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_core::{RecordKey, RecordSource, TzOrigin};

    fn record(item_id: &str, rarity: Option<&str>, meta_state: MetaState, qty: i64) -> GachaRecord {
        GachaRecord {
            id: 0,
            account_id: 1,
            banner_key: "301".to_string(),
            pity_group: "characterEventWish".to_string(),
            record_key: RecordKey::new(format!("301:{item_id}:{qty}")).unwrap(),
            lang: None,
            occurred_at: 0,
            occurred_raw: "0".to_string(),
            tz_origin: TzOrigin::Assumed,
            tz_offset_min: None,
            seq_in_batch: None,
            item_id: item_id.to_string(),
            item_type: None,
            rarity: rarity.map(str::to_string),
            qty,
            meta_state,
            source: RecordSource::OfficialApi,
            captured_at: 0,
            raw_ref: None,
            extra: None,
        }
    }

    // 不在本模块手抄原神 RaritySpec fixture——直接调用
    // `crate::genshin_rarity_spec`（从 manifest 派生的单一数据源），
    // 与 `pity.rs`/`rare_event.rs`/集成测试统一。

    #[test]
    fn rarity_distribution_counts_known_and_unknown_records() {
        let records = vec![
            record("角色A", Some("4"), MetaState::Complete, 1),
            record("角色B", Some("4"), MetaState::Complete, 1),
            record("角色C", Some("5"), MetaState::Complete, 1),
            record("神秘物品", None, MetaState::Complete, 1),
        ];

        let dist = rarity_distribution(&records, &crate::genshin_rarity_spec());

        assert_eq!(dist.counts["3"], 0);
        assert_eq!(dist.counts["4"], 2);
        assert_eq!(dist.counts["5"], 1);
        assert_eq!(dist.unknown_count, 1);
        assert_eq!(dist.unrecognized_count, 0);
    }

    #[test]
    fn rarity_distribution_supports_non_standard_ladder_like_zzz() {
        let spec = RaritySpec {
            ladder: vec!["2".to_string(), "3".to_string(), "4".to_string()],
            pity_target: "4".to_string(),
        };
        let records = vec![
            record("邦布A", Some("2"), MetaState::Complete, 1),
            record("代理人B", Some("4"), MetaState::Complete, 1),
        ];

        let dist = rarity_distribution(&records, &spec);

        assert_eq!(dist.counts["2"], 1);
        assert_eq!(dist.counts["4"], 1);
        // ladder 里没有 "5"，如果实现里假设过 "5" 存在，这里的 keys 数量会露馅。
        assert_eq!(dist.counts.len(), 3);
        assert!(!dist.counts.contains_key("5"));
    }

    #[test]
    fn rarity_distribution_flags_unrecognized_codes_without_dropping_them() {
        // 插件声明的阶梯和实际数据对不上时的异常情况：不 panic、不静默吞掉，
        // 计入 unrecognized_count。
        let records = vec![record("异常物品", Some("9"), MetaState::Complete, 1)];
        let dist = rarity_distribution(&records, &crate::genshin_rarity_spec());
        assert_eq!(dist.unrecognized_count, 1);
        assert_eq!(dist.unknown_count, 0);
    }

    #[test]
    fn aggregate_by_item_sums_qty_and_pull_count_for_repeated_item() {
        let records = vec![
            record("摩拉", Some("3"), MetaState::Complete, 30),
            record("摩拉", Some("3"), MetaState::Complete, 50),
        ];
        let agg = aggregate_by_item(&records);
        let stat = agg.items.get("摩拉").expect("应当聚合出这个物品");
        assert_eq!(stat.pull_count, 2);
        assert_eq!(stat.total_qty, 80);
    }

    #[test]
    fn aggregate_by_item_excludes_pending_records_and_counts_them_separately() {
        let records = vec![
            record("胡桃", Some("5"), MetaState::Complete, 1),
            // 跨语言采集、字典尚未反查完成的记录：item_id 实为本地化名。
            record("Hu Tao", Some("5"), MetaState::Pending, 1),
        ];
        let agg = aggregate_by_item(&records);

        // Pending 记录不出现在正常聚合里，不会被错误地当成"另一个物品"。
        assert_eq!(agg.items.len(), 1);
        assert!(agg.items.contains_key("胡桃"));
        assert!(!agg.items.contains_key("Hu Tao"));
        assert_eq!(agg.pending_count, 1);
    }

    #[test]
    fn aggregate_by_item_excludes_unresolvable_records_and_counts_them_separately() {
        let records = vec![
            record("胡桃", Some("5"), MetaState::Complete, 1),
            record("未知物品", None, MetaState::Unresolvable, 1),
        ];
        let agg = aggregate_by_item(&records);

        assert_eq!(agg.items.len(), 1);
        assert_eq!(agg.unresolvable_count, 1);
        assert_eq!(agg.pending_count, 0);
    }
}
