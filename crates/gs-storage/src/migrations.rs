//! Schema 版本管理：`PRAGMA user_version` + 编译期内嵌的迁移 SQL。
//!
//! 五个要点照抄 HoYo.Gacha 的成熟做法
//! （`research/05-HoYo.Gacha存储层与交换格式校准.md` §八）：
//! ① 版本号用 `PRAGMA user_version`，不另建 migrations 表；
//! ② 迁移列表即顺序，`skip(version)` 应用尚未执行的那些；
//! ③ SQL 用 `include_str!` 编译期内嵌，二进制自带，不依赖运行时文件；
//! ④ 每个迁移自带事务 + savepoint；
//! ⑤ 改主键这类 SQLite 不支持的 DDL，未来迁移走
//!   rename → create new → `INSERT...SELECT` → drop old（本文件目前只有
//!   一条初始迁移，尚未用到这一模式，留作后续迁移的参照）。
//!
//! 有意不照抄的一处：参考实现的批量入库是逐条 `execute` 循环，我方在
//! `repository.rs` 的 `insert_records` 里用批量多值 `INSERT`——这与迁移机制
//! 本身无关，只是同一份校准材料里一并提到，故不在此重复。

use gs_core::GsError;
use rusqlite::Connection;

/// 一条迁移。`name` 只用于错误信息定位，实际应用顺序由数组下标决定。
pub(crate) struct Migration {
    name: &'static str,
    sql: &'static str,
}

/// 迁移列表即顺序。新增迁移只能追加到末尾，不能重排或删除历史条目——
/// `PRAGMA user_version` 记录的是"已应用到第几条"，重排会让旧库跳过本该
/// 应用的迁移，或者把已经生效过的迁移再套一遍。
///
/// 可见性是 `pub(crate)` 而非私有：`lib.rs` 的测试需要用 `MIGRATIONS.len()`
/// 断言"已在最新版本"，避免在测试里硬编码迁移条数。
pub(crate) const MIGRATIONS: &[Migration] = &[Migration {
    name: "0001_initial",
    sql: include_str!("../migrations/0001_initial.sql"),
}];

/// 把连接从当前 `user_version` 推进到 [`MIGRATIONS`] 的最新版本。
///
/// 每条迁移用一个具名 SAVEPOINT 包裹：当前不在事务中时，最外层 SAVEPOINT
/// 会隐式开启一个事务，`RELEASE` 时提交——效果上等价于"迁移自带事务"，
/// 同时保留了 SAVEPOINT 语义本身（为将来某条迁移内部需要嵌套回滚点、
/// 或者在同一连接会话里追加应用下一条迁移时留出空间）。
///
/// 空库（`user_version = 0`）与已是最新版本的库都能安全调用：前者应用
/// 全部迁移，后者因为 `skip(current_version)` 跳过所有条目而直接返回。
pub(crate) fn apply_migrations(conn: &mut Connection) -> Result<(), GsError> {
    let current_version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|err| GsError::Storage(err.to_string()))?;
    // user_version 不可能为负，但类型是有符号整数，兜底钳制到 0 避免
    // `as usize` 在异常数据下溢出回绕。
    let current_version = current_version.max(0) as usize;

    for (offset, migration) in MIGRATIONS.iter().enumerate().skip(current_version) {
        let next_version = (offset + 1) as i64;
        let savepoint = conn
            .savepoint()
            .map_err(|err| GsError::Storage(err.to_string()))?;
        savepoint.execute_batch(migration.sql).map_err(|err| {
            GsError::Storage(format!("迁移 `{}` 执行失败: {err}", migration.name))
        })?;
        savepoint
            .pragma_update(None, "user_version", next_version)
            .map_err(|err| GsError::Storage(err.to_string()))?;
        savepoint
            .commit()
            .map_err(|err| GsError::Storage(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_all_migrations_from_empty_database() {
        let mut conn = Connection::open_in_memory().expect("应当成功打开内存数据库");
        apply_migrations(&mut conn).expect("应当成功应用全部迁移");

        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("应当能读取版本");
        assert_eq!(version, MIGRATIONS.len() as i64);

        // 建表确实生效：8 张表 + 2 个视图应当都能在 sqlite_master 里查到。
        let object_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'view')",
                [],
                |row| row.get(0),
            )
            .expect("应当能查询 sqlite_master");
        assert_eq!(object_count, 10, "应有 8 张表 + 2 个视图");
    }

    #[test]
    fn reapplying_migrations_on_up_to_date_database_is_a_no_op() {
        let mut conn = Connection::open_in_memory().expect("应当成功打开内存数据库");
        apply_migrations(&mut conn).expect("首次应用应当成功");
        // 幂等性：已是最新版本时再跑一次不应报错（不会尝试重复建表）。
        apply_migrations(&mut conn).expect("重复应用不应报错");

        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("应当能读取版本");
        assert_eq!(version, MIGRATIONS.len() as i64);
    }
}
