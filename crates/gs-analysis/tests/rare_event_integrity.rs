//! 端到端集成测试：建库 → 插入带出金的 `gacha_record` → 派生 `rare_event`
//! → 查 `v_integrity` → 断言 `local_rares` 不再是 0、且与 `official_rares`
//! 对得上。
//!
//! 这是 A/B/C 三个任务共同存在的理由——三个单元测试文件各自全绿并不能
//! 排除拼接时字段错位（`pity_group` 传反、`record_id` 没对上、视图的
//! `origin='derived'` 过滤条件失效……）。在此之前，`v_integrity` 会对一个
//! 完全空的 `rare_event` 表撒谎，给出「官方 5 次金 / 本地 0 次」这种看起来
//! 像严重丢数据、实际只是功能没接上的假告警（`milestones/02-M1` §"S5
//! 落地后查实的三处集成缺口"）。

// 不在集成测试里再手抄一份原神 PityGroup/RaritySpec fixture——直接调用
// `gs_analysis::{character_event_wish_pity_group, genshin_rarity_spec}`
// （从 manifest 派生的单一数据源），与 `pity.rs`/`rarity.rs`/`rare_event.rs`
// 自身的单元测试统一，不再各自维护一份容易漂移的字面量拷贝。
use gs_analysis::{character_event_wish_pity_group, derive_rare_events, genshin_rarity_spec};
use gs_core::{GachaRecord, MetaState, RecordKey, RecordSource, TzOrigin};
use gs_storage::{NewAccount, NewBannerSnapshot, SnapshotOrigin, Storage};

fn record(account_id: i64, occurred_at: i64, item_id: &str, rarity: &str) -> GachaRecord {
    GachaRecord {
        id: 0,
        account_id,
        banner_key: "301".to_string(),
        pity_group: "characterEventWish".to_string(),
        record_key: RecordKey::new(format!("301:{occurred_at}:{item_id}"))
            .expect("测试 key 不应为空"),
        lang: Some("zh-cn".to_string()),
        occurred_at,
        occurred_raw: occurred_at.to_string(),
        tz_origin: TzOrigin::Region,
        tz_offset_min: Some(480),
        seq_in_batch: None,
        item_id: item_id.to_string(),
        item_type: Some("角色".to_string()),
        rarity: Some(rarity.to_string()),
        qty: 1,
        meta_state: MetaState::Complete,
        source: RecordSource::OfficialApi,
        captured_at: occurred_at,
        raw_ref: None,
        extra: None,
    }
}

#[test]
fn deriving_rare_events_makes_v_integrity_reflect_local_gold_pulls() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();

    let account_id = repo
        .create_account(&NewAccount {
            plugin_id: "genshin".to_string(),
            game_uid: "100000000".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: Some(168),
            created_at: 1_754_800_000_000,
        })
        .expect("创建账号应当成功");

    // 5 次出金，每次前面垫 3 条 4 星，共 20 条记录。
    let mut records = Vec::new();
    let mut occurred_at = 1_754_800_000_000i64;
    for hit in 0..5 {
        for filler in 0..3 {
            occurred_at += 1000;
            records.push(record(
                account_id,
                occurred_at,
                &format!("filler-{hit}-{filler}"),
                "4",
            ));
        }
        occurred_at += 1000;
        records.push(record(account_id, occurred_at, &format!("gold-{hit}"), "5"));
    }
    let inserted = repo.insert_records(&records).expect("插入应当成功");
    assert_eq!(inserted, records.len() as u64);

    // 官方权威基准：5 次出金（比如塔吉多式接口，字段形状与游戏无关）。
    repo.insert_banner_snapshot(&NewBannerSnapshot {
        account_id,
        banner_key: "301".to_string(),
        captured_at: occurred_at + 1,
        draw_count: Some(records.len() as i64),
        rare_count: Some(5),
        pity_current: None,
        pity_max: Some(90),
        origin: SnapshotOrigin::Authoritative,
        source: "tajiduo".to_string(),
        extra: None,
    })
    .expect("写入快照应当成功");

    // 派生前：视图必须表现出本次要修的假告警——用它作为本测试存在意义的
    // 直接证据，而不是空泛地断言"以前是空的"。
    let before = repo.integrity_report().expect("查询应当成功");
    let before_row = before
        .iter()
        .find(|row| row.banner_key == "301")
        .expect("应有一行 301 的完整性数据");
    assert_eq!(
        before_row.official_rares,
        Some(5),
        "官方基准应显示 5 次出金"
    );
    assert_eq!(
        before_row.local_rares, 0,
        "派生前 local_rares 恒为 0，这正是本次要修的假告警"
    );

    // 派生并写入。
    let group = character_event_wish_pity_group();
    let spec = genshin_rarity_spec();
    let stored_records = repo
        .find_records_by_pity_group(account_id, &group.key)
        .expect("查询应当成功");
    let derived = derive_rare_events(&group, &spec, &stored_records);
    assert_eq!(
        derived.events.len(),
        5,
        "5 次命中 rarity=5 的记录应当派生出 5 条出金事件"
    );
    assert_eq!(
        derived.unknown_rarity_count, 0,
        "这批记录没有稀有度未知的，组维度计数应为 0"
    );

    let written = repo
        .replace_derived_rare_events(account_id, &group.key, &derived.events)
        .expect("写入应当成功");
    assert_eq!(written, 5);

    // 派生后：v_integrity 不再撒谎。
    let after = repo.integrity_report().expect("查询应当成功");
    let after_row = after
        .iter()
        .find(|row| row.banner_key == "301")
        .expect("应有一行 301 的完整性数据");
    assert_eq!(after_row.official_rares, Some(5));
    assert_eq!(
        after_row.local_rares, 5,
        "派生后 local_rares 应与 official_rares 对得上"
    );
}

#[test]
fn re_deriving_after_new_records_arrive_recomputes_without_duplicating_old_hits() {
    // 模拟增量采集场景：第一批只有 2 次出金，派生一次；随后又采集到更多
    // 记录（含第 3 次出金），再派生一次——旧的两条派生结果应当被替换掉，
    // 不是在旁边多出三条、变成 5 条。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = repo
        .create_account(&NewAccount {
            plugin_id: "genshin".to_string(),
            game_uid: "100000001".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: Some(168),
            created_at: 1_754_800_000_000,
        })
        .expect("创建账号应当成功");

    let group = character_event_wish_pity_group();
    let spec = genshin_rarity_spec();

    let first_batch = vec![
        record(account_id, 1000, "角色A", "4"),
        record(account_id, 2000, "金卡1", "5"),
        record(account_id, 3000, "金卡2", "5"),
    ];
    repo.insert_records(&first_batch).expect("插入应当成功");
    let stored = repo
        .find_records_by_pity_group(account_id, &group.key)
        .expect("查询应当成功");
    let derived = derive_rare_events(&group, &spec, &stored);
    repo.replace_derived_rare_events(account_id, &group.key, &derived.events)
        .expect("首次写入应当成功");

    let after_first = repo
        .find_rare_events_by_pity_group(account_id, &group.key)
        .expect("查询应当成功");
    assert_eq!(after_first.len(), 2);

    let second_batch = vec![record(account_id, 4000, "金卡3", "5")];
    repo.insert_records(&second_batch).expect("插入应当成功");
    let stored = repo
        .find_records_by_pity_group(account_id, &group.key)
        .expect("查询应当成功");
    let derived = derive_rare_events(&group, &spec, &stored);
    assert_eq!(
        derived.events.len(),
        3,
        "重新派生应基于全部记录得到 3 次出金"
    );
    repo.replace_derived_rare_events(account_id, &group.key, &derived.events)
        .expect("重算写入应当成功");

    let rows = repo
        .find_rare_events_by_pity_group(account_id, &group.key)
        .expect("查询应当成功");
    assert_eq!(rows.len(), 3, "全量重算应替换旧结果，不是在旧结果上累加");
}
