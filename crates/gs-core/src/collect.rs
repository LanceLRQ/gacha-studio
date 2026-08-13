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
    /// 接口本身不分页：一次请求即返回全部记录，没有下一页的概念。
    ///
    /// 新增动机：鸣潮 `gacha/record/query` 接口一次返回整池全量记录，不接受
    /// 也不需要 `page`/`size` 参数——前三个变体全部预设"存在下一页，直到
    /// 满足某个条件才停"，套在鸣潮上没有意义（第一次请求后就没有"下一页"
    /// 可翻）。也正因为「一次请求 = 整池全量」，鸣潮的 `record_key` 序位安全性
    /// 才成立（详见 `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md`
    /// §1.7～§1.8）——增量采集会破坏这个前提，因此鸣潮插件必须声明本变体，
    /// 不能声明前三种分页语义的任何一种。
    SingleRequest {},
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
    /// 记录时间字符串的书写格式，见 [`RawTimeFormat`] 的文档。省略时由 L1
    /// 范式层套用 `RawTimeFormat::SpaceSeparated` 默认值——米哈游三游的
    /// manifest 不需要为了这个新字段改一行。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw_format: Option<RawTimeFormat>,
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

/// 记录时间字符串（`fields.time`）的书写格式。
///
/// 判据同 [`TimezoneSource`]（`00-实施总览.md` §11.5）：「解析一个日期时间
/// 字符串」的算法换一个游戏依然成立，归 Rust；但「这个游戏的时间用什么格式
/// 书写」是游戏知识，归插件声明。本类型修复的是一处已被记录过的能力边界
/// 违规——早期实现把"空格分隔"和"ISO `T` 分隔"两种格式都写死进
/// `crates/paradigms/gs-p-authkey/src/pipeline.rs` 的 `parse_record_time`，
/// 依次尝试到能解析为止；这只是把硬编码从一种变成两种，且会掩盖"插件声明与
/// 真实数据不符"这个信号——两种格式恰好都能解析出同一个时刻时不会算错，但
/// 一旦声明与实际线格式不一致，静默兜底不会报错，只会在下一个游戏用第三种
/// 格式时才被撞见。收口方式与 `crates/paradigms/gs-p-authkey/src/log_scan.rs`
/// 的 `LogDecodeSpec`（鸣潮日志解混淆参数）完全对称：算法留在 Rust，具体
/// 取值改成从插件声明读。
///
/// 省略时默认 [`Self::SpaceSeparated`]——原神/星铁/绝区零三个参考实现的真实
/// 响应格式，历史行为不变，不需要为了新增本字段去改它们的 manifest。
///
/// ⚠️ **鸣潮的已知褶皱**：鸣潮插件目前只声明一份 `rawFormat`，却要同时覆盖
/// 两条数据来源——采集走 API（真实线格式尚未抓包验证，见
/// `fixtures/wuwa/meta.toml` "已知未验证项：API 的 Time 线格式"一节）、导入
/// 走本地存档（Newtonsoft 序列化 `DateTime` 的产物，确定是 `IsoLocal`）。若
/// 将来证实 API 发的是另一种格式，一个 `rawFormat` 就不够用了，需要按数据
/// 来源分别声明。**现在不为此设计机制**——按三次法则，样本数为 1（只有一个
/// 需要双来源覆盖的游戏）不预先抽象，只在这里记一笔，等真的出现分歧再回改。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum RawTimeFormat {
    /// `YYYY-MM-DD HH:MM:SS`——米哈游三游参考实现的真实响应格式。
    SpaceSeparated {},
    /// `YYYY-MM-DDTHH:MM:SS`（ISO 8601，`T` 分隔）——鸣潮本地存档
    /// （`fixtures/wuwa/raw_response/*.json` 的形状）的确定格式，API 真实
    /// 线格式仍未验证，见本类型顶部"鸣潮的已知褶皱"一节。
    IsoLocal {},
}

/// 时区信息从哪里推断——三个米哈游参考工具时区可得性完全不一致：星铁 API
/// 直接返回 `region_time_zone`（对应 `ApiField`）；绝区零 API 只返回
/// `region`，时区靠客户端静态表按 `region` 查出来（对应 `StaticTable`），
/// `region_time_zone` 是查表算出来再写回导出存档的派生值，不是原始响应
/// 字段（源码级核实：`research/04-同族工具三方源码对比.md` §4.4，
/// `zzz-signal-search-export/src/main/getData.js:33-39,460`）；原神两者都
/// 不返回，只能靠 `Computed` 按其他信号推断。因此不能假设只有一种来源，
/// 必须是判别联合。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum TimezoneSource {
    /// 时区信息就在响应体的某个字段里，直接读取。
    ApiField { field: String },
    /// 接口不返回时区，用静态表按区服/服务器标识查表。
    StaticTable {
        /// 从响应体的哪个字段读取查表键（如绝区零的 `region`），语义与
        /// `ApiField::field` 对称——`field` 决定去响应体里读哪个原始值，
        /// 只是这里读到的不是最终偏移量，而是拿去 `table` 里再查一次。
        /// 缺了这个字段，L1 执行层拿到 `table` 后不知道该用谁去查——是一处
        /// 已被 M1-S7 纸面填表演练发现的类型不对称，见
        /// `docs/_internal/audit/AUDIT-2026-08-11-S7纸面填表演练.md` §3.1。
        field: String,
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
    fn stop_condition_single_request_round_trips_with_kind_tag() {
        let condition = StopCondition::SingleRequest {};
        let json = serde_json::to_value(condition).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "singleRequest" }));
        let round_tripped: StopCondition = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, condition);
    }

    #[test]
    fn raw_time_format_round_trips_with_kind_tag() {
        let space_separated = RawTimeFormat::SpaceSeparated {};
        let json = serde_json::to_value(space_separated).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "spaceSeparated" }));
        let round_tripped: RawTimeFormat = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, space_separated);

        let iso_local = RawTimeFormat::IsoLocal {};
        let json = serde_json::to_value(iso_local).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "isoLocal" }));
        let round_tripped: RawTimeFormat = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, iso_local);
    }

    #[test]
    fn time_config_omits_raw_format_when_absent() {
        let config = TimeConfig {
            raw_time_convention: None,
            timezone_source: None,
            raw_format: None,
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json, serde_json::json!({}));
        let round_tripped: TimeConfig = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, config);
    }

    #[test]
    fn timezone_source_static_table_round_trips_with_camel_case_field() {
        let source = TimezoneSource::StaticTable {
            field: "region".to_string(),
            table: BTreeMap::from([("os_usa".to_string(), -480), ("os_cht".to_string(), 480)]),
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["kind"], serde_json::json!("staticTable"));
        assert_eq!(json["field"], serde_json::json!("region"));
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
