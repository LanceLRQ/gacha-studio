//! 去重契约里的记录标识：`UNIQUE(account_id, record_key)`。
//!
//! `record_key` 由插件产出，本类型只负责宿主侧最基本的约束——非空、去除首尾
//! 空白后不为空——具体生成算法留给各插件的 `deriveRecordKey` hook，不在这里
//! 假设任何游戏专属格式。
//!
//! ⚠️ 米哈游三游**不可裸用服务端雪花 ID**作为 record_key。服务端 ID 在跨端点
//! 场景会重复——星铁联动池走独立端点 `getLdGachaLog`，与常规端点各自编号，
//! 裸用雪花 ID 会导致 `INSERT OR IGNORE` 静默丢记录。这不是推测：参考实现
//! HoYo.Gacha 上线时主键就是 `(business,uid,id)`，一年后为此付出过一次整表
//! 重建迁移，把主键改成了 `(business,uid,id,gacha_type)`。因此米哈游三游插件
//! 必须实现 `deriveRecordKey`，把卡池维度并进去，形如 `` `${gachaType}:${id}` ``，
//! 不能把 `id`（雪花 ID）原样交给这里。

use crate::error::GsError;
use serde::{Deserialize, Serialize};
use std::fmt;
use ts_rs::TS;

/// 一条抽卡记录在账号维度下的稳定唯一标识。
///
/// 单字段元组结构体在 `serde_json` 里默认就会序列化成裸字符串（而不是
/// `{ "0": "..." }`），不需要额外的 `#[serde(transparent)]`——实测加上后
/// ts-rs 会打印 `failed to parse serde attribute: transparent` 警告，故不加。
/// `derive(TS)` 单独就能生成 `type RecordKey = string;`（newtype 透明别名，
/// 见 gs-codegen 顶部说明），同样不依赖这个 serde 属性。
///
/// 反序列化**不走** `derive(Deserialize)`，而是手写实现绕道 [`RecordKey::new`]。
///
/// 这不是洁癖：插件产出的 `record_key` 正是经反序列化进入宿主的。若空串能从
/// 这条路径混进来，`UNIQUE(account_id, record_key)` 会把多条记录判成同一条，
/// `INSERT OR IGNORE` 静默丢掉其余的——与裸用雪花 ID 撞键是同一类失败：
/// 不报错，只是少数据。有校验构造函数的类型，每条构造路径都得过校验。
///
/// 用手写实现而非 `#[serde(try_from = "String")]`，是因为后者会让 ts-rs 打印
/// `failed to parse serde attribute` 告警（它不认识这个属性，实测产物不受影响，
/// 但每次编译都刷一行噪音）。本项目 clippy 跑 `-D warnings`，构建输出保持干净
/// 才有信号价值，不值得为省十行代码换一条长期噪音。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, TS)]
pub struct RecordKey(String);

impl<'de> Deserialize<'de> for RecordKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

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
    fn rejects_blank_value_from_deserialization() {
        // 校验必须覆盖反序列化路径——插件产出的 record_key 正是走这条路进宿主的。
        let result: Result<RecordKey, _> = serde_json::from_str(r#""   ""#);
        assert!(result.is_err(), "空白 record_key 不得通过反序列化混入");

        let ok: RecordKey = serde_json::from_str(r#""301:1700000000000000000""#).expect("应当成功");
        assert_eq!(ok.as_str(), "301:1700000000000000000");
    }

    #[test]
    fn accepts_non_blank_value() {
        let key = RecordKey::new("20230101_snowflake_123").expect("应当构造成功");
        assert_eq!(key.as_str(), "20230101_snowflake_123");
        assert_eq!(key.to_string(), "20230101_snowflake_123");
    }
}
