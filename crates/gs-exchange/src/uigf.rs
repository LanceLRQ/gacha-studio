//! `uigf`：UIGF v4.x（`https://uigf.org`）交换格式适配器。
//!
//! ## 存档形状（源码级核实）
//!
//! 校准依据：`docs/example-projects/HoYo.Gacha/tauri/src/business/converters.rs`
//! 1034-1171 行（`Uigf`/`UigfInfo`/`UigfProject`/`UigfHk4eItem`/`UigfHkrpgItem`/
//! `UigfNapItem`/`UigfHk4eBeyondItem`）。顶层结构：
//!
//! ```json
//! {
//!   "info": { "export_timestamp": 1735689600, "export_app": "...",
//!              "export_app_version": "...", "version": "v4.0" },
//!   "hk4e": [ { "uid": "100000000", "timezone": 8, "lang": "zh-cn", "list": [...] } ],
//!   "hkrpg": [ ... ],
//!   "nap": [ ... ],
//!   "hk4e_ugc": [ ... ]
//! }
//! ```
//!
//! `info.version` 是版本字段名——**不是** `uigf_version`，后者属于旧版
//! （v2.x~v3.x）`ClassicUigfInfo`，两者结构不同，不要混用（这个区分已经在
//! `wwgacha` 模块的 `uigf_v4_shape_json` 测试样本里踩过一次坑，见该处注释）。
//! 四个游戏键分别对应：`hk4e`→原神、`hkrpg`→星铁、`nap`→绝区零、
//! `hk4e_ugc`→原神 UGC 玩法"Miliastra Wonderland"（本适配器不支持，见下方
//! "hk4e_ugc 不支持"一节）。每个游戏键下是一个**账号数组**（`UigfProject`），
//! 每个账号自带 `uid`/`timezone`/`lang` 与该账号的完整 `list`。
//!
//! `uid`/`export_timestamp` 允许 JSON 里写成字符串或数字两种形式
//! （`string_or_integer_de`，converters.rs:1012-1032）；本适配器只消费
//! `uid`，用 [`u32_or_string`] 承接同样的宽松度。`timezone` 是**纯数字**
//! （`i8`，没有这层宽松解析，converters.rs:1060），JSON 里必须是数字而不是
//! 字符串。
//!
//! 各游戏 item 结构里的 `gacha_type`/`item_id`/`gacha_id`/`rank_type`/`count`
//! 一律用 `string_number_into`（同样字符串/数字两态皆可，converters.rs 里
//! `#[serde(with = "string_number_into")]` 系列标注），本适配器用
//! [`u32_or_string`]/[`opt_u32_or_string`] 承接。`id`（服务端雪花 ID）在
//! 三个游戏的 item 结构里都是**必填 `String`，没有 `#[serde(default)]`**
//! （converters.rs:1092、1121、1154）——缺失即整个 `import` 失败，这是
//! fail-closed，不为缺失的 `id` 合成兜底值。
//!
//! ## 版本范围：只支持 v4.x
//!
//! 版本号格式 `^v(\d+)\.(\d+)$`，本项目只做 v4.0/4.1/4.2（v2.x/v3.0 Classic
//! UIGF 与 SRGF v1.0 不做，用户已确认，超出范围不视为缺陷）。`sniff` 与
//! `import` 对"是不是 UIGF"与"是不是本适配器支持的版本"给出不同层次的答案
//! ——见 [`UigfAdapter::sniff`] 与 [`UigfAdapter::import`] 各自的文档。
//!
//! ## 与采集 API 响应的关系：还原、不映射
//!
//! 与 [`crate::wwgacha`] 模块同一条纪律：本适配器只负责把 UIGF item 还原成
//! 米哈游 API 原始响应元素的形状，**绝不自己映射成 `UnifiedRecordFields`**
//! ——字段映射只能有一处（TS 侧 `plugins/<game>/manifest.ts` 的
//! `fields.extractRecord`），理由见 `crate` 顶层文档 [`ImportBanner::records`]
//! 字段的说明与 [`crate::wwgacha`] 模块文档"顺序反转不是可有可无的兜底"
//! 一节——这里同样适用，只是换成了"字段还原"而不是"顺序还原"。
//!
//! 三个游戏的原始响应字段**不完全相同**，逐一核对自
//! `fixtures/{genshin,starrail,zzz}/raw_response/*.json`：
//!
//! | 字段 | 原神（hk4e） | 星铁（hkrpg） | 绝区零（nap） |
//! |------|------|------|------|
//! | `uid` | ✓ | ✓ | ✓ |
//! | `gacha_type` | ✓ | ✓ | ✓ |
//! | `gacha_id` | ✗ | ✓ | ✓（恒为 `"0"`） |
//! | `item_id` | ✗（API 不返回，见 `plugins/genshin/manifest.ts`） | ✓ | ✓ |
//! | `count` | ✓ | ✓ | ✓ |
//! | `time` | ✓ | ✓ | ✓ |
//! | `name` | ✓ | ✓ | ✓ |
//! | `lang` | ✓ | ✓ | ✓ |
//! | `item_type` | ✓ | ✓ | ✓ |
//! | `rank_type` | ✓ | ✓ | ✓ |
//! | `id` | ✓ | ✓ | ✓ |
//!
//! UIGF 的 `UigfHk4eItem`/`UigfHkrpgItem` 都携带 `item_id`（导出时用于查
//! 物品字典），但原神 API 从不返回这个字段——还原时**主动丢弃**，理由与
//! `wwgacha::WwgachaRecord` 丢弃 `CardPoolId` 完全一致：写进"已经还原成 API
//! 形状"的 `Value` 里，等于给 `extractRecord` 递一个真实 API 响应里根本不
//! 存在的字段。绝区零的 `gacha_id` 在 UIGF 里是 `Option<u32>`
//! （converters.rs:1131，与原神/星铁的必填不同），真实存档全量记录实测恒为
//! `"0"`（`fixtures/zzz/meta.toml`），因此 `None` 时补 `"0"`，不是凭空杜撰
//! 的默认值。
//!
//! `lang`/`uid` 在 UIGF 里是账号级字段（`UigfProject`），不在每条记录内部，
//! 但三款游戏的真实 API 响应元素里都携带这两个字段（逐条记录都有）——还原
//! 时把账号级的 `uid`/`lang` 广播进每一条重建出来的记录，这不是编造：UIGF
//! 的 `lang` 本来就是从某一条 API 记录的 `lang` 字段读来的（导出时同一账号
//! 全部记录理应共享同一个 `lang`），`uid` 同理。
//!
//! ### 时间字段：`time` 原样透传，`timezone` 走 `ImportAccount` 单独携带
//!
//! UIGF 的 `time` 是**朴素时间**（`PrimitiveDateTime`，序列化格式
//! `yyyy-MM-dd HH:mm:ss`，`converters.rs` 引用的 `gacha_log_time_format` 与
//! `hg_url_scraper::GACHA_LOG_TIME_FORMAT` 是同一个格式描述——见
//! `docs/example-projects/HoYo.Gacha/crates/url_scraper/src/types.rs:9-12`），
//! 与三款游戏插件 `time.rawFormat` 缺省值 `spaceSeparated`
//! 完全同构。`timezone` 是独立的小时偏移字段，导入时的语义是"假设该时间
//! 属于文件声明的 `timezone`"（`converters.rs:1610-1654` 的读取逻辑：
//! `time.assume_offset(target_timezone).to_offset(server_timezone)`）。
//!
//! 本适配器**不在这里做这层换算**：`time` 字段原样透传成还原记录的 `time`
//! 值，不结合 `timezone` 做任何偏移运算。理由不是"忘了处理"，而是这层换算
//! 需要的输入（"这条记录最终应该落在哪个时区语境下解释"）本来就应该由
//! `AuthkeyApiPipeline::build_records` 的 `page_tz_offset_hours` 参数决定
//! ——那正是这个参数存在的意义（`crates/paradigms/gs-p-authkey/src/
//! pipeline.rs` 的 `normalize_time`）。若适配器自己先用 UIGF 的 `timezone`
//! 把 `time` 换算成另一个语境下的字符串再交出去，得到的 `Value` 就不再是
//! "米哈游 API 原始响应元素的形状"了（真实 API 的 `time` 字段从来就是没有
//! 经过这种二次换算的服务器本地时间），这正是本文件开头"还原、不映射"那条
//! 纪律要防的事。
//!
//! `timezone` 本身不会凭空消失——它是账号级信息（UIGF 里 `timezone` 挂在
//! `UigfProject` 上，语义上属于"这个游戏这个账号"，不属于整份文件），落在
//! [`ImportAccount::tz_offset_hours`] 上，与 `time` 字符串走两条不同的
//! 通路：`time` 经由还原出的 `Value` 交给 `extractRecord`（游戏知识，TS
//! 侧），`timezone` 经由 `ImportAccount` 交给
//! `AuthkeyApiPipeline::build_records` 的 `page_tz_offset_hours` 参数
//! （范式流程，Rust 侧）——两者都不在本适配器内部相遇、不在本适配器内部
//! 发生任何换算运算，职责边界因此保持清晰。真正消费 `tz_offset_hours` 的
//! 地方是 `gs_host::import::import_batch`，见该函数文档。

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use crate::{ExchangeAdapter, ImportAccount, ImportBanner, ImportBatch, ImportError, SniffResult};

/// 本适配器识别/导入的交换格式标识，对齐 `plugins/genshin/manifest.ts` 里
/// `exchangeFormats: ["uigf-v4"]` 的取值。
pub const FORMAT_ID: &str = "uigf-v4";

/// UIGF 游戏键 → 本项目插件 `manifest.id` 的映射，逐项对应关系见模块文档。
const GAME_ID_GENSHIN: &str = "genshin";
const GAME_ID_STARRAIL: &str = "starrail";
const GAME_ID_ZZZ: &str = "zzz";

// ============================================================
// 宽松数字解析：JSON 里字符串/数字两种写法都要接受
// ============================================================

/// 承接 `string_number_into`/`string_or_integer_de`（converters.rs 里两个
/// 语义相同、命名不同的辅助函数）——必填字段版本。
fn u32_or_string<'de, D>(de: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Str(String),
        Num(u32),
    }
    match StrOrNum::deserialize(de)? {
        StrOrNum::Num(n) => Ok(n),
        StrOrNum::Str(s) => s
            .parse()
            .map_err(|err| serde::de::Error::custom(format!("\"{s}\" 不是合法的数字：{err}"))),
    }
}

/// 同 [`u32_or_string`]，可选字段版本——对应源码里 `string_number_into::option`
/// 与 `Option::default` 组合的字段（`count`/`rank_type`/绝区零的 `gacha_id`）。
fn opt_u32_or_string<'de, D>(de: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Str(String),
        Num(u32),
    }
    match Option::<StrOrNum>::deserialize(de)? {
        None => Ok(None),
        Some(StrOrNum::Num(n)) => Ok(Some(n)),
        Some(StrOrNum::Str(s)) => s
            .parse()
            .map(Some)
            .map_err(|err| serde::de::Error::custom(format!("\"{s}\" 不是合法的数字：{err}"))),
    }
}

// ============================================================
// 顶层结构
// ============================================================

#[derive(Debug, Deserialize)]
struct UigfArchive {
    info: UigfInfo,
    #[serde(default)]
    hk4e: Option<Vec<UigfProject<UigfHk4eItem>>>,
    #[serde(default)]
    hkrpg: Option<Vec<UigfProject<UigfHkrpgItem>>>,
    #[serde(default)]
    nap: Option<Vec<UigfProject<UigfNapItem>>>,
    // hk4e_ugc（Miliastra Wonderland，原神 UGC 玩法）不在本项目支持范围内，
    // 故意不声明这个字段——serde 默认忽略输入 JSON 里未在结构体中声明的
    // 字段（不管它的值是什么形状），这正是"遇到它不得报错崩溃、要跳过"最
    // 直接的实现方式，做法与 `wwgacha::WwgachaRecord` 故意不声明
    // `CardPoolId` 完全一致：不需要额外声明一个 `Option<Value>` 字段再手动
    // 丢弃它。若声明成真实结构体，`hk4e_ugc` 内部任何一处与本项目预期不符
    // 的形状都会让**整份文件**解析失败，与"跳过"的要求矛盾；声明成
    // `Option<Value>` 兜底虽然不会失败，但除了多一个从不读取的字段之外没有
    // 任何额外好处，因此两种方案里选更简单的一种。
}

#[derive(Debug, Deserialize)]
struct UigfInfo {
    version: String,
    // export_timestamp / export_app / export_app_version 真实存在
    // （converters.rs:1048-1054）但本适配器不消费它们的值——serde 默认忽略
    // JSON 里未在结构体中声明的字段，不需要为了"看起来完整"而声明用不上的
    // 字段，做法与 `wwgacha::WwgachaRecord` 故意不声明 `CardPoolId` 一致。
}

#[derive(Debug, Deserialize)]
struct UigfProject<Item> {
    #[serde(deserialize_with = "u32_or_string")]
    uid: u32,
    /// 纯数字，没有 `string_or_integer_de` 那层宽松解析
    /// （converters.rs:1060 的 `pub timezone: i8` 没有 `#[serde(with = ...)]`
    /// 标注）——JSON 里必须是数字，不接受字符串。落进
    /// [`crate::ImportAccount::tz_offset_hours`]，本适配器自己不用它做
    /// 任何换算运算，理由见模块文档"时间字段"一节。
    timezone: i8,
    #[serde(default)]
    lang: Option<String>,
    list: Vec<Item>,
}

#[derive(Debug, Deserialize)]
struct UigfHk4eItem {
    #[serde(deserialize_with = "u32_or_string")]
    gacha_type: u32,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    count: Option<u32>,
    time: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    item_type: Option<String>,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    rank_type: Option<u32>,
    /// 服务端雪花 ID，必填、无默认值——缺失时 `serde_json::from_slice`
    /// 直接反序列化失败，这就是"缺 id 字段 → 整体失败"的实现，不需要额外
    /// 校验代码。
    id: String,
    // item_id/uigf_gacha_type 真实存在（converters.rs:1069、1073）但本适配器
    // 故意不声明：item_id 在真实原神 API 响应里根本不存在（模块文档表格已
    // 说明），声明了也只会在还原阶段被丢弃；uigf_gacha_type 是 UIGF 内部
    // 跨工具归一化用的池码，不是原始 API 字段，本适配器完全不消费。
}

#[derive(Debug, Deserialize)]
struct UigfHkrpgItem {
    #[serde(deserialize_with = "u32_or_string")]
    gacha_id: u32,
    #[serde(deserialize_with = "u32_or_string")]
    gacha_type: u32,
    #[serde(deserialize_with = "u32_or_string")]
    item_id: u32,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    count: Option<u32>,
    time: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    item_type: Option<String>,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    rank_type: Option<u32>,
    id: String,
}

#[derive(Debug, Deserialize)]
struct UigfNapItem {
    /// 绝区零特有：UIGF 里是 `Option`（converters.rs:1131），与原神/星铁的
    /// 必填不同——`None` 时按真实存档实测结论补 `"0"`，见模块文档。
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    gacha_id: Option<u32>,
    #[serde(deserialize_with = "u32_or_string")]
    gacha_type: u32,
    #[serde(deserialize_with = "u32_or_string")]
    item_id: u32,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    count: Option<u32>,
    time: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    item_type: Option<String>,
    #[serde(default, deserialize_with = "opt_u32_or_string")]
    rank_type: Option<u32>,
    id: String,
}

// ============================================================
// 版本号解析：^v(\d+)\.(\d+)$
// ============================================================

/// 解析 `info.version`，返回 `(major, minor)`。格式不满足
/// `^v(\d+)\.(\d+)$` 时返回 `None`——不尝试任何"看起来差不多就算了"的
/// 宽松匹配，格式本身不对是比"版本号不受支持"更基础的一类错误。
fn parse_uigf_version(version: &str) -> Option<(u32, u32)> {
    let rest = version.strip_prefix('v')?;
    let (major_str, minor_str) = rest.split_once('.')?;
    if major_str.is_empty()
        || minor_str.is_empty()
        || !major_str.bytes().all(|b| b.is_ascii_digit())
        || !minor_str.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let major = major_str.parse().ok()?;
    let minor = minor_str.parse().ok()?;
    Some((major, minor))
}

// ============================================================
// sniff：结构识别
// ============================================================

/// `value` 是否具备 UIGF 的顶层结构特征：`info.version` 存在且为字符串，
/// 并且至少有一个游戏键（`hk4e`/`hkrpg`/`nap`/`hk4e_ugc`）出现——不要求
/// 版本号落在本适配器支持的范围内，"结构上像 UIGF"与"版本受支持"是两个
/// 不同层次的判断，后者留给 [`UigfAdapter::import`]，理由见该方法文档。
///
/// 命中时返回 `info.version` 的原始字符串，供 [`SniffResult::Confident`]
/// 的 `format_version` 使用。
fn uigf_shape_version(value: &Value) -> Option<String> {
    let obj = value.as_object()?;
    let info = obj.get("info")?.as_object()?;
    let version = info.get("version")?.as_str()?.to_string();
    let has_game_key = ["hk4e", "hkrpg", "nap", "hk4e_ugc"]
        .iter()
        .any(|key| matches!(obj.get(*key), Some(Value::Array(_)) | Some(Value::Null)));
    has_game_key.then_some(version)
}

/// 截断前缀的文本特征扫描：`head` 解析不出合法 JSON 时的降级路径，与
/// `wwgacha::has_wwgacha_signature_text` 同一思路——要求 `"info"`/
/// `"version"` 与至少一个游戏键的字面量同时出现在前缀里，单独一个特征字符
/// 串不够独特。
fn has_uigf_signature_text(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    text.contains("\"info\"")
        && text.contains("\"version\"")
        && ["\"hk4e\"", "\"hkrpg\"", "\"nap\"", "\"hk4e_ugc\""]
            .iter()
            .any(|needle| text.contains(needle))
}

// ============================================================
// 还原成 API 形状
// ============================================================

/// 把 `(banner_id, Value)` 对按 `banner_id` 分组，并在每组内部把顺序反转
/// ——UIGF `list` 是账号维度的单一数组，写入时按服务端雪花 ID 升序
/// （`docs/example-projects/HoYo.Gacha/tauri/src/database/schemas/
/// gacha_record.rs:152` 的 `ORDER BY id ASC`，即时间正序、旧→新），且不同
/// 卡池的记录在这个数组里是**混排**的（写入端 `converters.rs:1224-1236`
/// 的 `fold` 只按 `(business, uid)` 分组，不按卡池分组）。真实 API 分页
/// 响应按卡池查询、时间倒序（新→旧）——三款游戏 `raw_response/*.json`
/// fixture 的既有注释均已确认这一点。
///
/// 因此这里做的是 wwgacha 那套"顺序反转不是可有可无的兜底"的同一操作，
/// 只是多了一步分组：先按 `banner_id` 把混排的账号级列表拆回各自的卡池
/// 子序列（拆分过程保持 `list` 原有的相对顺序，即 稳定 分组），再对每个
/// 子序列整体反转，换回 API 真实返回的倒序。
fn group_by_banner_and_restore_api_order(items: Vec<(String, Value)>) -> Vec<ImportBanner> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (banner_id, value) in items {
        if !groups.contains_key(&banner_id) {
            order.push(banner_id.clone());
        }
        groups.entry(banner_id).or_default().push(value);
    }
    order
        .into_iter()
        .map(|banner_id| {
            let mut records = groups.remove(&banner_id).unwrap_or_default();
            records.reverse();
            ImportBanner { banner_id, records }
        })
        .collect()
}

/// `count` 缺省时的兜底值——`Option<u32>` 为 `None` 对应 UIGF 导出时的
/// `minimized: true`（`converters.rs:1259-1264` 的 `minimized!` 宏，为真时
/// 把 `count` 整体置空）；真实 API 响应的 `count` 字段永远存在，三款游戏
/// 全部样本实测恒为 `"1"`（`fixtures/{genshin,starrail,zzz}/raw_response/`
/// 逐条核实），补 1 不是凭空杜撰。
const DEFAULT_COUNT: u32 = 1;

fn hk4e_item_to_api_shape(item: &UigfHk4eItem, uid: &str, lang: &str) -> Value {
    serde_json::json!({
        "uid": uid,
        "gacha_type": item.gacha_type.to_string(),
        "count": item.count.unwrap_or(DEFAULT_COUNT).to_string(),
        "time": item.time,
        "name": item.name.clone().unwrap_or_default(),
        "lang": lang,
        "item_type": item.item_type.clone().unwrap_or_default(),
        "rank_type": item
            .rank_type
            .map(|n| n.to_string())
            .unwrap_or_default(),
        "id": item.id.clone(),
    })
}

fn hkrpg_item_to_api_shape(item: &UigfHkrpgItem, uid: &str, lang: &str) -> Value {
    serde_json::json!({
        "uid": uid,
        "gacha_type": item.gacha_type.to_string(),
        "gacha_id": item.gacha_id.to_string(),
        "item_id": item.item_id.to_string(),
        "count": item.count.unwrap_or(DEFAULT_COUNT).to_string(),
        "time": item.time,
        "name": item.name.clone().unwrap_or_default(),
        "lang": lang,
        "item_type": item.item_type.clone().unwrap_or_default(),
        "rank_type": item
            .rank_type
            .map(|n| n.to_string())
            .unwrap_or_default(),
        "id": item.id.clone(),
    })
}

/// 绝区零 `gacha_id` 缺省时补 `"0"`：真实存档全量记录实测恒为 `"0"`
/// （`fixtures/zzz/meta.toml`），不是凭空杜撰的默认值。
fn nap_item_to_api_shape(item: &UigfNapItem, uid: &str, lang: &str) -> Value {
    serde_json::json!({
        "id": item.id.clone(),
        "uid": uid,
        "gacha_type": item.gacha_type.to_string(),
        "gacha_id": item.gacha_id.map(|n| n.to_string()).unwrap_or_else(|| "0".to_string()),
        "item_id": item.item_id.to_string(),
        "count": item.count.unwrap_or(DEFAULT_COUNT).to_string(),
        "time": item.time,
        "name": item.name.clone().unwrap_or_default(),
        "item_type": item.item_type.clone().unwrap_or_default(),
        "rank_type": item
            .rank_type
            .map(|n| n.to_string())
            .unwrap_or_default(),
        "lang": lang,
    })
}

fn hk4e_project_to_batch(project: UigfProject<UigfHk4eItem>) -> ImportBatch {
    let uid = project.uid.to_string();
    let lang = project.lang.unwrap_or_default();
    let tz_offset_hours = Some(i32::from(project.timezone));
    let items = project
        .list
        .iter()
        .map(|item| {
            (
                item.gacha_type.to_string(),
                hk4e_item_to_api_shape(item, &uid, &lang),
            )
        })
        .collect();
    ImportBatch {
        format_id: FORMAT_ID.to_string(),
        game_id: GAME_ID_GENSHIN.to_string(),
        account: ImportAccount {
            uid,
            region: None,
            server_id: None,
            tz_offset_hours,
        },
        banners: group_by_banner_and_restore_api_order(items),
    }
}

fn hkrpg_project_to_batch(project: UigfProject<UigfHkrpgItem>) -> ImportBatch {
    let uid = project.uid.to_string();
    let lang = project.lang.unwrap_or_default();
    let tz_offset_hours = Some(i32::from(project.timezone));
    let items = project
        .list
        .iter()
        .map(|item| {
            (
                item.gacha_type.to_string(),
                hkrpg_item_to_api_shape(item, &uid, &lang),
            )
        })
        .collect();
    ImportBatch {
        format_id: FORMAT_ID.to_string(),
        game_id: GAME_ID_STARRAIL.to_string(),
        account: ImportAccount {
            uid,
            region: None,
            server_id: None,
            tz_offset_hours,
        },
        banners: group_by_banner_and_restore_api_order(items),
    }
}

fn nap_project_to_batch(project: UigfProject<UigfNapItem>) -> ImportBatch {
    let uid = project.uid.to_string();
    let lang = project.lang.unwrap_or_default();
    let tz_offset_hours = Some(i32::from(project.timezone));
    let items = project
        .list
        .iter()
        .map(|item| {
            (
                item.gacha_type.to_string(),
                nap_item_to_api_shape(item, &uid, &lang),
            )
        })
        .collect();
    ImportBatch {
        format_id: FORMAT_ID.to_string(),
        game_id: GAME_ID_ZZZ.to_string(),
        account: ImportAccount {
            uid,
            region: None,
            server_id: None,
            tz_offset_hours,
        },
        banners: group_by_banner_and_restore_api_order(items),
    }
}

/// `UIGF` v4.x 交换格式适配器。
pub struct UigfAdapter;

impl ExchangeAdapter for UigfAdapter {
    fn format_id(&self) -> &'static str {
        FORMAT_ID
    }

    /// `head` 结构上像 UIGF（`info.version` + 至少一个游戏键）就返回
    /// `Confident`，**即使版本不是 v4.x**——`format_version` 如实携带解析出
    /// 的版本号，不在这里做支持范围判断。
    ///
    /// 理由：返回 `No` 会让用户拿到"无法识别此文件"这种误导性提示，而它
    /// 其实是一份合法但本适配器暂不支持的 UIGF（如 Classic UIGF v3.0 或
    /// SRGF v1.0）。是否支持这个版本、支持到什么程度，是 [`Self::import`]
    /// 的职责——`sniff` 只回答"这是不是 UIGF"，`import` 才回答"这份 UIGF
    /// 我能不能处理"，两个问题不能用同一个返回值糊在一起回答。
    fn sniff(&self, head: &[u8]) -> SniffResult {
        match serde_json::from_slice::<Value>(head) {
            Ok(value) => match uigf_shape_version(&value) {
                Some(version) => SniffResult::Confident {
                    format_version: Some(version),
                },
                // 解析成功但形状不对：head 已经是完整、可信的 JSON，没有
                // "信息不足"这回事，直接判定不是本格式——与
                // `wwgacha::WwgachaAdapter::sniff` 同一条理由。
                None => SniffResult::No,
            },
            Err(_) => {
                if has_uigf_signature_text(head) {
                    SniffResult::Possible
                } else {
                    SniffResult::No
                }
            }
        }
    }

    /// 版本不是 v4.x（含格式完全不合法）时 fail closed，错误信息写明识别到
    /// 的版本号，呼应 [`Self::sniff`] 对非 v4.x 版本仍然给出 `Confident` 的
    /// 设计——用户从"能识别但不支持"走到"明确报错说明原因"，不会卡在
    /// 一句"无法识别"里猜不出该怎么办。
    fn import(&self, data: &[u8]) -> Result<Vec<ImportBatch>, ImportError> {
        let archive: UigfArchive =
            serde_json::from_slice(data).map_err(|err| ImportError::Malformed {
                format_id: FORMAT_ID.to_string(),
                detail: err.to_string(),
            })?;

        let (major, minor) =
            parse_uigf_version(&archive.info.version).ok_or_else(|| ImportError::Malformed {
                format_id: FORMAT_ID.to_string(),
                detail: format!(
                    "info.version \"{}\" 不是合法的 UIGF 版本号（应形如 \"v4.0\"）",
                    archive.info.version
                ),
            })?;
        if major != 4 {
            return Err(ImportError::Malformed {
                format_id: FORMAT_ID.to_string(),
                detail: format!("识别为 UIGF v{major}.{minor}，当前只支持 v4.x"),
            });
        }

        let mut batches = Vec::new();
        if let Some(projects) = archive.hk4e {
            batches.extend(projects.into_iter().map(hk4e_project_to_batch));
        }
        if let Some(projects) = archive.hkrpg {
            batches.extend(projects.into_iter().map(hkrpg_project_to_batch));
        }
        if let Some(projects) = archive.nap {
            batches.extend(projects.into_iter().map(nap_project_to_batch));
        }
        // hk4e_ugc 不在本项目支持范围内——`UigfArchive` 故意不声明这个字段
        // （见该结构体定义旁注释），因此这里不需要任何代码就已经"跳过，不
        // 产出 ImportBatch，也不因为它存在而让整份文件导入失败"。

        Ok(batches)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- 版本号解析 ----------

    #[test]
    fn parse_uigf_version_accepts_well_formed_strings() {
        assert_eq!(parse_uigf_version("v4.0"), Some((4, 0)));
        assert_eq!(parse_uigf_version("v4.2"), Some((4, 2)));
        assert_eq!(parse_uigf_version("v2.0"), Some((2, 0)));
        assert_eq!(parse_uigf_version("v10.3"), Some((10, 3)));
    }

    #[test]
    fn parse_uigf_version_rejects_malformed_strings() {
        for input in ["", "4.0", "v4", "v4.", "va.b", "v4.0.1", "v-1.0"] {
            assert_eq!(parse_uigf_version(input), None, "input = {input:?}");
        }
    }

    // ---------- sniff ----------

    fn minimal_uigf_json(version: &str) -> String {
        format!(
            r#"{{"info":{{"export_timestamp":1735689600,"export_app":"x","export_app_version":"1","version":"{version}"}},"hk4e":[]}}"#
        )
    }

    #[test]
    fn sniff_returns_confident_for_well_formed_v4_archive() {
        let adapter = UigfAdapter;
        let json = minimal_uigf_json("v4.0");
        assert_eq!(
            adapter.sniff(json.as_bytes()),
            SniffResult::Confident {
                format_version: Some("v4.0".to_string())
            }
        );
    }

    #[test]
    fn sniff_returns_confident_for_non_v4_version_not_no() {
        // sniff 只回答"像不像 UIGF"，不回答"支持不支持这个版本"——即使
        // 版本号是本适配器不支持的 v3.0，结构上仍然是一份 UIGF，应当
        // Confident，理由见 `UigfAdapter::sniff` 文档。
        let adapter = UigfAdapter;
        let json = minimal_uigf_json("v3.0");
        assert_eq!(
            adapter.sniff(json.as_bytes()),
            SniffResult::Confident {
                format_version: Some("v3.0".to_string())
            }
        );
    }

    #[test]
    fn sniff_returns_no_for_json_without_any_game_key() {
        let adapter = UigfAdapter;
        let json = r#"{"info":{"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"}}"#;
        assert_eq!(adapter.sniff(json.as_bytes()), SniffResult::No);
    }

    #[test]
    fn sniff_returns_no_for_unrelated_json_and_non_json_bytes() {
        let adapter = UigfAdapter;
        assert_eq!(adapter.sniff(br#"{"foo":"bar"}"#), SniffResult::No);
        assert_eq!(adapter.sniff(b"not json at all"), SniffResult::No);
    }

    #[test]
    fn sniff_returns_possible_for_truncated_prefix_containing_signature() {
        let adapter = UigfAdapter;
        let full = minimal_uigf_json("v4.0");
        let cut = full.find("\"hk4e\"").expect("样本应当包含 hk4e") + 6;
        let head = &full.as_bytes()[..cut];
        assert!(serde_json::from_slice::<Value>(head).is_err());
        assert_eq!(adapter.sniff(head), SniffResult::Possible);
    }

    #[test]
    fn sniff_returns_no_for_wwgacha_shape() {
        // 反过来验证不会把 wwgacha 存档误判成 UIGF——两个适配器的 sniff
        // 互不误判是 `AdapterRegistry` 能正确工作的前提。
        let adapter = UigfAdapter;
        let wwgacha = br#"{"UID":1,"ServerID":"s","ServerArea":"a","GachaPoolData":[]}"#;
        assert_eq!(adapter.sniff(wwgacha), SniffResult::No);
    }

    // ---------- import：版本范围 ----------

    #[test]
    fn import_fails_closed_for_non_v4_version_with_descriptive_message() {
        let adapter = UigfAdapter;
        let json = minimal_uigf_json("v3.0");
        let err = adapter
            .import(json.as_bytes())
            .expect_err("v3.0 不在支持范围内，应当报错");
        let message = err.to_string();
        assert!(
            message.contains("v3.0") && message.contains("v4.x"),
            "错误信息应当同时点出识别到的版本与支持范围，实际: {message}"
        );
    }

    #[test]
    fn import_fails_closed_for_malformed_version_string() {
        let adapter = UigfAdapter;
        let json = minimal_uigf_json("not-a-version");
        assert!(adapter.import(json.as_bytes()).is_err());
    }

    // ---------- import：hk4e_ugc 跳过 ----------

    #[test]
    fn import_skips_hk4e_ugc_without_error_or_batch() {
        let adapter = UigfAdapter;
        let json = r#"{"info":{"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
                "hk4e_ugc":[{"anything":"goes",  "nested": {"a": [1,2,3]} }]}"#;
        let batches = adapter
            .import(json.as_bytes())
            .expect("hk4e_ugc 存在不应导致整体导入失败");
        assert!(
            batches.is_empty(),
            "hk4e_ugc 不应产出任何 ImportBatch，实际: {batches:?}"
        );
    }

    // ---------- import：缺 id 字段 fail closed ----------

    #[test]
    fn import_fails_closed_when_record_is_missing_id_field() {
        let adapter = UigfAdapter;
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hk4e": [{
                "uid": "100000000",
                "timezone": 8,
                "lang": "zh-cn",
                "list": [
                    {"gacha_type":"301","item_id":"1","count":"1","time":"2026-01-01 00:00:00","name":"x","item_type":"角色","rank_type":"5"}
                ]
            }]
        }"#;
        let result = adapter.import(json.as_bytes());
        assert!(
            matches!(result, Err(ImportError::Malformed { .. })),
            "缺少 id 字段应当导致整体导入失败（fail closed），不应合成兜底值，实际: {result:?}"
        );
    }

    // ---------- import：多游戏多账号 ----------

    #[test]
    fn import_produces_one_batch_per_game_and_account_with_correct_ids() {
        let adapter = UigfAdapter;
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hk4e": [
                {
                    "uid": "100000001",
                    "timezone": 8,
                    "lang": "zh-cn",
                    "list": [
                        {"gacha_type":"301","count":"1","time":"2026-01-01 00:00:00","name":"x","item_type":"角色","rank_type":"5","id":"1400000000000000001"}
                    ]
                },
                {
                    "uid": "100000002",
                    "timezone": 8,
                    "lang": "zh-cn",
                    "list": [
                        {"gacha_type":"301","count":"1","time":"2026-01-01 00:00:00","name":"y","item_type":"武器","rank_type":"4","id":"1400000000000000002"}
                    ]
                }
            ],
            "hkrpg": [
                {
                    "uid": "200000001",
                    "timezone": 8,
                    "lang": "zh-cn",
                    "list": [
                        {"gacha_id":"2000","gacha_type":"11","item_id":"20001","count":"1","time":"2026-01-01 00:00:00","name":"z","item_type":"光锥","rank_type":"3","id":"1500000000000000001"}
                    ]
                }
            ]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        assert_eq!(
            batches.len(),
            3,
            "两个原神账号 + 一个星铁账号，应当恰好产出三个 batch"
        );

        let genshin_uids: Vec<&str> = batches
            .iter()
            .filter(|b| b.game_id == "genshin")
            .map(|b| b.account.uid.as_str())
            .collect();
        assert_eq!(genshin_uids.len(), 2);
        assert!(genshin_uids.contains(&"100000001"));
        assert!(genshin_uids.contains(&"100000002"));

        let starrail_batch = batches
            .iter()
            .find(|b| b.game_id == "starrail")
            .expect("应当有一个 starrail batch");
        assert_eq!(starrail_batch.account.uid, "200000001");
    }

    // ---------- import：字段还原形状 ----------

    #[test]
    fn import_restores_genshin_record_to_api_shape_without_item_id() {
        let adapter = UigfAdapter;
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hk4e": [{
                "uid": "100000000",
                "timezone": 8,
                "lang": "zh-cn",
                "list": [
                    {"gacha_type":"301","item_id":"99999","count":"1","time":"2026-01-01 00:00:00","name":"测试角色","item_type":"角色","rank_type":"5","id":"1400000000000000001"}
                ]
            }]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        let batch = batches.into_iter().next().unwrap();
        let banner = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "301")
            .expect("应当有 banner 301");
        assert_eq!(banner.records.len(), 1);
        let record = banner.records[0].as_object().unwrap();
        assert_eq!(record.len(), 9, "原神 API 形状应当恰好 9 个键: {record:?}");
        for key in [
            "uid",
            "gacha_type",
            "count",
            "time",
            "name",
            "lang",
            "item_type",
            "rank_type",
            "id",
        ] {
            assert!(record.contains_key(key), "缺少键 {key}: {record:?}");
        }
        assert!(
            !record.contains_key("item_id"),
            "item_id 不应出现在还原后的原神 API 形状里（真实 API 不返回这个字段）: {record:?}"
        );
        assert_eq!(record["uid"].as_str(), Some("100000000"));
        assert_eq!(record["gacha_type"].as_str(), Some("301"));
        assert_eq!(record["id"].as_str(), Some("1400000000000000001"));
    }

    // ---------- import：timezone → ImportAccount.tz_offset_hours ----------

    #[test]
    fn import_carries_declared_timezone_into_import_account_tz_offset_hours() {
        let adapter = UigfAdapter;
        // 三个游戏键各给一个不同的 timezone，交叉验证不会串位——例如把
        // hkrpg 的值错填进 hk4e 这类 bug，单一游戏键的测试样本抓不住。
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hk4e": [{
                "uid": "100000001", "timezone": 8, "lang": "zh-cn",
                "list": [{"gacha_type":"301","count":"1","time":"2026-01-01 00:00:00","name":"a","item_type":"角色","rank_type":"5","id":"1400000000000000001"}]
            }],
            "hkrpg": [{
                "uid": "100000002", "timezone": -5, "lang": "zh-cn",
                "list": [{"gacha_id":"1","gacha_type":"11","item_id":"1","count":"1","time":"2026-01-01 00:00:00","name":"b","item_type":"光锥","rank_type":"3","id":"1500000000000000001"}]
            }],
            "nap": [{
                "uid": "100000003", "timezone": 1, "lang": "zh-cn",
                "list": [{"gacha_type":"2","item_id":"1","count":"1","time":"2026-01-01 00:00:00","name":"c","item_type":"代理人","rank_type":"3","id":"1900000000000000001"}]
            }]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        assert_eq!(batches.len(), 3);

        let hk4e = batches.iter().find(|b| b.game_id == "genshin").unwrap();
        let hkrpg = batches.iter().find(|b| b.game_id == "starrail").unwrap();
        let nap = batches.iter().find(|b| b.game_id == "zzz").unwrap();
        assert_eq!(hk4e.account.tz_offset_hours, Some(8));
        assert_eq!(hkrpg.account.tz_offset_hours, Some(-5));
        assert_eq!(nap.account.tz_offset_hours, Some(1));
    }

    #[test]
    fn import_restores_starrail_record_with_item_id_and_gacha_id() {
        let adapter = UigfAdapter;
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hkrpg": [{
                "uid": "100000000",
                "timezone": 8,
                "lang": "zh-cn",
                "list": [
                    {"gacha_id":"2128","gacha_type":"11","item_id":"20008","count":"1","time":"2026-01-01 00:00:00","name":"嘉果","item_type":"光锥","rank_type":"3","id":"1500000000000000001"}
                ]
            }]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        let batch = batches.into_iter().next().unwrap();
        let record = batch.banners[0].records[0].as_object().unwrap();
        assert_eq!(
            record.len(),
            11,
            "星铁 API 形状应当恰好 11 个键: {record:?}"
        );
        assert_eq!(record["gacha_id"].as_str(), Some("2128"));
        assert_eq!(record["item_id"].as_str(), Some("20008"));
    }

    #[test]
    fn import_restores_zzz_record_defaulting_missing_gacha_id_to_zero() {
        let adapter = UigfAdapter;
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "nap": [{
                "uid": "100000000",
                "timezone": 8,
                "lang": "zh-cn",
                "list": [
                    {"gacha_type":"2","item_id":"1281","count":"1","time":"2026-01-01 00:00:00","name":"派派","item_type":"代理人","rank_type":"3","id":"1900000000000000001"}
                ]
            }]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        let batch = batches.into_iter().next().unwrap();
        let record = batch.banners[0].records[0].as_object().unwrap();
        assert_eq!(
            record.len(),
            11,
            "绝区零 API 形状应当恰好 11 个键: {record:?}"
        );
        assert_eq!(
            record["gacha_id"].as_str(),
            Some("0"),
            "UIGF 未声明 gacha_id 时应当补真实存档实测的恒定值 \"0\""
        );
    }

    // ---------- import：分组与顺序还原 ----------

    #[test]
    fn import_groups_interleaved_banners_and_restores_descending_order_within_each() {
        let adapter = UigfAdapter;
        // list 是账号级升序（旧→新），且不同卡池混排——构造一份 301/400
        // 交替出现的输入，验证分组不依赖"同一卡池连续出现"这个假设。
        let json = r#"{
            "info": {"export_timestamp":1,"export_app":"x","export_app_version":"1","version":"v4.0"},
            "hk4e": [{
                "uid": "100000000",
                "timezone": 8,
                "lang": "zh-cn",
                "list": [
                    {"gacha_type":"301","count":"1","time":"2026-06-01 00:00:00","name":"a","item_type":"角色","rank_type":"4","id":"1400000000000000001"},
                    {"gacha_type":"400","count":"1","time":"2026-06-02 00:00:00","name":"b","item_type":"角色","rank_type":"5","id":"1400000000000000002"},
                    {"gacha_type":"301","count":"1","time":"2026-06-03 00:00:00","name":"c","item_type":"角色","rank_type":"4","id":"1400000000000000003"}
                ]
            }]
        }"#;
        let batches = adapter.import(json.as_bytes()).expect("应当能成功导入");
        let batch = batches.into_iter().next().unwrap();

        let banner_301 = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "301")
            .expect("应当有 banner 301");
        assert_eq!(banner_301.records.len(), 2);
        // list 内 301 的相对顺序是 id 1 在前、id 3 在后（升序）；还原成 API
        // 倒序后，id 3（新）应当在前，id 1（旧）在后。
        assert_eq!(
            banner_301.records[0]["id"].as_str(),
            Some("1400000000000000003")
        );
        assert_eq!(
            banner_301.records[1]["id"].as_str(),
            Some("1400000000000000001")
        );

        let banner_400 = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "400")
            .expect("应当有 banner 400");
        assert_eq!(banner_400.records.len(), 1);
        assert_eq!(
            banner_400.records[0]["id"].as_str(),
            Some("1400000000000000002")
        );
    }

    // ---------- import：损坏字节不 panic ----------

    #[test]
    fn import_returns_error_not_panic_for_corrupted_bytes() {
        let adapter = UigfAdapter;
        let corrupted = br#"{"info": {"version": "v4.0""#;
        let result = adapter.import(corrupted);
        assert!(result.is_err());
    }
}
