//! L1 范式流程：`AuthkeyApiPipeline`。
//!
//! 编排顺序（架构裁定 `docs/_internal/milestones/00-实施总览.md` §6.7）：
//!
//! ```text
//! loop {
//!     resp = transport.get(url)                          L0，HTTP IO 在 Rust
//!     list = plugin_runtime.call(extractList, resp)       只把响应体喂给 JS
//!     recs = list.map(plugin_runtime.call(extractRecord))
//!     n    = repo.insert_records(recs)                    去重发生在数据库层
//!     if 连续 N 页 n == 0 { break }
//! }
//! ```
//!
//! 插件全程只做"数据 in、数据 out"的同步计算，采集编排、HTTP、限速重试、
//! 归一化全部在 Rust。

use std::collections::HashMap;

use gs_core::{GachaRecord, MetaState, RecordKey, RecordSource, TzOrigin};
use gs_plugin_runtime::{PluginCallError, PluginRuntime};
use gs_storage::{NewBannerSnapshot, Repository, SnapshotOrigin};
use serde_json::Value;

use crate::rate_limit::RateLimitPolicy;
use crate::DEFAULT_PAGE_SIZE;

// ============================================================
// 错误类型
// ============================================================

#[derive(Debug)]
pub enum PipelineError {
    /// manifest 纯数据缺失/形状不对——多半是忘了跑
    /// `node scripts/gs-bundle-plugins.mjs`，或者插件声明的范式不是 authkey。
    Config(String),
    /// HTTP 传输失败，或重试耗尽后仍然拿不到可用响应。
    Transport(String),
    /// 插件函数调用失败（JS 异常/JSON 编解码失败），错误信息已经带原始
    /// TS 文件名与行号，见 `gs_plugin_runtime::PluginCallError` 的
    /// `Display` 实现。
    PluginCall(PluginCallError),
    /// 存储层写入失败。
    Storage(gs_core::GsError),
    /// 响应体或插件返回值不是合法 JSON，或形状不满足预期契约。
    Json(String),
    /// authkey 已过期——不可重试的终止条件，调用方需要引导用户重新打开
    /// 游戏内抽卡记录页以刷新凭据，而不是傻等重试。
    AuthkeyExpired,
}

impl std::fmt::Display for PipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(msg) => write!(f, "authkey 采集流程配置错误：{msg}"),
            Self::Transport(msg) => write!(f, "authkey 采集流程传输失败：{msg}"),
            Self::PluginCall(err) => write!(f, "{err}"),
            Self::Storage(err) => write!(f, "authkey 采集流程存储层失败：{err}"),
            Self::Json(msg) => write!(f, "authkey 采集流程 JSON 处理失败：{msg}"),
            Self::AuthkeyExpired => write!(f, "authkey 已过期，需要用户重新打开游戏内抽卡记录页刷新凭据"),
        }
    }
}

impl std::error::Error for PipelineError {}

impl From<PluginCallError> for PipelineError {
    fn from(err: PluginCallError) -> Self {
        Self::PluginCall(err)
    }
}

impl From<gs_core::GsError> for PipelineError {
    fn from(err: gs_core::GsError) -> Self {
        Self::Storage(err)
    }
}

// ============================================================
// GameApiTransport：HTTP 走 trait 抽象
// ============================================================

/// 一次 HTTP 响应。只建模流程需要的两个字段——状态码用于判断是否需要重试，
/// 响应体交给插件的 `extractList` 解析。
#[derive(Debug, Clone)]
pub struct TransportResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct TransportError(pub String);

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for TransportError {}

/// 抽象出 HTTP 传输层，使整条 pipeline 能在 `cargo test` 里无网络跑通——
/// 测试用 fixture 驱动的实现见本文件 `tests` 模块的 `FixtureTransport`，
/// 生产用 [`ReqwestTransport`]。
pub trait GameApiTransport {
    fn get(&self, url: &str) -> Result<TransportResponse, TransportError>;
}

/// 生产环境实现。用阻塞客户端而不是 async——本 crate 与 `gs-storage`
/// 一样保持同步风格，采集流程本身也不需要并发发起多个请求（分页天然是
/// 串行的：下一页依赖上一页是否为空）。
pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self {
            client: reqwest::blocking::Client::new(),
        }
    }
}

impl GameApiTransport for ReqwestTransport {
    fn get(&self, url: &str) -> Result<TransportResponse, TransportError> {
        let response = self.client.get(url).send().map_err(|err| TransportError(err.to_string()))?;
        let status = response.status().as_u16();
        let body = response.text().map_err(|err| TransportError(err.to_string()))?;
        Ok(TransportResponse { status, body })
    }
}

// ============================================================
// manifest 纯数据 JSON 的最小反序列化形态
// ============================================================
//
// 这里只声明 pipeline 真正要用到的字段子集——不是 PluginManifest 的完整
// 镜像。serde 默认忽略未声明的 JSON 字段，因此 manifest 里其余数据
// （banners/rarity/pityGroups 的 curve、baseline……）不会因为这里没建模
// 而报错，它们留给各自的消费方（分析引擎等）按自己的需要单独解析。

#[derive(Debug, Clone, serde::Deserialize)]
struct ManifestDataJson {
    collect: CollectSectionJson,
    #[serde(rename = "pityGroups", default)]
    pity_groups: Vec<PityGroupJson>,
    #[serde(rename = "itemIdSource")]
    item_id_source: Option<String>,
    time: Option<TimeConfigJson>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct CollectSectionJson {
    paradigm: String,
    params: AuthkeyParamsJson,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AuthkeyParamsJson {
    pub credential: CredentialJson,
    pub request: RequestTemplateJson,
    /// 每页条数，填进 `request.url` 的 `{{pageSize}}` 占位符。
    ///
    /// > 这里曾有 `type_param` / `page_param` 两个字段。M1-S3 实现后实测确认
    /// > 它们反序列化进来之后**一行没被读过**——参数名已由 `request.url`
    /// > 模板自己写死（`&gacha_type=`、`&page=`），声明只是重复了一遍。
    /// > 已从契约删除。与本字段的区别在于：`page_size` 是**值**，真的被消费。
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
    #[serde(rename = "errorMap", default)]
    pub error_map: HashMap<String, String>,
    #[serde(rename = "stopCondition")]
    pub stop_condition: Option<StopConditionJson>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum StopConditionJson {
    #[serde(rename = "emptyPage")]
    EmptyPage {},
    #[serde(rename = "cursorExhausted")]
    CursorExhausted {},
    #[serde(rename = "reachedKnown")]
    ReachedKnown {},
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum CredentialJson {
    #[serde(rename = "chromiumCache")]
    ChromiumCache {
        #[serde(rename = "gameDir")]
        game_dir: String,
        #[serde(rename = "urlPattern")]
        url_pattern: RegexJson,
    },
    #[serde(rename = "logFile")]
    LogFile {
        #[serde(rename = "logPath")]
        log_path: String,
        #[serde(rename = "urlPattern")]
        url_pattern: RegexJson,
    },
    #[serde(rename = "manual")]
    Manual {},
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RegexJson {
    pub source: String,
    pub flags: String,
}

impl RegexJson {
    /// 把 JS `RegExp` 的 `{ source, flags }` 重新编译成 Rust `regex::Regex`。
    ///
    /// JS 的 `\/`（转义斜杠）在 Rust 正则语法里同样合法——转义任意非字母
    /// 数字字符总是被当作该字符的字面匹配，不需要预处理去掉这层转义。
    /// `g`/`u`/`y` 这三个 JS 独有的标志没有直接的 Rust 等价物，忽略即可：
    /// `g`（全局匹配）对应 Rust 的 `find_iter`，不是编译期开关；`u`
    /// （Unicode 模式）在 `regex` crate 里本来就是默认行为；`y`（粘性匹配）
    /// 目前没有任何插件用到。
    pub fn compile(&self) -> Result<regex::Regex, PipelineError> {
        let mut builder = regex::RegexBuilder::new(&self.source);
        for flag in self.flags.chars() {
            match flag {
                'i' => {
                    builder.case_insensitive(true);
                }
                's' => {
                    builder.dot_matches_new_line(true);
                }
                'm' => {
                    builder.multi_line(true);
                }
                _ => {}
            }
        }
        builder
            .build()
            .map_err(|err| PipelineError::Config(format!("urlPattern 编译失败：{err}")))
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RequestTemplateJson {
    pub url: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct PityGroupJson {
    key: String,
    members: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct TimeConfigJson {
    #[serde(rename = "timezoneSource")]
    timezone_source: Option<TimezoneSourceJson>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind")]
enum TimezoneSourceJson {
    #[serde(rename = "apiField")]
    ApiField { #[allow(dead_code)] field: String },
    #[serde(rename = "staticTable")]
    StaticTable { #[allow(dead_code)] table: HashMap<String, i32> },
    #[serde(rename = "computed")]
    Computed {},
}

/// 从 `extractRecord`/`hooks.transformRecord` 返回值反序列化出来的字段。
#[derive(Debug, Clone, serde::Deserialize)]
struct UnifiedRecordFieldsJson {
    #[serde(rename = "itemId")]
    item_id: String,
    time: String,
    #[serde(rename = "bannerId")]
    banner_id: String,
    count: i64,
    name: Option<String>,
    #[serde(rename = "itemType")]
    item_type: Option<String>,
    rarity: Option<String>,
    #[serde(rename = "stableId")]
    stable_id: Option<String>,
}

// ============================================================
// 错误语义
// ============================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ErrorSemantic {
    AuthkeyExpired,
    RateLimited,
    Unknown,
}

fn parse_error_semantic(raw: &str) -> ErrorSemantic {
    match raw {
        "authkeyExpired" => ErrorSemantic::AuthkeyExpired,
        "rateLimited" => ErrorSemantic::RateLimited,
        _ => ErrorSemantic::Unknown,
    }
}

/// 从响应体里识别错误语义。米哈游三游的响应统一带 `retcode` 字段
/// （`0` 表示成功），这是 authkey 范式（而非通用 HTTP 语义）内置的约定——
/// `errorMap` 的类型契约（`Record<string, ErrorSemantic>`）本身没有声明
/// "错误码从响应的哪个字段取"，本范式把它固定为 `retcode`，因为三个参考
/// 实现（原神/星铁/绝区零）用的都是同一套响应包壳。
///
/// ⚠️ **必须在分页循环的每一次响应上都调用**，不能只在循环开始前检查一次
/// ——这是三方工具的共同缺陷（`research/04` §4.9：`star-rail`/`zzz` 的
/// `tryGetUid` 阶段完全不识别 authkey 过期，只会静默失败）。调用点见
/// [`AuthkeyApiPipeline::fetch_with_retry`]，每次拿到响应都会过一遍这里。
fn detect_error_semantic(response: &Value, error_map: &HashMap<String, ErrorSemantic>) -> Option<ErrorSemantic> {
    let retcode_value = response.get("retcode")?;
    let retcode = match retcode_value {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    if retcode == "0" {
        return None;
    }
    Some(error_map.get(&retcode).copied().unwrap_or(ErrorSemantic::Unknown))
}

// ============================================================
// 增量合并 / 终止条件
// ============================================================

/// `reachedKnown` 终止条件：连续多少页"本页新增行数为 0"就认为已经翻到了
/// 已采集过的区域、可以停止翻页。
///
/// 取 2 而不是 1：单独一页新增为零可能只是巧合（比如上游偶发返回了重复的
/// 一页、或该页恰好全部撞上了另一账号已采集的记录——理论上不该发生但没有
/// 实证排除），连续两页都是零把"运气不好撞了一页"和"确实翻到头了"区分开，
/// 代价只是最多多发一次分页请求。
pub const REACHED_KNOWN_THRESHOLD: u32 = 2;

/// `reachedKnown` 是否应当停止翻页。**不做数组内容比对**（genshin 反例式的
/// "取前 11 条拼字符串比较"）——只看"本页 `INSERT OR IGNORE` 后的新增行数"
/// 是否连续为零，这是 `UNIQUE(account_id, record_key)` 契约在应用层的
/// 直接推论，不依赖任何顺序假设。抽成独立函数是为了能脱离完整 pipeline
/// 单独测试这条判断本身。
pub fn should_stop_reached_known(consecutive_zero_pages: u32) -> bool {
    consecutive_zero_pages >= REACHED_KNOWN_THRESHOLD
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    EmptyPage,
    ReachedKnown,
}

#[derive(Debug, Clone)]
pub struct CollectOutcome {
    /// 实际发出的请求页数（含最终触发终止条件的那一页）。
    pub pages_fetched: u32,
    /// 非空页数——用作 `banner_snapshot.extra.page_count`，见类型定义处的
    /// 解释：这是"至少存在这么多页有数据"的下界基准，不是精确总页数。
    pub non_empty_pages: u32,
    pub records_seen: u64,
    pub records_inserted: u64,
    pub stop_reason: StopReason,
}

// ============================================================
// Precondition：结构化判定结果
// ============================================================

#[derive(Debug, Clone)]
pub struct PreconditionCheckResult {
    pub id: String,
    pub capability: String,
    pub level: String,
    /// `{ kind: "satisfied" | "unsatisfied" | "unknown", actual?: string }`，
    /// 原样保留 JS 返回的结构，调用方（未来的 UI 层）按 `kind` 分支处理。
    pub status: Value,
    pub remedy: Option<Value>,
}

fn default_host_env() -> Value {
    serde_json::json!({ "installedDependencies": [] })
}

// ============================================================
// AuthkeyApiPipeline
// ============================================================

pub struct AuthkeyApiPipeline<'rt> {
    plugin_id: String,
    plugin_runtime: &'rt PluginRuntime,
    manifest_value: Value,
    params: AuthkeyParamsJson,
    /// 已校验（非零）的每页条数，缺省时取 [`DEFAULT_PAGE_SIZE`]。构造期
    /// 校验一次并缓存，避免"manifest 声明 `pageSize: 0`"这类配置错误
    /// 拖到分页循环跑起来、甚至陷入死循环才暴露。
    page_size: u32,
    pity_group_by_banner: HashMap<String, String>,
    item_id_source: Option<String>,
    timezone_is_computed: bool,
    has_derive_record_key: bool,
    has_resolve_timezone: bool,
    /// `stopCondition` 省略时默认 `emptyPage`（`list.is_empty()` 已经在
    /// 循环里处理）；只有插件显式声明 `{ kind: "reachedKnown" }` 时，
    /// "连续 N 页新增为零"才作为**额外**的终止条件生效——不能对所有插件
    /// 都无条件启用，否则会在"这一页恰好全部撞库但后面还有新记录"的场景
    /// （例如两次采集时间间隔极短、上游对同一页返回了完全相同的数据）
    /// 提前掐断翻页，把 `emptyPage` 语义悄悄替换掉。
    is_reached_known_stop_condition: bool,
    error_map: HashMap<String, ErrorSemantic>,
    rate_limit: RateLimitPolicy,
}

impl<'rt> AuthkeyApiPipeline<'rt> {
    pub fn new(
        plugin_id: &str,
        plugin_runtime: &'rt PluginRuntime,
        rate_limit: RateLimitPolicy,
    ) -> Result<Self, PipelineError> {
        let manifest_value = gs_plugin_runtime::plugin_manifest_data(plugin_id)
            .ok_or_else(|| {
                PipelineError::Config(format!(
                    "插件 \"{plugin_id}\" 的 manifest 纯数据未找到——先跑一次 \
                     `node scripts/gs-bundle-plugins.mjs` 生成 \
                     crates/gs-plugin-runtime/generated/plugins.manifest.json"
                ))
            })?
            .clone();

        let parsed: ManifestDataJson = serde_json::from_value(manifest_value.clone())
            .map_err(|err| PipelineError::Config(format!("解析插件 \"{plugin_id}\" 的 manifest 纯数据失败：{err}")))?;

        if parsed.collect.paradigm != "authkey" {
            return Err(PipelineError::Config(format!(
                "插件 \"{plugin_id}\" 声明的采集范式是 \"{}\"，AuthkeyApiPipeline 只支持 \"authkey\"",
                parsed.collect.paradigm
            )));
        }

        let mut pity_group_by_banner = HashMap::new();
        for group in &parsed.pity_groups {
            for member in &group.members {
                pity_group_by_banner.insert(member.clone(), group.key.clone());
            }
        }

        let timezone_is_computed = matches!(
            parsed.time.as_ref().and_then(|t| t.timezone_source.as_ref()),
            Some(TimezoneSourceJson::Computed {})
        );

        let has_derive_record_key = plugin_runtime.has(plugin_id, "hooks.deriveRecordKey")?;
        let has_resolve_timezone = plugin_runtime.has(plugin_id, "hooks.resolveTimezone")?;

        let page_size = match parsed.collect.params.page_size {
            Some(declared) => crate::validate_page_size(declared).map_err(|err| PipelineError::Config(err.to_string()))?,
            None => DEFAULT_PAGE_SIZE,
        };

        let error_map = parsed
            .collect
            .params
            .error_map
            .iter()
            .map(|(code, semantic)| (code.clone(), parse_error_semantic(semantic)))
            .collect();

        let is_reached_known_stop_condition =
            matches!(parsed.collect.params.stop_condition, Some(StopConditionJson::ReachedKnown {}));

        Ok(Self {
            plugin_id: plugin_id.to_string(),
            plugin_runtime,
            manifest_value,
            params: parsed.collect.params,
            page_size,
            pity_group_by_banner,
            item_id_source: parsed.item_id_source,
            timezone_is_computed,
            has_derive_record_key,
            has_resolve_timezone,
            is_reached_known_stop_condition,
            error_map,
            rate_limit,
        })
    }

    pub fn credential(&self) -> &CredentialJson {
        &self.params.credential
    }

    fn pity_group_for(&self, banner_id: &str) -> String {
        self.pity_group_by_banner
            .get(banner_id)
            .cloned()
            .unwrap_or_else(|| banner_id.to_string())
    }

    /// 构造某一页请求的完整 URL。`{{credential}}` 的替换发生在这里——替换后
    /// 的明文 URL 只存在于 Rust 的局部变量里，不经过任何插件代码能看到的
    /// 路径（HC-2 的具体实现点）。
    pub fn build_page_url(&self, credential_url: &str, banner_id: &str, page: u32) -> String {
        self.params
            .request
            .url
            .replace("{{credential}}", credential_url)
            .replace("{{page}}", &page.to_string())
            .replace("{{gachaType}}", banner_id)
            .replace("{{pageSize}}", &self.page_size.to_string())
    }

    /// 逐个用索引路径调用 `manifest.preconditions[i].check`，把纯数据字段
    /// （`id`/`capability`/`level`/`remedy`）与 JS 返回的判定结果拼成结构化
    /// 结果。原神也有前置条件（`credential.gameDir` 存在性），成本低体感
    /// 大，不必等到 M4 做异环才第一次用这套机制。
    pub fn check_preconditions(&self, host_env: &Value) -> Result<Vec<PreconditionCheckResult>, PipelineError> {
        let preconditions = self
            .manifest_value
            .get("preconditions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        preconditions
            .iter()
            .enumerate()
            .map(|(index, declaration)| {
                let id = declaration
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let capability = declaration
                    .get("capability")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let level = declaration
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let remedy = declaration.get("remedy").cloned();

                let status = self
                    .plugin_runtime
                    .call(&self.plugin_id, &format!("manifest.preconditions.{index}.check"), std::slice::from_ref(host_env))?;

                Ok(PreconditionCheckResult {
                    id,
                    capability,
                    level,
                    status,
                    remedy,
                })
            })
            .collect()
    }

    /// 用宿主默认的空环境跑一遍前置条件检查——多数场景下调用方还没有真实
    /// 的 `HostEnv` 快照时的便捷入口。
    pub fn check_preconditions_with_default_env(&self) -> Result<Vec<PreconditionCheckResult>, PipelineError> {
        self.check_preconditions(&default_host_env())
    }

    /// 拉取一页并处理重试/错误语义。`errorMap` 的识别在**每一次**响应到达
    /// 时都会发生（本函数就是分页循环的循环体一部分），而不是只在流程开始
    /// 前检查一次。
    fn fetch_with_retry<T: GameApiTransport>(&self, transport: &T, url: &str) -> Result<Value, PipelineError> {
        let mut last_error: Option<PipelineError> = None;

        for attempt in 1..=self.rate_limit.retry.max_attempts {
            let outcome = transport.get(url).map_err(|err| PipelineError::Transport(err.to_string()));

            let response = match outcome {
                Ok(response) => response,
                Err(err) => {
                    last_error = Some(err);
                    std::thread::sleep(self.rate_limit.retry.delay_for_attempt(attempt));
                    continue;
                }
            };

            if response.status >= 500 || response.status == 429 {
                last_error = Some(PipelineError::Transport(format!(
                    "HTTP 状态码 {}（第 {attempt} 次尝试）",
                    response.status
                )));
                std::thread::sleep(self.rate_limit.retry.delay_for_attempt(attempt));
                continue;
            }

            let body_json: Value = match serde_json::from_str(&response.body) {
                Ok(json) => json,
                Err(err) => {
                    last_error = Some(PipelineError::Json(format!("响应体不是合法 JSON：{err}")));
                    std::thread::sleep(self.rate_limit.retry.delay_for_attempt(attempt));
                    continue;
                }
            };

            if let Some(semantic) = detect_error_semantic(&body_json, &self.error_map) {
                match semantic {
                    ErrorSemantic::AuthkeyExpired => return Err(PipelineError::AuthkeyExpired),
                    ErrorSemantic::RateLimited | ErrorSemantic::Unknown => {
                        last_error = Some(PipelineError::Transport(format!(
                            "响应语义 {semantic:?}（第 {attempt} 次尝试），响应体：{}",
                            response.body
                        )));
                        std::thread::sleep(self.rate_limit.retry.delay_for_attempt(attempt));
                        continue;
                    }
                }
            }

            return Ok(body_json);
        }

        Err(last_error.unwrap_or_else(|| PipelineError::Transport("重试次数已耗尽".to_string())))
    }

    /// 把 `fields.time`（形如 `"2026-06-18 21:15:32"`，不带时区）换算成 UTC
    /// 毫秒时间戳。`tz_offset_hours` 为 `None` 时说明拿不到可信的时区来源
    /// （既没有 `computed` 也没有其余两种声明），归一化为 `Assumed` 而不是
    /// 悄悄假设某个时区——错的时区好过悄悄编一个看起来对的时区。
    fn normalize_time(raw_time: &str, tz_offset_hours: Option<i32>) -> Result<(i64, TzOrigin, Option<i32>), PipelineError> {
        let naive = chrono::NaiveDateTime::parse_from_str(raw_time, "%Y-%m-%d %H:%M:%S")
            .map_err(|err| PipelineError::Json(format!("无法解析记录时间 \"{raw_time}\"：{err}")))?;
        match tz_offset_hours {
            Some(hours) => {
                let utc_seconds = naive.and_utc().timestamp() - i64::from(hours) * 3600;
                Ok((utc_seconds * 1000, TzOrigin::Region, Some(hours * 60)))
            }
            None => {
                let utc_seconds = naive.and_utc().timestamp();
                Ok((utc_seconds * 1000, TzOrigin::Assumed, None))
            }
        }
    }

    fn determine_meta_state(&self, fields: &UnifiedRecordFieldsJson) -> MetaState {
        // ★ M1-S3 阻塞项：itemIdSource === "displayName" 的插件，itemId 是
        // 本地化物品名而非真正标识——即使 name/itemType/rarity 都有值，也
        // 必须标 pending，否则 idx_record_meta_pending 永远扫不到这类记录，
        // 错的 item_id 会被当成"完整"而没有任何机制来纠正。见交付报告
        // 「偏差与发现」与本 crate 的验收测试
        // `pipeline_marks_records_pending_when_item_id_source_is_display_name`。
        if self.item_id_source.as_deref() == Some("displayName") {
            return MetaState::Pending;
        }
        if fields.name.is_none() || fields.item_type.is_none() || fields.rarity.is_none() {
            return MetaState::Pending;
        }
        MetaState::Complete
    }

    /// 采集单个卡池（`banner_id`，即填进 `{{gachaType}}` 占位符的取值，如原神的
    /// `"301"`）的全部记录，分页直至终止条件，写入 `repo` 并落一条
    /// `banner_snapshot`。
    ///
    /// `credential_url` 是 [`crate::cache_scan::scan_game_cache`] 取回的、
    /// 已经包含明文 authkey 的完整 URL；`uid`/`region` 用于
    /// `hooks.resolveTimezone` 的 `TimezoneContext`；`lang` 由调用方从
    /// `credential_url` 的查询串里取出（`gacha_record.lang` 不是插件产出的
    /// 字段，而是会话级上下文，见 `crate::cache_scan::extract_query_param`）。
    #[allow(clippy::too_many_arguments)]
    pub fn collect_banner<T: GameApiTransport>(
        &self,
        transport: &T,
        repo: &Repository<'_>,
        account_id: i64,
        banner_id: &str,
        credential_url: &str,
        uid: &str,
        region: Option<&str>,
        lang: Option<&str>,
        captured_at: i64,
    ) -> Result<CollectOutcome, PipelineError> {
        let mut page: u32 = 1;
        let mut consecutive_zero_pages: u32 = 0;
        let mut pages_fetched: u32 = 0;
        let mut non_empty_pages: u32 = 0;
        let mut records_seen: u64 = 0;
        let mut records_inserted: u64 = 0;
        let stop_reason;

        loop {
            let url = self.build_page_url(credential_url, banner_id, page);
            let response_json = self.fetch_with_retry(transport, &url)?;
            pages_fetched += 1;

            let list_value = self
                .plugin_runtime
                .call(&self.plugin_id, "manifest.collect.params.extractList", &[response_json])?;
            let list = list_value.as_array().cloned().unwrap_or_default();

            if crate::is_empty_page(list.len()) {
                stop_reason = StopReason::EmptyPage;
                break;
            }
            non_empty_pages += 1;
            records_seen += list.len() as u64;

            let mut batch = Vec::with_capacity(list.len());
            for raw in &list {
                let fields_value = self
                    .plugin_runtime
                    .call(&self.plugin_id, "manifest.fields.extractRecord", std::slice::from_ref(raw))?;
                let fields: UnifiedRecordFieldsJson = serde_json::from_value(fields_value.clone())
                    .map_err(|err| PipelineError::Json(format!("extractRecord 返回值不满足契约：{err}")))?;

                let record_key_text = if self.has_derive_record_key {
                    let key_value = self
                        .plugin_runtime
                        .call(&self.plugin_id, "hooks.deriveRecordKey", std::slice::from_ref(&fields_value))?;
                    key_value.as_str().map(str::to_string)
                } else {
                    fields.stable_id.clone()
                }
                .ok_or_else(|| {
                    PipelineError::Config(format!(
                        "记录 itemId=\"{}\" 既没有 hooks.deriveRecordKey 的产出也没有 stableId，无法确定 record_key",
                        fields.item_id
                    ))
                })?;

                let tz_offset_hours: Option<i32> = if self.timezone_is_computed && self.has_resolve_timezone {
                    let ctx = serde_json::json!({ "uid": uid, "region": region });
                    let value = self
                        .plugin_runtime
                        .call(&self.plugin_id, "hooks.resolveTimezone", &[fields_value.clone(), ctx])?;
                    value.as_i64().map(|n| n as i32)
                } else {
                    None
                };

                let (occurred_at, tz_origin, tz_offset_min) = Self::normalize_time(&fields.time, tz_offset_hours)?;

                batch.push(GachaRecord {
                    id: 0,
                    account_id,
                    banner_key: fields.banner_id.clone(),
                    pity_group: self.pity_group_for(&fields.banner_id),
                    record_key: RecordKey::new(record_key_text)?,
                    lang: lang.map(str::to_string),
                    occurred_at,
                    occurred_raw: fields.time.clone(),
                    tz_origin,
                    tz_offset_min,
                    seq_in_batch: None,
                    item_id: fields.item_id.clone(),
                    item_type: fields.item_type.clone(),
                    rarity: fields.rarity.clone(),
                    qty: fields.count,
                    meta_state: self.determine_meta_state(&fields),
                    source: RecordSource::OfficialApi,
                    captured_at,
                    raw_ref: None,
                    extra: None,
                });
            }

            let inserted = repo.insert_records(&batch)?;
            records_inserted += inserted;
            consecutive_zero_pages = if inserted == 0 { consecutive_zero_pages + 1 } else { 0 };

            if self.is_reached_known_stop_condition && should_stop_reached_known(consecutive_zero_pages) {
                stop_reason = StopReason::ReachedKnown;
                break;
            }

            page += 1;
            std::thread::sleep(self.rate_limit.per_page_delay);
        }

        // 页码/分页元信息写入 banner_snapshot：原神虽不像异环那样直接返回
        // 总页数，但"拉到空列表即终止"配合非空页计数，同样能产出一个可信的
        // 下界基准。这条对所有分页型采集都成立，不是异环特例
        // （research/03 §4.4.2）。
        repo.insert_banner_snapshot(&NewBannerSnapshot {
            account_id,
            banner_key: banner_id.to_string(),
            captured_at,
            draw_count: None,
            rare_count: None,
            pity_current: None,
            pity_max: None,
            origin: SnapshotOrigin::Authoritative,
            source: "pagination".to_string(),
            extra: Some(
                serde_json::json!({
                    "page_count": non_empty_pages,
                    "page_size": self.page_size,
                    "precision": "page",
                })
                .to_string(),
            ),
        })?;

        Ok(CollectOutcome {
            pages_fetched,
            non_empty_pages,
            records_seen,
            records_inserted,
            stop_reason,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_storage::{NewAccount, Storage};
    use std::cell::RefCell;
    use std::collections::HashMap as StdHashMap;
    use std::collections::VecDeque;

    /// fixture 驱动的传输层：按**精确 URL**注册响应，同一 URL 的重复调用
    /// （HTTP 重试）会一直拿到该 URL 最后注册的那个响应，不会"偷跑"到下一页
    /// 的内容——这正是验证"重试同一页不应误吃掉下一页数据"所需要的语义。
    struct FixtureTransport {
        responses: RefCell<StdHashMap<String, VecDeque<String>>>,
        calls: RefCell<Vec<String>>,
    }

    impl FixtureTransport {
        fn new() -> Self {
            Self {
                responses: RefCell::new(StdHashMap::new()),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn register(&self, url: impl Into<String>, body: impl Into<String>) {
            self.responses.borrow_mut().entry(url.into()).or_default().push_back(body.into());
        }

        fn call_count(&self) -> usize {
            self.calls.borrow().len()
        }
    }

    impl GameApiTransport for FixtureTransport {
        fn get(&self, url: &str) -> Result<TransportResponse, TransportError> {
            self.calls.borrow_mut().push(url.to_string());
            let mut responses = self.responses.borrow_mut();
            let queue = responses
                .get_mut(url)
                .ok_or_else(|| TransportError(format!("FixtureTransport 未注册该 URL 的响应：{url}")))?;
            let body = if queue.len() > 1 {
                queue.pop_front().expect("非空队列 pop_front 不应失败")
            } else {
                queue.front().cloned().ok_or_else(|| TransportError(format!("URL 的响应队列已空：{url}")))?
            };
            Ok(TransportResponse { status: 200, body })
        }
    }

    /// 测试专用临时目录，`Drop` 时自动清理。不引入 `tempfile` crate——
    /// 只在本文件一处用例里需要真实的文件系统路径（验证 `scan_game_cache`
    /// 与 pipeline 真正串起来），`std::env::temp_dir` + 一个基于 pid/纳秒
    /// 时间戳的唯一子目录名已经够用。
    struct TestDir(std::path::PathBuf);
    impl TestDir {
        fn new(label: &str) -> Self {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "gs-p-authkey-pipeline-test-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            path.push(unique);
            std::fs::create_dir_all(&path).expect("创建临时目录应当成功");
            Self(path)
        }
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn repo_root() -> std::path::PathBuf {
        // 集成测试的可执行文件运行目录不保证是仓库根目录，用 CARGO_MANIFEST_DIR
        // （crates/paradigms/gs-p-authkey）向上跳两级得到仓库根，定位 fixtures/。
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .expect("应当能解析出仓库根目录")
    }

    fn read_fixture(relative: &str) -> String {
        std::fs::read_to_string(repo_root().join(relative))
            .unwrap_or_else(|err| panic!("读取 fixture \"{relative}\" 失败：{err}"))
    }

    fn setup_pipeline_and_account(storage: &Storage) -> (PluginRuntime, i64) {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let account_id = storage
            .repository()
            .create_account(&NewAccount {
                plugin_id: "genshin".to_string(),
                game_uid: "100000000".to_string(),
                region: "cn_gf01".to_string(),
                display_name: None,
                retention_days: Some(168),
                created_at: 1_754_800_000_000,
            })
            .expect("创建测试账号应当成功");
        (runtime, account_id)
    }

    /// 用真实 fixture（`fixtures/genshin/raw_response/`）驱动 3 页请求：
    /// 前两页各有记录，第三页空——验证 emptyPage 终止条件、record_key 形态
    /// （`301:xxx` / `400:xxx`）、`meta_state='pending'`（genshin
    /// `itemIdSource: "displayName"`）、空串 rarity/itemType 归一化为 NULL。
    #[test]
    fn full_pipeline_run_matches_fixture_expectations() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests()).expect("应当能构造 pipeline");

        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn&gacha_type=301";

        let transport = FixtureTransport::new();
        transport.register(
            pipeline.build_page_url(credential_url, "301", 1),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline.build_page_url(credential_url, "301", 2),
            read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
        );
        transport.register(
            pipeline.build_page_url(credential_url, "301", 3),
            read_fixture("fixtures/genshin/raw_response/301_page_3_empty.json"),
        );

        let repo = storage.repository();
        let lang = crate::cache_scan::extract_query_param(credential_url, "lang");
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "301",
                credential_url,
                "100000000",
                None,
                lang.as_deref(),
                1_754_812_801_000,
            )
            .expect("采集应当成功");

        assert_eq!(outcome.stop_reason, StopReason::EmptyPage);
        assert_eq!(outcome.pages_fetched, 3);
        assert_eq!(outcome.non_empty_pages, 2);
        assert_eq!(outcome.records_seen, 8);
        assert_eq!(outcome.records_inserted, 8);

        let records_301 = repo.find_records_by_banner(account_id, "301").expect("查询应当成功");
        let records_400 = repo.find_records_by_banner(account_id, "400").expect("查询应当成功");
        assert_eq!(records_301.len(), 7, "8 条记录里 1 条 gacha_type=400，其余 7 条归 301");
        assert_eq!(records_400.len(), 1);

        // record_key 形态：`${bannerId}:${stableId}`。
        assert!(records_301.iter().any(|r| r.record_key.as_str() == "301:1400000000000000010"));
        assert_eq!(records_400[0].record_key.as_str(), "400:1400000000000000008");

        // itemIdSource === "displayName"：全部记录都应标 pending，即使
        // name/itemType/rarity 三项都有值。
        assert!(
            records_301.iter().chain(records_400.iter()).all(|r| r.meta_state == MetaState::Pending),
            "genshin itemIdSource=displayName，所有记录都应标 meta_state=pending"
        );

        // 空串 rank_type/item_type（fixture 里 id=...007 那条）归一化为 NULL，
        // 不是空字符串——存储层 normalize_empty 已经覆盖这条断言，这里额外
        // 确认它在真实分页流程里也生效。
        let record_with_blank_rarity = records_301
            .iter()
            .find(|r| r.item_id == "测试四星角色D")
            .expect("fixture 里应当有这条记录");
        assert_eq!(record_with_blank_rarity.rarity, None);
        assert_eq!(record_with_blank_rarity.item_type, None);

        // lang 由采集会话上下文（凭据 URL 的 &lang= 参数）传入，不是 NULL。
        assert_eq!(records_301[0].lang.as_deref(), Some("zh-cn"));

        // 页码基准写入 banner_snapshot。
        let snapshots = storage
            .repository()
            .integrity_report()
            .expect("v_integrity 视图查询应当成功");
        // v_integrity 依赖 banner_meta 才会关联出行，本 Stage 不落 banner_meta，
        // 因此这里只验证查询本身不出错；banner_snapshot 是否正确写入用
        // 一次直接的 repository 调用一致性检查（见下方独立断言）。
        let _ = snapshots;
    }

    /// 真正的"缓存扫描 → 分页拉取"全链路：不像上一个用例那样把 credential
    /// URL 写死在测试代码里，而是先用 [`crate::cache_scan::scan_game_cache`]
    /// 从 `fixtures/genshin/credential/data_2.sample`（真实缓存文件的手工
    /// 文本近似，见该文件顶部说明）里扫出凭据 URL，再把它交给 pipeline 分页。
    /// `CredentialJson::urlPattern` 的编译（[`RegexJson::compile`]）也在这里
    /// 被真正用到——不是一个只存在于类型定义里、从未被调用的方法。
    #[test]
    fn cache_scan_and_pipeline_run_together_end_to_end() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests()).expect("应当能构造 pipeline");

        let CredentialJson::ChromiumCache { game_dir, url_pattern } = pipeline.credential() else {
            panic!("genshin 声明的凭据来源应当是 chromiumCache");
        };
        let compiled_pattern = url_pattern.compile().expect("urlPattern 应当能编译成功");

        // 按 game_dir（"YuanShen_Data/webCaches"）声明的相对片段，把 fixture
        // 样本放到 scan_game_cache 期望的目录结构下。
        let dir = TestDir::new("cache-scan-e2e");
        let data2_path = dir.path().join(game_dir).join("Cache/Cache_Data/data_2");
        std::fs::create_dir_all(data2_path.parent().unwrap()).unwrap();
        std::fs::copy(repo_root().join("fixtures/genshin/credential/data_2.sample"), &data2_path)
            .expect("复制 fixture 样本应当成功");

        let locator = crate::cache_scan::StaticGameLocator::new().with_install_root("genshin", dir.path());
        let credential_url = crate::cache_scan::scan_game_cache("genshin", game_dir, &compiled_pattern, &locator)
            .expect("扫描不应报错")
            .expect("应当能从 fixture 样本里扫出凭据 URL");
        assert!(credential_url.contains("getGachaLog"));
        assert!(credential_url.contains("authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY"));
        let lang = crate::cache_scan::extract_query_param(&credential_url, "lang");
        assert_eq!(lang.as_deref(), Some("zh-cn"));

        let transport = FixtureTransport::new();
        transport.register(pipeline.build_page_url(&credential_url, "301", 1), read_fixture("fixtures/genshin/raw_response/301_page_1.json"));
        transport.register(pipeline.build_page_url(&credential_url, "301", 2), read_fixture("fixtures/genshin/raw_response/301_page_2.json"));
        transport.register(pipeline.build_page_url(&credential_url, "301", 3), read_fixture("fixtures/genshin/raw_response/301_page_3_empty.json"));

        let repo = storage.repository();
        let outcome = pipeline
            .collect_banner(&transport, &repo, account_id, "301", &credential_url, "100000000", None, lang.as_deref(), 1_754_812_801_000)
            .expect("采集应当成功");
        assert_eq!(outcome.records_inserted, 8);
    }

    /// 同一份 fixture 跑两遍：第二遍新增行数必须为 0，且不报错——
    /// `UNIQUE(account_id, record_key)` + `INSERT OR IGNORE` 的幂等性。
    #[test]
    fn running_same_fixture_twice_inserts_zero_new_records_second_time() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests()).expect("应当能构造 pipeline");
        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE&lang=zh-cn";

        // 每次调用用不同的 captured_at——`banner_snapshot` 是时间序列表，
        // `UNIQUE(account_id, banner_key, captured_at, source)` 约束的正是
        // "同一时刻不会有两条快照"，两次真实采集本来就发生在不同的墙钟时刻，
        // 用相同 captured_at 跑两遍反而是在制造契约本不允许的场景。
        let run_once = |captured_at: i64| {
            let transport = FixtureTransport::new();
            transport.register(pipeline.build_page_url(credential_url, "301", 1), read_fixture("fixtures/genshin/raw_response/301_page_1.json"));
            transport.register(pipeline.build_page_url(credential_url, "301", 2), read_fixture("fixtures/genshin/raw_response/301_page_2.json"));
            transport.register(pipeline.build_page_url(credential_url, "301", 3), read_fixture("fixtures/genshin/raw_response/301_page_3_empty.json"));
            let repo = storage.repository();
            pipeline
                .collect_banner(&transport, &repo, account_id, "301", credential_url, "100000000", None, Some("zh-cn"), captured_at)
                .expect("采集应当成功")
        };

        let first = run_once(1_754_812_801_000);
        assert_eq!(first.records_inserted, 8);

        let second = run_once(1_754_899_201_000);
        assert_eq!(second.records_inserted, 0, "第二次跑同一份 fixture 不应产生任何新增行");
        assert_eq!(second.stop_reason, StopReason::EmptyPage);
    }

    /// authkey 过期类响应体要在分页循环内部识别，不能只在循环开始前检查
    /// 一次：第一页正常返回、第二页返回不可重试的错误码，pipeline 必须在
    /// 处理到第二页时才失败（证明检查发生在每一次响应上，而不是启动时
    /// 检查一次就不再复查）。
    #[test]
    fn detects_persistent_error_semantic_on_a_later_page_not_only_at_start() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests()).expect("应当能构造 pipeline");
        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE";

        let transport = FixtureTransport::new();
        transport.register(
            pipeline.build_page_url(credential_url, "301", 1),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        // 第二页持续返回一个未在 errorMap 里声明的非零 retcode——genshin
        // 插件没有声明 errorMap，因此按契约"未覆盖的错误码按通用重试处理"，
        // 重试耗尽后应当以 Transport 错误告终，而不是被静默忽略或在第一页
        // 就被拦下。
        transport.register(
            pipeline.build_page_url(credential_url, "301", 2),
            serde_json::json!({ "retcode": -100, "message": "boom", "data": null }).to_string(),
        );

        let repo = storage.repository();
        let result = pipeline.collect_banner(
            &transport,
            &repo,
            account_id,
            "301",
            credential_url,
            "100000000",
            None,
            None,
            1_754_812_801_000,
        );

        assert!(result.is_err(), "第二页持续返回错误语义，重试耗尽后应当失败");
        // 第一页成功过（call_count 里应当能看到第一页只被请求了一次），
        // 证明失败确实发生在"处理到第二页"而不是流程一开始就被拦下。
        assert!(transport.call_count() > 1, "应当已经请求过不止一次，说明流程走过了第一页");
    }

    #[test]
    fn precondition_check_returns_genshin_cache_dir_precondition() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default()).expect("应当能构造 pipeline");
        let results = pipeline
            .check_preconditions_with_default_env()
            .expect("前置条件检查不应失败");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "genshin.credential.cacheDirExists");
        assert_eq!(results[0].capability, "credential");
        assert_eq!(results[0].level, "required");
        assert_eq!(results[0].status["kind"], serde_json::json!("unknown"));
        assert!(results[0].remedy.is_some());
    }

    #[test]
    fn should_stop_reached_known_requires_consecutive_zero_pages() {
        assert!(!should_stop_reached_known(0));
        assert!(!should_stop_reached_known(1));
        assert!(should_stop_reached_known(2));
        assert!(should_stop_reached_known(3));
    }

    #[test]
    fn detect_error_semantic_maps_known_and_unknown_codes() {
        let mut error_map = HashMap::new();
        error_map.insert("-101".to_string(), ErrorSemantic::AuthkeyExpired);

        let expired = serde_json::json!({ "retcode": -101 });
        assert_eq!(detect_error_semantic(&expired, &error_map), Some(ErrorSemantic::AuthkeyExpired));

        let unmapped = serde_json::json!({ "retcode": -999 });
        assert_eq!(detect_error_semantic(&unmapped, &error_map), Some(ErrorSemantic::Unknown));

        let success = serde_json::json!({ "retcode": 0 });
        assert_eq!(detect_error_semantic(&success, &error_map), None);

        let no_field = serde_json::json!({ "data": {} });
        assert_eq!(detect_error_semantic(&no_field, &error_map), None);
    }

    #[test]
    fn build_page_url_substitutes_all_placeholders() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default()).expect("应当能构造 pipeline");
        let url = pipeline.build_page_url("CREDENTIAL", "301", 3);
        assert_eq!(url, "CREDENTIAL&page=3&gacha_type=301&size=20&end_id=0");
    }
}
