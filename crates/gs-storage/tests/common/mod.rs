//! 集成测试共用的构造函数，避免每个测试文件重复拼一遍
//! `GachaRecord` 的 21 个字段。
//!
//! `allow(dead_code)`：Rust 的集成测试是**每个 tests/*.rs 一个独立编译单元**，
//! `mod common` 会在每个单元里各编译一遍，用不到全部函数的那些单元就会报
//! dead_code。这是共享测试助手的固有形态，不是真的有死代码。

#![allow(dead_code)]

use gs_core::{GachaRecord, MetaState, RecordKey, RecordSource, TzOrigin};
use gs_storage::{NewAccount, Repository, Storage};
use std::path::PathBuf;

/// 生成一个不与其他测试冲突的临时数据库文件路径，调用方负责用完后
/// `fs::remove_file` 清理。用进程 id + 纳秒时间戳拼路径：`label` 区分不同
/// 测试文件（方便在临时目录里定位是谁留下的），pid + 纳秒时间戳保证同一
/// `label` 下反复调用（同一个测试函数需要多个独立临时库）也不会撞名。
pub fn temp_db_path(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "gs-storage-{label}-{}-{nanos}.sqlite3",
        std::process::id()
    ))
}

/// 打开一个全新的临时文件数据库，返回 `(Storage, 文件路径)`。调用方用完后
/// 应 `fs::remove_file(&path)` 清理，避免临时目录堆积测试产物。
pub fn open_temp_storage(label: &str) -> (Storage, PathBuf) {
    let path = temp_db_path(label);
    let _ = std::fs::remove_file(&path);
    let path_str = path.to_str().expect("临时路径应当是合法 UTF-8");
    let storage = Storage::open(path_str).expect("应当成功打开临时文件数据库");
    (storage, path)
}

/// 建一个测试账号，返回自增 `id`。`gacha_record.account_id` 有外键约束，
/// 测试里插记录前必须先有一行账号。
pub fn create_test_account(repo: &Repository<'_>, plugin_id: &str) -> i64 {
    repo.create_account(&NewAccount {
        plugin_id: plugin_id.to_string(),
        game_uid: "100000000".to_string(),
        region: "official".to_string(),
        display_name: None,
        retention_days: Some(168),
        created_at: 1_754_800_000_000,
    })
    .expect("创建测试账号应当成功")
}

/// 一条"看起来合理"的记录，字段取值均为占位值，调用方按需用结构体更新
/// 语法覆盖需要变化的字段。`id` 固定为 0——写入路径会忽略它。
pub fn sample_record(account_id: i64, banner_key: &str, record_key: &str) -> GachaRecord {
    GachaRecord {
        id: 0,
        account_id,
        banner_key: banner_key.to_string(),
        pity_group: format!("{banner_key}-shared"),
        record_key: RecordKey::new(record_key).expect("测试用 record_key 不应为空"),
        lang: Some("zh-cn".to_string()),
        occurred_at: 1_754_812_800_000,
        occurred_raw: "2026-08-10 12:00:00".to_string(),
        tz_origin: TzOrigin::Region,
        tz_offset_min: Some(480),
        seq_in_batch: None,
        item_id: "10001".to_string(),
        item_type: Some("角色".to_string()),
        rarity: Some("5".to_string()),
        qty: 1,
        meta_state: MetaState::Complete,
        source: RecordSource::OfficialApi,
        captured_at: 1_754_812_801_000,
        raw_ref: None,
        extra: None,
        stable_id: None,
        gacha_id: None,
    }
}
