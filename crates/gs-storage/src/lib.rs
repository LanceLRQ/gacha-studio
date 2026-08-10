//! `gs-storage`：SQLite 存储引擎骨架。
//!
//! 账号 / 卡池 / 记录表的具体 schema（公共字段 + `extra` JSON 列的模式）
//! 需要先用 `HoYo.Gacha` 等参考项目的真实实现校准，本阶段只落地连接管理
//! 与 pragma 初始化，不提前定义任何业务表结构，避免校准之前产出需要
//! 返工的实现代码。

use gs_core::GsError;
use rusqlite::Connection;

/// SQLite 连接的最小封装：负责开启连接与设置宿主要求的 pragma。
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

    fn from_connection(conn: Connection) -> Result<Self, GsError> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|err| GsError::Storage(err.to_string()))?;
        Ok(Self { conn })
    }

    /// 查询当前连接的 `foreign_keys` pragma 是否已开启。
    /// 仅用于骨架阶段自证连接可用，正式的存储契约留待 schema 落地后设计。
    pub fn foreign_keys_enabled(&self) -> Result<bool, GsError> {
        let enabled: i64 = self
            .conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .map_err(|err| GsError::Storage(err.to_string()))?;
        Ok(enabled == 1)
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
}
