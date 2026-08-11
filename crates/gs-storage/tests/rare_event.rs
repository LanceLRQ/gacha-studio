//! `rare_event` 写入/查询契约：
//! - `replace_derived_rare_events` 全量重算替换 `origin='derived'` 的行，
//!   绝不触碰 `origin='authoritative'` 的行；
//! - `find_rare_events_by_pity_group` 按 `occurred_at` 升序返回；
//! - `is_rate_up` 的 `NULL` 读出来必须是 `None`，不能被悄悄转成 `Some(false)`。

mod common;

use common::create_test_account;
use gs_storage::{NewRareEvent, SnapshotOrigin, Storage};

/// 一条派生出金事件。`record_id` 留空——这组测试只验证 `replace`/`delete`
/// 的集合语义，不建立真实的 `gacha_record` 行；`record_id` 有外键约束，
/// 填一个当前测试库里不存在的 id 会触发外键错误。`record_id` 的真实链路
/// 由 `gs-analysis` 的端到端集成测试覆盖（先插入真实 `gacha_record`，再用
/// 返回的自增 id 派生）。
fn derived_event(
    account_id: i64,
    pity_group: &str,
    occurred_at: i64,
    item_id: &str,
) -> NewRareEvent {
    NewRareEvent {
        account_id,
        banner_key: "301".to_string(),
        pity_group: pity_group.to_string(),
        occurred_at,
        item_id: item_id.to_string(),
        rarity: "5".to_string(),
        pity_count: Some(74),
        is_rate_up: None,
        origin: SnapshotOrigin::Derived,
        source: "derived:pity".to_string(),
        record_id: None,
        extra: None,
    }
}

#[test]
fn replace_derived_rare_events_recomputes_full_set_and_orders_by_occurred_at() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let first_pass = vec![
        derived_event(account_id, "characterEventWish", 2000, "角色B"),
        derived_event(account_id, "characterEventWish", 1000, "角色A"),
    ];
    let inserted = repo
        .replace_derived_rare_events(account_id, "characterEventWish", &first_pass)
        .expect("首次写入应当成功");
    assert_eq!(inserted, 2);

    let rows = repo
        .find_rare_events_by_pity_group(account_id, "characterEventWish")
        .expect("查询应当成功");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].occurred_at, 1000, "应当按 occurred_at 升序返回");
    assert_eq!(rows[1].occurred_at, 2000);

    // 重算：新结果只有一条命中（比如重新识别后判定不同）。
    let second_pass = vec![derived_event(
        account_id,
        "characterEventWish",
        3000,
        "角色C",
    )];
    let inserted = repo
        .replace_derived_rare_events(account_id, "characterEventWish", &second_pass)
        .expect("重算应当成功");
    assert_eq!(inserted, 1);

    let rows = repo
        .find_rare_events_by_pity_group(account_id, "characterEventWish")
        .expect("查询应当成功");
    assert_eq!(
        rows.len(),
        1,
        "全量重算应当替换掉旧的 derived 行，不是在旧行基础上追加"
    );
    assert_eq!(rows[0].item_id, "角色C");
}

#[test]
fn replace_derived_rare_events_never_deletes_authoritative_rows() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "nte");

    let authoritative = NewRareEvent {
        account_id,
        banner_key: "nte:limited".to_string(),
        pity_group: "nte:limited".to_string(),
        occurred_at: 500,
        item_id: "charid-1".to_string(),
        rarity: "5".to_string(),
        pity_count: Some(59),
        is_rate_up: Some(true),
        origin: SnapshotOrigin::Authoritative,
        source: "tajiduo".to_string(),
        record_id: None,
        extra: None,
    };
    repo.insert_rare_event(&authoritative)
        .expect("写入权威数据应当成功");

    let derived = vec![derived_event(account_id, "nte:limited", 900, "charid-2")];
    repo.replace_derived_rare_events(account_id, "nte:limited", &derived)
        .expect("写入 derived 应当成功");

    let rows = repo
        .find_rare_events_by_pity_group(account_id, "nte:limited")
        .expect("查询应当成功");
    assert_eq!(rows.len(), 2, "权威行必须还在，derived 行也应当写入成功");
    assert!(
        rows.iter()
            .any(|row| row.origin == "authoritative" && row.item_id == "charid-1")
    );
    assert!(
        rows.iter()
            .any(|row| row.origin == "derived" && row.item_id == "charid-2")
    );

    // 再重算一次 derived（这次结果为空集），权威行必须完好无损——
    // 这是"永远不删 authoritative"这条约束最容易被破坏的场景：如果 DELETE
    // 语句忘了带 `origin = 'derived'` 这个条件，空结果的重算会把权威行也删掉。
    repo.replace_derived_rare_events(account_id, "nte:limited", &[])
        .expect("重算为空集也应当成功");
    let rows = repo
        .find_rare_events_by_pity_group(account_id, "nte:limited")
        .expect("查询应当成功");
    assert_eq!(rows.len(), 1, "derived 行应被清空，权威行必须还在");
    assert_eq!(rows[0].origin, "authoritative");
}

#[test]
fn is_rate_up_null_round_trips_as_none_not_false() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let events = vec![derived_event(
        account_id,
        "characterEventWish",
        1000,
        "角色A",
    )];
    repo.replace_derived_rare_events(account_id, "characterEventWish", &events)
        .expect("写入应当成功");

    let rows = repo
        .find_rare_events_by_pity_group(account_id, "characterEventWish")
        .expect("查询应当成功");
    assert_eq!(
        rows[0].is_rate_up, None,
        "写 NULL 时读出来必须是 None，不能被悄悄转成 Some(false)"
    );
}

#[test]
fn is_rate_up_true_and_false_round_trip_distinctly_from_null() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "nte");

    repo.insert_rare_event(&NewRareEvent {
        account_id,
        banner_key: "nte:limited".to_string(),
        pity_group: "nte:limited".to_string(),
        occurred_at: 100,
        item_id: "charid-up".to_string(),
        rarity: "5".to_string(),
        pity_count: Some(60),
        is_rate_up: Some(true),
        origin: SnapshotOrigin::Authoritative,
        source: "tajiduo".to_string(),
        record_id: None,
        extra: None,
    })
    .expect("写入应当成功");
    repo.insert_rare_event(&NewRareEvent {
        account_id,
        banner_key: "nte:limited".to_string(),
        pity_group: "nte:limited".to_string(),
        occurred_at: 200,
        item_id: "charid-off".to_string(),
        rarity: "5".to_string(),
        pity_count: Some(90),
        is_rate_up: Some(false),
        origin: SnapshotOrigin::Authoritative,
        source: "tajiduo".to_string(),
        record_id: None,
        extra: None,
    })
    .expect("写入应当成功");

    let rows = repo
        .find_rare_events_by_pity_group(account_id, "nte:limited")
        .expect("查询应当成功");
    assert_eq!(rows[0].is_rate_up, Some(true));
    assert_eq!(rows[1].is_rate_up, Some(false));
}
