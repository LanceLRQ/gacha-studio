//! `rare_event`（L2 出金事件）的派生逻辑：从 `gacha_record` 按
//! `RaritySpec.pity_target` 筛出出金记录，用 [`crate::pity`] 已有的保底
//! 计数得到 `pity_count`，产出可写入
//! [`gs_storage::Repository::replace_derived_rare_events`] 的行。
//!
//! 不另写一套计数：[`analyze_pity_group`] 已经实现了"同一 `pity_group`
//! 内按 `occurred_at` 顺序计数、命中即清零"的完整逻辑，本模块只是从它的
//! 输出里挑出命中的那些 pull——两套计数逻辑漂移正是这个项目明确要防的事
//! （存储数据模型设计文档 §七.4 附近的裁定）。

use crate::pity::{analyze_pity_group, effective_pity_target};
use gs_core::{GachaRecord, PityGroup, RaritySpec};
use gs_storage::{NewRareEvent, SnapshotOrigin};

/// 标注派生算法本身（"用保底计数从 L1 推出来的"），不是原始采集通道——
/// 采集通道已经能通过 `record_id` 关联回 `gacha_record` 查到，不需要在
/// `rare_event.source` 上重复一遍。
const DERIVED_RARE_EVENT_SOURCE: &str = "derived:pity";

/// [`derive_rare_events`] 的完整输出。
///
/// 不用裸 `Vec<NewRareEvent>`：`analyze_pity_group` 认真统计的
/// `unknown_rarity_count`（`rarity IS NULL` 的记录数，明确"不参与保底
/// 计数但不能被静默丢弃"）如果只留在 `PityGroupReport` 里、这一步不往下
/// 传，就在这里蒸发了——落进 `rare_event.pity_count` 的数字可能因为中间
/// 跳过了未知稀有度记录而偏低，但调用方看到的是一个裸 `Vec`，没有任何
/// 信号提示"这批数字可能不准"。这与 §8.3"区间不得显示为精确值"是同一条
/// 精神：`banner_snapshot` 用 `extra.precision` 标注"这是区间不是精确值"，
/// 这里用 `unknown_rarity_count` + 各事件的 `extra`（见下方）做同样的事。
///
/// 组维度的 `unknown_rarity_count` 不能反推是哪一条事件受影响——具体到
/// 哪一条事件、可能偏低多少，见该事件 `NewRareEvent.extra` 里的
/// `unknown_rarity_skipped`（只在 >0 时才写）。两个信号配合看：前者告诉
/// 调用方"这批结果里有需要留意的地方"，后者告诉调用方"具体是哪一条"。
///
/// 不派生 `Debug`/`Clone`/`PartialEq`：`NewRareEvent`（`gs-storage`）本身
/// 就不带这些派生，与其余"New*"写入模型（`NewBannerSnapshot` 等）保持
/// 同一种极简形态一致——这类类型只用于"构造后立刻传给写入方法"，不需要
/// 比较或打印。
pub struct DerivedRareEvents {
    pub events: Vec<NewRareEvent>,
    /// `analyze_pity_group` 统计的 `rarity IS NULL` 记录数（组维度，不是
    /// 逐事件的）。
    pub unknown_rarity_count: u32,
}

/// 从 `records`（应为同一 `pity_group` 下的全部记录，`occurred_at` 升序，
/// 如 `Repository::find_records_by_pity_group` 的返回值）派生出全部命中
/// 保底目标的出金事件。
///
/// `is_rate_up` 恒为 `None`：本 Stage 没有任何数据源能提供当期 UP 物品
/// 列表，写 `Some(false)` 会把"不知道"伪装成"没歪"，污染后续
/// `GuaranteeRule::FiftyFifty` 状态机的判断（存储数据模型设计文档 §4.2）。
///
/// `rarity` 取 [`effective_pity_target`] 算出的有效目标，而不是直接读
/// `rarity.pity_target` 或 `pull.rarity`——`analyze_pity_group` 判定命中
/// 用的正是 `effective_pity_target(group, rarity)`（`group.pity_target`
/// 显式声明时优先，缺省才回落到 `rarity.pity_target`），这里必须复用
/// 同一个值才能保证"判定命中的目标"与"写进 `rare_event.rarity` 的值"
/// 一致。这条逻辑曾经在两处各写了一遍 `unwrap_or` 表达式，这里当时漏改
/// 成了裸 `rarity.pity_target`：鸣潮 4★ 组命中判定按 "4" 走，写进库里的
/// 却是 "5"，是一个真实存在过的 bug，现在改成共用 [`effective_pity_target`]，
/// 两处不可能再各自漂移。
///
/// `extra`：当 `pull.unknown_rarity_since_last_hit > 0`（这次命中前跳过
/// 过未知稀有度记录）时写 `{"unknown_rarity_skipped": N}`，否则留 `None`
/// ——不是"把数字塞进 extra 就算交代了"：即使调用方从不读 `extra`，组维度
/// 的 [`DerivedRareEvents::unknown_rarity_count`] 也已经在返回类型上标出
/// "这批结果里有条目可能受影响"；读 `extra` 的调用方（或直接查
/// `rare_event` 表的 UI）能进一步定位到具体是哪一条、差多少。
pub fn derive_rare_events(
    group: &PityGroup,
    rarity: &RaritySpec,
    records: &[GachaRecord],
) -> DerivedRareEvents {
    let report = analyze_pity_group(group, rarity, records);
    let events = report
        .pulls
        .into_iter()
        .filter(|pull| pull.is_pity_hit)
        .map(|pull| {
            let extra = (pull.unknown_rarity_since_last_hit > 0).then(|| {
                serde_json::json!({ "unknown_rarity_skipped": pull.unknown_rarity_since_last_hit })
                    .to_string()
            });
            NewRareEvent {
                account_id: pull.account_id,
                banner_key: pull.banner_key,
                pity_group: group.key.clone(),
                occurred_at: pull.occurred_at,
                item_id: pull.item_id,
                rarity: effective_pity_target(group, rarity).to_string(),
                pity_count: Some(i64::from(pull.pulls_since_last_hit)),
                is_rate_up: None,
                origin: SnapshotOrigin::Derived,
                source: DERIVED_RARE_EVENT_SOURCE.to_string(),
                record_id: Some(pull.record_id),
                extra,
            }
        })
        .collect();

    DerivedRareEvents {
        events,
        unknown_rarity_count: report.unknown_rarity_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_core::{MetaState, RecordKey, RecordSource, TzOrigin};

    fn record(
        id: i64,
        account_id: i64,
        banner_key: &str,
        pity_group: &str,
        occurred_at: i64,
        item_id: &str,
        rarity: Option<&str>,
    ) -> GachaRecord {
        GachaRecord {
            id,
            account_id,
            banner_key: banner_key.to_string(),
            pity_group: pity_group.to_string(),
            record_key: RecordKey::new(format!("{banner_key}:{occurred_at}:{item_id}")).unwrap(),
            lang: None,
            occurred_at,
            occurred_raw: occurred_at.to_string(),
            tz_origin: TzOrigin::Assumed,
            tz_offset_min: None,
            seq_in_batch: None,
            item_id: item_id.to_string(),
            item_type: None,
            rarity: rarity.map(str::to_string),
            qty: 1,
            meta_state: MetaState::Complete,
            source: RecordSource::OfficialApi,
            captured_at: occurred_at,
            raw_ref: None,
            extra: None,
            stable_id: None,
            gacha_id: None,
        }
    }

    // 不在本模块手抄原神 PityGroup/RaritySpec fixture——直接调用
    // `crate::character_event_wish_pity_group`/`crate::genshin_rarity_spec`
    // （从 manifest 派生的单一数据源），与 `pity.rs`/`rarity.rs`/集成测试
    // 统一，不再各自维护一份容易漂移的字面量拷贝。

    #[test]
    fn derive_rare_events_extracts_only_pity_hits_with_pity_count_and_null_rate_up() {
        let group = crate::character_event_wish_pity_group();
        let spec = crate::genshin_rarity_spec();
        let records = vec![
            record(101, 7, "301", "characterEventWish", 1, "角色A", Some("4")),
            record(102, 7, "301", "characterEventWish", 2, "角色B", Some("4")),
            record(103, 7, "301", "characterEventWish", 3, "角色C", Some("5")),
            record(104, 7, "301", "characterEventWish", 4, "角色D", Some("3")),
        ];

        let derived = derive_rare_events(&group, &spec, &records);

        assert_eq!(
            derived.events.len(),
            1,
            "四条记录里只有一条命中 pity_target"
        );
        assert_eq!(
            derived.unknown_rarity_count, 0,
            "这组记录里没有稀有度未知的，组维度计数应为 0"
        );
        let event = &derived.events[0];
        assert_eq!(event.account_id, 7);
        assert_eq!(event.banner_key, "301");
        assert_eq!(event.pity_group, "characterEventWish");
        assert_eq!(event.item_id, "角色C");
        assert_eq!(event.rarity, "5");
        assert_eq!(event.pity_count, Some(3));
        assert_eq!(event.record_id, Some(103));
        assert_eq!(
            event.is_rate_up, None,
            "本 Stage 拿不到 UP 物品列表，必须写 NULL，不能默认 false 冒充「没歪」"
        );
        assert_eq!(event.origin, SnapshotOrigin::Derived);
        assert_eq!(event.source, DERIVED_RARE_EVENT_SOURCE);
        assert_eq!(
            event.extra, None,
            "命中前没有跳过任何未知稀有度记录，不应带 extra 标注"
        );
    }

    #[test]
    fn derive_rare_events_returns_empty_when_no_pity_target_hit() {
        let group = crate::character_event_wish_pity_group();
        let spec = crate::genshin_rarity_spec();
        let records = vec![record(
            1,
            1,
            "301",
            "characterEventWish",
            1,
            "角色A",
            Some("4"),
        )];

        let derived = derive_rare_events(&group, &spec, &records);
        assert!(derived.events.is_empty());
        assert_eq!(derived.unknown_rarity_count, 0);
    }

    #[test]
    fn derive_rare_events_ignores_unknown_rarity_records_without_crashing() {
        let group = crate::character_event_wish_pity_group();
        let spec = crate::genshin_rarity_spec();
        let records = vec![
            // 字典未同步导致的稀有度未知记录（星铁真实存档实测场景），
            // 不应参与计数，也不应让派生逻辑 panic。
            record(1, 1, "301", "characterEventWish", 1, "神秘物品", None),
            record(2, 1, "301", "characterEventWish", 2, "角色C", Some("5")),
        ];

        let derived = derive_rare_events(&group, &spec, &records);

        assert_eq!(derived.events.len(), 1);
        assert_eq!(
            derived.events[0].pity_count,
            Some(1),
            "unknown-rarity 记录完全不占计数位（不是「跳过但仍占一抽」），\
             命中是计数器里的第 1 抽，不是第 2 抽"
        );
        assert_eq!(derived.unknown_rarity_count, 1);
    }

    #[test]
    fn derive_rare_events_merges_shared_pity_group_members_by_the_group_key() {
        // 301/400 共享保底：派生出的 pity_group 统一写成分组 key，
        // 不是各记录原始的 banner_key——这样重算时才能按 pity_group
        // 一次性替换两个卡池的旧结果（见 Repository::replace_derived_rare_events）。
        let group = crate::character_event_wish_pity_group();
        let spec = crate::genshin_rarity_spec();
        let records = vec![
            record(1, 1, "301", "characterEventWish", 1, "角色A", Some("4")),
            record(2, 1, "400", "characterEventWish", 2, "角色B", Some("5")),
        ];

        let derived = derive_rare_events(&group, &spec, &records);

        assert_eq!(derived.events.len(), 1);
        assert_eq!(
            derived.events[0].banner_key, "400",
            "原始 banner_key 逐条保留"
        );
        assert_eq!(
            derived.events[0].pity_group, "characterEventWish",
            "写入的 pity_group 是分组 key，不是原始 banner_key"
        );
    }

    #[test]
    fn derive_rare_events_flags_events_whose_pity_count_may_be_undercounted() {
        // 未知稀有度记录夹在两次命中之间：这条记录本身不参与计数，
        // 但它的存在意味着"命中前实际经过的抽数"可能比 pity_count 显示的
        // 更多——这条测试断言这一事实被记在了具体那条事件的 extra 上，
        // 而不是只在组维度的 unknown_rarity_count 里含糊带过。
        let group = crate::character_event_wish_pity_group();
        let spec = crate::genshin_rarity_spec();
        let records = vec![
            record(1, 7, "301", "characterEventWish", 1, "角色HitA", Some("5")),
            record(2, 7, "301", "characterEventWish", 2, "角色Miss", Some("4")),
            record(3, 7, "301", "characterEventWish", 3, "神秘物品", None),
            record(4, 7, "301", "characterEventWish", 4, "角色HitB", Some("5")),
        ];

        let derived = derive_rare_events(&group, &spec, &records);

        assert_eq!(derived.events.len(), 2);
        assert_eq!(
            derived.unknown_rarity_count, 1,
            "组维度应当带出跳过的未知稀有度记录总数"
        );

        let hit_a = &derived.events[0];
        assert_eq!(hit_a.pity_count, Some(1));
        assert_eq!(
            hit_a.extra, None,
            "第一次命中前没有跳过任何未知记录，不应带 extra 标注"
        );

        let hit_b = &derived.events[1];
        assert_eq!(
            hit_b.pity_count,
            Some(2),
            "已知计数只数到 2（Miss 1 次 + 本次命中），不含被跳过的那条未知记录"
        );
        let extra = hit_b
            .extra
            .as_ref()
            .expect("命中前跳过过未知记录的事件必须带 extra 标注");
        let parsed: serde_json::Value = serde_json::from_str(extra).expect("extra 应当是合法 JSON");
        assert_eq!(
            parsed["unknown_rarity_skipped"], 1,
            "hit_b 前恰好跳过了 1 条未知稀有度记录，这是它的 pity_count 可能偏低的直接证据"
        );
    }

    #[test]
    fn derive_rare_events_writes_effective_pity_target_not_rarity_spec_when_group_overrides() {
        // 回归测试：鸣潮 4★ 组显式声明 group.pity_target = "4"，与该卡池
        // rarity.pity_target = "5" 不同。此前 derive_rare_events 直接写
        // rarity.pity_target，命中判定明明按 "4" 走，写进库里的却是 "5"——
        // 这是曾经真实发生过的 bug（见 derive_rare_events 文档），这条测试
        // 锁死它不再复发。
        use gs_core::{GuaranteeRule, ProbabilityCurve};

        let spec = RaritySpec {
            ladder: vec!["3".to_string(), "4".to_string(), "5".to_string()],
            pity_target: "5".to_string(),
            tier_labels: std::collections::BTreeMap::new(),
        };
        let group = PityGroup {
            key: "wuwaStandard4Star".to_string(),
            members: vec!["standard".to_string()],
            hard_pity: 10,
            curve: ProbabilityCurve::Flat { base: 0.06 },
            guarantee: GuaranteeRule::None {},
            pity_target: Some("4".to_string()), // 显式覆盖，与 rarity.pity_target 不同
        };
        let records = vec![
            record(1, 7, "standard", "wuwaStandard4Star", 1, "武器A", Some("3")),
            record(
                2,
                7,
                "standard",
                "wuwaStandard4Star",
                2,
                "四星角色B",
                Some("4"),
            ),
        ];

        let derived = derive_rare_events(&group, &spec, &records);

        assert_eq!(
            derived.events.len(),
            1,
            "第 2 条 4★ 记录应命中该组的保底目标"
        );
        assert_eq!(
            derived.events[0].rarity, "4",
            "写入的 rarity 必须跟随 group.pity_target 算出的有效目标，\
             而不是静默回落到 rarity.pity_target 的 \"5\""
        );
    }
}
