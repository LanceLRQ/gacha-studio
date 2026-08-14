//! 备份点与回滚：往返一致性、回滚后重跑迁移、保留策略、失败路径。

mod common;

use common::{create_test_account, open_temp_storage, sample_record};
use gs_storage::BackupKind;
use std::fs;

#[test]
fn restore_returns_records_to_exact_state_at_backup_time() {
    let (mut storage, db_path) = open_temp_storage("backup-roundtrip");
    let backup_dir = std::env::temp_dir().join(format!(
        "gs-storage-backup-roundtrip-dir-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&backup_dir);

    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");
    let seed = vec![
        sample_record(account_id, "genshin:character-event", "301:snowflake_1"),
        sample_record(account_id, "genshin:character-event", "301:snowflake_2"),
        sample_record(account_id, "genshin:character-event", "301:snowflake_3"),
    ];
    repo.insert_records(&seed).expect("写入原始记录应当成功");
    // `seed` 里的 `id` 全是占位值 0（insert_records 会忽略它，真实主键由
    // SQLite 自增分配）——不能直接拿 `seed` 当"备份时刻的期望状态"去比对，
    // 否则会在 `id` 字段上必然失败。改为查回数据库刚写入后的真实状态，
    // 拿它作为回滚后应当精确复现的基准。
    let original = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(original.len(), 3);

    let backup_path = storage
        .create_backup(&backup_dir, BackupKind::Manual)
        .expect("建备份点应当成功");

    // 备份之后继续写入，制造与备份时刻的差异——不能只靠"条数变了"就通过，
    // 必须证明恢复后连这批新记录也一并消失，且原始三条的具体字段原样返回。
    let repo = storage.repository();
    let divergent = vec![sample_record(
        account_id,
        "genshin:character-event",
        "301:snowflake_after_backup",
    )];
    repo.insert_records(&divergent)
        .expect("写入分叉记录应当成功");
    let before_restore = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(before_restore.len(), 4, "回滚前应能看到分叉记录");

    storage
        .restore_backup(&backup_path)
        .expect("从备份恢复应当成功");

    let repo = storage.repository();
    let restored = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(restored, original, "恢复后应精确回到备份时刻的记录集合");

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_dir_all(&backup_dir);
}

#[test]
fn restore_reruns_migrations_when_backup_schema_is_older_than_current() {
    let (mut storage, db_path) = open_temp_storage("backup-old-schema");

    // 手工构造一个"只应用了 0001_initial 迁移"的旧库，模拟一份在 0002 迁移
    // 存在之前建立的历史备份——不能靠"打完整迁移再把 user_version 调低"来
    // 伪造，那样表结构其实已经是最新的，测试会在"没有真的重跑迁移"时也
    // 假绿。`include_str!` 在集成测试文件里按相对路径解析，直接复用同一份
    // 迁移 SQL，不需要 gs-storage 额外开放内部的迁移列表。
    let old_backup_path = std::env::temp_dir().join(format!(
        "gs-storage-old-schema-backup-{}.sqlite3",
        std::process::id()
    ));
    let _ = fs::remove_file(&old_backup_path);
    {
        let conn = rusqlite::Connection::open(&old_backup_path).expect("应当能创建旧库文件");
        conn.execute_batch(include_str!("../migrations/0001_initial.sql"))
            .expect("应当能执行 0001 迁移 SQL");
        conn.pragma_update(None, "user_version", 1_i64)
            .expect("应当能设置 user_version");
    }

    storage
        .restore_backup(&old_backup_path)
        .expect("从旧版本备份恢复应当成功");

    assert_eq!(
        storage.schema_version().expect("应当能读取版本"),
        2,
        "恢复后 schema 版本应当被迁移补齐到最新版本"
    );

    // `v_integrity` 的 page_count/page_size 两列是 0002 迁移才补上的
    // （在此之前只有 precision 一列）。`integrity_report` 的 SQL 显式
    // SELECT 了这两列——如果恢复后没有重跑迁移，这里会直接因为
    // "no such column: page_size" 报错，而不是安静地返回空结果集，
    // 因此这一步比只看 schema_version 更能直接证明"新版本才有的列存在"。
    storage
        .repository()
        .integrity_report()
        .expect("恢复后 v_integrity 应当已具备 page_size/page_count 列");

    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(&old_backup_path);
}

#[test]
fn automatic_backups_beyond_retention_are_pruned_oldest_first() {
    let (storage, db_path) = open_temp_storage("backup-retention");
    let backup_dir = std::env::temp_dir().join(format!(
        "gs-storage-backup-retention-dir-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&backup_dir);

    // 连续建 5 + 2 = 7 个自动备份点，只应保留最新的 5 个。
    let mut auto_paths = Vec::new();
    for _ in 0..7 {
        let path = storage
            .create_backup(&backup_dir, BackupKind::Automatic)
            .expect("建自动备份点应当成功");
        auto_paths.push(path);
    }

    let remaining: std::collections::HashSet<_> = fs::read_dir(&backup_dir)
        .expect("应当能读取备份目录")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .collect();

    assert_eq!(remaining.len(), 5, "自动备份点应只保留最新 5 份");

    // 前两个（最旧的）必须已被删除，后五个（最新的）必须都还在。
    for stale in &auto_paths[..2] {
        assert!(!remaining.contains(stale), "最旧的自动备份点应当被清理");
    }
    for fresh in &auto_paths[2..] {
        assert!(remaining.contains(fresh), "最新的自动备份点应当被保留");
    }

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_dir_all(&backup_dir);
}

#[test]
fn manual_backups_are_exempt_from_automatic_retention_cleanup() {
    let (storage, db_path) = open_temp_storage("backup-manual-exempt");
    let backup_dir = std::env::temp_dir().join(format!(
        "gs-storage-backup-manual-exempt-dir-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&backup_dir);

    let manual_path = storage
        .create_backup(&backup_dir, BackupKind::Manual)
        .expect("建手动备份点应当成功");

    // 建 7 个自动备份点，触发保留策略清理；手动备份点不应受影响。
    for _ in 0..7 {
        storage
            .create_backup(&backup_dir, BackupKind::Automatic)
            .expect("建自动备份点应当成功");
    }

    assert!(manual_path.is_file(), "手动备份点不应被自动清理删除");

    let auto_count = fs::read_dir(&backup_dir)
        .expect("应当能读取备份目录")
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("auto-"))
        })
        .count();
    assert_eq!(auto_count, 5, "自动备份点数量应当仍被收敛到 5");

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_dir_all(&backup_dir);
}

#[test]
fn create_backup_fails_gracefully_when_backup_dir_cannot_be_created() {
    let (storage, db_path) = open_temp_storage("backup-unwritable-dir");

    // 用一个已存在的普通文件冒充"备份目录"：`create_dir_all` 撞见同名的非
    // 目录路径分量会报错，借此在不依赖 chmod（跨平台行为不一致）的前提下
    // 稳定复现"目标目录不可写/不可建"的失败路径。
    let blocking_file = std::env::temp_dir().join(format!(
        "gs-storage-backup-blocking-file-{}",
        std::process::id()
    ));
    fs::write(&blocking_file, b"not a directory").expect("应当能创建占位文件");

    let result = storage.create_backup(&blocking_file, BackupKind::Manual);
    assert!(result.is_err(), "备份目录无法创建时应返回 Err 而不是 panic");

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(&blocking_file);
}

#[test]
fn restore_fails_gracefully_for_missing_backup_file() {
    let (mut storage, db_path) = open_temp_storage("backup-restore-missing");

    // 恢复尝试之前先落一批真实数据，失败之后要拿它逐条比对。
    // 这里原本没有任何前置数据，失败后只新建一个账号断言 `id > 0`——那证明的
    // 是"schema 还能用"，不是"原有数据还在"，与它自己的注释宣称的检查内容不符。
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");
    let seed = vec![
        sample_record(
            account_id,
            "genshin:character-event",
            "301:before_restore_1",
        ),
        sample_record(
            account_id,
            "genshin:character-event",
            "301:before_restore_2",
        ),
    ];
    repo.insert_records(&seed).expect("写入前置记录应当成功");
    let before = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(before.len(), 2, "自证前提：恢复尝试之前库里确实有数据");

    let missing_path = std::env::temp_dir().join(format!(
        "gs-storage-does-not-exist-{}.sqlite3",
        std::process::id()
    ));
    let _ = fs::remove_file(&missing_path);

    let result = storage.restore_backup(&missing_path);
    assert!(
        result.is_err(),
        "从不存在的备份文件恢复应返回 Err 而不是 panic"
    );

    // 更重要的是：数据没有因为这次失败尝试而被清空。`Connection::restore`
    // 内部是 `Connection::open(src)`，默认带 `SQLITE_OPEN_CREATE`——路径打错时
    // 它会先凭空造一个空库，再把这个空库覆盖到当前库上，静默抹掉全部数据。
    // `restore_backup` 里那道 `is_file()` 前置检查就是为此存在的，而这条断言
    // 是它唯一的把关点，因此必须逐条比对记录，不能只验证"还能写入新数据"。
    let repo = storage.repository();
    let after = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(after, before, "失败的恢复尝试不得改动当前库的任何一条记录");

    drop(storage);
    let _ = fs::remove_file(&db_path);
}

#[test]
fn restore_fails_gracefully_for_corrupt_backup_file() {
    let (mut storage, db_path) = open_temp_storage("backup-restore-corrupt");

    let corrupt_path = std::env::temp_dir().join(format!(
        "gs-storage-corrupt-backup-{}.sqlite3",
        std::process::id()
    ));
    fs::write(&corrupt_path, b"this is not a valid sqlite file at all")
        .expect("应当能写入损坏的占位文件");

    let result = storage.restore_backup(&corrupt_path);
    assert!(
        result.is_err(),
        "从损坏的备份文件恢复应返回 Err 而不是 panic"
    );

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(&corrupt_path);
}

#[test]
fn with_auto_backup_restores_state_when_action_fails() {
    let (mut storage, db_path) = open_temp_storage("backup-with-auto-backup");
    let backup_dir = std::env::temp_dir().join(format!(
        "gs-storage-with-auto-backup-dir-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&backup_dir);

    let account_id = {
        let repo = storage.repository();
        create_test_account(&repo, "genshin")
    };

    let outcome: Result<(), gs_core::GsError> =
        storage.with_auto_backup(&backup_dir, |repo| -> Result<(), String> {
            let record = sample_record(account_id, "genshin:character-event", "301:doomed");
            repo.insert_records(std::slice::from_ref(&record))
                .map_err(|err| err.to_string())?;
            Err("模拟业务失败".to_string())
        });

    assert!(
        outcome.is_err(),
        "action 失败时 with_auto_backup 应返回 Err"
    );

    let repo = storage.repository();
    let records = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert!(
        records.is_empty(),
        "action 失败后应已回滚，doomed 记录不应残留"
    );

    drop(storage);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_dir_all(&backup_dir);
}
