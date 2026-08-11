//! 采集流程相关的**纯数据**类型。
//!
//! 采集流程本身（分页拉取、限速重试、时区推断）是范式层（`crates/paradigms/*`）
//! 的执行逻辑，不在 `gs-core`；本模块只定义流程会读取的**配置形状**，供插件在
//! manifest 里声明式地描述「这个游戏的采集参数是什么」。判断某个字段该不该放
//! 在这里的测试：换一个游戏，这组参数还讲得通吗？讲得通就是配置（放这里），
//! 讲不通（比如某个游戏专属的字节偏移量）就是插件私有声明，不进这个模块。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// 分页拉取时的限速参数，全部可选——省略的字段由范式层套用内置默认值。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub per_page_delay_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub batch_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub batch_delay_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub retry: Option<RetryConfig>,
}

/// 请求失败后的重试策略。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RetryConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_attempts: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub backoff: Option<BackoffKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub delay_ms: Option<u64>,
}

/// 重试间隔的增长方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum BackoffKind {
    Fixed,
    Exponential,
}

/// 采集请求失败时，把底层错误归类为语义化的处理建议。
///
/// 与 [`crate::error::AcquireError`] 的区别：这里是范式层在采集循环里做的
/// **实时分类**（决定要不要继续重试、要不要中止），`AcquireError` 是面向
/// 界面渲染引导的结构化错误，二者服务的读者不同，不能合并。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ErrorSemantic {
    AuthkeyExpired,
    RateLimited,
    Unknown,
}

/// 分页拉取的停止条件。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum StopCondition {
    /// 请求返回了空页。
    EmptyPage {},
    /// 分页游标（如 `end_id`）耗尽，接口明确表示没有下一页了。
    CursorExhausted {},
    /// 拉到了已经采集过的记录——增量同步场景下的正常停止点。
    ReachedKnown {},
}

/// 原始时间字符串的换算相关配置。
///
/// 不派生 `Copy`：`timezone_source` 携带 `TimezoneSource::StaticTable` 时内含
/// `BTreeMap`，是堆分配的，不满足 `Copy` 的按位复制语义。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TimeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw_time_convention: Option<RawTimeConvention>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timezone_source: Option<TimezoneSource>,
}

/// 原始时间字符串遵循的约定。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum RawTimeConvention {
    /// 服务端本地时间，不带时区标注（米哈游三游、鸣潮的常见形态）。
    ServerLocal,
    /// 客户端已经按某个时区本地化过的时间字符串。
    ClientLocalized,
}

/// 时区信息从哪里推断——三个米哈游参考工具时区可得性完全不一致
/// （星铁有 `region` + `region_time_zone`，绝区零只有 `region_time_zone`，
/// 原神两者都没有），因此不能假设只有一种来源，必须是判别联合。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum TimezoneSource {
    /// 时区信息就在响应体的某个字段里，直接读取。
    ApiField { field: String },
    /// 接口不返回时区，用静态表按区服/服务器标识查表。
    StaticTable {
        #[ts(type = "Record<string, number>")]
        table: BTreeMap<String, i32>,
    },
    /// 既没有字段也没有静态表能用，需要按其他信号（如 IP、账号地区）计算推断。
    Computed {},
}

/// 采集前置条件的重要程度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PreconditionLevel {
    /// 不满足就无法采集，必须阻断流程。
    Required,
    /// 不满足会降低采集质量或体验，但流程可以继续。
    Recommended,
}

/// 单个前置条件的检测结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum PreconditionStatus {
    Satisfied {},
    /// 检测到了具体的不满足状态，`actual` 携带实测值供界面展示
    /// （如「游戏窗口分辨率 1024x768，低于建议的 1280x720」）。
    Unsatisfied {
        actual: String,
    },
    /// 该前置条件本身无法检测（如权限不足、平台不支持）。
    Unknown {},
}

/// 采集时探测到的宿主环境信息，供前置条件检测使用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct HostEnv {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub game_client_size: Option<GameClientSize>,
    pub installed_dependencies: Vec<String>,
}

/// 游戏客户端窗口尺寸，像素为单位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GameClientSize {
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_config_omits_absent_fields() {
        let config = RateLimitConfig {
            per_page_delay_ms: Some(300),
            batch_size: None,
            batch_delay_ms: None,
            retry: None,
        };
        let json = serde_json::to_value(config).unwrap();
        assert_eq!(json, serde_json::json!({ "perPageDelayMs": 300 }));
        let round_tripped: RateLimitConfig = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, config);
    }

    #[test]
    fn retry_config_round_trips_with_camel_case_backoff() {
        let config = RetryConfig {
            max_attempts: Some(3),
            backoff: Some(BackoffKind::Exponential),
            delay_ms: Some(500),
        };
        let json = serde_json::to_value(config).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "maxAttempts": 3, "backoff": "exponential", "delayMs": 500 })
        );
        let round_tripped: RetryConfig = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, config);
    }

    #[test]
    fn error_semantic_serializes_to_camel_case_string() {
        let value = serde_json::to_value(ErrorSemantic::AuthkeyExpired).unwrap();
        assert_eq!(value, serde_json::json!("authkeyExpired"));
    }

    #[test]
    fn stop_condition_round_trips_with_kind_tag() {
        let condition = StopCondition::CursorExhausted {};
        let json = serde_json::to_value(condition).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "cursorExhausted" }));
        let round_tripped: StopCondition = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, condition);
    }

    #[test]
    fn timezone_source_static_table_round_trips_with_camel_case_field() {
        let source = TimezoneSource::StaticTable {
            table: BTreeMap::from([("os_usa".to_string(), -480), ("os_cht".to_string(), 480)]),
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["kind"], serde_json::json!("staticTable"));
        assert_eq!(
            json["table"],
            serde_json::json!({ "os_usa": -480, "os_cht": 480 })
        );
        let round_tripped: TimezoneSource = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, source);
    }

    #[test]
    fn precondition_status_unsatisfied_round_trips_with_actual_field() {
        let status = PreconditionStatus::Unsatisfied {
            actual: "1024x768".to_string(),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "unsatisfied", "actual": "1024x768" })
        );
        let round_tripped: PreconditionStatus = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, status);
    }

    #[test]
    fn host_env_round_trips_with_camel_case_fields() {
        let env = HostEnv {
            game_client_size: Some(GameClientSize {
                width: 1920,
                height: 1080,
            }),
            installed_dependencies: vec!["webview2".to_string()],
        };
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(
            json["gameClientSize"],
            serde_json::json!({ "width": 1920, "height": 1080 })
        );
        assert_eq!(
            json["installedDependencies"],
            serde_json::json!(["webview2"])
        );
        let round_tripped: HostEnv = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, env);
    }
}
