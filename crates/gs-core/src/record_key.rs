//! 去重契约里的记录标识：`UNIQUE(account_id, record_key)`。
//!
//! `record_key` 由插件产出（参见插件 SDK 设计文档第四节的三种参考实现：
//! 米哈游三游直用雪花 ID、鸣潮/异环各自的哈希拼接策略），本类型只负责
//! 宿主侧最基本的约束——非空、去除首尾空白后不为空——具体生成算法留给
//! 各插件的 `deriveRecordKey` hook，不在这里假设任何游戏专属格式。

use crate::error::GsError;
use std::fmt;

/// 一条抽卡记录在账号维度下的稳定唯一标识。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RecordKey(String);

impl RecordKey {
    /// 校验并构造一个 `RecordKey`。
    ///
    /// # Errors
    /// 当 `value` 去除首尾空白后为空字符串时返回 [`GsError::Validation`]。
    pub fn new(value: impl Into<String>) -> Result<Self, GsError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(GsError::Validation("record_key 不能为空".to_string()));
        }
        Ok(Self(value))
    }

    /// 返回内部字符串的只读引用。
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RecordKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_value() {
        let result = RecordKey::new("   ");
        assert!(matches!(result, Err(GsError::Validation(_))));
    }

    #[test]
    fn accepts_non_blank_value() {
        let key = RecordKey::new("20230101_snowflake_123").expect("应当构造成功");
        assert_eq!(key.as_str(), "20230101_snowflake_123");
        assert_eq!(key.to_string(), "20230101_snowflake_123");
    }
}
