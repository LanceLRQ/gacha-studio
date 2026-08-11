//! `record_key` 幂等性 + 空串→NULL 归一化。
//!
//! 两条都是贯穿全程的正确性断言（`milestones/00-实施总览.md` §8.3），
//! 存储层是最终落盘前的一道关口，不单点信任上游归一化层已经做对。

mod common;

use common::{create_test_account, sample_record};
use gs_storage::Storage;

#[test]
fn inserting_same_record_key_twice_does_not_create_a_second_row() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let record = sample_record(account_id, "genshin:character-event", "301:snowflake_123");

    let first_pass = repo
        .insert_records(std::slice::from_ref(&record))
        .expect("首次插入应当成功");
    assert_eq!(first_pass, 1, "首次插入应当新增 1 行");

    let second_pass = repo
        .insert_records(std::slice::from_ref(&record))
        .expect("重复插入不应报错");
    assert_eq!(second_pass, 0, "同一条实际记录任意次插入都不应产生第二行");

    let stored = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(
        stored.len(),
        1,
        "UNIQUE(account_id, record_key) 应保证只有一行落库"
    );
}

#[test]
fn empty_string_rarity_is_normalized_to_null_on_write() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "starrail");

    let mut record = sample_record(account_id, "starrail:character-event", "11:snowflake_456");
    // 星铁真实存档实测场景：item_id 有值，但 rank_type 是空字符串
    // （新角色上线当日官方字典未同步），见 research/03 §1.3。
    record.rarity = Some(String::new());

    repo.insert_records(&[record]).expect("插入应当成功");

    let stored = repo
        .find_records_by_banner(account_id, "starrail:character-event")
        .expect("查询应当成功");
    assert_eq!(stored.len(), 1);
    assert_eq!(
        stored[0].rarity, None,
        "空串必须在写入前转换为 NULL——空串会一路通过非空校验，只有 NULL 才强制显式处理"
    );
}

#[test]
fn inserting_a_full_archive_sized_batch_does_not_exceed_sqlite_variable_limit() {
    // 5372 是星铁真实存档的实测条数（research/03）。导入路径（UIGF / 伙伴工具同步）
    // 会一次性交进来这个量级，而多值 INSERT 的占位符个数是 条数 × 19，
    // 5372 条就是 102068 个变量，远超 SQLite 的 SQLITE_MAX_VARIABLE_NUMBER。
    // 分页采集每页 20 条撞不到这个上限，所以它只会在导入时才炸——
    // 正是那种"测试全绿、真实数据一跑就挂"的坑。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "starrail");

    let records: Vec<_> = (0..5372)
        .map(|i| sample_record(account_id, "starrail:character-event", &format!("11:{i}")))
        .collect();

    let inserted = repo.insert_records(&records).expect("整份存档量级的批量插入应当成功");
    assert_eq!(inserted, 5372, "所有记录都应当写入");
}
