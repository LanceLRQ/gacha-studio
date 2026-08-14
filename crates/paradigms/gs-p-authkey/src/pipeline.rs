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
use crate::cache_scan::InstalledGameLocator;
use crate::log_scan::LogScanError;
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
    /// 占位符替换完成之后的最终请求 URL，其 host 不在插件声明的
    /// `allowedHosts` 白名单内——见 [`AuthkeyApiPipeline::validate_request_url_host`]
    /// 与 crate 顶部 §7.8 裁定。**不携带完整 URL**（URL 含替换后的明文凭据，
    /// 见 `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md`
    /// §7.8 关于错误信息不能泄露明文凭据的要求），只携带插件 id 与解析出的
    /// host（解析失败时为 `None`）。
    HostNotAllowed {
        plugin_id: String,
        host: Option<String>,
    },
    /// `{{credential.<queryParam>}}` 具名占位符解析失败——见
    /// [`AuthkeyApiPipeline::substitute_named_credential_placeholders`] 的
    /// 三条 fail-closed 规则（参数不存在 / 值含非法字符 / 均不得静默放行）。
    ///
    /// **不携带凭据 URL 或解析出的参数值**，只携带插件 id 与占位符名称——
    /// 与 [`Self::HostNotAllowed`] 同一条理由：这类失败往往正是"凭据被
    /// 投毒"的信号，错误信息本身还可能被写进日志，携带明文凭据片段等于
    /// 把证据递给攻击者。
    CredentialParamInvalid {
        plugin_id: String,
        param_name: String,
        reason: &'static str,
    },
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
            Self::HostNotAllowed { plugin_id, host } => match host {
                Some(host) => write!(
                    f,
                    "插件 \"{plugin_id}\" 的请求目标 host \"{host}\" 不在 allowedHosts 白名单内，请求已拒绝"
                ),
                None => write!(
                    f,
                    "插件 \"{plugin_id}\" 的请求 URL 无法解析出合法 host，请求已拒绝"
                ),
            },
            Self::CredentialParamInvalid {
                plugin_id,
                param_name,
                reason,
            } => write!(
                f,
                "插件 \"{plugin_id}\" 的占位符 \"{{{{credential.{param_name}}}}}\" 解析失败：{reason}"
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

// LogScanError 的两个变体（游戏未在宿主配置里登记安装目录 / 日志文件读取
// 失败）本质上都是"缺少可用的采集前置条件"，语义上与 Config 变体（manifest
// 纯数据缺失/形状不对）最贴近——都是"流程还没走到发请求那一步就已经无法
// 继续"，不是 HTTP 传输失败（Transport 变体特指网络往返），也不是 JSON
// 解析失败（Json 变体）。两个调用点（见 [`AuthkeyApiPipeline::
// resolve_log_credential`]）不足以单开一个专属变体。
impl From<LogScanError> for PipelineError {
    fn from(err: LogScanError) -> Self {
        Self::Config(err.to_string())
    }
}

impl From<crate::cache_scan::CacheScanError> for PipelineError {
    fn from(err: crate::cache_scan::CacheScanError) -> Self {
        Self::Config(err.to_string())
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
///
/// ⚠️ **`post` 没有默认实现**——这是有意为之。带默认实现的话，默认体只能
/// 返回一个"不支持 POST"的错误，那正是本项目反复抓到的失效模式："看起来
/// 有防护、实际什么都没做"：新增一个实现者时完全可以忘记覆写 `post`，
/// 编译器不会提醒，直到真跑到鸣潮这类 POST 范式时才在运行时报错。不给
/// 默认实现，让编译器强制每个实现者显式表态。
pub trait GameApiTransport {
    fn get(&self, url: &str) -> Result<TransportResponse, TransportError>;
    fn post(
        &self,
        url: &str,
        body: &str,
        headers: &std::collections::BTreeMap<String, String>,
    ) -> Result<TransportResponse, TransportError>;
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

    /// `Content-Type` 等请求头完全由插件通过 `request.headers` 声明——
    /// **不在这里硬编码 `application/json`**：具体发什么内容类型是游戏
    /// 知识（鸣潮的接口要什么头，只有插件作者知道），不是范式能力，硬编码
    /// 一个"看起来总是对"的默认值，下一个 POST 范式的游戏若需要不同的
    /// `Content-Type` 就只能改 Rust 主程序，违反"新游戏只改插件"的目标。
    fn post(
        &self,
        url: &str,
        body: &str,
        headers: &std::collections::BTreeMap<String, String>,
    ) -> Result<TransportResponse, TransportError> {
        let mut request = self.client.post(url).body(body.to_string());
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        let response = request
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
    /// 请求目标 host 白名单，**必填**——本字段没有 `#[serde(default)]`，
    /// manifest 里完全缺失这个键会在这里直接反序列化失败（`from_manifest_value`
    /// 的 `serde_json::from_value` 调用点），"忘了填"与"故意留空数组"是两种
    /// 不同的构造期拒绝路径，后者由 [`validate_allowed_hosts`] 负责。
    /// 非空/合法性校验、以及"必须在占位符替换之后校验最终 URL"的完整理由，
    /// 见 `packages/gs-plugin-kit/manifest.ts` 的
    /// `CredentialedApiPipelineParams.allowedHosts` 文档与 crate 顶部 §7.8 裁定。
    #[serde(rename = "allowedHosts")]
    pub allowed_hosts: Vec<String>,
    /// 每页条数，填进 `request.url` 的 `{{pageSize}}` 占位符。
    ///
    /// > 这里曾有 `type_param` / `page_param` 两个字段。M1-S3 实现后实测确认
    /// > 它们反序列化进来之后**一行没被读过**——参数名已由 `request.url`
    /// > 模板自己写死（`&gacha_type=`、`&page=`），声明只是重复了一遍。
    /// > 已从契约删除。与本字段的区别在于：`page_size` 是**值**，真的被消费。
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
    /// 限速与重试参数声明，缺省表示插件对这项没有意见，全部沿用宿主注入的
    /// [`crate::rate_limit::RateLimitPolicy`]。**这不是"覆盖"关系**——真正
    /// 生效的策略由 [`crate::rate_limit::RateLimitPolicy::merged_with_declared`]
    /// 逐字段取更温和者算出，消费点见 [`AuthkeyApiPipeline::from_manifest_value`]。
    /// 修复前的状态：本字段整个不存在于这个反序列化镜像里，manifest 声明的
    /// `rateLimit` 会被 serde 静默丢弃——这正是本字段要堵上的缺口。
    #[serde(rename = "rateLimit", default)]
    pub rate_limit: Option<gs_core::RateLimitConfig>,
    #[serde(rename = "errorMap", default)]
    pub error_map: HashMap<String, String>,
    #[serde(rename = "stopCondition")]
    pub stop_condition: Option<StopConditionJson>,
    /// 记录的卡池归属以哪一侧为准，缺省 `Response`（历史行为不变）。消费点
    /// 见 [`AuthkeyApiPipeline::collect_banner`] 里选择 `banner_key`/
    /// `pity_group` 来源那一段；两个游戏的完整对照证据见
    /// `gs_core::BannerIdentitySource` 的文档注释与
    /// `packages/gs-plugin-kit/manifest.ts` 同名字段的文档。
    #[serde(rename = "bannerIdentity", default)]
    pub banner_identity: Option<gs_core::BannerIdentitySource>,
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
    /// 镜像 `gs_core::StopCondition::SingleRequest`——接口本身不分页，一次
    /// 请求即返回全部记录。**M2-S3 起已接线**：`collect_banner` 处理完第一次
    /// 请求（无论本页是否为空）就无条件终止循环，不再判断 `emptyPage`/
    /// `reachedKnown`。消费点见 [`AuthkeyApiPipeline`] 的
    /// `is_single_request_stop_condition` 字段与 `collect_banner` 循环体内
    /// 的判断——鸣潮 API 不认 `page` 参数，若继续沿用缺省的 `emptyPage`，
    /// 第二次请求会拿到与第一次完全相同的全量数据，`emptyPage` 永远不触发，
    /// 陷入死循环。
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
        /// 解混淆参数，省略表示日志是明文，不需要解码。真实消费点见
        /// [`AuthkeyApiPipeline::resolve_log_credential`]。
        #[serde(default)]
        decode: Option<crate::log_scan::LogDecodeSpec>,
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

/// ⚠️ **已知缺口 C8：一个 `url` 模板装不下"凭据决定的端点分支"**（M2-S3
/// 记录，未实现）。
///
/// 鸣潮参考实现按凭据 URL 的 `svr_area` 参数在两个 host 之间二选一
/// （`WWGachaExport/ViewModels/Dialogs/UpdateGachaDataDialogViewModel.cs:239-242`：
/// 国服 `gmserver-api.aki-game2.com`、国际服 `gmserver-api.aki-game2.net`）。
/// 本结构体只有**一个** `url` 模板，而 `.com` → `.net` 不是任何字符串替换
/// 能从 `svr_area="global"` 推导出来的——具名占位符
/// `{{credential.svr_area}}` 只能把 `"global"` 这个值填进去，填不出 TLD。
///
/// **刻意不实现**：本机只有国服存档样本，国际服分支无法验证。为一个验证不了
/// 的分支发明机制（如按凭据参数取值路由的 `requestVariants`），正是三次法则
/// 与本项目"不提前留判别联合分支"这条教训要防的事——占位分支能过类型检查、
/// 过所有门禁、被文档引用为设计依据，却永远跑不起来。
/// `collect.params.allowedHosts` 里同样**不预放** `.net`：预放等于声明一个
/// 跑不到的能力。等真有国际服样本再一并落地。
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RequestTemplateJson {
    pub url: String,
    /// 请求方法，缺省 GET——原神/星铁/绝区零现有行为不变。声明为 `POST`
    /// 时 [`AuthkeyApiPipeline::collect_banner`] 会改走
    /// [`GameApiTransport::post`]，见该方法的分派逻辑。
    #[serde(default)]
    pub method: Option<gs_core::HttpMethod>,
    /// 请求头模板，值与 `url`/`body` 共用同一套占位符替换规则（含具名的
    /// `{{credential.<queryParam>}}`），见
    /// [`AuthkeyApiPipeline::build_page_headers`]。键（header 名）不做替换
    /// ——占位符只用于凭据这类"值会变化"的场景，header 名本身是插件的静态
    /// 声明。典型用途：`Cookie`/`Authorization` 这类凭据不适合塞进 URL 或
    /// body 的场景。
    #[serde(default)]
    pub headers: Option<std::collections::BTreeMap<String, String>>,
    /// POST 请求体模板，占位符替换规则与 `url` 完全一致，见
    /// [`AuthkeyApiPipeline::substitute_placeholders`]。`method` 声明为
    /// `POST` 时必须同时声明本字段，否则 [`AuthkeyApiPipeline::collect_banner`]
    /// 会在构造请求时报 [`PipelineError::Config`]。
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
    /// 记录时间字符串的书写格式，消费点见 [`parse_record_time`]——插件声明
    /// 什么格式，就只按那一种解析，不再依次尝试多种格式。
    #[serde(rename = "rawFormat")]
    raw_format: Option<RawTimeFormatJson>,
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

/// 对应 `gs_core::RawTimeFormat`，理由同 [`RawTimeConventionJson`] 顶部说明
/// ——本文件不直接复用 `gs_core` 的判别联合，一律单独声明一份只做反序列化的
/// 镜像。两个变体都是空 payload，可以派生 `Copy`，方便按值传给
/// [`parse_record_time`]/[`AuthkeyApiPipeline::normalize_time`] 而不必操心
/// 借用生命周期。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind")]
enum RawTimeFormatJson {
    #[serde(rename = "spaceSeparated")]
    SpaceSeparated {},
    #[serde(rename = "isoLocal")]
    IsoLocal {},
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

/// 即将请求的 `page` 是否命中"每 N 页额外停顿一次"（`RateLimitPolicy::
/// batch_pause`）的触发点，检查发生在该页请求真正发出**之前**——与三方
/// 参考实现的顺序一致（`getData.js` 的 `if (page % 10 === 0) { await sleep(1) }`
/// 在 `getGachaLog(...)` 调用之前），语义是"翻到第 N/2N/3N... 页之前先歇一下"，
/// 不是"翻完这些页之后再歇"。`every_n_pages` 为 0 会导致取模 panic，但这个
/// 不变量在构造期已经由 `validate_declared_batch_size` 保证，这里不重复
/// 判断——与 `should_stop_reached_known` 同样的理由抽成独立函数：脱离完整
/// pipeline 单独测试这条判断本身。
pub fn should_batch_pause(page: u32, every_n_pages: u32) -> bool {
    page % every_n_pages == 0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    EmptyPage,
    ReachedKnown,
    /// `stopCondition: { kind: "singleRequest" }`：处理完第一次请求（无论
    /// 本页是否为空）即终止，不判断 `emptyPage`/`reachedKnown`。
    SingleRequest,
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

// ============================================================
// allowedHosts：请求目标 host 白名单（§7.8 裁定）
// ============================================================

/// `allowedHosts` 单个条目的合法性校验：不接受 scheme、路径、query、通配符、
/// 空白，冒号只允许出现在"host:端口号"这一种形态里。
///
/// 比 [`validate_endpoint_override_segment`] 宽松（真实 host 本来就含 `.`
/// 与 `-`），但精神一致——不接受任何会重新引入"这段字符串到底匹配到哪"
/// 解释空间的写法，尤其是通配符：一旦允许 `*.example.com`，`*` 匹配到的
/// 边界本身就是一段需要另外定义的语义，等于把 `endpointOverride` 已经拒绝
/// 过的同一类风险重新引入白名单机制。校验放在 pipeline 构造期（同
/// [`validate_endpoint_override_segment`] 的理由），声明不合法直接拒绝
/// 启动，不留到某次请求发出前才发现。
fn validate_allowed_host_entry(host: &str) -> Result<(), &'static str> {
    if host.is_empty() {
        return Err("不能是空字符串");
    }
    if host.contains("://") {
        return Err("不能包含 scheme（形如 \"https://\"），只写 host 本身");
    }
    if host.contains('/') {
        return Err("不能包含路径分隔符 \"/\"");
    }
    if host.contains('?') {
        return Err("不能包含查询串分隔符 \"?\"");
    }
    if host.contains('*') {
        return Err("不支持通配符 \"*\"，必须精确匹配完整 host");
    }
    if host.chars().any(|c| c.is_whitespace()) {
        return Err("不能包含空白字符");
    }
    // 冒号只允许用于"host:端口号"这一种形态：切到第一个冒号之后，剩余部分
    // 必须是纯数字端口号，且不能再出现第二个冒号（排除 IPv6 字面量这类
    // 本项目未支持的形态——fail closed，不猜测它是否合法）。
    if let Some((_, port)) = host.split_once(':') {
        let port_is_valid_port_number =
            !port.is_empty() && port.chars().all(|c| c.is_ascii_digit());
        if !port_is_valid_port_number {
            return Err("冒号只能用于端口号（形如 \"example.com:8080\"），且只能出现一次");
        }
    }
    Ok(())
}

/// `allowedHosts` 整个数组的校验：非空、且每一项都通过
/// [`validate_allowed_host_entry`]。可选的安全字段等于默认关闭
/// （manifest.ts `allowedHosts` 字段文档 §为什么必填而非可选），因此空数组
/// 本身就是配置错误，不是"没有限制"的合法表达。
fn validate_allowed_hosts(hosts: &[String]) -> Result<(), String> {
    if hosts.is_empty() {
        return Err("不能是空数组——省略等于关闭校验，必须至少声明一个允许的 host".to_string());
    }
    for host in hosts {
        validate_allowed_host_entry(host)
            .map_err(|reason| format!("条目 \"{host}\" 不合法：{reason}"))?;
    }
    Ok(())
}

/// 解析 URL 的 host（若显式声明了非默认端口，一并纳入比对，形如
/// `"host:port"`），并归一化为小写——host 本身大小写不敏感。解析失败或
/// URL 本身没有 host（如相对路径、`data:` 之类的非常规 scheme）一律返回
/// `None`，调用方按 fail closed 处理，不尝试"大概能对"的字符串切分兜底。
fn extract_url_host(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    match parsed.port() {
        Some(port) => Some(format!("{}:{port}", host.to_ascii_lowercase())),
        None => Some(host.to_ascii_lowercase()),
    }
}

/// `host` 是否精确命中 `allowed_hosts` 里的某一项（大小写不敏感）。
/// `allowed_hosts` 约定已经是小写（构造期归一化，见
/// [`AuthkeyApiPipeline::from_manifest_value`]），这里仍然用
/// `eq_ignore_ascii_case` 而不是裸 `==`——不依赖调用方是否真的做了归一化，
/// 这条比对规则本身就该是大小写不敏感的。
fn host_is_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    allowed_hosts
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
}

/// `value` 是否含有会破坏 JSON body 字符串字面量语法的字符（引号/反斜杠/
/// 花括号），或空白/控制字符。用于
/// [`AuthkeyApiPipeline::substitute_named_credential_placeholders`] 的规则
/// 二——`crate::cache_scan::extract_query_param` 不做百分号解码，合法的
/// query 参数值不可能出现这些字符，出现即视为凭据 URL 已被投毒。
fn contains_json_string_unsafe_char(value: &str) -> bool {
    value
        .chars()
        .any(|c| matches!(c, '"' | '\\' | '{' | '}') || c.is_whitespace() || c.is_control())
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

/// 拒绝"批处理序位 record_key + 增量提前终止"这个组合在构造期就出现。
///
/// 背景（`docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md`
/// §1.6～§1.8 的实测结论）：鸣潮 `record_key` 必须合成
/// `hash(时间 + 物品 + 同秒内序位)`，真实存档 3371 条记录里 **17.53%**
/// （591 条）靠这个序位才能互相区分——这不是边角情况，是六分之一的数据。
/// 序位由 `hooks.deriveRecordKeys` 在**一整页**记录上算出，它的正确性
/// 完全建立在"每次采集都是整池全量拉取"这个前提上：`stopCondition:
/// reachedKnown` 恰恰是"只拉新记录、拉到已采集过的就提前停"的增量语义，
/// 一旦允许它与批处理序位共存，序位就会在**局部集合**（而不是完整数组）
/// 上重新计算，17.53% 的 key 当场漂移——写入层用 `INSERT OR IGNORE`，
/// 撞键的记录会被**静默跳过**，不会报错，用户看到的只是"这次采集少了一些
/// 记录"，且没有任何信号能告诉他为什么。因此这两个声明只要同时出现，就在
/// 插件构造期直接拒绝启动，不留到某次真实采集才暴露。
///
/// 抽成独立纯函数、测试模式与
/// [`validate_derive_record_key_hooks_not_both_declared`] 一致：直接用
/// 合成的布尔值验证判断本身，不依赖某个真实插件恰好声明过这个组合。
fn validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
    plugin_id: &str,
    has_derive_record_keys: bool,
    is_reached_known_stop_condition: bool,
) -> Result<(), PipelineError> {
    if has_derive_record_keys && is_reached_known_stop_condition {
        return Err(PipelineError::Config(format!(
            "插件 \"{plugin_id}\" 同时声明了 hooks.deriveRecordKeys（批处理序位去重）与 \
             stopCondition: reachedKnown（增量提前终止）——鸣潮真实存档实测 17.53% 的记录\
             依赖同秒内序位区分，这个序位只有在\"每次都是整池全量拉取\"时才稳定；一旦允许\
             增量拉取，序位会在局部集合上重新计算并漂移，撞键的记录会被 INSERT OR IGNORE \
             静默跳过、不会报错。二者不能同时声明，详见 \
             docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md §1.6～§1.8。"
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

/// `collect.params.rateLimit.batchSize` 若声明，必须非零——0 无法构成
/// 合法的"每 N 页停顿一次"间隔，会让采集循环里的
/// [`should_batch_pause`] 取模运算除零 panic。校验放在构造期（同
/// [`validate_endpoint_override_segment`] 的理由），声明不合法直接拒绝
/// 启动，不留到某次真实翻页时才崩溃。
fn validate_declared_batch_size(
    plugin_id: &str,
    batch_size: Option<u32>,
) -> Result<(), PipelineError> {
    if batch_size == Some(0) {
        return Err(PipelineError::Config(format!(
            "插件 \"{plugin_id}\" 声明的 collect.params.rateLimit.batchSize 不能是 0——\
             0 无法构成合法的\"每 N 页停顿一次\"间隔"
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

/// 解析 `fields.time`（不带时区的记录时间字符串），按 `raw_format` 声明的
/// **那一种**格式解析，不再依次尝试多种格式。
///
/// # 这里曾经是一处已修复的能力边界违规
///
/// 修复前的实现依次尝试空格分隔与 ISO `T` 分隔两种格式，哪种能解析就用哪种
/// ——这只是把硬编码从"一种格式"变成"两种格式"，第三个用其它格式的游戏
/// 还会再撞一次，而且更隐蔽：只要两种格式都能解析成功且解析出的时刻恰好
/// 一致，插件声明与真实数据不符这个信号会被静默吞掉，直到某天两种格式解析
/// 出不同时刻才会暴露（那时候数据库里可能已经攒了一批错误时间戳）。按
/// `00-实施总览.md` §11.5 的判据——「这段逻辑换一个游戏还成立吗？」——
/// 「解析一个日期时间字符串」的**算法**换一个游戏依然成立，归 Rust；但
/// 「这个游戏的时间用什么格式书写」是**游戏知识**，理应由插件在
/// `time.rawFormat` 声明，Rust 侧只认那一种。收口方式对齐本 crate 已有的
/// 正确先例——`log_scan.rs` 的 `LogDecodeSpec`：算法留在 Rust，具体取值
/// （这里是格式字符串）从插件声明读，见 [`crate::log_scan::LogDecodeSpec`]。
///
/// # 为什么改成严格匹配、不再兜底
///
/// 现在声明 `isoLocal` 就只解析 ISO，遇到空格格式直接报错。理由：
/// `fixtures/wuwa/meta.toml` "已知未验证项：API 的 Time 线格式"记录的空白
/// ——鸣潮插件声明的 `isoLocal` 来自本地存档格式，API 真实线格式尚未抓包
/// 验证。若这个声明与真实数据不符，严格解析会在**首次真实采集**时报出
/// 明确错误，而不是被"多种格式都试一遍"的兜底悄悄吸收掉——错的声明应该
/// 报错，不应该被吸收成"反正解析出来了"。
fn parse_record_time(
    raw_time: &str,
    raw_format: RawTimeFormatJson,
) -> Result<chrono::NaiveDateTime, PipelineError> {
    let (pattern, kind_label) = match raw_format {
        RawTimeFormatJson::SpaceSeparated {} => ("%Y-%m-%d %H:%M:%S", "spaceSeparated"),
        RawTimeFormatJson::IsoLocal {} => ("%Y-%m-%dT%H:%M:%S", "isoLocal"),
    };
    chrono::NaiveDateTime::parse_from_str(raw_time, pattern).map_err(|err| {
        PipelineError::Json(format!(
            "无法解析记录时间 \"{raw_time}\"：插件声明的 time.rawFormat 是 \"{kind_label}\"\
             （对应格式 {pattern}），按该格式解析失败：{err}——请检查插件 manifest 里 \
             time.rawFormat 的声明是否与真实数据一致"
        ))
    })
}

// ============================================================
// PageRequest：单次页面请求的完整声明
// ============================================================

/// 一次页面请求需要的全部信息——GET 只需要 `url`，POST 还需要 `body` 与
/// `headers`。用一个判别联合而不是给 `fetch_with_retry` 加
/// `body: Option<&str>`/`headers: Option<&BTreeMap<...>>` 这类可选参数，是
/// 因为 GET/POST 两种取值本来就互斥（POST 必然有 body，GET 必然没有），
/// 用类型表达这份互斥比"某个参数在某种方法下该不该是 `None`"这类隐式约定
/// 更难用错——调用方在 `match` 的每个分支里都清楚自己在构造哪一种请求。
enum PageRequest<'a> {
    Get {
        url: &'a str,
    },
    Post {
        url: &'a str,
        body: &'a str,
        headers: &'a std::collections::BTreeMap<String, String>,
    },
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
    /// `time.rawFormat` 声明，构造期已套用默认值——省略时是
    /// `RawTimeFormatJson::SpaceSeparated {}`（原神/星铁/绝区零现有行为
    /// 不变），消费点见 [`Self::normalize_time`]/[`parse_record_time`]。
    raw_format: RawTimeFormatJson,
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
    /// `stopCondition: { kind: "singleRequest" }`——接口一次请求返回整池
    /// 全量，没有下一页。消费点见 `collect_banner` 循环体：处理完第一次
    /// 请求即无条件终止，不再判断 `emptyPage`/`reachedKnown`。
    is_single_request_stop_condition: bool,
    error_map: HashMap<String, ErrorSemantic>,
    rate_limit: RateLimitPolicy,
    /// 请求目标 host 白名单，已在构造期校验合法并归一化为小写（§7.8 裁定）。
    /// 消费点见 [`Self::validate_request_url_host`]，调用点见
    /// [`Self::collect_banner`]——在占位符替换完成之后、真正发起请求之前。
    allowed_hosts: Vec<String>,
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

        // allowedHosts：非空 + 每项合法，同 endpointOverride 的时机——声明
        // 不合法直接拒绝启动，不留到某次请求发出前才发现。归一化为小写
        // 存下来，运行时比对（Self::validate_request_url_host）不需要每次
        // 都重新转换大小写。
        validate_allowed_hosts(&parsed.collect.params.allowed_hosts).map_err(|reason| {
            PipelineError::Config(format!(
                "插件 \"{plugin_id}\" 声明的 collect.params.allowedHosts {reason}"
            ))
        })?;
        let allowed_hosts: Vec<String> = parsed
            .collect
            .params
            .allowed_hosts
            .iter()
            .map(|host| host.to_ascii_lowercase())
            .collect();

        let timezone_source = parsed.time.as_ref().and_then(|t| t.timezone_source.clone());
        let raw_time_convention = parsed.time.as_ref().and_then(|t| t.raw_time_convention);
        // 默认值在构造期就套用，而不是留到 parse_record_time 每次调用时再判断
        // ——原神/星铁/绝区零都没有声明 rawFormat，默认解析成
        // `SpaceSeparated`，历史行为不变。
        let raw_format = parsed
            .time
            .as_ref()
            .and_then(|t| t.raw_format)
            .unwrap_or(RawTimeFormatJson::SpaceSeparated {});

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

        // rateLimit：逐字段取更温和者合并注入策略与插件声明，完整规则见
        // `RateLimitPolicy::merged_with_declared` 的文档。校验必须先于合并
        // ——batchSize=0 一旦被 min() 选中会让采集循环除零 panic。
        validate_declared_batch_size(
            plugin_id,
            parsed
                .collect
                .params
                .rate_limit
                .as_ref()
                .and_then(|declared| declared.batch_size),
        )?;
        let rate_limit = rate_limit.merged_with_declared(parsed.collect.params.rate_limit.as_ref());

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
        let is_single_request_stop_condition = matches!(
            parsed.collect.params.stop_condition,
            Some(StopConditionJson::SingleRequest {})
        );
        validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
            plugin_id,
            has_derive_record_keys,
            is_reached_known_stop_condition,
        )?;

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
            raw_format,
            endpoint_override_by_banner,
            has_derive_record_key,
            has_derive_record_keys,
            has_resolve_timezone,
            is_reached_known_stop_condition,
            is_single_request_stop_condition,
            error_map,
            rate_limit,
            allowed_hosts,
        })
    }

    /// 仅供测试：绕开插件注册表，直接用调用方给的 manifest 纯数据 JSON 构造
    /// pipeline。函数调用（`extractList`/`extractRecord`/hooks）仍然按
    /// `plugin_id` 路由到插件运行时里真实编译的 JS，与这里传入的
    /// `manifest_value` 互不影响——这正是这个测试入口能成立的原因：拿
    /// genshin 已经编译好的 JS 当执行载体，只替换 Rust 侧要解析的纯数据。
    ///
    /// 默认只在本 crate 编译测试代码时可见（`#[cfg(test)]`）。额外挂一个
    /// `test-support` feature 把它变成 `pub`，供其它 crate 的测试代码构造
    /// 本仓库唯一真实插件都没声明过的分支（如 `timezoneSource: apiField`）
    /// ——`gs-host` 验证"导入路径必须对 apiField/staticTable fail closed"
    /// 这条约束正是靠它，见 `crates/gs-host/tests/import_wwgacha.rs`。不把
    /// 这个入口做成默认可见：生产代码永远只应该经 [`Self::new`] 走插件
    /// 注册表构造 pipeline，`test-support` 不进 `[dependencies]`，只在
    /// `[dev-dependencies]` 里对需要它的 crate 单独开启。
    #[cfg(any(test, feature = "test-support"))]
    pub fn from_manifest_json_for_test(
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

    /// 插件 id，供调用方（如 `gs-host` 的导入流程）在错误信息里指明是哪个
    /// 插件——[`PipelineError`] 的变体普遍携带 `plugin_id`，调用方自己的
    /// 错误类型延续同一惯例时需要能读到它。
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    /// `time.timezoneSource` 声明为 `apiField`/`staticTable` 时返回
    /// `true`——这两个分支都要读**页级 API 响应体**里的字段
    /// （[`Self::resolve_page_level_timezone_offset_hours`]），而存档导入
    /// 路径根本没有响应体可读。
    ///
    /// 供导入流程在调用 [`Self::build_records`] 之前做 fail-closed 检查：
    /// `build_records` 本身不知道调用方是采集还是导入，无法替调用方判断
    /// "拿不到时区来源该不该继续"，这个判断必须留给调用方——静默传
    /// `page_tz_offset_hours: None` 会让时间按"无时区"归一化、
    /// `tz_origin` 落成不真实的 `Assumed`，且这一切不报错，正是本项目
    /// 反复记录的"门之所以通过，是因为它什么都没检查"这类失效模式。
    ///
    /// `computed` 分支走 `hooks.resolveTimezone`（逐条记录调用，不依赖
    /// 响应体）可以正常支持，返回 `false`；未声明（`None`）同样返回
    /// `false`——历史行为不变，`page_tz_offset_hours` 传 `None` 就是
    /// 这两种情况原本就有的正确取值，不是新引入的静默降级。
    pub fn timezone_source_requires_page_response(&self) -> bool {
        matches!(
            self.timezone_source,
            Some(TimezoneSourceJson::ApiField { .. })
                | Some(TimezoneSourceJson::StaticTable { .. })
        )
    }

    /// `hooks.deriveRecordKeys`（批处理版本）是否已声明——供 `gs-host` 的
    /// 导入流程判断是否要启用"同秒内序位漂移"检查，见该 crate `import`
    /// 模块文档"同秒内序位漂移的 fail-closed"一节的完整论证。开关必须绑定
    /// 这个布尔量本身，不能写成 `plugin_id == "wuwa"` 这类硬编码——只有
    /// 声明了这个批处理 hook 的插件，`record_key` 才含有"同一秒内第几次
    /// 出现"的序位分量，判据要跟着声明走，不是跟着某个具体插件的名字走
    /// （哪怕现在唯一这么声明的插件就是鸣潮）。
    pub fn has_derive_record_keys(&self) -> bool {
        self.has_derive_record_keys
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

    /// `endpointOverride` 已声明的卡池，把凭据 URL 的路径最后一段替换成
    /// 卡池覆盖的端点；未声明的卡池原样返回。`build_page_url`/
    /// `build_page_body`/`build_page_headers` 三处占位符替换入口共用这一步，
    /// 不各写一份。
    fn credential_url_with_endpoint_override(
        &self,
        credential_url: &str,
        banner_id: &str,
    ) -> String {
        match self.endpoint_override_by_banner.get(banner_id) {
            Some(segment) => override_url_path_segment(credential_url, segment),
            None => credential_url.to_string(),
        }
    }

    /// 具名占位符 `{{credential.<queryParam>}}` 的替换：从凭据 URL 的对应
    /// query 参数里取值，供 `substitute_placeholders` 在替换裸 `{{credential}}`
    /// **之前**调用。
    ///
    /// 动机（C7 缺口，`docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表
    /// 演练.md` §8.3）：裸 `{{credential}}` 只能把**整个**凭据 URL 塞进模板，
    /// 没有任何机制能从中拆出单个 query 参数分别填进 POST body 的不同字段
    /// ——鸣潮 body 需要 `cardPoolId`/`languageCode`/`playerId`/`recordId`/
    /// `serverId` 五个离散字段，分别来自凭据 URL 的 `resources_id`/`lang`/
    /// `player_id`/`record_id`/`svr_id` 五个 query 参数。
    ///
    /// 三条 fail-closed 规则——本项目反复抓到"门之所以通过，是因为它什么都
    /// 没检查"这个失效模式，以下三条都是针对它的预防，任何一条都不能退化成
    /// 静默放行：
    /// 1. **query 参数不存在 → `Err`，不得替换成空串**。空串会产出一个字段
    ///    值为空但语法合法的请求，请求照发、服务端可能返回语义错误的结果，
    ///    用户看到的是"少了一批记录"而不是一条明确的报错。
    /// 2. **取到的值含非法字符 → `Err`**。这些值会被拼进 JSON body 字符串
    ///    字面量。[`crate::cache_scan::extract_query_param`] 不做百分号解码，
    ///    合法的 query 值不可能出现 `"` `\` `{` `}` 或任何空白/控制字符——
    ///    一旦出现，说明凭据 URL 本身被投毒：凭据是用插件声明的正则去扫描
    ///    游戏日志匹配出来的，能往日志里写内容的攻击者可以种一个匹配该正则、
    ///    却带有这些字符的 URL。
    /// 3. **本方法返回 `Result`，调用方不得用 `unwrap_or_default()` 之类把
    ///    错误吞掉**——`substitute_placeholders`/`build_page_url`/
    ///    `build_page_body`/`build_page_headers` 全部跟着传播 `Result`。
    ///
    /// 错误信息只携带插件 id 与占位符名称，不携带凭据 URL 或解析出的参数
    /// 值——理由与 [`Self::validate_request_url_host`] 相同。
    fn substitute_named_credential_placeholders(
        &self,
        template: &str,
        credential_url: &str,
    ) -> Result<String, PipelineError> {
        const PREFIX: &str = "{{credential.";
        const SUFFIX: &str = "}}";

        let mut result = String::with_capacity(template.len());
        let mut remaining = template;

        while let Some(prefix_start) = remaining.find(PREFIX) {
            result.push_str(&remaining[..prefix_start]);
            let after_prefix = &remaining[prefix_start + PREFIX.len()..];

            let Some(suffix_offset) = after_prefix.find(SUFFIX) else {
                // 没有匹配的结束符——不是一个完整的具名占位符。真实插件
                // 声明的模板不会出现半截占位符，这里只保证不 panic、不死
                // 循环，原样保留剩余文本交给后续处理。
                result.push_str(&remaining[prefix_start..]);
                remaining = "";
                break;
            };

            let param_name = &after_prefix[..suffix_offset];
            remaining = &after_prefix[suffix_offset + SUFFIX.len()..];

            let is_valid_param_name = !param_name.is_empty()
                && param_name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !is_valid_param_name {
                return Err(PipelineError::CredentialParamInvalid {
                    plugin_id: self.plugin_id.clone(),
                    param_name: param_name.to_string(),
                    reason: "占位符名称只能是字母、数字、下划线的组合",
                });
            }

            // 规则一：参数不存在必须报错，不能替换成空串。
            let value = crate::cache_scan::extract_query_param(credential_url, param_name)
                .ok_or(PipelineError::CredentialParamInvalid {
                    plugin_id: self.plugin_id.clone(),
                    param_name: param_name.to_string(),
                    reason: "凭据 URL 里不存在这个 query 参数——不能替换成空串，那会产出一个字段值为空但语法合法的请求",
                })?;

            // 规则二：取到的值含有会破坏 JSON body 字符串字面量语法的字符
            // （引号/反斜杠/花括号）或空白/控制字符时拒绝，凭据 URL 可能
            // 已被投毒。
            if contains_json_string_unsafe_char(&value) {
                return Err(PipelineError::CredentialParamInvalid {
                    plugin_id: self.plugin_id.clone(),
                    param_name: param_name.to_string(),
                    reason: "取到的值含有引号/反斜杠/花括号/空白/控制字符——凭据 URL 可能已被投毒",
                });
            }

            result.push_str(&value);
        }

        result.push_str(remaining);
        Ok(result)
    }

    /// 对模板字符串做占位符替换——`build_page_url`（`request.url`）、
    /// `build_page_body`（`request.body`）与 `build_page_headers`
    /// （`request.headers` 的值）共用同一套规则，不各写一份。
    /// `credential_url` 由调用方传入**已经**套用过 `endpointOverride` 的值
    /// （见 [`Self::credential_url_with_endpoint_override`]），本方法本身
    /// 不关心端点覆盖。
    ///
    /// **必须先替换具名的 `{{credential.<name>}}`，再替换裸的
    /// `{{credential}}`**：顺序上更清晰——虽然两者字面量不会互相误匹配
    /// （`{{credential}}` 不含 `.`，`str::replace` 是精确字面量匹配，交换
    /// 顺序不会产生错误结果），但读者不该需要自己推导这一点才能确信正确性，
    /// 因此固定顺序并写清楚理由。
    fn substitute_placeholders(
        &self,
        template: &str,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> Result<String, PipelineError> {
        let with_named_params =
            self.substitute_named_credential_placeholders(template, credential_url)?;
        Ok(with_named_params
            .replace("{{credential}}", credential_url)
            .replace("{{page}}", &page.to_string())
            .replace("{{gachaType}}", banner_id)
            .replace("{{pageSize}}", &self.page_size.to_string()))
    }

    /// 构造某一页请求的完整 URL。`{{credential}}` 的替换发生在这里——替换后
    /// 的明文 URL 只存在于 Rust 的局部变量里，不经过任何插件代码能看到的
    /// 路径（HC-2 的具体实现点）。
    ///
    /// `banner_id` 若在 `banners[].endpointOverride` 里声明了覆盖端点
    /// （如星铁联动池的 `getLdGachaLog`），先在这里把凭据 URL 的路径最后
    /// 一段换掉，再套用 `request.url` 模板——覆盖动作发生在凭据 URL 已经
    /// 是明文之后、离开 Rust 之前，全程不经过插件代码。
    pub fn build_page_url(
        &self,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> Result<String, PipelineError> {
        let credential_url = self.credential_url_with_endpoint_override(credential_url, banner_id);
        self.substitute_placeholders(&self.params.request.url, &credential_url, banner_id, page)
    }

    /// 构造某一页请求的 POST body（若 `request.body` 已声明），占位符替换
    /// 规则与 [`Self::build_page_url`] 完全一致，复用同一个
    /// [`Self::substitute_placeholders`]。`request.body` 未声明时返回
    /// `Ok(None)`——多数插件（如原神）走 GET 分页，没有 body 可言。
    ///
    /// 消费点见 [`Self::collect_banner`]：`request.method` 声明为 `POST`
    /// 时，这里构造出的 body 会真正随请求发出。
    pub fn build_page_body(
        &self,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> Result<Option<String>, PipelineError> {
        let credential_url = self.credential_url_with_endpoint_override(credential_url, banner_id);
        self.params
            .request
            .body
            .as_ref()
            .map(|template| {
                self.substitute_placeholders(template, &credential_url, banner_id, page)
            })
            .transpose()
    }

    /// 构造某一页请求的头部（若 `request.headers` 已声明），值跑与
    /// [`Self::build_page_url`] 完全一致的占位符替换——header 名（key）本身
    /// 不做替换，占位符只用于凭据这类会变化的值。未声明 `request.headers`
    /// 时返回空表，调用方据此判断是否需要附加任何自定义头。
    pub fn build_page_headers(
        &self,
        credential_url: &str,
        banner_id: &str,
        page: u32,
    ) -> Result<std::collections::BTreeMap<String, String>, PipelineError> {
        let credential_url = self.credential_url_with_endpoint_override(credential_url, banner_id);
        let Some(headers_template) = &self.params.request.headers else {
            return Ok(std::collections::BTreeMap::new());
        };
        headers_template
            .iter()
            .map(|(key, value_template)| {
                let value =
                    self.substitute_placeholders(value_template, &credential_url, banner_id, page)?;
                Ok((key.clone(), value))
            })
            .collect()
    }

    /// 校验**占位符替换完成之后**的最终请求 URL，host 是否在插件声明的
    /// `allowedHosts` 白名单内。调用点在 [`Self::collect_banner`]，位置是
    /// [`Self::build_page_url`] 之后、真正发起请求（`fetch_with_retry`）
    /// 之前——校验模板本身挡不住"凭据被投毒"这种场景（`request.url` 的
    /// host 常常整个来自 `{{credential}}`，模板字符串里根本没有 host 可查），
    /// 只有校验替换后的最终 URL 才能同时挡住恶意插件与被投毒的凭据源，
    /// 完整理由见 crate 顶部 §7.8.3 引用的裁定文档。
    ///
    /// 错误信息只携带 host 与插件 id，**不携带完整 URL**——`url` 参数里
    /// 可能含有已经替换进去的明文凭据。
    fn validate_request_url_host(&self, url: &str) -> Result<(), PipelineError> {
        let host = extract_url_host(url);
        match &host {
            Some(host) if host_is_allowed(host, &self.allowed_hosts) => Ok(()),
            _ => Err(PipelineError::HostNotAllowed {
                plugin_id: self.plugin_id.clone(),
                host,
            }),
        }
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
    /// 前检查一次。GET/POST 共用这一份重试/错误语义处理，不各写一份——两种
    /// 方法唯一的差异只是"怎么发出这次请求"，用 [`PageRequest`] 把这个差异
    /// 收在一个参数里。
    fn fetch_with_retry<T: GameApiTransport>(
        &self,
        transport: &T,
        request: &PageRequest,
    ) -> Result<Value, PipelineError> {
        let mut last_error: Option<PipelineError> = None;

        for attempt in 1..=self.rate_limit.retry.max_attempts {
            let outcome = match request {
                PageRequest::Get { url } => transport.get(url),
                PageRequest::Post { url, body, headers } => transport.post(url, body, headers),
            }
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
    ///
    /// `raw_format` 是插件声明（或默认值）的记录时间格式，原样转发给
    /// [`parse_record_time`]——本函数不再自己猜格式。
    fn normalize_time(
        raw_time: &str,
        tz_offset_hours: Option<i32>,
        raw_format: RawTimeFormatJson,
    ) -> Result<(i64, TzOrigin, Option<i32>), PipelineError> {
        let naive = parse_record_time(raw_time, raw_format)?;
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

    /// 把"原始记录数组"变换成可落库的 [`GachaRecord`] 批次——完整走一遍
    /// `manifest.fields.extractRecord → hooks.deriveRecordKeys → 时区换算/
    /// 落库字段拼装`三阶段。
    ///
    /// 这是 M2-S6 从 [`Self::collect_banner`] 循环体里抽出来的可复用阶段
    /// （`docs/_internal/milestones/03-M2-鸣潮插件与抽象证伪.md` §4.6.3 裁定）：
    /// 导入路径（`gs-host` 的存档导入流程）必须走与采集**完全相同**的这段
    /// 逻辑，两边才会对同一条实际记录算出同一个 `record_key`——若导入侧
    /// 另写一套字段映射，`UNIQUE(account_id, record_key)` 形同虚设，是
    /// HoYo.Gacha 因 `record_key` 裸用雪花 ID 付出过整表重建代价的同一类
    /// 问题（"同一语义写了两遍只改一遍"，M2-S5 的 `effective_pity_target`
    /// 也是这个成因）。
    ///
    /// 因此把 `collect_banner` 里原本写死/现算的两个量参数化，调用方必须
    /// 显式给出：
    /// - `source`：分页采集固定传 `RecordSource::OfficialApi`；导入路径必须
    ///   传 `RecordSource::Import`，两者不能共用一个写死的值。
    /// - `page_tz_offset_hours`：分页采集从**本页 API 响应体**现算
    ///   （[`Self::resolve_page_level_timezone_offset_hours`]）；导入路径根本
    ///   拿不到响应体，只能由调用方决定传什么——`timezoneSource` 声明为
    ///   `apiField`/`staticTable` 时，导入侧必须提前拒绝而不是编一个假值传
    ///   `None`，这条 fail-closed 检查在导入流程里实现，不在这个方法内部
    ///   （本方法不知道调用方是采集还是导入，无法替调用方做这个判断）。
    ///
    /// `raw_records` 是 `extractList` 已经拆出的记录数组（分页采集里是响应
    /// `list`，导入路径里是 `gs_exchange::ImportBanner::records`）——两者
    /// 形状相同，都是"未经 Rust 侧二次解释的 API 原始记录"，这正是
    /// `gs-exchange` 适配器不产出 `UnifiedRecordFields` 的原因。
    #[allow(clippy::too_many_arguments)]
    pub fn build_records(
        &self,
        raw_records: &[Value],
        banner_id: &str,
        account_id: i64,
        uid: &str,
        region: Option<&str>,
        lang: Option<&str>,
        captured_at: i64,
        page_tz_offset_hours: Option<i32>,
        source: RecordSource,
    ) -> Result<Vec<GachaRecord>, PipelineError> {
        // 第一阶段：先跑完整页的 extractRecord，收齐 fields_values/
        // fields_list——deriveRecordKeys（批处理钩子）需要整页数据一起
        // 传给插件，不能逐条调用，见 Self::derive_record_keys_for_page。
        let mut fields_values: Vec<Value> = Vec::with_capacity(raw_records.len());
        let mut fields_list: Vec<UnifiedRecordFieldsJson> = Vec::with_capacity(raw_records.len());
        for raw in raw_records {
            let mut fields_value = self.plugin_runtime.call(
                &self.plugin_id,
                "manifest.fields.extractRecord",
                std::slice::from_ref(raw),
            )?;

            // `bannerIdentity: "query"` 时，**在这里**就把 bannerId 换成本次
            // 查询/导入实际归属的卡池，而不是等到下面第三阶段建 GachaRecord
            // 时才覆盖 banner_key——因为夹在中间的第二阶段 `deriveRecordKeys`
            // 也要读这个字段。
            //
            // 覆盖晚一步的后果不是"卡池归属错"（那一处最终还是会被改对），
            // 而是**记录去重键少了卡池这一维**：插件此时只能拿到一个与卡池
            // 无关的占位值，`hash(bannerId, time, itemId, 组内序位)` 在两个
            // 不同卡池之间就失去了区分度。鸣潮的十连整组共用同一个时间戳，
            // 而 3★ 武器同时出现在角色池与武器池——两池在同一秒各出一次同一
            // 件 3★ 且组内序位相同时，两条记录会算出**相同的 record_key**，
            // 被 `UNIQUE(account_id, record_key)` + `INSERT OR IGNORE` 静默
            // 吞掉一条：不报错、不进日志，用户只看到"少了一条"。
            //
            // 提前到这里之后，插件不需要为"响应里没有卡池身份"编造任何占位
            // 值——它照常读响应，宿主负责把这一维补成权威值，
            // `deriveRecordKeys` / `banner_key` / `pity_group` 三处天然一致。
            if matches!(
                self.params.banner_identity,
                Some(gs_core::BannerIdentitySource::Query)
            ) && let Some(object) = fields_value.as_object_mut()
            {
                object.insert("bannerId".to_string(), Value::String(banner_id.to_string()));
            }

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
        let mut batch = Vec::with_capacity(raw_records.len());
        for ((fields_value, fields), record_key_text) in fields_values
            .iter()
            .zip(fields_list.iter())
            .zip(record_keys.into_iter())
        {
            // computed 分支逐条记录调用 hook（历史行为不变，签名允许按
            // 记录定制，即使目前唯一实现——原神的 uid 首位数字推断——
            // 只用了账号级信息）；apiField/staticTable 已经在调用方算好，
            // 通过 page_tz_offset_hours 传入，这里直接复用同一个值。
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
                Self::normalize_time(&fields.time, tz_offset_hours, self.raw_format)?;

            // 此处直接用 fields.banner_id，**不再**二次判别 banner_identity：
            // `Query` 模式下这个字段已经在第一阶段 extractRecord 之后被换成
            // 本次查询/导入实际归属的卡池了（见那里的说明），`Response`/缺省
            // 模式下它本来就是响应产出的值。两种模式在这里已经收敛成同一个
            // 权威取值，再判一次只会制造第二处真相来源——而 banner_key 与
            // pity_group 一旦取自不同来源，记录的卡池归属就会和它的保底组
            // 对不上，那是比两处都错更难查的 bug。
            let banner_identity_key = fields.banner_id.as_str();

            batch.push(GachaRecord {
                id: 0,
                account_id,
                banner_key: banner_identity_key.to_string(),
                pity_group: self.pity_group_for(banner_identity_key),
                record_key: RecordKey::new(record_key_text)?,
                lang: lang.map(str::to_string),
                occurred_at,
                occurred_raw: fields.time.clone(),
                tz_origin,
                tz_offset_min,
                // seq_in_batch 恒为 None：TS 侧 hooks.deriveRecordKeys 算出
                // 的组内序位只喂进哈希参与计算、算完即弃，没有任何字段把它
                // 带出来落库，这一列在库里没有任何东西能与 record_key 互证。
                // gs-host 导入流程新增的"同秒内序位漂移"检查（见该 crate
                // import 模块文档"同秒内序位漂移的 fail-closed"一节）因此
                // 退而求其次，只能靠"这一秒同 item_id 的条数是否与库中已有
                // 记录一致"这个间接信号把关——这条信号是充分条件：同一分组
                // 内逐字段完全相同的记录彼此可互换（见
                // validate_batch_record_keys_not_combined_with_reached_known_
                // stop_condition 的文档与鸣潮真实存档审计的论证），条数一致
                // 就足以保证落库结果正确。
                seq_in_batch: None,
                item_id: fields.item_id.clone(),
                item_type: fields.item_type.clone(),
                rarity: fields.rarity.clone(),
                qty: fields.count,
                meta_state: self.determine_meta_state(fields),
                source,
                captured_at,
                raw_ref: None,
                extra: None,
            });
        }

        Ok(batch)
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
            // 批处理限速：翻到第 N/2N/3N... 页之前先额外歇一下，检查发生在
            // 本页请求发出之前——与三方参考实现的顺序一致，见
            // `should_batch_pause` 与 `RateLimitPolicy::batch_pause` 的文档。
            if should_batch_pause(page, self.rate_limit.batch_pause.every_n_pages) {
                std::thread::sleep(self.rate_limit.batch_pause.delay);
            }

            let url = self.build_page_url(credential_url, banner_id, page)?;
            // §7.8.3：必须校验替换完成之后的最终 URL，且必须在真正发起请求
            // （下面的 fetch_with_retry）之前——晚一步就等于请求已经发出去
            // 了。这一步在 GET/POST 两条路径之前、且只做一次：无论最终走
            // 哪个方法，用的都是同一个已校验的 `url`，POST 分支不会绕过它。
            self.validate_request_url_host(&url)?;

            // method 缺省 GET——原神/星铁/绝区零现有行为不变。只有插件显式
            // 声明 POST 时才构造 body/headers 并改走 transport.post。
            let response_json = match self.params.request.method {
                Some(gs_core::HttpMethod::Post) => {
                    let body = self
                        .build_page_body(credential_url, banner_id, page)?
                        .ok_or_else(|| {
                            PipelineError::Config(format!(
                                "插件 \"{}\" 的 request.method 声明为 POST，但没有声明 request.body",
                                self.plugin_id
                            ))
                        })?;
                    let headers = self.build_page_headers(credential_url, banner_id, page)?;
                    self.fetch_with_retry(
                        transport,
                        &PageRequest::Post {
                            url: &url,
                            body: &body,
                            headers: &headers,
                        },
                    )?
                }
                Some(gs_core::HttpMethod::Get) | None => {
                    self.fetch_with_retry(transport, &PageRequest::Get { url: &url })?
                }
            };
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
                // singleRequest 优先于 emptyPage：接口本身不分页，第一次
                // 请求就是全部结果，即使该页恰好为空（空卡池），也应报告
                // "已按单次请求语义完成"，而不是普通的 emptyPage 终止。
                stop_reason = if self.is_single_request_stop_condition {
                    StopReason::SingleRequest
                } else {
                    StopReason::EmptyPage
                };
                break;
            }
            non_empty_pages += 1;
            records_seen += list.len() as u64;

            // apiField/staticTable 是页级元数据，每页只需要解析一次；
            // computed 分支逐条记录调用 hook，见 Self::build_records 内部的
            // 分支判断。
            let page_tz_offset_hours =
                self.resolve_page_level_timezone_offset_hours(&response_json)?;

            // extractRecord → deriveRecordKeys → 时区换算/落库字段拼装
            // 三阶段已抽成 Self::build_records（M2-S6，见该方法文档）——
            // 分页采集固定传 RecordSource::OfficialApi，页级时区就是刚解析出
            // 的 page_tz_offset_hours。
            let batch = self.build_records(
                &list,
                banner_id,
                account_id,
                uid,
                region,
                lang,
                captured_at,
                page_tz_offset_hours,
                RecordSource::OfficialApi,
            )?;

            let inserted = repo.insert_records(&batch)?;
            records_inserted += inserted;
            consecutive_zero_pages = if inserted == 0 {
                consecutive_zero_pages + 1
            } else {
                0
            };

            // singleRequest：接口不分页，处理完这一次请求（无论插入了多少
            // 条新记录）就无条件终止，不再判断 reachedKnown——鸣潮 API 不认
            // page 参数，继续翻页只会拿到与这一次完全相同的全量数据。
            if self.is_single_request_stop_condition {
                stop_reason = StopReason::SingleRequest;
                break;
            }

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

    /// 用 `credential.logFile` 声明的 `logPath`/`decode` 参数，从游戏日志
    /// 文件里扫出凭据 URL——组合调用 [`crate::log_scan::scan_log_file`]。
    /// 鸣潮凭据来自 `Client.log`（异或混淆的文本日志），不是原神/星铁/
    /// 绝区零用的 Chromium 磁盘缓存，因此单独走这条分支，不复用
    /// `crate::cache_scan::scan_game_cache`（`collect_banner` 的调用方目前
    /// 就是这样对 `ChromiumCache` 分支直接调用的，见测试
    /// `cache_scan_and_pipeline_run_together_end_to_end`）。
    ///
    /// 只处理 `credential` 声明为 `logFile` 的插件——插件声明的凭据来源与
    /// 该走哪个扫描函数是一一对应的，调用方（宿主）理应已经按
    /// [`Self::credential`] 暴露的判别联合自行路由；这里若被喂了非
    /// `logFile` 的插件，直接拒绝而不是静默退化去扫别的东西。
    pub fn resolve_log_credential(
        &self,
        locator: &dyn InstalledGameLocator,
    ) -> Result<Option<String>, PipelineError> {
        let CredentialJson::LogFile {
            log_path,
            url_pattern,
            decode,
        } = &self.params.credential
        else {
            return Err(PipelineError::Config(format!(
                "插件 \"{}\" 的 credential 未声明为 logFile，无法走日志扫描解析凭据",
                self.plugin_id
            )));
        };
        let compiled_pattern = url_pattern.compile()?;
        Ok(crate::log_scan::scan_log_file(
            &self.plugin_id,
            log_path,
            decode.as_ref(),
            &compiled_pattern,
            locator,
        )?)
    }

    /// 用 `credential.chromiumCache` 声明的 `gameDir`/`urlPattern`，从游戏的
    /// Chromium 磁盘缓存里扫出凭据 URL——组合调用
    /// [`crate::cache_scan::scan_game_cache`]。原神/星铁/绝区零走这条分支。
    ///
    /// ⚠️ **本方法补的是一处对称性破损，不是新功能。** `CredentialSource`
    /// 判别联合的两个分支此前只有一个接进了 pipeline：`logFile` 有
    /// [`Self::resolve_log_credential`]（M2-S3 建），`chromiumCache` 没有对应
    /// 方法，`scan_game_cache` 是个自由函数，唯一的调用方是测试代码——测试
    /// 自己解构 `credential()` 拿到 `game_dir` 再直接调它。
    ///
    /// 后果是 manifest 里声明的 `credential.gameDir` **在生产代码里从来没有
    /// 被读出来过**。它长期躲过 HC-4「声明必被消费」门，是因为该门的消费判定
    /// 曾经把**文档注释**里的字段名也算作消费（`cache_scan.rs` 恰好有两处注释
    /// 提到 `game_dir`）；M2-S7 修掉注释顶替之后这条红线立刻亮了。
    ///
    /// 这与 §4.6.1 裁定「同一个判别联合的两个分支实现必须对称」是同一条原则，
    /// 只是那次谈的是 crate 落点，这次发生在 pipeline 方法这一层。
    ///
    /// 拒绝语义与 [`Self::resolve_log_credential`] 一致：喂进来的插件若不是
    /// `chromiumCache`，直接报错，而不是静默退化去扫别的东西。
    pub fn resolve_cache_credential(
        &self,
        locator: &dyn InstalledGameLocator,
    ) -> Result<Option<String>, PipelineError> {
        let CredentialJson::ChromiumCache {
            game_dir,
            url_pattern,
        } = &self.params.credential
        else {
            return Err(PipelineError::Config(format!(
                "插件 \"{}\" 的 credential 未声明为 chromiumCache，无法走缓存扫描解析凭据",
                self.plugin_id
            )));
        };
        let compiled_pattern = url_pattern.compile()?;
        Ok(crate::cache_scan::scan_game_cache(
            &self.plugin_id,
            game_dir,
            &compiled_pattern,
            locator,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_storage::{NewAccount, Storage};
    use std::cell::RefCell;
    use std::collections::HashMap as StdHashMap;
    use std::collections::VecDeque;
    use std::time::Duration;

    use crate::rate_limit::BackoffKind;

    /// `(url, body, headers)`——一次被记录下来的 POST 请求全貌，供
    /// `collect_banner_dispatches_post_request_...` 一类测试断言占位符替换
    /// 后的实际取值是否正确。单独起名是为了绕开 clippy::type_complexity，
    /// 不是这个元组本身有什么复用价值。
    type PostRequestRecord = (String, String, StdHashMap<String, String>);

    /// fixture 驱动的传输层：按**精确 URL**注册响应，同一 URL 的重复调用
    /// （HTTP 重试）会一直拿到该 URL 最后注册的那个响应，不会"偷跑"到下一页
    /// 的内容——这正是验证"重试同一页不应误吃掉下一页数据"所需要的语义。
    /// GET/POST 共用同一份响应注册表（按 URL 查找，不区分方法）——测试只
    /// 关心"这个 URL 该返回什么"，方法层面的差异由 `post_requests()` 单独
    /// 记录下来，供需要断言"POST 确实带上了正确 body/headers"的用例读取。
    struct FixtureTransport {
        responses: RefCell<StdHashMap<String, VecDeque<String>>>,
        /// `(method, url)`，method 取值 `"GET"`/`"POST"`。`call_count()` 统计
        /// 两者之和——host 白名单等测试用它断言"请求从未被发出"，不需要区分
        /// 方法。
        calls: RefCell<Vec<(&'static str, String)>>,
        post_requests: RefCell<Vec<PostRequestRecord>>,
    }

    impl FixtureTransport {
        fn new() -> Self {
            Self {
                responses: RefCell::new(StdHashMap::new()),
                calls: RefCell::new(Vec::new()),
                post_requests: RefCell::new(Vec::new()),
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

        fn post_requests(&self) -> Vec<PostRequestRecord> {
            self.post_requests.borrow().clone()
        }

        fn respond_for(&self, url: &str) -> Result<TransportResponse, TransportError> {
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

    impl GameApiTransport for FixtureTransport {
        fn get(&self, url: &str) -> Result<TransportResponse, TransportError> {
            self.calls.borrow_mut().push(("GET", url.to_string()));
            self.respond_for(url)
        }

        fn post(
            &self,
            url: &str,
            body: &str,
            headers: &std::collections::BTreeMap<String, String>,
        ) -> Result<TransportResponse, TransportError> {
            self.calls.borrow_mut().push(("POST", url.to_string()));
            self.post_requests.borrow_mut().push((
                url.to_string(),
                body.to_string(),
                headers
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            ));
            self.respond_for(url)
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

    /// 与 `setup_pipeline_and_account` 同构，仅把账号的 `plugin_id` 参数化
    /// ——星铁/绝区零测试需要账号声明的插件与实际采集的插件一致（虽然当前
    /// schema 不会因为不一致而报错，但测试语义上应当对应真实场景，不该
    /// 借用一个写死的 "genshin" 账号）。
    fn setup_pipeline_and_account_for(storage: &Storage, plugin_id: &str) -> (PluginRuntime, i64) {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let account_id = storage
            .repository()
            .create_account(&NewAccount {
                plugin_id: plugin_id.to_string(),
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
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 3)
                .expect("URL 构造应当成功"),
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

        let CredentialJson::ChromiumCache { game_dir, .. } = pipeline.credential() else {
            panic!("genshin 声明的凭据来源应当是 chromiumCache");
        };

        // 按 game_dir（"YuanShen_Data/webCaches"）声明的相对片段，把 fixture
        // 样本放到 scan_game_cache 期望的目录结构下。这里读 `game_dir` 是为了
        // **搭出测试目录**，不是为了替生产代码解析凭据——扫描本身走下面的
        // `resolve_cache_credential`，与 `logFile` 分支走
        // `resolve_log_credential` 对称。
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
        let credential_url = pipeline
            .resolve_cache_credential(&locator)
            .expect("扫描不应报错")
            .expect("应当能从 fixture 样本里扫出凭据 URL");
        assert!(credential_url.contains("getGachaLog"));
        assert!(credential_url.contains("authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY"));
        let lang = crate::cache_scan::extract_query_param(&credential_url, "lang");
        assert_eq!(lang.as_deref(), Some("zh-cn"));

        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(&credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(&credential_url, "301", 2)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
        );
        transport.register(
            pipeline
                .build_page_url(&credential_url, "301", 3)
                .expect("URL 构造应当成功"),
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

    /// 用真实 fixture（`fixtures/starrail/raw_response/`）驱动星铁角色活动
    /// 跃迁（banner "11"）的 3 页请求：前两页各有记录、第三页空——这是
    /// FIXRS 门要求的"至少一条 Rust 测试吃过星铁真实数据"。星铁与原神最大
    /// 的差异是 `timezoneSource: apiField`（原神走 hooks.resolveTimezone），
    /// 这条测试专门验证 apiField 分支在真实响应体上真的算出了
    /// `TzOrigin::Region`，而不是像 M2-S6 故障那样静默退化成 `Assumed`——
    /// 只是这次发生在星铁而不是鸣潮。
    #[test]
    fn starrail_full_pipeline_run_matches_fixture_expectations() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account_for(&storage, "starrail");
        let pipeline = AuthkeyApiPipeline::new(
            "starrail",
            &runtime,
            RateLimitPolicy::zero_delay_for_tests(),
        )
        .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hkrpg.mihoyo.com/common/hkrpg_gacha_record/api/getGachaLog?authkey=FAKE&lang=zh-cn&gacha_type=11";

        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "11", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/starrail/raw_response/11_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "11", 2)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/starrail/raw_response/11_page_2.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "11", 3)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/starrail/raw_response/11_page_3_empty.json"),
        );

        let repo = storage.repository();
        let lang = crate::cache_scan::extract_query_param(credential_url, "lang");
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "11",
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
        assert_eq!(outcome.records_seen, 15, "page_1 9 条 + page_2 6 条");
        assert_eq!(outcome.records_inserted, 15);

        let records = repo
            .find_records_by_banner(account_id, "11")
            .expect("查询应当成功");
        assert_eq!(records.len(), 15);

        // record_key 形态：`${bannerId}:${stableId}`——验证星铁 hooks.ts 声明
        // 的 deriveRecordKey 真的被插件运行时执行到了，不是空操作。
        assert!(
            records
                .iter()
                .any(|r| r.record_key.as_str() == "11:1500000000000000001")
        );

        // apiField 分支：region_time_zone=8 是页级字段，三页记录应当全部
        // 换算出 TzOrigin::Region + tz_offset_min=480，不是 computed 路径
        // （星铁 hooks.ts 没有声明 resolveTimezone）。
        assert!(
            records
                .iter()
                .all(|r| r.tz_origin == TzOrigin::Region && r.tz_offset_min == Some(480)),
            "星铁 timezoneSource=apiField(region_time_zone)，全部记录都应换算出 UTC+8"
        );

        // occurred_at 抽查：page_1 第一条记录 time="2101-07-15 10:21:49"，
        // 按 UTC+8 换算成毫秒时间戳。
        let expected_naive =
            chrono::NaiveDateTime::parse_from_str("2101-07-15 10:21:49", "%Y-%m-%d %H:%M:%S")
                .unwrap();
        let expected_utc_ms = (expected_naive.and_utc().timestamp() - 8 * 3600) * 1000;
        let first_record = records
            .iter()
            .find(|r| r.record_key.as_str() == "11:1500000000000000001")
            .expect("应当能找到这条记录");
        assert_eq!(first_record.occurred_at, expected_utc_ms);

        // research/03 §1.3 的元数据缺失真实样例：item_id="1223" 有值，
        // name/item_type/rank_type 全为空串。星铁 itemIdSource 缺省
        // "native"，determine_meta_state 靠 name/item_type/rarity 是否为
        // None 判定——空串必须先被插件侧 toNonEmptyString 归一化成 None，
        // 这条记录才会落在 MetaState::Pending；如果这层归一化被去掉，空串
        // 会原样透传，is_none() 判断会失效，这条记录会被误判为 Complete，
        // `idx_record_meta_pending` 永远扫不到它。
        let record_with_missing_metadata = records
            .iter()
            .find(|r| r.item_id == "1223")
            .expect("fixture 里 11_page_2.json 应当有这条元数据缺失记录");
        assert_eq!(record_with_missing_metadata.meta_state, MetaState::Pending);
        assert_eq!(
            record_with_missing_metadata.item_type, None,
            "空串必须归一化为 NULL，不是原样存空字符串"
        );
        assert_eq!(
            record_with_missing_metadata.rarity, None,
            "空串必须归一化为 NULL，不是原样存空字符串"
        );

        // 其余 14 条记录 name/item_type/rank_type 都有值，应当落
        // Complete——与上面那条 Pending 记录形成对照，证明
        // determine_meta_state 真的在按字段完整性判定，不是恒定值。
        let complete_count = records
            .iter()
            .filter(|r| r.meta_state == MetaState::Complete)
            .count();
        assert_eq!(
            complete_count, 14,
            "15 条记录里只有 1 条元数据缺失，其余 14 条应为 Complete"
        );
    }

    /// 星铁联动池（banner "21"）在真实 manifest 里声明了
    /// `endpointOverride: "getLdGachaLog"`。已有的
    /// `build_page_url_applies_endpoint_override_for_declared_banner_only`
    /// （见下方 A1 节）用的是拼出来的合成 manifest，从没真正喂过一条星铁的
    /// 真实响应。这条测试用星铁真实 manifest + 真实 fixture
    /// `21_page_1.json`，同时验证两件事没有互相脱节：① `build_page_url`
    /// 真的把最后一段路径替换成 `getLdGachaLog`；② 替换后的端点收到的真实
    /// 联动池数据仍然能正确走完 `build_records`（record_key 带上 "21:"
    /// 前缀、apiField 时区、meta_state）。用 `build_records` 而不是
    /// `collect_banner` 整页循环——联动池 fixture 只给了一页数据，不需要为
    /// 了触发终止条件去伪造一页本不存在的空响应。
    #[test]
    fn starrail_collab_pool_endpoint_override_pipeline_run_uses_ld_endpoint_and_real_fixture() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account_for(&storage, "starrail");
        let pipeline = AuthkeyApiPipeline::new(
            "starrail",
            &runtime,
            RateLimitPolicy::zero_delay_for_tests(),
        )
        .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hkrpg.mihoyo.com/common/hkrpg_gacha_record/api/getGachaLog?authkey=FAKE&lang=zh-cn&gacha_type=21";
        let overridden_url = pipeline
            .build_page_url(credential_url, "21", 1)
            .expect("URL 构造应当成功");
        let overridden_path = overridden_url
            .split('?')
            .next()
            .expect("URL 应当至少有路径部分");
        assert!(
            overridden_path.ends_with("getLdGachaLog"),
            "banner 21 声明了 endpointOverride，最终请求路径应当以 getLdGachaLog 结尾：{overridden_url}"
        );

        let raw_response = read_fixture("fixtures/starrail/raw_response/21_page_1.json");
        let response_json: Value =
            serde_json::from_str(&raw_response).expect("fixture 应当是合法 JSON");
        let list: Vec<Value> = response_json["data"]["list"]
            .as_array()
            .cloned()
            .expect("fixture 应当有 data.list 数组");
        assert_eq!(list.len(), 8);

        let tz_offset_hours = pipeline
            .resolve_page_level_timezone_offset_hours(&response_json)
            .expect("apiField 声明且响应体带 region_time_zone 时应当能解析出时区偏移");
        assert_eq!(tz_offset_hours, Some(8));

        let batch = pipeline
            .build_records(
                &list,
                "21",
                account_id,
                "100000000",
                None,
                Some("zh-cn"),
                1_754_812_801_000,
                tz_offset_hours,
                RecordSource::OfficialApi,
            )
            .expect("build_records 应当成功");
        assert_eq!(batch.len(), 8);

        let repo = storage.repository();
        let inserted = repo.insert_records(&batch).expect("写入应当成功");
        assert_eq!(inserted, 8);

        let records = repo
            .find_records_by_banner(account_id, "21")
            .expect("查询应当成功");
        assert!(
            records
                .iter()
                .any(|r| r.record_key.as_str() == "21:1500000000000000019"),
            "record_key 应当是 `${{bannerId}}:${{stableId}}` 形态"
        );
        assert!(
            records
                .iter()
                .all(|r| r.tz_origin == TzOrigin::Region && r.tz_offset_min == Some(480)),
            "联动池同样走 apiField(region_time_zone) 分支"
        );
        assert!(
            records.iter().all(|r| r.meta_state == MetaState::Complete),
            "21_page_1.json 里全部记录 name/item_type/rank_type 均有值，不应有 Pending"
        );
    }

    /// 用真实 fixture（`fixtures/zzz/raw_response/`）驱动绝区零独家频段
    /// （banner "2"）的 3 页请求：前两页各有记录、第三页空——这是 FIXRS 门
    /// 要求的"至少一条 Rust 测试吃过绝区零真实数据"。绝区零与星铁的差异是
    /// `timezoneSource: staticTable`（响应体只有 `region` 字段，没有
    /// `region_time_zone`，UTC 偏移量要靠插件声明的查表 table 换算），这条
    /// 测试验证 staticTable 查表路径在真实响应体上真的走通了。
    #[test]
    fn zzz_full_pipeline_run_matches_fixture_expectations() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account_for(&storage, "zzz");
        let pipeline =
            AuthkeyApiPipeline::new("zzz", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-nap.mihoyo.com/common/gacha_record/api/getGachaLog?authkey=FAKE&lang=zh-cn&real_gacha_type=2";

        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "2", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/zzz/raw_response/2_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "2", 2)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/zzz/raw_response/2_page_2.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "2", 3)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/zzz/raw_response/2_page_3_empty.json"),
        );

        let repo = storage.repository();
        let lang = crate::cache_scan::extract_query_param(credential_url, "lang");
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "2",
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
        assert_eq!(outcome.records_seen, 11, "page_1 6 条 + page_2 5 条");
        assert_eq!(outcome.records_inserted, 11);

        let records = repo
            .find_records_by_banner(account_id, "2")
            .expect("查询应当成功");
        assert_eq!(records.len(), 11);

        // record_key 形态：`${bannerId}:${stableId}`。
        assert!(
            records
                .iter()
                .any(|r| r.record_key.as_str() == "2:1900000000000000001")
        );

        // staticTable 分支：响应体只有 `region: "prod_gf_cn"`，没有任何形式
        // 的 UTC 偏移量字段——必须靠插件声明的 table（region → 8）查出偏移
        // 量，不是直接读某个字段。三页记录应当全部换算出
        // TzOrigin::Region + tz_offset_min=480。
        assert!(
            records
                .iter()
                .all(|r| r.tz_origin == TzOrigin::Region && r.tz_offset_min == Some(480)),
            "绝区零 timezoneSource=staticTable(region)，prod_gf_cn 应查出 UTC+8"
        );

        let expected_naive =
            chrono::NaiveDateTime::parse_from_str("2099-01-01 18:51:55", "%Y-%m-%d %H:%M:%S")
                .unwrap();
        let expected_utc_ms = (expected_naive.and_utc().timestamp() - 8 * 3600) * 1000;
        let first_record = records
            .iter()
            .find(|r| r.record_key.as_str() == "2:1900000000000000001")
            .expect("应当能找到这条记录");
        assert_eq!(first_record.occurred_at, expected_utc_ms);

        // 稀有度阶梯 2/3/4，不是米哈游默认的 3/4/5——抽查真实响应里
        // rank_type="4" 的那条（"猫又"，绝区零 S 级代理人），确认 rarity
        // 字段原样透传了这个此前从未在本 crate fixture 里出现过的取值。
        let s_rank_record = records
            .iter()
            .find(|r| r.item_id == "1021")
            .expect("fixture 里应当有猫又这条记录");
        assert_eq!(s_rank_record.rarity.as_deref(), Some("4"));

        // 全部记录 name/item_type/rank_type 均有值，itemIdSource 缺省
        // native，应当全部落 Complete——与星铁那条元数据缺失记录形成对照，
        // 证明这批 fixture 本身没有缺失样例，Pending 分支不会被误触发。
        assert!(records.iter().all(|r| r.meta_state == MetaState::Complete));
    }

    /// 绝区零邦布频段（banner "5"）真实响应里 5 条记录混有已知的"音擎"
    /// 类型（1 条）与此前 fixture 里从未出现过的"邦布"类型（4 条），同时
    /// 引入稀有度阶梯的最高档 `rank_type: "4"`。fixture 只有一页数据，用
    /// `build_records` 而不是 `collect_banner` 整页循环，理由与星铁联动池
    /// 测试相同——不需要为了触发终止条件去伪造一页本不存在的空响应。
    #[test]
    fn zzz_bangboo_channel_pipeline_run_covers_third_item_type_and_top_rarity_four() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account_for(&storage, "zzz");
        let pipeline =
            AuthkeyApiPipeline::new("zzz", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let raw_response = read_fixture("fixtures/zzz/raw_response/5_page_1.json");
        let response_json: Value =
            serde_json::from_str(&raw_response).expect("fixture 应当是合法 JSON");
        let list: Vec<Value> = response_json["data"]["list"]
            .as_array()
            .cloned()
            .expect("fixture 应当有 data.list 数组");
        assert_eq!(list.len(), 5);

        let tz_offset_hours = pipeline
            .resolve_page_level_timezone_offset_hours(&response_json)
            .expect("staticTable 查表命中时应当能解析出时区偏移");
        assert_eq!(tz_offset_hours, Some(8));

        let batch = pipeline
            .build_records(
                &list,
                "5",
                account_id,
                "100000000",
                None,
                Some("zh-cn"),
                1_754_812_801_000,
                tz_offset_hours,
                RecordSource::OfficialApi,
            )
            .expect("build_records 应当成功");
        assert_eq!(batch.len(), 5);

        let repo = storage.repository();
        let inserted = repo.insert_records(&batch).expect("写入应当成功");
        assert_eq!(inserted, 5);

        let records = repo
            .find_records_by_banner(account_id, "5")
            .expect("查询应当成功");
        assert_eq!(records.len(), 5);

        // 5 条记录里 4 条是"邦布"类型物品——item_type 字段是自由字符串直接
        // 透传，这里按数量断言而不是全量断言（fixture 里第 1 条
        // "「湍流」-矢型" 仍是"音擎"类型），验证第三档物品类型真的完整流过了
        // Rust 侧，不是只在 TS 侧 extractRecord 里存在。
        let bangboo_count = records
            .iter()
            .filter(|r| r.item_type.as_deref() == Some("邦布"))
            .count();
        assert_eq!(
            bangboo_count, 4,
            "5_page_1.json 应有 4 条邦布类型记录（其余 1 条是音擎）"
        );

        // 稀有度阶梯最高档是 "4"（S 级），fixture 里两条 rank_type="4"
        // 的记录（巴特勒、飚速布）应当原样透传为 rarity=Some("4")——不是
        // 米哈游三游默认的 "5"。
        let rank_four_count = records
            .iter()
            .filter(|r| r.rarity.as_deref() == Some("4"))
            .count();
        assert_eq!(rank_four_count, 2, "巴特勒、飚速布两条应为 rank_type=4");
        assert!(
            records.iter().all(|r| r.rarity.as_deref() != Some("5")),
            "绝区零稀有度阶梯不含 \"5\"，不应有任何记录被归到这一档"
        );

        assert!(
            records
                .iter()
                .any(|r| r.record_key.as_str() == "5:1900000000000000012")
        );
        assert!(
            records
                .iter()
                .all(|r| r.tz_origin == TzOrigin::Region && r.tz_offset_min == Some(480))
        );
        assert!(records.iter().all(|r| r.meta_state == MetaState::Complete));
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
        // host 用 genshin 真实 allowedHosts 里的域名——这几个测试要验证的是
        // 去重/时区/错误语义等与 host 白名单无关的行为，用真实允许的 host
        // 避免 §7.8 新增的校验掩盖了测试本身要验证的逻辑。
        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";

        // 每次调用用不同的 captured_at——`banner_snapshot` 是时间序列表，
        // `UNIQUE(account_id, banner_key, captured_at, source)` 约束的正是
        // "同一时刻不会有两条快照"，两次真实采集本来就发生在不同的墙钟时刻，
        // 用相同 captured_at 跑两遍反而是在制造契约本不允许的场景。
        let run_once = |captured_at: i64| {
            let transport = FixtureTransport::new();
            transport.register(
                pipeline
                    .build_page_url(credential_url, "301", 1)
                    .expect("URL 构造应当成功"),
                read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
            );
            transport.register(
                pipeline
                    .build_page_url(credential_url, "301", 2)
                    .expect("URL 构造应当成功"),
                read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
            );
            transport.register(
                pipeline
                    .build_page_url(credential_url, "301", 3)
                    .expect("URL 构造应当成功"),
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
        // 同上：用 genshin 真实 allowedHosts 里的域名，避免 §7.8 host 白名单
        // 校验掩盖本测试真正要验证的逻辑。
        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE";

        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        // 第二页持续返回一个未在 errorMap 里声明的非零 retcode——genshin
        // 插件没有声明 errorMap，因此按契约"未覆盖的错误码按通用重试处理"，
        // 重试耗尽后应当以 Transport 错误告终，而不是被静默忽略或在第一页
        // 就被拦下。
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
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
        let url = pipeline
            .build_page_url("CREDENTIAL", "301", 3)
            .expect("URL 构造应当成功");
        assert_eq!(url, "CREDENTIAL&page=3&gacha_type=301&size=20&end_id=0");
    }

    #[test]
    fn build_page_body_returns_none_when_request_body_not_declared() {
        // genshin 走 GET 分页，没有声明 request.body。
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        assert_eq!(
            pipeline
                .build_page_body("CREDENTIAL", "301", 1)
                .expect("无 body 声明时不应报错"),
            None
        );
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
            .expect("替换不应报错")
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

        let overridden = pipeline
            .build_page_url(credential_url, "21", 1)
            .expect("URL 构造应当成功");
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

        let default_endpoint = pipeline
            .build_page_url(credential_url, "301", 1)
            .expect("URL 构造应当成功");
        assert!(
            default_endpoint.contains("/getGachaLog?"),
            "未声明 endpointOverride 的卡池应当保持默认端点，不受其它卡池声明影响：{default_endpoint}"
        );
    }

    // ============================================================
    // §7.8 · allowedHosts host 白名单
    // ============================================================

    #[test]
    fn validate_allowed_host_entry_accepts_plain_hostname_and_host_with_port() {
        assert!(validate_allowed_host_entry("public-operation-hk4e.mihoyo.com").is_ok());
        assert!(validate_allowed_host_entry("example.com:8080").is_ok());
    }

    #[test]
    fn validate_allowed_host_entry_rejects_scheme_path_query_wildcard_whitespace_and_bad_colon() {
        assert!(
            validate_allowed_host_entry("").is_err(),
            "空字符串应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("https://evil.example.com").is_err(),
            "带 scheme 的写法应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("evil.example.com/path").is_err(),
            "带路径的写法应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("evil.example.com?x=1").is_err(),
            "带查询串的写法应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("*.example.com").is_err(),
            "通配符应当被拒绝——本裁定明确不支持通配符匹配"
        );
        assert!(
            validate_allowed_host_entry("evil example.com").is_err(),
            "空白字符应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("evil.example.com:abc").is_err(),
            "冒号之后不是纯数字端口号应当被拒绝"
        );
        assert!(
            validate_allowed_host_entry("evil.example.com:80:81").is_err(),
            "出现第二个冒号应当被拒绝"
        );
    }

    #[test]
    fn validate_allowed_hosts_rejects_empty_array() {
        let result = validate_allowed_hosts(&[]);
        assert!(result.is_err(), "空数组应当被拒绝——省略等于关闭校验");
    }

    #[test]
    fn validate_allowed_hosts_rejects_first_invalid_entry_and_accepts_all_valid() {
        assert!(validate_allowed_hosts(&["*.evil.com".to_string()]).is_err());
        assert!(
            validate_allowed_hosts(&[
                "public-operation-hk4e.mihoyo.com".to_string(),
                "public-operation-hk4e-sg.hoyoverse.com".to_string(),
            ])
            .is_ok()
        );
    }

    #[test]
    fn extract_url_host_parses_lowercase_host_and_optional_port() {
        assert_eq!(
            extract_url_host(
                "https://Public-Operation-HK4E.Mihoyo.com/gacha_info/api/getGachaLog?authkey=x"
            ),
            Some("public-operation-hk4e.mihoyo.com".to_string()),
            "host 比对大小写不敏感，这里归一化为小写"
        );
        assert_eq!(
            extract_url_host("https://example.com:8443/path"),
            Some("example.com:8443".to_string()),
            "显式声明了非默认端口时，端口应当纳入比对"
        );
    }

    #[test]
    fn extract_url_host_returns_none_for_unparseable_url() {
        // fail closed：解析失败时返回 None，不猜测、不做字符串切分兜底。
        assert_eq!(extract_url_host("not a url at all"), None);
        assert_eq!(extract_url_host(""), None);
    }

    #[test]
    fn pipeline_construction_rejects_empty_allowed_hosts() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["allowedHosts"] = serde_json::json!([]);
        });
        let result =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value);
        assert!(
            result.is_err(),
            "空的 allowedHosts 数组应当在构造期就被拒绝——可选的安全字段等于默认关闭"
        );
    }

    #[test]
    fn pipeline_construction_rejects_allowed_hosts_with_wildcard_scheme_or_path() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");

        let wildcard = genshin_manifest_with(|v| {
            v["collect"]["params"]["allowedHosts"] = serde_json::json!(["*.mihoyo.com"]);
        });
        assert!(
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, wildcard).is_err(),
            "通配符条目应当在构造期就被拒绝"
        );

        let with_scheme = genshin_manifest_with(|v| {
            v["collect"]["params"]["allowedHosts"] =
                serde_json::json!(["https://public-operation-hk4e.mihoyo.com"]);
        });
        assert!(
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, with_scheme)
                .is_err(),
            "带 scheme 的条目应当在构造期就被拒绝"
        );

        let with_path = genshin_manifest_with(|v| {
            v["collect"]["params"]["allowedHosts"] =
                serde_json::json!(["public-operation-hk4e.mihoyo.com/gacha_info"]);
        });
        assert!(
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, with_path)
                .is_err(),
            "带路径的条目应当在构造期就被拒绝"
        );
    }

    /// ★ §7.8.3 的核心验证：白名单本身合法，但 `{{credential}}` 展开出的
    /// host 不在白名单内——这正是"凭据被投毒"的场景：能往游戏缓存/日志里
    /// 写内容的攻击者，可以种一个匹配 `urlPattern` 正则、却指向自己域名的
    /// URL。校验模板本身挡不住这个（genshin 的 `request.url` 模板里根本
    /// 没有 host，host 完全来自 `{{credential}}`），必须校验替换完成之后
    /// 的最终 URL 才挡得住。
    ///
    /// 额外断言 `transport.call_count() == 0`：证明被拒绝的请求**从未真正
    /// 发出**，不是"发出去了但结果被事后丢弃"。
    #[test]
    fn collect_banner_rejects_request_when_final_url_host_is_credential_poisoned() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        // 白名单是 genshin 真实声明（mihoyo.com / hoyoverse.com），但这里的
        // "凭据"指向攻击者自己的域名——模拟"游戏缓存/日志被投毒"场景。
        let poisoned_credential_url =
            "https://evil.example.com/gacha_info/api/getGachaLog?authkey=stolen&lang=zh-cn";

        let transport = FixtureTransport::new();
        // 刻意不给这个 URL 注册任何响应——如果校验没生效、请求真的被发出去，
        // FixtureTransport 会因为找不到注册的响应而报错，而不是"意外成功"，
        // 这样测试在两种失败模式下都不会被误判为通过。

        let repo = storage.repository();
        let result = pipeline.collect_banner(
            &transport,
            &repo,
            account_id,
            "301",
            poisoned_credential_url,
            "100000000",
            None,
            Some("zh-cn"),
            1_754_812_801_000,
        );

        match result {
            Err(PipelineError::HostNotAllowed { plugin_id, host }) => {
                assert_eq!(plugin_id, "genshin");
                assert_eq!(host.as_deref(), Some("evil.example.com"));
            }
            other => panic!("期望 HostNotAllowed，实际：{other:?}"),
        }
        assert_eq!(
            transport.call_count(),
            0,
            "host 不在白名单内的请求必须在发出之前就被拦下，FixtureTransport 不应该收到任何调用"
        );
    }

    #[test]
    fn collect_banner_allows_request_when_final_url_host_is_allowlisted() {
        // 回归：正常路径（host 属于插件真实声明的 allowedHosts）不受影响，
        // 与 full_pipeline_run_matches_fixture_expectations 覆盖同一条正常
        // 路径，这里只聚焦断言"host 校验本身放行"，不重复校验记录内容。
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_3_empty.json"),
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
            Some("zh-cn"),
            1_754_812_801_000,
        );
        assert!(result.is_ok(), "host 在白名单内时不应当被拒绝：{result:?}");
        assert_eq!(transport.call_count(), 1);
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

    // ============================================================
    // parse_record_time：按声明的单一格式解析，不再依次尝试
    // ============================================================

    #[test]
    fn parse_record_time_accepts_iso_local_when_declared() {
        let parsed = parse_record_time("2026-06-18T21:15:32", RawTimeFormatJson::IsoLocal {})
            .expect("声明 isoLocal 时 ISO 字符串应当能解析");
        assert_eq!(
            parsed,
            chrono::NaiveDate::from_ymd_opt(2026, 6, 18)
                .unwrap()
                .and_hms_opt(21, 15, 32)
                .unwrap()
        );
    }

    #[test]
    fn parse_record_time_accepts_space_separated_when_declared() {
        let parsed = parse_record_time("2026-06-18 21:15:32", RawTimeFormatJson::SpaceSeparated {})
            .expect("声明 spaceSeparated 时空格分隔字符串应当能解析");
        assert_eq!(
            parsed,
            chrono::NaiveDate::from_ymd_opt(2026, 6, 18)
                .unwrap()
                .and_hms_opt(21, 15, 32)
                .unwrap()
        );
    }

    /// ★ 严格匹配的核心行为：声明 `isoLocal` 时空格分隔格式必须报错，不再
    /// 像修复前那样依次尝试两种格式后"反正能解析出来就算数"。
    #[test]
    fn parse_record_time_rejects_space_separated_when_iso_local_declared() {
        let err = parse_record_time("2026-06-18 21:15:32", RawTimeFormatJson::IsoLocal {})
            .expect_err("声明 isoLocal 时空格分隔格式应当报错，不能被静默兜底接受");
        let message = err.to_string();
        assert!(
            message.contains("2026-06-18 21:15:32") && message.contains("isoLocal"),
            "错误信息应当包含原始字符串与声明的 kind，实际：{message}"
        );
    }

    /// 对称的另一半：声明 `spaceSeparated` 时 ISO 格式必须报错。
    #[test]
    fn parse_record_time_rejects_iso_local_when_space_separated_declared() {
        let err = parse_record_time("2026-06-18T21:15:32", RawTimeFormatJson::SpaceSeparated {})
            .expect_err("声明 spaceSeparated 时 ISO 格式应当报错，不能被静默兜底接受");
        let message = err.to_string();
        assert!(
            message.contains("2026-06-18T21:15:32") && message.contains("spaceSeparated"),
            "错误信息应当包含原始字符串与声明的 kind，实际：{message}"
        );
    }

    #[test]
    fn parse_record_time_rejects_unrecognized_format() {
        assert!(
            parse_record_time("18/06/2026 21:15:32", RawTimeFormatJson::SpaceSeparated {}).is_err()
        );
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

        // 同上：用 genshin 真实 allowedHosts 里的域名，避免 §7.8 host 白名单
        // 校验掩盖本测试真正要验证的逻辑。
        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE";
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
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            page_1,
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
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
        // 同上：用 genshin 真实 allowedHosts 里的域名，避免 §7.8 host 白名单
        // 校验掩盖本测试真正要验证的逻辑。
        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
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

        // 同上：用 genshin 真实 allowedHosts 里的域名，避免 §7.8 host 白名单
        // 校验掩盖本测试真正要验证的逻辑。
        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_2.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 3)
                .expect("URL 构造应当成功"),
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

        // 同上：用 genshin 真实 allowedHosts 里的域名，避免 §7.8 host 白名单
        // 校验掩盖本测试真正要验证的逻辑。
        let credential_url =
            "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
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

    // ============================================================
    // A4 · rawFormat
    // ============================================================

    /// 未声明 `time.rawFormat`：默认套用 `SpaceSeparated`，genshin 现有
    /// manifest 从未声明过这个字段，历史行为不能变。
    #[test]
    fn manifest_parsing_defaults_raw_format_to_space_separated_when_absent() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        assert_eq!(pipeline.raw_format, RawTimeFormatJson::SpaceSeparated {});
    }

    /// 声明 `time.rawFormat: { kind: "isoLocal" }`：pipeline 应当原样存下这个
    /// 声明——这是 `parse_record_time` 真正读取到插件意图的唯一路径。
    #[test]
    fn manifest_parsing_captures_declared_raw_format() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["time"] = serde_json::json!({ "rawFormat": { "kind": "isoLocal" } });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");
        assert_eq!(pipeline.raw_format, RawTimeFormatJson::IsoLocal {});
    }

    // ============================================================
    // C7 · 具名占位符 {{credential.<name>}}（M2-S3）
    // ============================================================

    /// 鸣潮 POST body 的真实需求（`AUDIT-2026-08-12-M2鸣潮纸面填表演练.md`
    /// §8.3）：五个离散字段分别从凭据 URL 的不同 query 参数取值，
    /// `cardPoolType` 复用已有的裸占位符 `{{gachaType}}`——验证具名占位符与
    /// 裸占位符能在同一个模板里共存，且都被正确替换。
    #[test]
    fn named_credential_placeholder_extracts_individual_query_params() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"]["body"] = serde_json::json!(
                r#"{"cardPoolId":"{{credential.resources_id}}","cardPoolType":"{{gachaType}}","languageCode":"{{credential.lang}}","playerId":"{{credential.player_id}}","recordId":"{{credential.record_id}}","serverId":"{{credential.svr_id}}"}"#
            );
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://gmserver-api.aki-game2.com/gacha/record?resources_id=6001&lang=zh-cn&player_id=100000000&record_id=abc123&svr_id=76402e5b20be2c39f095a152090711cc";

        let body = pipeline
            .build_page_body(credential_url, "2001", 1)
            .expect("具名占位符应当全部替换成功")
            .expect("声明了 request.body 时应当返回 Some");

        assert_eq!(
            body,
            r#"{"cardPoolId":"6001","cardPoolType":"2001","languageCode":"zh-cn","playerId":"100000000","recordId":"abc123","serverId":"76402e5b20be2c39f095a152090711cc"}"#
        );
    }

    /// 规则一：query 参数不存在必须报错，不能替换成空串——空串会产出一个
    /// 字段值为空但语法合法的请求，请求照发、服务端可能返回语义错误的结果，
    /// 用户看到的是"少了一批记录"而不是一条明确的报错。
    #[test]
    fn named_credential_placeholder_rejects_missing_query_param() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"]["url"] = serde_json::json!(
                "https://public-operation-hk4e.mihoyo.com/x?playerId={{credential.player_id}}"
            );
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        // 凭据 URL 里没有 player_id 这个 query 参数。
        let credential_url = "https://public-operation-hk4e.mihoyo.com/x?lang=zh-cn";
        let result = pipeline.build_page_url(credential_url, "301", 1);
        match result {
            Err(PipelineError::CredentialParamInvalid {
                plugin_id,
                param_name,
                reason,
            }) => {
                assert_eq!(plugin_id, "genshin");
                assert_eq!(param_name, "player_id");
                // ★ 必须断言到 reason：CredentialParamInvalid 是规则一（参数
                // 不存在）与规则二（取值非法）共用的变体，只断言 param_name
                // 的话，一条本该走规则二的用例即使实际走了规则一也照样通过。
                // 这不是假设——本文件的规则二用例最初就是这么写错的（占位符
                // 名与凭据 URL 里的参数名不一致，实际走的是规则一，规则二的
                // 字符检查零覆盖），由变异测试暴露后才补上本断言。
                assert!(
                    reason.contains("不存在"),
                    "应当是「参数不存在」而非「取值非法」：{reason}"
                );
            }
            other => panic!("期望 CredentialParamInvalid，实际：{other:?}"),
        }
    }

    /// 规则二：取到的值含有会破坏 JSON body 字符串字面量语法的字符时必须
    /// 报错——这里用一个未经百分号编码、直接嵌了字面引号的凭据 URL 模拟
    /// "凭据被投毒"的场景（能往游戏日志/缓存里写内容的攻击者，可以种一个
    /// 匹配 urlPattern 正则、但携带这类字符的 URL）。同时验证错误信息只带
    /// 占位符名称，不带解析出的取值——避免明文凭据片段被写进日志。
    #[test]
    fn named_credential_placeholder_rejects_value_with_illegal_characters() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"]["url"] = serde_json::json!(
                "https://public-operation-hk4e.mihoyo.com/x?secret={{credential.secret}}"
            );
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        // ⚠️ 占位符名（`secret`）必须与凭据 URL 里真实存在的 query 参数名
        // 一致，本用例才会走到规则二。这里曾经写成 `{{credential.secretToken}}`
        // 而凭据 URL 里的参数叫 `secret`——extract_query_param 找不到
        // `secretToken`，实际触发的是规则一（参数不存在），规则二的字符检查
        // 从未被执行过，而断言只核 param_name，两条规则的错误都能满足，
        // 于是这条用例名不副实地"通过"了。
        let poisoned_credential_url =
            "https://public-operation-hk4e.mihoyo.com/x?secret=super\"secret&lang=zh-cn";
        let err = pipeline
            .build_page_url(poisoned_credential_url, "301", 1)
            .expect_err("取到的值含有字面引号，应当报错");
        let message = err.to_string();
        match &err {
            PipelineError::CredentialParamInvalid {
                plugin_id,
                param_name,
                reason,
            } => {
                assert_eq!(plugin_id, "genshin");
                assert_eq!(param_name, "secret");
                assert!(
                    reason.contains("投毒"),
                    "应当是「取值非法」而非「参数不存在」：{reason}"
                );
            }
            other => panic!("期望 CredentialParamInvalid，实际：{other:?}"),
        }
        assert!(message.contains("secret"), "应当带上占位符名称：{message}");
        assert!(
            !message.contains("super\"secret"),
            "不应当带上解析出的凭据取值：{message}"
        );
    }

    // ============================================================
    // S3 · POST 传输 + request.method/headers 接线 + singleRequest（M2-S3）
    // ============================================================

    /// 端到端验证鸣潮形态：`request.method: "POST"`、`headers`（含具名占位符）、
    /// `body`（含具名占位符）三者一起接线进 `collect_banner`，
    /// `stopCondition: singleRequest` 保证只发一次请求。
    #[test]
    fn collect_banner_dispatches_post_request_with_substituted_body_and_headers() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"] = serde_json::json!({
                "url": "https://gmserver-api.aki-game2.com/gacha/record/query",
                "method": "POST",
                "headers": {
                    "Content-Type": "application/json",
                    "Lang": "{{credential.lang}}"
                },
                "body": r#"{"cardPoolId":"{{credential.resources_id}}","cardPoolType":"{{gachaType}}","recordId":"{{credential.record_id}}"}"#
            });
            v["collect"]["params"]["allowedHosts"] =
                serde_json::json!(["gmserver-api.aki-game2.com"]);
            v["collect"]["params"]["stopCondition"] =
                serde_json::json!({ "kind": "singleRequest" });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url =
            "https://gmserver-api.aki-game2.com/x?resources_id=6001&lang=zh-cn&record_id=abc123";
        let expected_url = pipeline
            .build_page_url(credential_url, "2001", 1)
            .expect("URL 构造应当成功");

        let response_body = serde_json::json!({
            "retcode": 0,
            "message": "OK",
            "data": {
                "list": [{
                    "uid": "100000000", "gacha_type": "2001", "count": "1",
                    "time": "2026-06-18 21:15:32", "name": "测试五星角色A", "lang": "zh-cn",
                    "item_type": "角色", "rank_type": "5", "id": "1400000000000000010"
                }]
            }
        })
        .to_string();

        let transport = FixtureTransport::new();
        transport.register(expected_url.clone(), response_body);

        let repo = storage.repository();
        let outcome = pipeline
            .collect_banner(
                &transport,
                &repo,
                account_id,
                "2001",
                credential_url,
                "100000000",
                None,
                Some("zh-cn"),
                1_754_812_801_000,
            )
            .expect("采集应当成功");

        assert_eq!(outcome.pages_fetched, 1);
        assert_eq!(outcome.stop_reason, StopReason::SingleRequest);
        assert_eq!(transport.call_count(), 1, "只应当发出一次请求");

        let post_requests = transport.post_requests();
        assert_eq!(
            post_requests.len(),
            1,
            "应当且只应当走 POST 一次，不应该退化成 GET"
        );
        let (url, body, headers) = &post_requests[0];
        assert_eq!(url, &expected_url);
        assert_eq!(
            body,
            r#"{"cardPoolId":"6001","cardPoolType":"2001","recordId":"abc123"}"#
        );
        assert_eq!(
            headers.get("Content-Type").map(String::as_str),
            Some("application/json"),
            "Content-Type 由插件通过 headers 声明，不是 Rust 侧硬编码"
        );
        assert_eq!(
            headers.get("Lang").map(String::as_str),
            Some("zh-cn"),
            "headers 的值也应当跑占位符替换"
        );
    }

    /// ★ POST 路径必须同样受 host 白名单保护，不能绕过 §7.8.3 的校验——
    /// 新增的 POST 分支绕过既有安全检查是最典型的回归。断言
    /// `transport.call_count() == 0`：请求从未真正发出，不是发出去了但
    /// 结果被事后丢弃，这两者在抓包/代理日志里差别巨大。
    #[test]
    fn collect_banner_rejects_post_request_when_final_url_host_is_not_allowed() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["request"] = serde_json::json!({
                "url": "https://evil.example.com/gacha/record/query",
                "method": "POST",
                "body": r#"{"cardPoolType":"{{gachaType}}"}"#
            });
            // allowedHosts 沿用 genshin 真实声明（mihoyo.com/hoyoverse.com），
            // 与 request.url 的 host 不一致。
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let transport = FixtureTransport::new();
        // 刻意不注册任何响应——校验生效的话请求根本不会被发出，
        // FixtureTransport 找不到注册响应而报错也不会发生，因为压根不会
        // 走到 transport.post。

        let repo = storage.repository();
        let result = pipeline.collect_banner(
            &transport,
            &repo,
            account_id,
            "301",
            "https://public-operation-hk4e.mihoyo.com/x?resources_id=6001",
            "100000000",
            None,
            None,
            1_754_812_801_000,
        );

        assert!(
            matches!(result, Err(PipelineError::HostNotAllowed { .. })),
            "期望 HostNotAllowed，实际：{result:?}"
        );
        assert_eq!(
            transport.call_count(),
            0,
            "POST 路径下 host 不在白名单时，请求必须在发出之前就被拦下——\
             无论走 GET 还是 POST，都不能绕过 host 白名单校验"
        );
    }

    /// `stopCondition: singleRequest`：即使第一页非空，也只应当发出一次
    /// 请求——鸣潮 API 不认 `page` 参数，继续翻页只会拿到与第一次完全相同
    /// 的全量数据，用缺省的 `emptyPage` 会陷入死循环。只注册第一页的响应：
    /// 如果 pipeline 错误地继续翻页，测试会失败在"请求了未注册的第二页"，
    /// 而不是静默通过。
    #[test]
    fn collect_banner_stops_after_single_request_even_when_first_page_is_non_empty() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["stopCondition"] =
                serde_json::json!({ "kind": "singleRequest" });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
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
            .expect("采集应当成功");

        assert_eq!(outcome.stop_reason, StopReason::SingleRequest);
        assert_eq!(outcome.pages_fetched, 1, "只应当发出一次请求");
        assert_eq!(transport.call_count(), 1);
        assert!(outcome.records_inserted > 0, "第一页非空，记录应当已经写入");
    }

    // ============================================================
    // C1 · resolve_log_credential（credential.logFile 的真实消费点）
    // ============================================================

    /// 端到端验证：manifest 声明 `credential.kind: "logFile"` + `decode`，
    /// `resolve_log_credential` 应当能定位日志文件、解混淆、按 urlPattern
    /// 扫出凭据 URL——这是 `logPath`/`decode` 两个契约字段的真实消费点
    /// （HC-4）。
    #[test]
    fn resolve_log_credential_decodes_log_and_extracts_url_end_to_end() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["credential"] = serde_json::json!({
                "kind": "logFile",
                "logPath": "Client/Saved/Logs/Client.log",
                "urlPattern": {
                    "source": r"https://[\w.-]+/aki/gacha/index\.html#/record[?=&\w-]+",
                    "flags": ""
                },
                "decode": { "kind": "xorByLowBit", "skipBytes": 0, "maskWhenOdd": 90, "maskWhenEven": 90 }
            });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let dir = TestDir::new("log-credential-e2e");
        let log_path = dir.path().join("Client/Saved/Logs/Client.log");
        std::fs::create_dir_all(log_path.parent().unwrap()).unwrap();

        let plaintext = "2026-08-13 10:00:00 [Info] https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?a=1\n";
        // mask_when_odd == mask_when_even 时异或自身可逆（同一个字节异或
        // 同一个掩码两次等于没变），构造"密文"只需要对明文再跑一遍同样的
        // 解码函数，不需要像 log_scan.rs 测试那样为非对称掩码单写一个
        // encode 辅助函数。
        let spec = crate::log_scan::LogDecodeSpec::XorByLowBit {
            skip_bytes: 0,
            mask_when_odd: 0x5A,
            mask_when_even: 0x5A,
        };
        let encoded = crate::log_scan::decode_log_bytes(plaintext.as_bytes(), Some(&spec));
        std::fs::write(&log_path, &encoded).unwrap();

        let locator =
            crate::cache_scan::StaticGameLocator::new().with_install_root("genshin", dir.path());
        let url = pipeline
            .resolve_log_credential(&locator)
            .expect("解析不应报错")
            .expect("应当能从日志里扫出凭据 URL");
        assert!(url.ends_with("a=1"), "应当扫到唯一一行里的 URL：{url}");
    }

    /// 与 `resolve_log_credential_rejects_when_credential_is_not_log_file`
    /// 对称：`credential` 不是 `chromiumCache` 时同样直接拒绝。两个分支的
    /// 拒绝语义必须一致，否则「宿主按 `credential()` 的判别联合自行路由」
    /// 这条约定在其中一边会失去兜底。
    #[test]
    fn resolve_cache_credential_rejects_when_credential_is_not_chromium_cache() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["credential"] = serde_json::json!({
                "kind": "logFile",
                "logPath": "Client/Saved/Logs/Client.log",
                "urlPattern": { "source": "https://example.com/record", "flags": "" }
            });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");
        let locator = crate::cache_scan::StaticGameLocator::new();
        let result = pipeline.resolve_cache_credential(&locator);
        assert!(
            matches!(result, Err(PipelineError::Config(_))),
            "credential 不是 chromiumCache 时应当报 Config 错误，实际：{result:?}"
        );
    }

    /// 游戏未登记安装目录时，`CacheScanError::GameNotInstalled` 应当经由
    /// `From<CacheScanError> for PipelineError` 传播出来——与 `logFile`
    /// 分支的同名测试对称。
    #[test]
    fn resolve_cache_credential_propagates_game_not_installed_error() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        // 空 locator：任何 game_id 都查不到安装目录。
        let locator = crate::cache_scan::StaticGameLocator::new();
        let result = pipeline.resolve_cache_credential(&locator);
        let Err(PipelineError::Config(message)) = result else {
            panic!("未登记安装目录时应当报 Config 错误，实际：{result:?}");
        };
        assert!(
            message.contains("genshin"),
            "错误信息应当点名是哪个游戏没登记：{message}"
        );
    }

    /// `credential` 不是 `logFile`（genshin 真实声明是 `chromiumCache`）时
    /// 应当直接拒绝，不静默退化去扫别的东西。
    #[test]
    fn resolve_log_credential_rejects_when_credential_is_not_log_file() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let pipeline = AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::default())
            .expect("应当能构造 pipeline");
        let locator = crate::cache_scan::StaticGameLocator::new();
        let result = pipeline.resolve_log_credential(&locator);
        assert!(
            matches!(result, Err(PipelineError::Config(_))),
            "credential 不是 logFile 时应当报 Config 错误，实际：{result:?}"
        );
    }

    /// 游戏未在宿主配置里登记安装目录：`LogScanError::GameNotInstalled`
    /// 应当经由 `From<LogScanError> for PipelineError` 正确传播出来，不是
    /// panic 或被吞掉。
    #[test]
    fn resolve_log_credential_propagates_game_not_installed_error() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["credential"] = serde_json::json!({
                "kind": "logFile",
                "logPath": "Client/Saved/Logs/Client.log",
                "urlPattern": { "source": "https://example.com/record", "flags": "" }
            });
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");
        let locator = crate::cache_scan::StaticGameLocator::new(); // 未注册任何安装目录
        let result = pipeline.resolve_log_credential(&locator);
        assert!(
            matches!(result, Err(PipelineError::Config(_))),
            "游戏未安装应当报 Config 错误，实际：{result:?}"
        );
    }

    // ============================================================
    // §1.8 · 拒绝"批处理序位 + 增量提前终止"的组合（M2-S3）
    // ============================================================

    #[test]
    fn validate_batch_record_keys_not_combined_with_reached_known_stop_condition_rejects_combo() {
        let result = validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
            "wuwa", true, true,
        );
        assert!(result.is_err(), "批处理序位 + 增量提前终止的组合应当被拒绝");
        let message = result.unwrap_err().to_string();
        assert!(message.contains("deriveRecordKeys"));
        assert!(message.contains("reachedKnown"));
        assert!(
            message.contains("17.53"),
            "错误信息应当说清楚为什么拒绝（实测比例），不能只说\"不允许\"：{message}"
        );
    }

    #[test]
    fn validate_batch_record_keys_not_combined_with_reached_known_stop_condition_accepts_others() {
        assert!(
            validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
                "wuwa", true, false
            )
            .is_ok(),
            "只声明批处理序位、不搭配增量终止，应当放行"
        );
        assert!(
            validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
                "genshin", false, true
            )
            .is_ok(),
            "只声明增量终止、不搭配批处理序位，应当放行"
        );
        assert!(
            validate_batch_record_keys_not_combined_with_reached_known_stop_condition(
                "x", false, false
            )
            .is_ok()
        );
    }

    // ============================================================
    // bannerIdentity（M2-S4）：banner_key/pity_group 取查询还是取响应
    // ============================================================
    //
    // 三个用例共用同一份 fixture（301_page_1.json：5 条记录，4 条
    // gacha_type="301"、1 条 gacha_type="400"，实测分布见
    // gs_core::BannerIdentitySource 文档注释）+ 一页空响应终止翻页，
    // 不复用 full_pipeline_run_matches_fixture_expectations 的三页设置——
    // 这三个用例只关心 banner_key/pity_group 的分布，不需要验证完整分页
    // 行为，两页足够且更聚焦。

    /// `bannerIdentity: "query"`：即使响应里混回了别的卡池的记录（fixture
    /// 里那条 gacha_type="400"），落库的 `banner_key` 也必须是本次查询实际
    /// 使用的 banner（"301"），不是响应自带的 `gacha_type`。这是
    /// `gs_core::BannerIdentitySource` 文档注释里鸣潮那条真实行为的直接
    /// 模拟——声明 query 就是要求宿主无条件信查询参数，哪怕响应看起来
    /// "混池"了。
    #[test]
    fn collect_banner_uses_query_banner_id_when_banner_identity_is_query() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["bannerIdentity"] = serde_json::json!("query");
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
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
            .expect("采集应当成功");
        assert_eq!(outcome.records_inserted, 5);

        let records_301 = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        let records_400 = repo
            .find_records_by_banner(account_id, "400")
            .expect("查询应当成功");
        assert_eq!(
            records_301.len(),
            5,
            "query 模式下全部记录都应归到查询参数 \"301\"，包括响应里 gacha_type=400 的那条"
        );
        assert_eq!(
            records_400.len(),
            0,
            "query 模式下不应有任何记录落到响应自带的 \"400\"——那条记录必须被查询参数覆盖"
        );

        // ★ 覆盖必须发生在 record_key 生成**之前**，不能只改最终落库的
        // banner_key。genshin 的 deriveRecordKey 产出 `${bannerId}:${stableId}`，
        // 因此 record_key 的前缀直接暴露了 hook 当时看到的是哪个 bannerId：
        //   - 覆盖在 hook 之前（正确）→ 那条响应 gacha_type=400 的记录，key 是 "301:..."
        //   - 覆盖在 hook 之后（错误）→ key 仍是 "400:..."，而 banner_key 已是 "301"
        // 后者两处不一致，且更要命的是：`bannerIdentity: "query"` 的游戏里插件
        // 拿不到真实卡池，key 就少了卡池这一维，两个卡池在同一秒出同一件物品时
        // 会算出相同的 record_key，被 UNIQUE + INSERT OR IGNORE 静默吞掉一条。
        // 没有这条断言，把覆盖挪回下游不会让任何测试变红。
        assert!(
            records_301
                .iter()
                .all(|record| record.record_key.as_str().starts_with("301:")),
            "record_key 必须由被覆盖后的 bannerId 生成（前缀 \"301:\"），\
             说明 query 覆盖发生在 deriveRecordKey 之前；实际：{:?}",
            records_301
                .iter()
                .map(|record| record.record_key.as_str())
                .collect::<Vec<_>>()
        );
    }

    /// 缺省（不声明 `bannerIdentity`）：`banner_key` 必须继续取响应自带的
    /// `gacha_type`，混池的那条记录（`gacha_type: "400"`）绝不能被查询参数
    /// "301" 覆盖——这是本次改动前唯一真实存在的行为，必须原样保留。用真实、
    /// 未经修改的 genshin manifest（不经过 genshin_manifest_with 覆盖任何
    /// 字段）构造 pipeline，是防止新增的 query 模式误伤原神现有行为的
    /// 回归用例。
    #[test]
    fn collect_banner_defaults_to_response_banner_id_and_keeps_mixed_pool_fixture_correct() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
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
            .expect("采集应当成功");
        assert_eq!(outcome.records_inserted, 5);

        let records_301 = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        let records_400 = repo
            .find_records_by_banner(account_id, "400")
            .expect("查询应当成功");
        assert_eq!(
            records_301.len(),
            4,
            "缺省 Response 模式：5 条记录里 1 条 gacha_type=400，其余 4 条归 301，\
             这条行为不能被本次改动破坏"
        );
        assert_eq!(
            records_400.len(),
            1,
            "缺省 Response 模式：混池的那条记录必须落到响应真实的 400，不能被查询参数 301 覆盖"
        );
    }

    /// `banner_key` 与 `pity_group` 必须取自**同一个**来源，不能一处用
    /// 查询、一处用响应——那种"各用各的"组合会让记录的卡池归属与它的保底组
    /// 不一致，是比两处都错更难查的 bug。
    ///
    /// 构造两个互不相同的保底组：`groupA` 只含 "301"，`groupB` 只含
    /// "400"。若实现有 bug（`banner_key` 信查询、`pity_group` 却仍信响应），
    /// 混池的那条记录会被错误地判给 `groupB`；只有两处一致地信查询参数，
    /// 它才会落进与其余记录相同的 `groupA`。
    #[test]
    fn collect_banner_derives_banner_key_and_pity_group_from_the_same_source() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let (runtime, account_id) = setup_pipeline_and_account(&storage);
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["bannerIdentity"] = serde_json::json!("query");
            v["pityGroups"] = serde_json::json!([
                { "key": "groupA", "members": ["301"] },
                { "key": "groupB", "members": ["400"] },
            ]);
        });
        let pipeline =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value)
                .expect("应当能构造 pipeline");

        let credential_url = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn";
        let transport = FixtureTransport::new();
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 1)
                .expect("URL 构造应当成功"),
            read_fixture("fixtures/genshin/raw_response/301_page_1.json"),
        );
        transport.register(
            pipeline
                .build_page_url(credential_url, "301", 2)
                .expect("URL 构造应当成功"),
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
                1_754_812_801_000,
            )
            .expect("采集应当成功");

        let records_301 = repo
            .find_records_by_banner(account_id, "301")
            .expect("查询应当成功");
        assert_eq!(records_301.len(), 5, "query 模式下全部记录都应归到 \"301\"");
        assert!(
            records_301.iter().all(|r| r.pity_group == "groupA"),
            "banner_key 与 pity_group 必须取自同一来源：全部记录的 pity_group 都应是查询参数 \
             \"301\" 对应的 groupA，不能有记录因为响应里的 gacha_type=400 而被错误地判给 groupB"
        );
    }

    // ============================================================
    // collect.params.rateLimit（M2-S6 之后的缺口修复）：manifest 声明的
    // 限速参数曾经完全不进反序列化路径——AuthkeyParamsJson 没有 rateLimit
    // 字段，serde 静默丢弃了它。以下用例既验证合并逻辑本身（与
    // rate_limit.rs 的单元测试互补：这里从"真实 manifest JSON 文本"出发，
    // 证明字段确实穿过了反序列化 + 合并两层，不是只在 RateLimitPolicy
    // 内部测试通过而 pipeline.rs 仍然没接上），也验证接线路径上新增的
    // 构造期校验（batchSize=0 拒绝启动）。
    // ============================================================

    /// 用 `from_manifest_value`（私有，测试模块作为祖先模块可直接调用）而
    /// 不是 `from_manifest_json_for_test`——后者把注入策略写死成
    /// `RateLimitPolicy::zero_delay_for_tests()`，delay 类字段已经是下界，
    /// 无法构造"声明比注入更短"的场景。这里需要自己控制注入值。
    #[test]
    fn declared_rate_limit_longer_per_page_delay_flows_through_deserialization_and_merge() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["rateLimit"] = serde_json::json!({ "perPageDelayMs": 9000 });
        });
        let pipeline = AuthkeyApiPipeline::from_manifest_value(
            "genshin",
            &runtime,
            manifest_value,
            RateLimitPolicy::default(), // 注入 300ms
        )
        .expect("应当能构造 pipeline");
        assert_eq!(
            pipeline.rate_limit.per_page_delay,
            Duration::from_millis(9000)
        );
    }

    /// 本任务的核心场景：插件声明的延迟比注入值更短，不能被采纳——证明
    /// "合并"而不是"覆盖"这条口径在真实反序列化路径上也成立，不只是
    /// `RateLimitPolicy::merged_with_declared` 单测里成立。
    ///
    /// ⚠️ **必须同时声明一个"插件会赢"的字段，否则这条测试名不副实。**
    /// 只断言 `per_page_delay == 300ms` 的话，两种截然不同的实现会产生
    /// **完全相同**的观测结果：
    ///   1. 正确执行了 `max(300, 10)`，插件值因更激进而落选；
    ///   2. `rateLimit` 整个对象根本没被解析（本任务修的就是这个缺口），
    ///      注入值原样穿过。
    ///
    /// 变异测试实测过这一点——把 `rateLimit` 的解析整个退回不接线，这条
    /// 测试**依然通过**。所以这里补上 `retry.maxAttempts: 2`（比注入的 5
    /// 更保守，插件应当赢）：两条断言合起来才同时证明了"declared 确实被
    /// 解析到了"与"更激进的那个字段没被采纳"，缺一条都留有上述歧义。
    #[test]
    fn declared_rate_limit_shorter_per_page_delay_cannot_relax_injected_policy() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["rateLimit"] = serde_json::json!({
                "perPageDelayMs": 10,
                "retry": { "maxAttempts": 2 },
            });
        });
        let pipeline = AuthkeyApiPipeline::from_manifest_value(
            "genshin",
            &runtime,
            manifest_value,
            RateLimitPolicy::default(), // 注入 300ms / 5 次，前者比声明的 10ms 更温和
        )
        .expect("应当能构造 pipeline");
        // ① 更激进的声明（10ms < 300ms）没被采纳。
        assert_eq!(
            pipeline.rate_limit.per_page_delay,
            Duration::from_millis(300)
        );
        // ② 但 declared 确实被解析到了——更保守的 maxAttempts 赢了。没有这
        //    一条，①单独成立并不能排除"整个 rateLimit 没接线"。
        assert_eq!(
            pipeline.rate_limit.retry.max_attempts, 2,
            "declared 未被解析：若 rateLimit 整个对象没接进反序列化路径，这里会是注入的 5"
        );
    }

    /// genshin 场景零影响：真实插件（`plugins/genshin/manifest.ts`）没有声明
    /// `rateLimit`，走注册表路径（`AuthkeyApiPipeline::new`，不是测试专用的
    /// `from_manifest_value`），合并结果必须与注入值逐字段相等——历史行为
    /// 不受本次改动影响。
    #[test]
    fn genshin_plugin_without_declared_rate_limit_is_unaffected_by_merge() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let injected = RateLimitPolicy::default();
        let pipeline =
            AuthkeyApiPipeline::new("genshin", &runtime, injected).expect("应当能构造 pipeline");
        assert_eq!(pipeline.rate_limit, injected);
    }

    /// 完整往返：manifest 同时声明 `perPageDelayMs`/`batchSize`/
    /// `batchDelayMs`/`retry.maxAttempts`/`retry.backoff`/`retry.delayMs`
    /// 六个子字段，逐一核对合并结果——防止某个字段的 serde `rename`
    /// （如 `delayMs`/`maxAttempts`）与 `packages/gs-plugin-kit/manifest.ts`
    /// 的实际 camelCase 键名不一致却在只测单字段的用例里被漏掉。
    #[test]
    fn declared_rate_limit_all_subfields_round_trip_through_merge() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["rateLimit"] = serde_json::json!({
                "perPageDelayMs": 800,
                "batchSize": 4,
                "batchDelayMs": 2500,
                "retry": {
                    "maxAttempts": 2,
                    "backoff": "exponential",
                    "delayMs": 6000,
                },
            });
        });
        let pipeline = AuthkeyApiPipeline::from_manifest_value(
            "genshin",
            &runtime,
            manifest_value,
            RateLimitPolicy::default(),
        )
        .expect("应当能构造 pipeline");

        assert_eq!(
            pipeline.rate_limit.per_page_delay,
            Duration::from_millis(800)
        );
        assert_eq!(pipeline.rate_limit.batch_pause.every_n_pages, 4);
        assert_eq!(
            pipeline.rate_limit.batch_pause.delay,
            Duration::from_millis(2500)
        );
        assert_eq!(pipeline.rate_limit.retry.max_attempts, 2);
        assert_eq!(pipeline.rate_limit.retry.backoff, BackoffKind::Exponential);
        assert_eq!(pipeline.rate_limit.retry.delay, Duration::from_millis(6000));
    }

    #[test]
    fn validate_declared_batch_size_rejects_zero() {
        let result = validate_declared_batch_size("genshin", Some(0));
        assert!(
            result.is_err(),
            "batchSize=0 无法构成合法的停顿间隔，必须拒绝"
        );
        assert!(result.unwrap_err().to_string().contains("batchSize"));
    }

    #[test]
    fn validate_declared_batch_size_accepts_absent_or_nonzero() {
        assert!(validate_declared_batch_size("genshin", None).is_ok());
        assert!(validate_declared_batch_size("genshin", Some(1)).is_ok());
        assert!(validate_declared_batch_size("genshin", Some(10)).is_ok());
    }

    /// 构造期集成测试：manifest 声明 `batchSize: 0` 必须在 pipeline 构造阶段
    /// 就被拒绝，而不是留到某次真实翻页时除零 panic。
    #[test]
    fn manifest_declaring_zero_batch_size_is_rejected_at_construction() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let manifest_value = genshin_manifest_with(|v| {
            v["collect"]["params"]["rateLimit"] = serde_json::json!({ "batchSize": 0 });
        });
        let result =
            AuthkeyApiPipeline::from_manifest_json_for_test("genshin", &runtime, manifest_value);
        // `AuthkeyApiPipeline` 没有派生 `Debug`（生命周期参数携带
        // `&PluginRuntime`，没有必要为了这一处测试断言给生产类型加派生），
        // 因此不能用 `unwrap_err()`（要求 `Ok` 分支也实现 `Debug`），改用
        // `match` 显式处理两个分支。
        match result {
            Err(err) => assert!(err.to_string().contains("batchSize")),
            Ok(_) => panic!("batchSize=0 应当在构造期被拒绝"),
        }
    }

    // ============================================================
    // should_batch_pause：纯函数，脱离完整 pipeline 单独验证触发点
    // ============================================================

    #[test]
    fn should_batch_pause_triggers_on_exact_multiples() {
        assert!(should_batch_pause(10, 10));
        assert!(should_batch_pause(20, 10));
        assert!(should_batch_pause(30, 10));
    }

    #[test]
    fn should_batch_pause_does_not_trigger_between_multiples() {
        assert!(!should_batch_pause(1, 10));
        assert!(!should_batch_pause(9, 10));
        assert!(!should_batch_pause(11, 10));
    }

    #[test]
    fn should_batch_pause_every_page_when_interval_is_one() {
        // 插件把 batchSize 合并成 1（"每页都停顿"）是合法边界值，不是 0。
        assert!(should_batch_pause(1, 1));
        assert!(should_batch_pause(2, 1));
    }
}
