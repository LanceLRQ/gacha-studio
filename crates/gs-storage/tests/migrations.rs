//! 迁移机制在 `Storage` 入口处的集成验证：空库能跑到最新版本，
//! 重复打开同一个文件数据库不报错（幂等，不会尝试重复建表），
//! 老库（缺少后来迁移新增的列）打开后能被机械补齐并正常读写。

mod common;

use common::{create_test_account, sample_record};
use gs_storage::Storage;
use std::fs;

#[test]
fn opens_a_fresh_file_database_and_reaches_latest_schema_version() {
    let path = common::temp_db_path("migration");
    let _ = fs::remove_file(&path);
    let path_str = path.to_str().expect("临时路径应当是合法 UTF-8");

    let version_after_first_open = {
        let storage = Storage::open(path_str).expect("首次打开应当成功建库");
        storage.schema_version().expect("应当能读取版本")
    };
    assert!(version_after_first_open > 0, "首次打开应当应用至少一条迁移");

    // 重新打开同一个文件：迁移必须是幂等的——不应报错，也不应重复建表
    // （重复执行 CREATE TABLE 本身就会因表已存在而报错，能跑通就证明
    // `skip(current_version)` 生效，没有重新执行已应用过的迁移）。
    let version_after_second_open = {
        let storage = Storage::open(path_str).expect("二次打开不应报错");
        storage.schema_version().expect("应当能读取版本")
    };
    assert_eq!(
        version_after_first_open, version_after_second_open,
        "已是最新版本的库重新打开不应改变版本号"
    );

    let _ = fs::remove_file(&path);
}

/// 老库（只应用到 0004，还没有 `stable_id`/`gacha_id` 两列）打开后应当被
/// 迁移补齐到最新版本，且补齐后的两列能正常读写——不能只验证 `user_version`
/// 数字变了，必须证明这两列在旧库上真的可用（`ALTER TABLE ADD COLUMN` 这类
/// DDL 如果漏应用，`INSERT`/`SELECT` 会直接报 "no such column"，而不是安静地
/// 返回空结果，这是比只看版本号更直接的证据）。
///
/// 手工构造只跑到 0004 的库，不能靠"打完整迁移再把 user_version 调低"伪造
/// ——那样表结构其实已经是最新的，测试会在"没有真的重跑 0005"时也假绿，
/// 与 backup.rs 里 `restore_reruns_migrations_when_backup_schema_is_older_
/// than_current` 同一个理由、同一种构造方式。
#[test]
fn opening_an_old_schema_database_backfills_stable_id_and_gacha_id_columns() {
    let path = common::temp_db_path("migration-old-schema-stable-gacha-id");
    let _ = fs::remove_file(&path);
    let path_str = path.to_str().expect("临时路径应当是合法 UTF-8");

    {
        let conn = rusqlite::Connection::open(&path).expect("应当能创建旧库文件");
        conn.execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("应当能执行 0001 迁移 SQL");
        conn.execute_batch(include_str!(
            "../migrations/0002_v_integrity_page_columns.sql"
        ))
        .expect("应当能执行 0002 迁移 SQL");
        conn.execute_batch(include_str!("../migrations/0003_app_setting.sql"))
            .expect("应当能执行 0003 迁移 SQL");
        conn.execute_batch(include_str!(
            "../migrations/0004_account_latest_record_at.sql"
        ))
        .expect("应当能执行 0004 迁移 SQL");
        conn.pragma_update(None, "user_version", 4_i64)
            .expect("应当能设置 user_version");
    }

    // 正常 `Storage::open`（不是备份恢复路径）也会推进未应用的迁移——
    // 与 `opens_a_fresh_file_database_and_reaches_latest_schema_version`
    // 验证的"空库跑到最新版本"是同一条代码路径，这里换成"半旧库"。
    let storage = Storage::open(path_str).expect("打开旧库应当成功并补齐迁移");
    assert!(
        storage.schema_version().expect("应当能读取版本") >= 5,
        "旧库打开后应当至少推进到 0005，具体最新版本号由 MIGRATIONS 列表决定"
    );

    let repo = storage.repository();
    let account_id = create_test_account(&repo, "starrail");
    let mut record = sample_record(account_id, "starrail:character-event", "11:old-schema");
    record.stable_id = Some("1500000000000000099".to_string());
    record.gacha_id = Some("2003".to_string());
    repo.insert_records(&[record])
        .expect("补齐迁移后应当能写入 stable_id/gacha_id 两列");

    let stored = repo
        .find_records_by_banner(account_id, "starrail:character-event")
        .expect("补齐迁移后应当能查询 stable_id/gacha_id 两列");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].stable_id.as_deref(), Some("1500000000000000099"));
    assert_eq!(stored[0].gacha_id.as_deref(), Some("2003"));

    drop(storage);
    let _ = fs::remove_file(&path);
}
