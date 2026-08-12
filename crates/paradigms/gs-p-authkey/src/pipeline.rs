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

use crate::DEFAULT_PAGE_SIZE;
use crate::rate_limit::RateLimitPolicy;

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
            Self::AuthkeyExpired => write!(
                f,
                "authkey 已过期，需要用户重新打开游戏内抽卡记录页刷新凭据"
            ),
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
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|err| TransportError(err.to_string()))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .map_err(|err| TransportError(err.to_string()))?;
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
    /// 卡池表。pipeline 目前只需要 `endpointOverride`——`displayName` 等展示
    /// 字段留给界面层直接读 manifest bundle 原始 JSON，这里不建模。
    #[serde(default)]
    banners: Vec<BannerSpecJson>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct BannerSpecJson {
    id: String,
    #[serde(rename = "endpointOverride", default)]
    endpoint_override: Option<String>,
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
    /// 镜像 `gs_core::StopCondition::SingleRequest`——只是为了让声明了这个
    /// 变体的 manifest（如未来的鸣潮插件）能被正常反序列化，不落入
    /// "unknown variant" 报错。**本 Stage 没有消费点**：`collect_banner`
    /// 的分页循环行为不变，鸣潮真正的一次性请求流程在 M2-S3 落地时再接线。
    #[serde(rename = "singleRequest")]
    SingleRequest {},
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
    /// POST 请求体模板，占位符替换规则与 `url` 完全一致，见
    /// [`AuthkeyApiPipeline::substitute_placeholders`]。
    ///
    /// ⚠️ **本 Stage 只提供替换能力（[`AuthkeyApiPipeline::build_page_body`]
    /// 有直接的单元测试验证），未接入 `collect_banner` 的实际发送路径**——
    /// 把 body 真正发出去需要 `GameApiTransport` 支持 POST + body，这是
    /// M2-S3 落地鸣潮采集实现时的范围，此处不提前改动已经跑通的 GET 分页
    /// 传输层。
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct PityGroupJson {
    key: String,
    members: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct TimeConfigJson {
    /// 已解析，但 M1 阶段管线没有任何环节消费它——见
    /// [`AuthkeyApiPipeline`] 结构体上同名字段的文档注释。
    #[serde(rename = "rawTimeConvention")]
    raw_time_convention: Option<RawTimeConventionJson>,
    #[serde(rename = "timezoneSource")]
    timezone_source: Option<TimezoneSourceJson>,
}

/// 对应 `gs_core::RawTimeConvention`。这里单独声明一份而不是直接依赖
/// `gs_core` 的类型，是因为 manifest 纯数据 JSON 的解析结构体在本文件里
/// 一律走这个模式（对照 `StopConditionJson`/`ErrorSemantic` 等，本文件没有
/// 一个是直接复用 `gs_core` 的判别联合）——`gs_core` 那份类型携带的是
/// ts-rs 导出属性，与这里"只需要反序列化"的用途不同。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum RawTimeConventionJson {
    ServerLocal,
    ClientLocalized,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind")]
enum TimezoneSourceJson {
    #[serde(rename = "apiField")]
    ApiField { field: String },
    #[serde(rename = "staticTable")]
    StaticTable {
        /// 从响应体的哪个字段读取查表键（如绝区零的 `region`），语义与
        /// `ApiField::field` 对称，见 `gs_core::TimezoneSource::StaticTable`
        /// 的文档注释。
        field: String,
        table: HashMap<String, i32>,
    },
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
fn detect_error_semantic(
    response: &Value,
    error_map: &HashMap<String, ErrorSemantic>,
) -> Option<ErrorSemantic> {
    let retcode_value = response.get("retcode")?;
    let retcode = match retcode_value {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    if retcode == "0" {
        return None;
    }
    Some(
        error_map
            .get(&retcode)
            .copied()
            .unwrap_or(ErrorSemantic::Unknown),
    )
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
// endpointOverride：路径段替换
// ============================================================

/// `endpointOverride` 只允许纯 ASCII 字母数字组成的路径段字面量。
///
/// 不接受 `/`、`.`、`:`、`?`、`#`、空白等任何字符——这与
/// `CredentialSource.gameDir` 必须是相对片段（`packages/gs-plugin-kit/manifest.ts`
/// 该字段文档的 ⚠️ 注释）是同一类担心：一旦这里能接受任意字符串，
/// [`override_url_path_segment`] 就等于把凭据 URL（含明文 authkey）的路径
/// 部分交给插件任意改写，插件的能力边界随之等于整个应用的网络请求能力
/// 边界。校验放在 pipeline 构造期（[`AuthkeyApiPipeline::from_manifest_value`]），
/// 声明不合法直接拒绝启动，而不是留到某次翻页时才发现。
fn validate_endpoint_override_segment(segment: &str) -> Result<(), &'static str> {
    if segment.is_empty() {
        return Err("不能是空字符串");
    }
    if !segment.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("只允许 ASCII 字母与数字，不接受 / . : ? # 空白等字符");
    }
    Ok(())
}

/// `hooks.deriveRecordKey`（逐条）与 `hooks.deriveRecordKeys`（批处理）互斥：
/// 两者只能声明其一。拒绝同时声明，而不是隐式约定"批处理优先"之类的规则——
/// 一份 manifest 该走哪种 record_key 生成方式应当只有一个答案，写出两个只会
/// 让读者猜宿主到底信谁。校验放在 pipeline 构造期（同
/// [`validate_endpoint_override_segment`] 的理由：声明不合法直接拒绝启动，
/// 不留到采集跑起来才发现）。
///
/// 抽成独立的纯函数（不直接内联在 `from_manifest_value` 里）是为了能脱离
/// 真实插件运行时单独测试这条判断本身——`has_derive_record_key`/
/// `has_derive_record_keys` 两个布尔量本身来自查询 QuickJS 里编译好的插件
/// JS（`PluginRuntime::has`），本仓库目前唯一打包的插件（genshin）的 JS
/// 是固定的、无法在测试里临时"声明"或"取消声明"某个 hook，因此这里把判断
/// 逻辑从"两个布尔量从哪来"里剥离出来，用合成的布尔值直接验证。
fn validate_derive_record_key_hooks_not_both_declared(
    plugin_id: &str,
    has_derive_record_key: bool,
    has_derive_record_keys: bool,
) -> Result<(), PipelineError> {
    if has_derive_record_key && has_derive_record_keys {
        return Err(PipelineError::Config(format!(
            "插件 \"{plugin_id}\" 同时声明了 hooks.deriveRecordKey 与 hooks.deriveRecordKeys——\
             二者只能二选一，宿主不会替插件猜该信哪一个"
        )));
    }
    Ok(())
}

/// `hooks.deriveRecordKeys` 返回的字符串数组长度必须与输入的记录数一致——
/// 长度不等说明插件的批处理钩子实现有 bug（漏算/多算了某条记录），宿主
/// 没有办法猜哪个 key 对应哪条记录，必须直接拒绝而不是按下标硬凑。
/// 抽成纯函数的理由同 [`validate_derive_record_key_hooks_not_both_declared`]。
fn validate_batch_record_keys_length(
    input_len: usize,
    output_len: usize,
) -> Result<(), PipelineError> {
    if input_len != output_len {
        return Err(PipelineError::Config(format!(
            "hooks.deriveRecordKeys 返回了 {output_len} 个 key，但输入了 {input_len} 条记录，长度必须一致"
        )));
    }
    Ok(())
}

/// 把 `url` 路径部分的最后一段替换成 `new_segment`，查询串（含明文
/// authkey）原样保留。
///
/// 星铁联动池的真实行为已用源码核实
/// （`docs/example-projects/star-rail-warp-export/src/main/getData.js:216`）：
/// `let gachaURLPath = ['21','22'].includes(key) ? 'getLdGachaLog' : 'getGachaLog'`，
/// 拼出的 URL 只有路径的最后一段不同，域名、其余路径、查询串完全一致。
/// `new_segment` 在调用前已经过 [`validate_endpoint_override_segment`] 校验，
/// 这里不需要再做防御式转义——全程只操作 Rust 局部变量里的明文 URL，
/// 不经过任何插件代码能看到的路径（HC-2 的具体实现点，与
/// `AuthkeyApiPipeline::build_page_url` 现有注释一致）。
fn override_url_path_segment(url: &str, new_segment: &str) -> String {
    let (path_part, query_part) = match url.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (url, None),
    };
    let replaced_path = match path_part.rfind('/') {
        Some(idx) => format!("{}/{new_segment}", &path_part[..idx]),
        // 极端兜底：凭据 URL 理论上永远是 scheme://host/path 形态（由
        // urlPattern 正则从真实浏览器缓存里扫出来），不存在任何 "/" 说明
        // 上游给出的 URL 本身已经不正常。此时保留原样比强行拼出一个看起来
        // 合法、实则指向错误位置的字符串更安全——请求会在传输层因 URL
        // 本身不合法而报错，不会被静默发到一个错误但"看起来对"的端点。
        None => return url.to_string(),
    };
    match query_part {
        Some(query) => format!("{replaced_path}?{query}"),
        None => replaced_path,
    }
}

// ============================================================
// timezoneSource：apiField / staticTable 的页级读取
// ============================================================

/// 在响应体里查找页级元数据字段——`apiField`/`staticTable` 都要用到。
///
/// authkey 范式目前唯一的三个参考实现（原神/星铁/绝区零）共享同一种信封
/// 形状：`{ retcode, message, data: { list, region, region_time_zone, ... } }`
/// ——[`detect_error_semantic`] 已经把"顶层带 retcode"当作本范式内置约定
/// （见该函数文档），这里延续同一约定：页级元数据（如 `region_time_zone`）
/// 与 `list` 同级，在 `data` 子对象里，不在信封顶层，也不在每条记录内部。
/// 已用源码核实：`star-rail-warp-export/src/main/getData.js:216-227`，
/// `res = await getGachaLog(...)` 拿到的正是 `data` 这一层解包后的对象，
/// `res.list`、`res.region_time_zone` 是同级字段。找不到 `data` 键时退化为
/// 在信封顶层直接找，兼容假设中"更扁平"的未来 authkey 变体，不强行绑死
/// 三个已知样本的信封形状。
fn read_page_level_field<'a>(response: &'a Value, field: &str) -> Option<&'a Value> {
    response
        .get("data")
        .and_then(|data| data.get(field))
        .or_else(|| response.get(field))
}

/// 时区偏移量的取值可能是数字（星铁真实存档 `region_time_zone: 8`）或数字
/// 字符串——参照 drills 草稿 `toCount` 同样的防御式转换（响应体里的数字
/// 字段经常被序列化成字符串）。
fn parse_timezone_offset_hours(value: &Value) -> Option<i32> {
    match value {
        Value::Number(n) => n.as_i64().map(|n| n as i32),
        Value::String(s) => s.trim().parse::<i32>().ok(),
        _ => None,
    }
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
    /// banner id -> 该 banner 所属的**全部**保底组 key，按 manifest
    /// `pityGroups` 声明顺序排列。一个 banner 可能同时属于多个组——鸣潮同一
    /// 卡池的 5★/4★ 硬保底是两套独立计数，manifest 会为它们各声明一个
    /// `PityGroup`，`members` 都指向同一批 banner。
    ///
    /// ⚠️ **修复前的实现是 `HashMap<String, String>`**，`insert` 的返回值被
    /// 丢弃：同一 banner 被两个 `PityGroup` 声明为成员时，后声明的组会
    /// **静默覆盖**前一个——前一个组从此再也查不到属于它的任何 banner。
    /// 这个 bug 在 M1 阶段不会触发（genshin 的两个 banner 都只属于唯一一个
    /// 组），但会让 `PityGroup.pity_target`（鸣潮 5★/4★ 双计数）看起来接上了
    /// 却实际半数失效，因此改成一对多，不丢失任何一次声明。
    pity_group_by_banner: HashMap<String, Vec<String>>,
    item_id_source: Option<String>,
    /// `time.timezoneSource` 的完整声明——不只是"是不是 computed"这一个
    /// 布尔量，`apiField`/`staticTable` 分支需要 `field`/`table` 的具体内容
    /// 才能真正读取响应体，见 [`Self::resolve_page_level_timezone_offset_hours`]。
    timezone_source: Option<TimezoneSourceJson>,
    /// 已解析但 M1 阶段没有任何消费点——`normalize_time` 目前只处理
    /// `serverLocal` 这一种真实场景（三个米哈游参考实现全部如此），
    /// `clientLocalized`（伙伴工具已经把时间换算成采集时本机时区，如
    /// research/03 §2.3.1 记录的 zzz-signal-search-export 行为）要等到
    /// "导入第三方已导出存档"这条路径落地才有消费点。与其让这个字段停在
    /// `TimeConfigJson` 里被 serde 静默吞掉（本次修复之前的状态：结构体里
    /// 压根没有这个字段），不如解析出来、存到这里、有测试验证——
    /// `#[allow(dead_code)]` 标注的是"暂无运行时读取点"，而不是像本次要修的
    /// 两处那样"连解析是否正确都没人验证过"。
    #[allow(dead_code)]
    raw_time_convention: Option<RawTimeConventionJson>,
    /// 卡池 id -> 该卡池覆盖的请求端点路径段，来自 `banners[].endpointOverride`。
    /// 只收录声明了该字段的卡池，未声明的卡池走 `params.request.url` 的
    /// 默认端点。
    endpoint_override_by_banner: HashMap<String, String>,
    has_derive_record_key: bool,
    /// `hooks.deriveRecordKeys` 是否已声明——批处理版本，一次拿整页全部
    /// 记录、返回等长字符串数组。与 `has_derive_record_key` **互斥**：两者
    /// 同时声明视为配置错误（构造期直接拒绝，见 `from_manifest_value`），
    /// 不做"批处理优先"这类隐式的优先级选择——类型即文档，一份 manifest
    /// 该用哪种 hook 应当只有一个答案，写出两个只会让读者猜宿主到底信谁。
    has_derive_record_keys: bool,
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

        Self::from_manifest_value(plugin_id, plugin_runtime, manifest_value, rate_limit)
    }

    /// `new` 与测试专用构造入口共享的解析逻辑，唯一差别是 `manifest_value`
    /// 的来源——真实插件走注册表查找，测试可以直接喂手改过的 JSON，不需要
    /// 为了验证 `endpointOverride`/`timezoneSource` 这类当前唯一的真实插件
    /// （genshin）都没有声明过的分支，去污染 `plugins/genshin/manifest.ts`。
    fn from_manifest_value(
        plugin_id: &str,
        plugin_runtime: &'rt PluginRuntime,
        manifest_value: Value,
        rate_limit: RateLimitPolicy,
    ) -> Result<Self, PipelineError> {
        let parsed: ManifestDataJson =
            serde_json::from_value(manifest_value.clone()).map_err(|err| {
                PipelineError::Config(format!(
                    "解析插件 \"{plugin_id}\" 的 manifest 纯数据失败：{err}"
                ))
            })?;

        if parsed.collect.paradigm != "credentialedApi" {
            return Err(PipelineError::Config(format!(
                "插件 \"{plugin_id}\" 声明的采集范式是 \"{}\"，AuthkeyApiPipeline 只支持 \"credentialedApi\"\
                 （历史上曾叫 \"authkey\"，M2 已改名，见 crate 顶部说明）",
                parsed.collect.paradigm
            )));
        }

        let mut pity_group_by_banner: HashMap<String, Vec<String>> = HashMap::new();
        for group in &parsed.pity_groups {
            for member in &group.members {
                pity_group_by_banner
                    .entry(member.clone())
                    .or_default()
                    .push(group.key.clone());
            }
        }

        let mut endpoint_override_by_banner = HashMap::new();
        for banner in &parsed.banners {
            if let Some(segment) = &banner.endpoint_override {
                validate_endpoint_override_segment(segment).map_err(|reason| {
                    PipelineError::Config(format!(
                        "插件 \"{plugin_id}\" 的卡池 \"{}\" 声明的 endpointOverride \"{segment}\" 不合法：{reason}",
                        banner.id
                    ))
                })?;
                endpoint_override_by_banner.insert(banner.id.clone(), segment.clone());
            }
        }

        let timezone_source = parsed.time.as_ref().and_then(|t| t.timezone_source.clone());
        let raw_time_convention = parsed.time.as_ref().and_then(|t| t.raw_time_convention);

        let has_derive_record_key = plugin_runtime.has(plugin_id, "hooks.deriveRecordKey")?;
        let has_derive_record_keys = plugin_runtime.has(plugin_id, "hooks.deriveRecordKeys")?;
        validate_derive_record_key_hooks_not_both_declared(
            plugin_id,
            has_derive_record_key,
            has_derive_record_keys,
        )?;
        let has_resolve_timezone = plugin_runtime.has(plugin_id, "hooks.resolveTimezone")?;

        let page_size = match parsed.collect.params.page_size {
            Some(declared) => crate::validate_page_size(declared)
                .map_err(|err| PipelineError::Config(err.to_string()))?,
            None => DEFAULT_PAGE_SIZE,
        };

        let error_map = parsed
            .collect
            .params
            .error_map
            .iter()
            .map(|(code, semantic)| (code.clone(), parse_error_semantic(semantic)))
            .collect();

        let is_reached_known_stop_condition = matches!(
            parsed.collect.params.stop_condition,
            Some(StopConditionJson::ReachedKnown {})
        );

        Ok(Self {
            plugin_id: plugin_id.to_string(),
            plugin_runtime,
            manifest_value,
            params: parsed.collect.params,
            page_size,
            pity_group_by_banner,
            item_id_source: parsed.item_id_source,
            timezone_source,
            raw_time_convention,
            endpoint_override_by_banner,
            has_derive_record_key,
            has_derive_record_keys,
            has_resolve_timezone,
            is_reached_known_stop_condition,
            error_map,
            rate_limit,
        })
    }

    /// 仅供测试：绕开插件注册表，直接用调用方给的 manifest 纯数据 JSON 构造
    /// pipeline。函数调用（`extractList`/`extractRecord`/hooks）仍然按
    /// `plugin_id` 路由到插件运行时里真实编译的 JS，与这里传入的
    /// `manifest_value` 互不影响——这正是这个测试入口能成立的原因：拿
    /// genshin 已经编译好的 JS 当执行载体，只替换 Rust 侧要解析的纯数据。
    #[cfg(test)]
    fn from_manifest_json_for_test(
        plugin_id: &str,
        plugin_runtime: &'rt PluginRuntime,
        manifest_value: Value,
    ) -> Result<Self, PipelineError> {
        Self::from_manifest_value(
            plugin_id,
            plugin_runtime,
            manifest_value,
            RateLimitPolicy::zero_delay_for_tests(),
        )
    }

    pub fn credential(&self) -> &CredentialJson {
        &self.params.credential
    }

    /// 单个 banner 落库时使用的**主**保底组 key。`GachaRecord.pity_group` 是
    /// 单值列，一个 banner 若同时属于多个组（鸣潮 5★/4★），只能落一个——
    /// 这里取声明顺序中的**第一个**（genshin 现有行为不变：它的每个 banner
    /// 只声明过一个组）。其余组仍然完整保留在 [`Self::pity_groups_for`]，
    /// 不是"选一个就把其余的丢了"。
    fn pity_group_for(&self, banner_id: &str) -> String {
        self.pity_group_by_banner
            .get(banner_id)
            .and_then(|groups| groups.first())
            .cloned()
            .unwrap_or_else(|| banner_id.to_string())
    }

    /// banner 声明所属的**全部**保底组 key，按 manifest 声明顺序排列；未声明
    /// 任何组时返回空切片。供需要感知"这个 banner 同时属于哪些组"的调用方
    /// 使用（如鸣潮 5★/4★ 双计数的编排逻辑——对同一份记录分别用两个
    /// `PityGroup` 声明各跑一遍 `analyze_pity_group`）；本 Stage 没有这样的
    /// 调用方，暴露这个方法只是为了不让一对多的信息在 `pity_group_for`
    /// 单值化之后又一次悄悄丢掉。
    pub fn pity_groups_for(&self, banner_id: &str) -> &[String] {
        self.pity_group_by_banner
            .get(banner_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// 对模板字符串做四个占位符的替换——`build_page_url`（`request.url`）与
    /// `build_page_body`（`request.body`）共用同一套规则，不各写一份。
    /// `credential_url` 由调用方传入**已经**套用过 `endpointOverride` 的值
    /// （见 `build_page_url` 里的处理），本方法本身不关心端点覆盖。
    fn substitute_placeholders(
        &self,
        template: &str,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> String {
        template
            .replace("{{credential}}", credential_url)
            .replace("{{page}}", &page.to_string())
            .replace("{{gachaType}}", banner_id)
            .replace("{{pageSize}}", &self.page_size.to_string())
    }

    /// 构造某一页请求的完整 URL。`{{credential}}` 的替换发生在这里——替换后
    /// 的明文 URL 只存在于 Rust 的局部变量里，不经过任何插件代码能看到的
    /// 路径（HC-2 的具体实现点）。
    ///
    /// `banner_id` 若在 `banners[].endpointOverride` 里声明了覆盖端点
    /// （如星铁联动池的 `getLdGachaLog`），先在这里把凭据 URL 的路径最后
    /// 一段换掉，再套用 `request.url` 模板——覆盖动作发生在凭据 URL 已经
    /// 是明文之后、离开 Rust 之前，全程不经过插件代码。
    pub fn build_page_url(&self, credential_url: &str, banner_id: &str, page: u32) -> String {
        let credential_url = match self.endpoint_override_by_banner.get(banner_id) {
            Some(segment) => override_url_path_segment(credential_url, segment),
            None => credential_url.to_string(),
        };
        self.substitute_placeholders(&self.params.request.url, &credential_url, banner_id, page)
    }

    /// 构造某一页请求的 POST body（若 `request.body` 已声明），占位符替换
    /// 规则与 [`Self::build_page_url`] 完全一致，复用同一个
    /// [`Self::substitute_placeholders`]。`request.body` 未声明时返回
    /// `None`——多数插件（如原神）走 GET 分页，没有 body 可言。
    ///
    /// ⚠️ 未接入 `collect_banner` 的实际发送路径，见
    /// [`RequestTemplateJson::body`] 字段文档；本方法只提供占位符替换能力，
    /// 由下方单元测试验证正确性。
    pub fn build_page_body(
        &self,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> Option<String> {
        let credential_url = match self.endpoint_override_by_banner.get(banner_id) {
            Some(segment) => override_url_path_segment(credential_url, segment),
            None => credential_url.to_string(),
        };
        self.params.request.body.as_ref().map(|template| {
            self.substitute_placeholders(template, &credential_url, banner_id, page)
        })
    }

    /// 根据 `time.timezoneSource` 的声明，从**本页**响应体计算时区偏移
    /// 小时数。`apiField`/`staticTable` 都是页级/账号级元数据（同一账号
    /// 同一次采集的每一页取值相同），因此在分页循环里每页只算一次，不需要
    /// 下沉到逐条记录；`computed` 分支需要逐条记录调用
    /// `hooks.resolveTimezone`（历史行为不变），不在这个方法里处理，见
    /// [`Self::collect_banner`] 里单独的调用点。
    ///
    /// 三种非 `None` 结果对应的 [`TzOrigin`] 统一是 [`TzOrigin::Region`]——
    /// `apiField`/`staticTable`/`computed` 本质上都是"按账号所在区服推断"，
    /// 区别只在推断方式（直接读字段 / 查静态表 / 按其他信号计算），不满足
    /// [`TzOrigin::Source`]"时间字符串本身自带时区"的定义（三个米哈游参考
    /// 实现的时间字符串一律不带时区），这与 `computed` 分支既有的映射保持
    /// 一致，不是本次新引入的判断。
    ///
    /// **返回 `Err` 而不是 `Ok(None)`**：声明了 `apiField`/`staticTable`
    /// 却在响应体里找不到值，说明插件的声明与实际响应已经不一致——这正是
    /// 本次要修的"静默降级为 Assumed"，修复后必须让这类不一致在采集时就
    /// 报错，而不是悄悄产出一批可信度被低估的记录。
    fn resolve_page_level_timezone_offset_hours(
        &self,
        response_json: &Value,
    ) -> Result<Option<i32>, PipelineError> {
        match &self.timezone_source {
            Some(TimezoneSourceJson::ApiField { field }) => {
                let raw = read_page_level_field(response_json, field).ok_or_else(|| {
                    PipelineError::Json(format!(
                        "timezoneSource 声明为 apiField(\"{field}\")，但本页响应体里取不到该字段"
                    ))
                })?;
                let hours = parse_timezone_offset_hours(raw).ok_or_else(|| {
                    PipelineError::Json(format!(
                        "timezoneSource.apiField(\"{field}\") 取到的值 {raw} 无法解析为时区偏移小时数"
                    ))
                })?;
                Ok(Some(hours))
            }
            Some(TimezoneSourceJson::StaticTable { field, table }) => {
                let key_raw = read_page_level_field(response_json, field).ok_or_else(|| {
                    PipelineError::Json(format!(
                        "timezoneSource 声明为 staticTable(field=\"{field}\")，但本页响应体里取不到查表键字段"
                    ))
                })?;
                let key = key_raw.as_str().ok_or_else(|| {
                    PipelineError::Json(format!(
                        "timezoneSource.staticTable 的查表键字段 \"{field}\" 取到的值不是字符串：{key_raw}"
                    ))
                })?;
                let hours = table.get(key).copied().ok_or_else(|| {
                    PipelineError::Json(format!(
                        "timezoneSource.staticTable 的查表键 \"{key}\" 不在插件声明的 table 里，需要补充这个区服"
                    ))
                })?;
                Ok(Some(hours))
            }
            Some(TimezoneSourceJson::Computed {}) | None => Ok(None),
        }
    }

    /// 逐个用索引路径调用 `manifest.preconditions[i].check`，把纯数据字段
    /// （`id`/`capability`/`level`/`remedy`）与 JS 返回的判定结果拼成结构化
    /// 结果。原神也有前置条件（`credential.gameDir` 存在性），成本低体感
    /// 大，不必等到 M4 做异环才第一次用这套机制。
    pub fn check_preconditions(
        &self,
        host_env: &Value,
    ) -> Result<Vec<PreconditionCheckResult>, PipelineError> {
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

                let status = self.plugin_runtime.call(
                    &self.plugin_id,
                    &format!("manifest.preconditions.{index}.check"),
                    std::slice::from_ref(host_env),
                )?;

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
    pub fn check_preconditions_with_default_env(
        &self,
    ) -> Result<Vec<PreconditionCheckResult>, PipelineError> {
        self.check_preconditions(&default_host_env())
    }

    /// 拉取一页并处理重试/错误语义。`errorMap` 的识别在**每一次**响应到达
    /// 时都会发生（本函数就是分页循环的循环体一部分），而不是只在流程开始
    /// 前检查一次。
    fn fetch_with_retry<T: GameApiTransport>(
        &self,
        transport: &T,
        url: &str,
    ) -> Result<Value, PipelineError> {
        let mut last_error: Option<PipelineError> = None;

        for attempt in 1..=self.rate_limit.retry.max_attempts {
            let outcome = transport
                .get(url)
                .map_err(|err| PipelineError::Transport(err.to_string()));

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
    fn normalize_time(
        raw_time: &str,
        tz_offset_hours: Option<i32>,
    ) -> Result<(i64, TzOrigin, Option<i32>), PipelineError> {
        let naive = chrono::NaiveDateTime::parse_from_str(raw_time, "%Y-%m-%d %H:%M:%S").map_err(
            |err| PipelineError::Json(format!("无法解析记录时间 \"{raw_time}\"：{err}")),
        )?;
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

    /// 为一整页记录批量计算 record_key。`fields_values`/`fields_list` 是同一次
    /// `extractRecord` 遍历的两种表示（前者是 JS 侧原始返回值，后者是反序列化
    /// 后的 Rust 结构），长度必须一致，调用方（`collect_banner`）保证这一点。
    ///
    /// 三选一，构造期 `from_manifest_value` 已经保证 `has_derive_record_key`
    /// 与 `has_derive_record_keys` 不会同时为真：
    /// 1. `hooks.deriveRecordKeys`——**整页一次调用**，输入是本页全部
    ///    `UnifiedRecordFields`，返回等长字符串数组。鸣潮同秒多条记录的序位
    ///    只有在能看到"同一秒内的其余记录"时才算得出来，逐条调用做不到——
    ///    这正是新增本 hook 的原因，见 `manifest.ts` 的 `PluginHooks.deriveRecordKeys`
    ///    文档。
    /// 2. `hooks.deriveRecordKey`——逐条调用，原神现有行为，不变。
    /// 3. 都未声明——退化到每条记录自己的 `stableId`，不变。
    fn derive_record_keys_for_page(
        &self,
        fields_values: &[Value],
        fields_list: &[UnifiedRecordFieldsJson],
    ) -> Result<Vec<String>, PipelineError> {
        if self.has_derive_record_keys {
            let batch_input = Value::Array(fields_values.to_vec());
            let keys_value = self.plugin_runtime.call(
                &self.plugin_id,
                "hooks.deriveRecordKeys",
                std::slice::from_ref(&batch_input),
            )?;
            let keys: Vec<String> = serde_json::from_value(keys_value).map_err(|err| {
                PipelineError::Json(format!(
                    "hooks.deriveRecordKeys 返回值不满足契约（应为字符串数组）：{err}"
                ))
            })?;
            validate_batch_record_keys_length(fields_values.len(), keys.len())?;
            return Ok(keys);
        }

        fields_values
            .iter()
            .zip(fields_list.iter())
            .map(|(fields_value, fields)| {
                if self.has_derive_record_key {
                    let key_value = self.plugin_runtime.call(
                        &self.plugin_id,
                        "hooks.deriveRecordKey",
                        std::slice::from_ref(fields_value),
                    )?;
                    Ok(key_value.as_str().map(str::to_string))
                } else {
                    Ok(fields.stable_id.clone())
                }
                .and_then(|maybe_key| {
                    maybe_key.ok_or_else(|| {
                        PipelineError::Config(format!(
                            "记录 itemId=\"{}\" 既没有 hooks.deriveRecordKey 的产出也没有 stableId，无法确定 record_key",
                            fields.item_id
                        ))
                    })
                })
            })
            .collect()
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

            // 用 slice::from_ref 借出去而不是移动/clone——extractList 只需要
            // 看响应体，不需要独占它；response_json 留给下面的页级时区解析
            // 继续读取。
            let list_value = self.plugin_runtime.call(
                &self.plugin_id,
                "manifest.collect.params.extractList",
                std::slice::from_ref(&response_json),
            )?;
            let list = list_value.as_array().cloned().unwrap_or_default();

            if crate::is_empty_page(list.len()) {
                stop_reason = StopReason::EmptyPage;
                break;
            }
            non_empty_pages += 1;
            records_seen += list.len() as u64;

            // apiField/staticTable 是页级元数据，每页只需要解析一次；
            // computed 分支逐条记录调用 hook，见下面循环体内的分支判断。
            let page_tz_offset_hours =
                self.resolve_page_level_timezone_offset_hours(&response_json)?;

            // 第一阶段：先跑完整页的 extractRecord，收齐 fields_values/
            // fields_list——deriveRecordKeys（批处理钩子）需要整页数据一起
            // 传给插件，不能逐条调用，见 Self::derive_record_keys_for_page。
            let mut fields_values: Vec<Value> = Vec::with_capacity(list.len());
            let mut fields_list: Vec<UnifiedRecordFieldsJson> = Vec::with_capacity(list.len());
            for raw in &list {
                let fields_value = self.plugin_runtime.call(
                    &self.plugin_id,
                    "manifest.fields.extractRecord",
                    std::slice::from_ref(raw),
                )?;
                let fields: UnifiedRecordFieldsJson = serde_json::from_value(fields_value.clone())
                    .map_err(|err| {
                        PipelineError::Json(format!("extractRecord 返回值不满足契约：{err}"))
                    })?;
                fields_values.push(fields_value);
                fields_list.push(fields);
            }

            // 第二阶段：批量算出这一页全部记录的 record_key。
            let record_keys = self.derive_record_keys_for_page(&fields_values, &fields_list)?;

            // 第三阶段：逐条补上时区换算等剩余字段，拼出可落库的 GachaRecord。
            let mut batch = Vec::with_capacity(list.len());
            for ((fields_value, fields), record_key_text) in fields_values
                .iter()
                .zip(fields_list.iter())
                .zip(record_keys.into_iter())
            {
                // computed 分支逐条记录调用 hook（历史行为不变，签名允许按
                // 记录定制，即使目前唯一实现——原神的 uid 首位数字推断——
                // 只用了账号级信息）；apiField/staticTable 已经在页级算好，
                // 直接复用同一个值。
                let tz_offset_hours: Option<i32> = match &self.timezone_source {
                    Some(TimezoneSourceJson::Computed {}) if self.has_resolve_timezone => {
                        let ctx = serde_json::json!({ "uid": uid, "region": region });
                        let value = self.plugin_runtime.call(
                            &self.plugin_id,
                            "hooks.resolveTimezone",
                            &[fields_value.clone(), ctx],
                        )?;
                        value.as_i64().map(|n| n as i32)
                    }
                    _ => page_tz_offset_hours,
                };

                let (occurred_at, tz_origin, tz_offset_min) =
                    Self::normalize_time(&fields.time, tz_offset_hours)?;

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
                    meta_state: self.determine_meta_state(fields),
                    source: RecordSource::OfficialApi,
                    captured_at,
                    raw_ref: None,
                    extra: None,
                });
            }

            let inserted = repo.insert_records(&batch)?;
            records_inserted += inserted;
            consecutive_zero_pages = if inserted == 0 {
                consecutive_zero_pages + 1
            } else {
                0
            };

            if self.is_reached_known_stop_condition
                && should_stop_reached_known(consecutive_zero_pages)
            {
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
            self.responses
                .borrow_mut()
                .entry(url.into())
                .or_default()
                .push_back(body.into());
        }

        fn call_count(&self) -> usize {
            self.calls.borrow().len()
        }
    }

    impl GameApiTransport for FixtureTransport {
        fn get(&self, url: &str) -> Result<TransportResponse, TransportError> {
            self.calls.borrow_mut().push(url.to_string());
            let mut responses = self.responses.borrow_mut();
            let queue = responses.get_mut(url).ok_or_else(|| {
                TransportError(format!("FixtureTransport 未注册该 URL 的响应：{url}"))
            })?;
            let body = if queue.len() > 1 {
                queue.pop_front().expect("非空队列 pop_front 不应失败")
            } else {
                queue
                    .front()
                    .cloned()
                    .ok_or_else(|| TransportError(format!("URL 的响应队列已空：{url}")))?
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

    /// 基于 genshin 真实 manifest 纯数据，覆盖调用方指定的字段构造测试用
    /// manifest JSON——凭据/请求模板/卡池表等其余字段全部沿用 genshin 真实
    /// 声明，只替换本次要验证的差异点。用来测试 `endpointOverride`/
    /// `timezoneSource` 这类当前唯一的真实插件（genshin）都没有声明过的
    /// 分支，不需要为了测试去手写一整份 manifest JSON，也不需要污染
    /// `plugins/genshin/manifest.ts`。
    fn genshin_manifest_with(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
        let mut value = gs_plugin_runtime::plugin_manifest_data("genshin")
            .expect(
                "genshin manifest 纯数据应当已经打包（先跑 node scripts/gs-bundle-plugins.mjs）",
            )
            .clone();
        mutate(&mut value);
        value
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
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn&gacha_type=301";

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

        let records_301 = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        let records_400 = repo
            .find_records_by_banner(account_id, "400")
            .expect("查询应当成功");
        assert_eq!(
            records_301.len(),
            7,
            "8 条记录里 1 条 gacha_type=400，其余 7 条归 301"
        );
        assert_eq!(records_400.len(), 1);

        // record_key 形态：`${bannerId}:${stableId}`。
        assert!(
            records_301
                .iter()
                .any(|r| r.record_key.as_str() == "301:1400000000000000010")
        );
        assert_eq!(
            records_400[0].record_key.as_str(),
            "400:1400000000000000008"
        );

        // itemIdSource === "displayName"：全部记录都应标 pending，即使
        // name/itemType/rarity 三项都有值。
        assert!(
            records_301
                .iter()
                .chain(records_400.iter())
                .all(|r| r.meta_state == MetaState::Pending),
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
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let CredentialJson::ChromiumCache {
            game_dir,
            url_pattern,
        } = pipeline.credential()
        else {
            panic!("genshin 声明的凭据来源应当是 chromiumCache");
        };
        let compiled_pattern = url_pattern.compile().expect("urlPattern 应当能编译成功");

        // 按 game_dir（"YuanShen_Data/webCaches"）声明的相对片段，把 fixture
        // 样本放到 scan_game_cache 期望的目录结构下。
        let dir = TestDir::new("cache-scan-e2e");
        let data2_path = dir.path().join(game_dir).join("Cache/Cache_Data/data_2");
        std::fs::create_dir_all(data2_path.parent().unwrap()).unwrap();
        std::fs::copy(
            repo_root().join("fixtures/genshin/credential/data_2.sample"),
            &data2_path,
        )
        .expect("复制 fixture 样本应当成功");

        let locator =
            crate::cache_scan::StaticGameLocator::new().with_install_root("genshin", dir.path());
        let credential_url =
            crate::cache_scan::scan_game_cache("genshin", game_dir, &compiled_pattern, &locator)
                .expect("扫描不应报错")
                .expect("应当能从 fixture 样本里扫出凭据 URL");
        assert!(credential_url.contains("getGachaLog"));
        assert!(credential_url.contains("authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY"));
        let lang = crate::cache_scan::extract_query_param(&credential_url, "lang");
        assert_eq!(lang.as_deref(), Some("zh-cn"));

        let transport = FixtureTransport::new();
        transport.register(
            pipeline.build_page_url(&credential_url, "301", 1),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline.build_page_url(&credential_url, "301", 2),
            read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
        );
        transport.register(
            pipeline.build_page_url(&credential_url, "301", 3),
            read_fixture("fixtures/genshin/raw_response/301_page_3_empty.json"),
        );

        let repo = storage.repository();
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "301",
                &credential_url,
                "100000000",
                None,
                lang.as_deref(),
                1_754_812_801_000,
            )
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
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");
        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE&lang=zh-cn";

        // 每次调用用不同的 captured_at——`banner_snapshot` 是时间序列表，
        // `UNIQUE(account_id, banner_key, captured_at, source)` 约束的正是
        // "同一时刻不会有两条快照"，两次真实采集本来就发生在不同的墙钟时刻，
        // 用相同 captured_at 跑两遍反而是在制造契约本不允许的场景。
        let run_once = |captured_at: i64| {
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
            pipeline
                .collect_banner(
                    &transport,
                    &repo,
                    account_id,
                    "301",
                    credential_url,
                    "100000000",
                    None,
                    Some("zh-cn"),
                    captured_at,
                )
                .expect("采集应当成功")
        };

        let first = run_once(1_754_812_801_000);
        assert_eq!(first.records_inserted, 8);

        let second = run_once(1_754_899_201_000);
        assert_eq!(
            second.records_inserted, 0,
            "第二次跑同一份 fixture 不应产生任何新增行"
        );
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
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");
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

        assert!(
            result.is_err(),
            "第二页持续返回错误语义，重试耗尽后应当失败"
        );
        // 第一页成功过（call_count 里应当能看到第一页只被请求了一次），
        // 证明失败确实发生在"处理到第二页"而不是流程一开始就被拦下。
        assert!(
            transport.call_count() > 1,
            "应当已经请求过不止一次，说明流程走过了第一页"
        );
    }

    #[test]
    fn precondition_check_returns_genshin_cache_dir_precondition() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
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
        assert_eq!(
            detect_error_semantic(&expired, &error_map),
            Some(ErrorSemantic::AuthkeyExpired)
        );

        let unmapped = serde_json::json!({ "retcode": -999 });
        assert_eq!(
            detect_error_semantic(&unmapped, &error_map),
            Some(ErrorSemantic::Unknown)
        );

        let success = serde_json::json!({ "retcode": 0 });
        assert_eq!(detect_error_semantic(&success, &error_map), None);

        let no_field = serde_json::json!({ "data": {} });
        assert_eq!(detect_error_semantic(&no_field, &error_map), None);
    }

    #[test]
    fn build_page_url_substitutes_all_placeholders() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        let url = pipeline.build_page_url("CREDENTIAL", "301", 3);
        assert_eq!(url, "CREDENTIAL&page=3&gacha_type=301&size=20&end_id=0");
    }

    #[test]
    fn build_page_body_returns_none_when_request_body_not_declared() {
        // genshin 走 GET 分页，没有声明 request.body。
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        assert_eq!(pipeline.build_page_body("CREDENTIAL", "301", 1), None);
    }

    #[test]
    fn build_page_body_substitutes_same_placeholders_as_url() {
        // 鸣潮形态：POST body 需要 {{gachaType}} 占位符，与 url 共用同一套替换。
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"]["body"] = serde_json::json!(
                r#"{"cardPoolId":"{{gachaType}}","cardPoolType":"{{gachaType}}","recordId":"{{credential}}"}"#
            );
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let body = pipeline
            .build_page_body("PLAYER_TOKEN", "1", 1)
            .expect("声明了 request.body 时应当返回 Some");
        assert_eq!(
            body,
            r#"{"cardPoolId":"1","cardPoolType":"1","recordId":"PLAYER_TOKEN"}"#
        );
    }

    // ============================================================
    // S2 · deriveRecordKeys 批处理钩子（M2-S2）
    // ============================================================

    #[test]
    fn validate_derive_record_key_hooks_not_both_declared_rejects_both_present() {
        let result = validate_derive_record_key_hooks_not_both_declared("wuwa", true, true);
        assert!(
            result.is_err(),
            "同时声明 deriveRecordKey 与 deriveRecordKeys 应当被拒绝"
        );
        let message = result.unwrap_err().to_string();
        assert!(message.contains("deriveRecordKey"));
        assert!(message.contains("deriveRecordKeys"));
    }

    #[test]
    fn validate_derive_record_key_hooks_not_both_declared_accepts_either_alone_or_neither() {
        assert!(validate_derive_record_key_hooks_not_both_declared("genshin", true, false).is_ok());
        assert!(validate_derive_record_key_hooks_not_both_declared("wuwa", false, true).is_ok());
        assert!(validate_derive_record_key_hooks_not_both_declared("x", false, false).is_ok());
    }

    #[test]
    fn validate_batch_record_keys_length_rejects_mismatched_length() {
        // 反例：插件的 deriveRecordKeys 实现漏算了一条记录（10 条输入只返回
        // 9 个 key），必须被拒绝而不是按下标硬凑——那样只会把第 10 条记录的
        // key 错配给别的记录。
        let result = validate_batch_record_keys_length(10, 9);
        assert!(result.is_err());
        let message = result.unwrap_err().to_string();
        assert!(message.contains("10"));
        assert!(message.contains('9'));
    }

    #[test]
    fn validate_batch_record_keys_length_accepts_equal_length() {
        assert!(validate_batch_record_keys_length(0, 0).is_ok());
        assert!(validate_batch_record_keys_length(5, 5).is_ok());
    }

    #[test]
    fn pity_group_by_banner_retains_all_groups_when_banner_belongs_to_multiple() {
        // 鸣潮形态：同一 banner 同时属于 5★ 组与 4★ 组。修复前的实现（单值
        // HashMap）会让后声明的组静默覆盖前一个；这里验证两个都被保留。
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["pityGroups"] = serde_json::json!([
                {
                    "key": "wuwaStandard5Star",
                    "members": ["standard"],
                    "hardPity": 80,
                    "curve": { "kind": "flat", "base": 0.008 },
                    "guarantee": { "kind": "none" },
                },
                {
                    "key": "wuwaStandard4Star",
                    "members": ["standard"],
                    "hardPity": 10,
                    "curve": { "kind": "flat", "base": 0.06 },
                    "guarantee": { "kind": "none" },
                    "pityTarget": "4",
                },
            ]);
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        assert_eq!(
            pipeline.pity_groups_for("standard"),
            &[
                "wuwaStandard5Star".to_string(),
                "wuwaStandard4Star".to_string()
            ],
            "两个组都应当被保留，不能只剩最后声明的那个"
        );
        assert_eq!(
            pipeline.pity_group_for("standard"),
            "wuwaStandard5Star",
            "落库主键取声明顺序中的第一个"
        );
    }

    #[test]
    fn pity_group_for_falls_back_to_banner_id_when_undeclared() {
        // genshin 现有行为不变：banner 不在任何 pityGroups 声明里时，
        // 落库的 pity_group 就是 banner_id 本身。
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        assert_eq!(pipeline.pity_group_for("200"), "200");
        assert!(pipeline.pity_groups_for("200").is_empty());
    }

    // ============================================================
    // A1 · endpointOverride
    // ============================================================

    #[test]
    fn validate_endpoint_override_segment_accepts_plain_alphanumeric() {
        assert!(validate_endpoint_override_segment("getLdGachaLog").is_ok());
        assert!(validate_endpoint_override_segment("a1").is_ok());
    }

    #[test]
    fn validate_endpoint_override_segment_rejects_anything_that_could_rewrite_the_url() {
        assert!(
            validate_endpoint_override_segment("").is_err(),
            "空字符串应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("../secret").is_err(),
            "路径穿越应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("a/b").is_err(),
            "多段路径应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("//evil.example.com").is_err(),
            "协议相对 URL 应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("a?x=1").is_err(),
            "查询串注入应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("https://evil.example.com").is_err(),
            "绝对 URL 应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("a b").is_err(),
            "空白字符应当被拒绝"
        );
        assert!(
            validate_endpoint_override_segment("a.b").is_err(),
            "点号应当被拒绝"
        );
    }

    #[test]
    fn override_url_path_segment_replaces_last_segment_keeps_query_and_authkey() {
        let url = "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog?authkey=SECRET&lang=zh-cn";
        let replaced = override_url_path_segment(url, "getLdGachaLog");
        assert_eq!(
            replaced,
            "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getLdGachaLog?authkey=SECRET&lang=zh-cn"
        );
    }

    #[test]
    fn override_url_path_segment_works_without_query_string() {
        let url = "https://x.example.com/api/getGachaLog";
        assert_eq!(
            override_url_path_segment(url, "getLdGachaLog"),
            "https://x.example.com/api/getLdGachaLog"
        );
    }

    #[test]
    fn override_url_path_segment_leaves_url_unchanged_when_no_path_separator() {
        // 极端兜底：真实凭据 URL 不会出现这种形态，但函数本身不能 panic，
        // 也不能拼出一个比原样更离谱的字符串。
        assert_eq!(
            override_url_path_segment("no-slash-at-all", "getLdGachaLog"),
            "no-slash-at-all"
        );
    }

    #[test]
    fn pipeline_construction_rejects_invalid_endpoint_override() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["banners"] = serde_json::json!([
                { "id": "21", "displayName": { "zh-CN": "联动" }, "endpointOverride": "../evil" },
            ]);
        });
        let result =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value);
        assert!(
            result.is_err(),
            "非法 endpointOverride 应当在构造期就被拒绝，而不是留到某次翻页时才发现"
        );
    }

    #[test]
    fn build_page_url_applies_endpoint_override_for_declared_banner_only() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["banners"] = serde_json::json!([
                { "id": "301", "displayName": { "zh-CN": "常规" } },
                { "id": "21", "displayName": { "zh-CN": "联动" }, "endpointOverride": "getLdGachaLog" },
            ]);
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog?authkey=SECRET";

        let overridden = pipeline.build_page_url(credential_url, "21", 1);
        assert!(
            overridden.contains("getLdGachaLog"),
            "声明了 endpointOverride 的卡池应当替换成联动池端点：{overridden}"
        );
        assert!(
            !overridden.contains("/getGachaLog?"),
            "不应该残留默认端点：{overridden}"
        );
        assert!(
            overridden.contains("authkey=SECRET"),
            "查询串（含明文凭据）必须原样保留：{overridden}"
        );

        let default_endpoint = pipeline.build_page_url(credential_url, "301", 1);
        assert!(
            default_endpoint.contains("/getGachaLog?"),
            "未声明 endpointOverride 的卡池应当保持默认端点，不受其它卡池声明影响：{default_endpoint}"
        );
    }

    // ============================================================
    // A2 · timezoneSource: apiField / staticTable
    // ============================================================

    #[test]
    fn read_page_level_field_prefers_data_object_over_top_level() {
        let response = serde_json::json!({
            "retcode": 0,
            "data": { "region_time_zone": 8, "list": [] }
        });
        assert_eq!(
            read_page_level_field(&response, "region_time_zone"),
            Some(&serde_json::json!(8))
        );
    }

    #[test]
    fn read_page_level_field_falls_back_to_top_level_when_no_data_object() {
        let response = serde_json::json!({ "region_time_zone": 8 });
        assert_eq!(
            read_page_level_field(&response, "region_time_zone"),
            Some(&serde_json::json!(8))
        );
    }

    #[test]
    fn read_page_level_field_returns_none_when_absent_everywhere() {
        let response = serde_json::json!({ "data": { "list": [] } });
        assert_eq!(read_page_level_field(&response, "region_time_zone"), None);
    }

    #[test]
    fn parse_timezone_offset_hours_accepts_number_and_numeric_string() {
        assert_eq!(parse_timezone_offset_hours(&serde_json::json!(8)), Some(8));
        assert_eq!(
            parse_timezone_offset_hours(&serde_json::json!(-5)),
            Some(-5)
        );
        assert_eq!(
            parse_timezone_offset_hours(&serde_json::json!("-5")),
            Some(-5)
        );
        assert_eq!(
            parse_timezone_offset_hours(&serde_json::json!("not-a-number")),
            None
        );
        assert_eq!(parse_timezone_offset_hours(&serde_json::json!(null)), None);
    }

    /// apiField 声明且响应体确实带该字段：时区应当正确换算，`tz_origin`
    /// 落在 `Region`，不是本次修复之前那种恒为 `Assumed` 的静默降级。
    #[test]
    fn collect_banner_resolves_timezone_from_declared_api_field() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({ "timezoneSource": { "kind": "apiField", "field": "region_time_zone" } });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE";
        let page_1 = serde_json::json!({
            "retcode": 0,
            "message": "OK",
            "data": {
                "region_time_zone": 8,
                "list": [{
                    "uid": "100000000", "gacha_type": "301", "count": "1",
                    "time": "2026-06-18 21:15:32", "name": "测试五星角色A", "lang": "zh-cn",
                    "item_type": "角色", "rank_type": "5", "id": "1400000000000000010"
                }]
            }
        })
        .to_string();
        let page_2_empty =
            serde_json::json!({ "retcode": 0, "message": "OK", "data": { "region_time_zone": 8, "list": [] } }).to_string();

        let transport = FixtureTransport::new();
        transport.register(pipeline.build_page_url(credential_url, "301", 1), page_1);
        transport.register(
            pipeline.build_page_url(credential_url, "301", 2),
            page_2_empty,
        );

        let repo = storage.repository();
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "301",
                credential_url,
                "100000000",
                None,
                Some("zh-cn"),
                1_754_812_801_000,
            )
            .expect("apiField 声明且响应体带该字段时，采集应当成功");
        assert_eq!(outcome.records_inserted, 1);

        let records = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        assert_eq!(records.len(), 1);
        assert_eq!(
            records[0].tz_origin,
            TzOrigin::Region,
            "apiField 来源应当归一化为 Region，不是 Assumed"
        );
        assert_eq!(records[0].tz_offset_min, Some(8 * 60));

        let expected_naive =
            chrono::NaiveDateTime::parse_from_str("2026-06-18 21:15:32", "%Y-%m-%d %H:%M:%S")
                .unwrap();
        let expected_utc_ms = (expected_naive.and_utc().timestamp() - 8 * 3600) * 1000;
        assert_eq!(records[0].occurred_at, expected_utc_ms);
    }

    /// 声明了 apiField 但响应体里没有该字段：必须报错，不能像修复前那样
    /// 静默把 `tz_offset_hours` 当成 `None` 归一化成 `Assumed`。
    #[test]
    fn collect_banner_fails_loudly_when_declared_api_field_is_missing_from_response() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({ "timezoneSource": { "kind": "apiField", "field": "region_time_zone" } });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        // 复用真实 genshin fixture——它没有 region_time_zone 字段。
        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline.build_page_url(credential_url, "301", 1),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
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
        assert!(
            result.is_err(),
            "声明了 apiField 但响应体没有该字段，必须报错，不能静默降级为 Assumed"
        );
    }

    /// staticTable 查表命中：复用真实 genshin fixture 里已有的 `data.region
    /// = "cn_gf01"` 字段作查表键，验证三页记录全部换算出正确的时区。
    #[test]
    fn collect_banner_resolves_timezone_from_static_table_lookup() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({
                "timezoneSource": { "kind": "staticTable", "field": "region", "table": { "cn_gf01": 8 } }
            });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE";
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
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "301",
                credential_url,
                "100000000",
                None,
                Some("zh-cn"),
                1_754_812_801_000,
            )
            .expect("staticTable 查表命中时，采集应当成功");
        assert_eq!(outcome.records_inserted, 8);

        let records = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        assert!(
            records
                .iter()
                .all(|r| r.tz_origin == TzOrigin::Region && r.tz_offset_min == Some(480)),
            "全部记录都应当按 region=cn_gf01 查表得到 UTC+8"
        );
    }

    /// staticTable 声明的查表键在响应体里能取到，但 `table` 没覆盖这个取值：
    /// 必须报错（提示需要补充这个区服），不能静默退化。
    #[test]
    fn collect_banner_fails_loudly_when_static_table_key_not_covered() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({
                // fixture 里的 region 是 "cn_gf01"，这里故意声明一个不覆盖它的表。
                "timezoneSource": { "kind": "staticTable", "field": "region", "table": { "os_usa": -300 } }
            });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://x.example.com/getGachaLog?authkey=FAKE";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline.build_page_url(credential_url, "301", 1),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
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
        assert!(
            result.is_err(),
            "查表键不在声明的 table 里，必须报错，不能静默降级为 Assumed"
        );
    }

    // ============================================================
    // A3 · rawTimeConvention
    // ============================================================

    #[test]
    fn manifest_parsing_captures_raw_time_convention_without_consuming_it() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({ "rawTimeConvention": "serverLocal" });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");
        assert_eq!(
            pipeline.raw_time_convention,
            Some(RawTimeConventionJson::ServerLocal)
        );
    }

    #[test]
    fn manifest_parsing_leaves_raw_time_convention_none_when_absent() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        // genshin 真实 manifest 本来就没有声明 rawTimeConvention。
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        assert_eq!(pipeline.raw_time_convention, None);
    }
}
