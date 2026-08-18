//! `Repository::monthly_activity` 的真实存储集成测试——走内存 SQLite +
//! 真实 `insert_records` + 真实聚合 SQL，不测纯函数（这个方法本身就是一条
//! SQL 语句，没有可单独抽出的纯函数部分可测）。

mod common;

use common::{create_test_account, sample_record};
use gs_core::GachaRecord;
use gs_storage::{NewAccount, Storage};

/// 2026-08-15T10:00:00Z 与 2026-08-31T23:59:00Z——同属 8 月，用来验证月内
/// 多条记录被聚合进同一行，而不是聚合成同一条记录。
const AUG_15: i64 = 1_786_788_000_000;
const AUG_31_LATE: i64 = 1_788_220_740_000;
/// 2026-09-01T00:01:00Z——比上面两个都晚，且跨进 9 月，用来验证按月分桶
/// 不是简单地按"同一天"或"最近 N 天"分组。
const SEP_01_EARLY: i64 = 1_788_220_860_000;
const SEP_20: i64 = 1_789_898_400_000;

fn record_at(account_id: i64, occurred_at: i64, rarity: &str, record_key: &str) -> GachaRecord {
    GachaRecord {
        occurred_at,
        rarity: Some(rarity.to_string()),
        ..sample_record(account_id, "301", record_key)
    }
}

#[test]
fn monthly_activity_aggregates_draws_and_top_tier_hits_per_calendar_month() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    // 8 月：3 条记录，其中 1 条命中顶级稀有度 "5"。
    repo.insert_records(&[
        record_at(account_id, AUG_15, "3", "aug-1"),
        record_at(account_id, AUG_15, "3", "aug-2"),
        record_at(account_id, AUG_31_LATE, "5", "aug-3"),
    ])
    .expect("插入 8 月记录应当成功");

    // 9 月：2 条记录，其中 1 条命中。
    repo.insert_records(&[
        record_at(account_id, SEP_01_EARLY, "4", "sep-1"),
        record_at(account_id, SEP_20, "5", "sep-2"),
    ])
    .expect("插入 9 月记录应当成功");

    let months = repo
        .monthly_activity(account_id, "5")
        .expect("月度聚合查询应当成功");

    assert_eq!(
        months.len(),
        2,
        "应当恰好聚合出两个自然月，不是按记录条数逐条返回"
    );
    assert_eq!(months[0].month, "2026-08");
    assert_eq!(months[0].draws, 3);
    assert_eq!(months[0].top_tier_hits, 1);
    assert_eq!(months[1].month, "2026-09");
    assert_eq!(months[1].draws, 2);
    assert_eq!(months[1].top_tier_hits, 1);
}

#[test]
fn monthly_activity_only_counts_top_tier_hits_for_the_rarity_passed_in() {
    // 绝区零形态的回归防护：顶级稀有度码不是字面量 "5"，调用方传什么就该
    // 按什么算，本方法不得内置任何具体游戏的稀有度常量。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "zzz");

    repo.insert_records(&[
        record_at(account_id, AUG_15, "2", "zzz-1"),
        record_at(account_id, AUG_15, "4", "zzz-2"), // 绝区零顶级是 "4"，不是 "5"
    ])
    .expect("插入应当成功");

    let months_wrong_target = repo
        .monthly_activity(account_id, "5")
        .expect("查询应当成功");
    assert_eq!(
        months_wrong_target[0].top_tier_hits, 0,
        "传错稀有度码（用米哈游三游的\"5\"去查绝区零）应当查出 0 命中，不是意外命中"
    );

    let months_correct_target = repo
        .monthly_activity(account_id, "4")
        .expect("查询应当成功");
    assert_eq!(months_correct_target[0].top_tier_hits, 1);
}

#[test]
fn monthly_activity_scopes_to_the_requested_account_only() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let first = create_test_account(&repo, "genshin");
    // 不能直接再调用一次 create_test_account——它固定用
    // game_uid: "100000000"，与 first 撞 UNIQUE(plugin_id, game_uid, region)。
    let second = repo
        .create_account(&NewAccount {
            plugin_id: "genshin".to_string(),
            game_uid: "200000000".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: Some(168),
            created_at: 1_754_800_000_000,
        })
        .expect("创建第二个测试账号应当成功");

    repo.insert_records(&[record_at(first, AUG_15, "5", "acc-1")])
        .expect("插入应当成功");
    repo.insert_records(&[record_at(second, AUG_15, "5", "acc-2")])
        .expect("插入应当成功");

    let months = repo.monthly_activity(first, "5").expect("查询应当成功");
    assert_eq!(months.len(), 1);
    assert_eq!(months[0].draws, 1, "不应把另一个账号的记录也聚合进来");
}
