//! `gs-storage`：SQLite 存储引擎。
//!
//! 8 张表 + 2 个视图落地存储数据模型设计文档 §3、§4.4、§5.2 的完整契约：
//! `account`、`gacha_record`、`rare_event`、`banner_snapshot`、`item_catalog`、
//! `banner_meta`、`collect_session`、`raw_payload`，以及 `v_integrity` /
//! `v_unknown_banner` 两个视图。建表 SQL 见 `migrations/0001_initial.sql`，
//! 版本管理见 [`migrations`] 模块（`PRAGMA user_version` + 编译期内嵌 SQL）；
//! 读写接口见 [`repository`] 模块。

mod credential_guard;
mod migrations;
pub mod repository;

use gs_core::GsError;
use rusqlite::Connection;

pub use repository::{
    Account, IntegrityRow, NewAccount, NewBannerMeta, NewBannerSnapshot, NewCollectSession,
    NewRawPayload, Repository, SnapshotOrigin, UnknownBannerRow,
};

/// SQLite 连接的封装：负责开启连接、设置宿主要求的 pragma、把 schema
/// 推进到最新版本。
pub struct Storage {
    conn: Connection,
}

impl Storage {
    /// 打开一个仅存在于内存中的数据库，用于测试与本阶段的骨架验证。
    pub fn open_in_memory() -> Result<Self, GsError> {
        let conn =
            Connection::open_in_memory().map_err(|err| GsError::Storage(err.to_string()))?;
        Self::from_connection(conn)
    }

    /// 打开（或创建）指定路径下的数据库文件。
    pub fn open(path: &str) -> Result<Self, GsError> {
        let conn = Connection::open(path).map_err(|err| GsError::Storage(err.to_string()))?;
        Self::from_connection(conn)
    }

    fn from_connection(mut conn: Connection) -> Result<Self, GsError> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|err| GsError::Storage(err.to_string()))?;
        migrations::apply_migrations(&mut conn)?;
        Ok(Self { conn })
    }

    /// 查询当前连接的 `foreign_keys` pragma 是否已开启。
    pub fn foreign_keys_enabled(&self) -> Result<bool, GsError> {
        let enabled: i64 = self
            .conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .map_err(|err| GsError::Storage(err.to_string()))?;
        Ok(enabled == 1)
    }

    /// 查询当前 schema 版本（`PRAGMA user_version`），供迁移相关的断言使用。
    pub fn schema_version(&self) -> Result<u32, GsError> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|err| GsError::Storage(err.to_string()))?;
        Ok(version.max(0) as u32)
    }

    /// 获取读写接口。生命周期借用 `self`，不允许比 `Storage` 活得更久。
    pub fn repository(&self) -> Repository<'_> {
        Repository::new(&self.conn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_in_memory_database_with_foreign_keys_enabled() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        assert!(storage.foreign_keys_enabled().expect("应当能读取 pragma"));
    }

    #[test]
    fn opens_in_memory_database_at_latest_schema_version() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        assert_eq!(
            storage.schema_version().expect("应当能读取版本"),
            migrations::MIGRATIONS.len() as u32
        );
    }
}
