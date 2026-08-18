//! 采集记录相关的领域类型。
//!
//! 本模块只定义**纯数据**——判别联合、值对象——不含任何执行逻辑。TS 侧绑定由
//! `gs-host` 的 `gs-codegen` 二进制显式导出（见该文件顶部说明），本模块自身
//! 不写 `#[ts(export)]`，避免导出清单散落在各处、review 时看不全。
//!
//! 三条实测约束（校准自星铁 5372 条真实存档与绝区零字段实测，写在
//! [`UnifiedRecordFields`] 上）与时间三元组的理由（写在 [`GachaRecord`] 上）
//! 是本模块里唯一「反直觉、必须留证据」的部分，其余字段照抄存储数据模型
//! 设计文档 §3.2 即可，不重复注释。

use crate::record_key::RecordKey;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// 本地化文本：key 为语言标签（如 `"zh-CN"` / `"en-US"`），value 为该语言下的文案。
///
/// 用 `BTreeMap` 不用 `HashMap`——`HashMap` 的遍历顺序不确定，会让 `gs-codegen`
/// 的输出在两次运行之间产生无意义的 diff（HC-3 门禁要求重跑后 `git diff` 为空）。
/// TS 侧用 `#[ts(type = ...)]` 强制生成 `Record<string, string>`，而不是
/// ts-rs 默认给 `BTreeMap` 生成的映射类型语法，二者语义等价，前者更贴近
/// TS 使用者的阅读习惯。
///
/// 不写 `#[serde(transparent)]`：单字段元组结构体在 `serde_json` 里本来就
/// 会透明地序列化成内层值（`serialize_newtype_struct` 直接转发），这个属性
/// 对 JSON 输出是无操作的多余声明；实测加上后 ts-rs 会打印
/// `failed to parse serde attribute: transparent` 警告（虽不影响生成结果，
/// 但徒增噪音），因此不加。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LocalizedText(#[ts(type = "Record<string, string>")] pub BTreeMap<String, String>);

/// 插件声明自己支持在哪些平台上运行。
///
/// macOS 无游戏客户端，插件的采集能力需要可缺省——这是平台字段存在的原因，
/// 而不是要在这里再重复一遍。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
}

impl Platform {
    /// 应用当前实际编译/运行的操作系统对应的 [`Platform`]，识别不出（如
    /// Linux 开发机）时返回 `None`。
    ///
    /// ## 为什么用 `std::env::consts::OS` 而不是 `#[cfg(target_os = ...)]`
    ///
    /// 两者在"能不能被单元测试覆盖多个分支"这件事上没有本质差别——
    /// `std::env::consts::OS` 本身也是目标三元组在编译期烧进二进制的字符串，
    /// 不是真正的运行时探测；不管选哪种，同一次 `cargo test` 都只能实际跑到
    /// 当前编译目标对应的那一条分支，另一条分支在这台机器上永远执行不到。
    /// 选 `std::env::consts::OS` 单纯是因为它是一次字符串匹配，不需要为每个
    /// 已知平台各写一个 `#[cfg(target_os = "...")]` 分支再加一个
    /// `#[cfg(not(any(...)))]` 兜底才能穷尽，维护量更小。
    ///
    /// 真正解决"可测试性"的方式是把这个函数保持成最薄的一层胶水（只做
    /// OS 字符串到 [`Platform`] 的映射），把"某个插件声明的平台列表是否
    /// 覆盖当前平台"这个真正需要覆盖分支测试的判断逻辑，拆成一个显式接收
    /// `Platform` 参数的纯函数——调用方测试时直接用字面量
    /// `Platform::Windows`/`Platform::Macos` 构造两侧输入，不必依赖测试
    /// 实际运行所在的操作系统。这个纯函数不需要在 `gs-core` 里再提供一份
    /// （`declared.contains(&current)` 本身已经是标准库的纯函数），拆分点
    /// 落在调用方（`gs-analysis::manifest_lookup::platform_supported`）。
    ///
    /// 识别不出的操作系统返回 `None`——调用方应当按"这个平台不支持任何插件
    /// 的采集能力"处理（fail closed，不是 fail open）：宁可界面上多禁用一个
    /// 采集入口，也不要在一个未声明过的平台上假装采集能力可用。
    pub fn current() -> Option<Platform> {
        match std::env::consts::OS {
            "windows" => Some(Platform::Windows),
            "macos" => Some(Platform::Macos),
            _ => None,
        }
    }
}

/// 一款游戏的稀有度阶梯声明。
///
/// `ladder` 不假设长度或具体取值——绝区零是 `["2","3","4"]`，米哈游三游是
/// `["3","4","5"]`，鸣潮同米哈游三游。`pity_target` 指向 `ladder` 中触发保底的
/// 那一档，同样不假设是最高档的字面值 `"5"`。
///
/// `tier_labels`：稀有度码到本地化展示文案的映射（如绝区零
/// `{"4": {"zh-CN": "S"}, "3": {"zh-CN": "A"}, "2": {"zh-CN": "B"}}`）——
/// 这是**面向用户的档位名**，与 `ladder` 里纯粹用来做机器判等/排序的码
/// 是两件事：绝区零的阶梯是 `2`/`3`/`4`，对应的档位名是 `B`/`A`/`S`，不是
/// "2星"/"3星"/"4星"，`ladder` 本身的取值不足以推出正确文案。要求
/// **每个插件各自声明**（不提供跨插件共享的兜底表）——"N 星"这种通用规则
/// 在米哈游三游/鸣潮上凑巧读得通，套在绝区零上就是错的。消费方是
/// `gs_analysis::manifest_lookup::tier_labels_for`（`gs-analysis` crate，
/// 不在本 crate 内，故不写成 intra-doc link）：未覆盖的码才回落到
/// "N 星"，不是本字段自己兜底。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RaritySpec {
    pub ladder: Vec<String>,
    pub pity_target: String,
    #[ts(type = "Record<string, LocalizedText>")]
    pub tier_labels: BTreeMap<String, LocalizedText>,
}

/// 账号/卡池数据的保留策略说明，面向界面展示。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    pub display_text: LocalizedText,
    pub conservative_days: u32,
}

/// 抽数统计口径的**纯数据**声明。
///
/// ⚠️ 存储数据模型设计文档 §3.2.3 给的 Rust 形态是
/// `enum DrawCounting { PerRecord, Custom(fn(&[GachaRecord]) -> u32) }`——
/// 带函数指针，无法做 TS 导出。按 `milestones/00-实施总览.md` §6.4 的裁定，
/// Rust 侧只定义这个纯数据版本；`custom` 分支的实际计算走 TS 侧的
/// `hooks.countDraws`，与 SDK 设计「函数归 hooks，manifest 只放可序列化声明」
/// 的既定模式一致，不在 manifest/领域模型里内联函数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum DrawCountingConfig {
    /// 每条记录记一抽，米哈游三游与鸣潮适用，也是省略时的默认值。
    PerRecord {},
    /// 每条记录代表的抽数不固定，实际计算走插件的 `hooks.countDraws`。
    Custom {},
}

/// 卡池声明。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BannerSpec {
    /// 稳定标识，一旦发布不可更改；会被写入数据库与用户配置。
    pub id: String,
    pub display_name: LocalizedText,
    /// 该卡池若不走插件的默认请求端点，在这里覆盖。多数卡池不需要填。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub endpoint_override: Option<String>,
}

/// HTTP 方法，仅覆盖采集请求会用到的两种。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "UPPERCASE")]
#[ts(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
}

/// 一次采集请求的声明式模板。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RequestTemplate {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub method: Option<HttpMethod>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, string>")]
    pub headers: Option<BTreeMap<String, String>>,
    /// POST 请求体模板，占位符替换规则与 `url` 完全一致
    /// （`{{credential}}` / `{{page}}` / `{{gachaType}}` / `{{pageSize}}`）——
    /// L1 侧复用同一套替换函数，不为 `body` 另写一份。
    ///
    /// 新增动机：鸣潮 `POST /gacha/record/query` 要发 JSON body
    /// `{ cardPoolId, cardPoolType, languageCode, playerId, recordId, serverId }`，
    /// `cardPoolType` 随卡池变化，body 里同样需要占位符——纯 `url` 模板表达
    /// 不了 POST body，因此这里新增而不是复用 `url` 硬塞查询串。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body: Option<String>,
}

/// 物品元数据条目，全部字段可选——元数据字典可能滞后于抽卡记录本身
/// （新角色上线当日官方字典未同步是实测过的真实场景，见
/// [`UnifiedRecordFields`] 的说明）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rarity: Option<String>,
}

/// 一次稀有物品出货的引用，用于 [`BannerBaseline`] 里的对照样本。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RareEventRef {
    pub time: String,
    pub item_id: String,
}

/// 卡池维度的基线数据，用于插件契约测试比对采集结果是否完整。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BannerBaseline {
    pub banner_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draw_count: Option<u32>,
    pub rare_events: Vec<RareEventRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pity_max: Option<u32>,
}

/// 插件采集响应归一化后的统一记录字段。
///
/// 三条实测约束，全部来自真实存档校准，不是设计推演：
///
/// 1. `name` / `item_type` / `rarity` 一律用 [`Option`]，**不得用空字符串
///    冒充有值**。星铁 5372 条真实存档里有 1 条 `item_id` 有值而 `name` /
///    `item_type` / `rank_type` 全为空串（新角色上线当日官方字典未同步）。
///    空串会一路穿过非空校验，只有 `Option` / `NULL` 才能强制每个消费点
///    显式处理这种「有记录、缺元数据」的情况。
/// 2. `rarity` 存的是**稀有度码，不是星数**，且不可假设最高档是 5——绝区零
///    实测 `rank_type` 取值是 `['2','3','4']`，最高档是 4。任何
///    `rarity == 5` 的判定在绝区零上会静默把出金统计成零且不报错。
/// 3. `stable_id` ⚠️ **米哈游三游不可裸用它作 record_key**，理由见
///    [`RecordKey`] 模块文档——服务端雪花 ID 在跨端点场景（如星铁联动池的
///    `getLdGachaLog`）会重复，裸用会导致去重契约静默丢记录。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedRecordFields {
    /// 物品在游戏内的稳定标识，唯一保证非空的字段。
    pub item_id: String,
    /// 原始时间字符串，未做任何时区换算。
    pub time: String,
    /// 归属卡池，取值对应 [`BannerSpec::id`]。
    pub banner_id: String,
    /// 本条获得的物品数量，语义是「数量」不是「抽数」；米哈游三游恒为 1。
    pub count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rarity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stable_id: Option<String>,
    /// 卡池实例 ID（如星铁的 `"2003"`），区别于 `banner_id`（卡池**类别**码，
    /// 如星铁 `gacha_type` 的 `"11"`）——同一类别下会随时间推出多个不同实例。
    ///
    /// **可选，依据 UIGF v4.2 权威 JSON Schema（原文已核）**：
    /// - `hkrpg`（星铁）段把 `gacha_id` 列为 **required**；
    /// - `nap`（绝区零）段把它列为**可选**，且实测恒为 `'0'`（真实存档全量记录
    ///   一致，见 `docs/_internal/research/03-真实导出数据格式实测.md` §1.2），
    ///   读了没有信息量；
    /// - `hk4e`（原神）段**根本不提**这个字段——原神 API 不返回它。
    ///
    /// 三款游戏对同一个字段的必要性判定完全不同，因此在宿主契约层只能定成
    /// 可选：把它设成必填会让原神/绝区零无值可填，设成"米哈游三游专属"又
    /// 会把跨游戏统一契约拆成游戏特例，两者都违反本项目的插件化设计。
    ///
    /// ⚠️ **不能用于可靠地区分卡池期次**：星铁虽然提供 49 种真实取值
    /// （能标识具体期数），但绝区零恒为 `'0'`、鸣潮不适用（不在 UIGF 范围、
    /// `CardPoolId` 全部池共用同一个 hash）。卡池期次归属目前仍是「时间窗口 +
    /// 卡池元数据表」的尽力而为推导，不是靠这个字段的事实断言，见
    /// `research/03` §1.2「设计影响」一节。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub gacha_id: Option<String>,
}

/// 时区来源的可信度分级，供归一化时区换算是否可靠时参考。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum TzOrigin {
    /// 时间字符串本身自带时区信息。
    Source,
    /// 由账号所在区服推断。
    Region,
    /// 由用户在界面上手动指定。
    User,
    /// 既无来源也无区服，宿主假设的默认时区（通常是本机时区）。
    Assumed,
}

/// 元数据补全状态。用于区分「已归一化完成」与「等待字典补齐」，
/// 不能用空字符串糊弄——理由同 [`UnifiedRecordFields`] 的约束 1。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum MetaState {
    Complete,
    Pending,
    Unresolvable,
}

/// 记录的采集来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum RecordSource {
    Packet,
    Ocr,
    OfficialApi,
    Import,
}

/// 记录的卡池归属以哪一侧为准。
///
/// 两个游戏的真实采集行为已实证但根本不同，两者都不能靠猜：
///
/// - **原神——响应携带权威的卡池身份，且可能与查询参数不同。** 实测
///   `fixtures/genshin/raw_response/301_page_1.json`：查询 `gacha_type=301`，
///   响应里 `gacha_type` 分布是 `{'301': 4, '400': 1}`——一次查询会混回其它
///   卡池的记录。此时若用查询时的 banner 覆盖，那条 400 记录会被错误归到
///   301，因此原神**必须**声明 `response`（也是省略时的默认值，历史行为
///   不变）。
/// - **鸣潮——响应不携带可还原的卡池身份。** API 响应元素是 `KRAPIItem`
///   （`docs/example-projects/WWGachaExport/WWGachaExport/Models/GachaAPI.cs`），
///   其 `cardPoolType` 字段实测是中文展示标签（如 `"角色精准调谐"`），不是
///   插件 `banners[].id` 用的 `PoolType` 数字；只有映射表跟不上的新池才会
///   降级成数字串（实测 `PoolType=10` 时回 `"10"`）。而鸣潮一次查询只返回
///   一个池的全量记录，不存在混池，因此查询时的 banner 才是权威，鸣潮
///   **必须**声明 `query`。
///
/// ⚠️ **声明 `query` 的前提是「一次查询只返回一个卡池的记录」。** 若某游戏
/// 其实会混池却声明了 `query`，被混进来的记录会被**静默错误归池**——不报错、
/// 不进日志，保底统计与卡池筛选会一起错，且极难定位。原神就是会混池的真实
/// 例子，它必须用 `response`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum BannerIdentitySource {
    /// 响应自带权威卡池身份，以 `extractRecord` 产出的 `bannerId` 为准。
    Response,
    /// 响应不携带可还原的卡池身份，以宿主发起本次查询时用的卡池为准。
    Query,
}

/// 归一化并落库后的一条抽卡记录，对应存储数据模型设计文档 §3.2。
/// 本 Stage 只定义 Rust 结构体，不建表（建表是 `gs-storage` 的职责）。
///
/// **时间三元组**（`occurred_at` + `occurred_raw` + `tz_origin` /
/// `tz_offset_min`）不是冗余设计。三个米哈游参考工具的时间字段一律不带
/// 时区，而时区可得性完全不一致：星铁 API 直接返回 `region` 与
/// `region_time_zone`（可直接读取使用）；绝区零 API 只返回 `region`，
/// `region_time_zone` 是客户端拿 `region` 查静态表算出来、再写回导出存档的
/// 派生值，不是原始响应字段（源码级核实：`research/04-同族工具三方源码
/// 对比.md` §4.4，`zzz-signal-search-export/src/main/getData.js:33-39,460`）；
/// 原神两者都不返回。若只存换算后的 UTC 毫秒数，一旦某次换算推断错了，
/// 污染就是永久性的、无从追溯——因为原始字符串已经丢了。保留
/// `occurred_raw` 与 `tz_origin`，换算逻辑修 bug 后才有重新推导的依据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GachaRecord {
    pub id: i64,
    pub account_id: i64,
    pub banner_key: String,
    pub pity_group: String,
    pub record_key: RecordKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lang: Option<String>,
    /// 归一化后的 UTC 毫秒时间戳。是否可信取决于 `tz_origin`。
    pub occurred_at: i64,
    /// 换算前的原始时间字符串，来源即插件产出的 [`UnifiedRecordFields::time`]。
    pub occurred_raw: String,
    pub tz_origin: TzOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tz_offset_min: Option<i32>,
    /// 同一原始时间戳内的批次序位，用于鸣潮/异环这类同秒可能有多条记录的场景。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub seq_in_batch: Option<i32>,
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rarity: Option<String>,
    /// 获得数量，业务默认值为 1（由构造方填充）；序列化层不做隐式默认，
    /// 避免消费方把「未提供数量」和「显式为 0」混为一谈。
    pub qty: i64,
    pub meta_state: MetaState,
    pub source: RecordSource,
    /// 本地采集完成时刻（UTC 毫秒），与 `occurred_at`（记录在游戏内的发生
    /// 时刻）是两个不同的时间轴，不要合并。
    pub captured_at: i64,
    /// 指向原始报文存档表的行 id，供归一化逻辑修 bug 后重放重建；
    /// 尚未接入原始报文存储时为 `None`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw_ref: Option<i64>,
    /// 游戏专属附加字段的 JSON 文本，宿主不解析其结构。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub extra: Option<String>,
    /// 服务端返回的记录稳定 ID（米哈游三游的雪花 ID），来自
    /// [`UnifiedRecordFields::stable_id`]，采集管线原样透传落库。
    ///
    /// ⚠️ **不是去重键**——`record_key` 已经由插件在合成时纳入卡池维度
    /// （如 `${gachaType}:${id}`），本列只是留底，供界面展示/校验/未来的
    /// 导出功能使用。鸣潮/异环这类没有服务端稳定 ID 的游戏本列恒为
    /// `None`（对应 SQL `NULL`，不是空字符串，理由见 [`UnifiedRecordFields`]
    /// 的约束 1 与 `gs_storage` 存储层 `normalize_empty` 的文档）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stable_id: Option<String>,
    /// 卡池实例 ID，来自 [`UnifiedRecordFields::gacha_id`]，采集管线原样
    /// 透传落库。可选性与「不能用于可靠区分卡池期次」的理由见该字段的文档。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub gacha_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_unified_record() -> UnifiedRecordFields {
        UnifiedRecordFields {
            item_id: "10001".to_string(),
            time: "2026-08-10 12:00:00".to_string(),
            banner_id: "character-event".to_string(),
            count: 1,
            name: None,
            item_type: None,
            rarity: None,
            stable_id: None,
            gacha_id: None,
        }
    }

    #[test]
    fn platform_serializes_to_lowercase_string_union() {
        let value = serde_json::to_value(Platform::Windows).unwrap();
        assert_eq!(value, serde_json::json!("windows"));
        let value = serde_json::to_value(Platform::Macos).unwrap();
        assert_eq!(value, serde_json::json!("macos"));
    }

    #[test]
    fn platform_current_matches_one_of_the_two_known_variants_or_none() {
        // 本仓库当前只跑在 Windows/macOS 开发机上（CI 平台待定，见
        // CLAUDE.local.md「M0 剩余项」），两者都应当被正确识别；未识别的
        // 操作系统（如 Linux 开发机跑 `cargo test`）不应 panic，只应返回
        // `None`——这条断言本身不依赖测试实际运行在哪个操作系统上，
        // `matches!` 三个分支穷尽了 `current()` 的全部可能返回值。
        assert!(matches!(
            Platform::current(),
            Some(Platform::Windows) | Some(Platform::Macos) | None
        ));
    }

    #[test]
    fn banner_identity_source_serializes_to_camel_case_string_union() {
        let value = serde_json::to_value(BannerIdentitySource::Response).unwrap();
        assert_eq!(value, serde_json::json!("response"));
        let value = serde_json::to_value(BannerIdentitySource::Query).unwrap();
        assert_eq!(value, serde_json::json!("query"));

        let round_tripped: BannerIdentitySource =
            serde_json::from_value(serde_json::json!("query")).unwrap();
        assert_eq!(round_tripped, BannerIdentitySource::Query);
    }

    #[test]
    fn rarity_spec_accepts_non_standard_ladder() {
        // 绝区零形态：最高档是 4，不是米哈游三游习惯的 5。
        let spec = RaritySpec {
            ladder: vec!["2".to_string(), "3".to_string(), "4".to_string()],
            pity_target: "4".to_string(),
            tier_labels: BTreeMap::new(),
        };
        let json = serde_json::to_value(&spec).unwrap();
        assert_eq!(json["ladder"], serde_json::json!(["2", "3", "4"]));
        assert_eq!(json["pityTarget"], serde_json::json!("4"));

        let round_tripped: RaritySpec = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, spec);
    }

    #[test]
    fn rarity_spec_tier_labels_serializes_as_camel_case_field_with_localized_text_values() {
        // 绝区零最高档 "4" 应当能声明文案 "S"——与通用的"N 星"规则完全
        // 无关，是这个字段存在的全部理由。
        let spec = RaritySpec {
            ladder: vec!["2".to_string(), "3".to_string(), "4".to_string()],
            pity_target: "4".to_string(),
            tier_labels: BTreeMap::from([
                (
                    "4".to_string(),
                    LocalizedText(BTreeMap::from([("zh-CN".to_string(), "S".to_string())])),
                ),
                (
                    "3".to_string(),
                    LocalizedText(BTreeMap::from([("zh-CN".to_string(), "A".to_string())])),
                ),
            ]),
        };
        let json = serde_json::to_value(&spec).unwrap();
        assert_eq!(json["tierLabels"]["4"], serde_json::json!({ "zh-CN": "S" }));
        assert_eq!(json["tierLabels"]["3"], serde_json::json!({ "zh-CN": "A" }));

        let round_tripped: RaritySpec = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, spec);
    }

    #[test]
    fn draw_counting_config_round_trips_with_kind_tag() {
        let per_record = DrawCountingConfig::PerRecord {};
        let json = serde_json::to_value(per_record).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "perRecord" }));
        let round_tripped: DrawCountingConfig = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, per_record);

        let custom = DrawCountingConfig::Custom {};
        let json = serde_json::to_value(custom).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "custom" }));
        let round_tripped: DrawCountingConfig = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, custom);
    }

    #[test]
    fn banner_spec_omits_endpoint_override_when_absent() {
        let spec = BannerSpec {
            id: "character-event".to_string(),
            display_name: LocalizedText(BTreeMap::from([(
                "zh-CN".to_string(),
                "角色活动祈愿".to_string(),
            )])),
            endpoint_override: None,
        };
        let json = serde_json::to_value(&spec).unwrap();
        assert!(
            json.get("endpointOverride").is_none(),
            "未提供时不应出现 endpointOverride 键: {json}"
        );

        let round_tripped: BannerSpec = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, spec);
    }

    #[test]
    fn request_template_serializes_method_as_uppercase() {
        let template = RequestTemplate {
            url: "https://example.com/gacha".to_string(),
            method: Some(HttpMethod::Post),
            headers: Some(BTreeMap::from([(
                "X-Rpc-Client-Type".to_string(),
                "2".to_string(),
            )])),
            body: None,
        };
        let json = serde_json::to_value(&template).unwrap();
        assert_eq!(json["method"], serde_json::json!("POST"));
        assert_eq!(
            json["headers"],
            serde_json::json!({ "X-Rpc-Client-Type": "2" })
        );

        let round_tripped: RequestTemplate = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, template);
    }

    #[test]
    fn request_template_omits_body_when_absent() {
        let template = RequestTemplate {
            url: "https://example.com/gacha".to_string(),
            method: None,
            headers: None,
            body: None,
        };
        let json = serde_json::to_value(&template).unwrap();
        assert!(
            json.get("body").is_none(),
            "未提供时不应出现 body 键: {json}"
        );
        let round_tripped: RequestTemplate = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, template);
    }

    #[test]
    fn request_template_carries_body_template_with_placeholders() {
        // 鸣潮形态：POST body 里同样需要 {{gachaType}} 占位符。
        let template = RequestTemplate {
            url: "https://gmserver-api.aki-game2.com/gacha/record/query".to_string(),
            method: Some(HttpMethod::Post),
            headers: None,
            body: Some(
                r#"{"cardPoolId":"{{gachaType}}","cardPoolType":"{{gachaType}}"}"#.to_string(),
            ),
        };
        let json = serde_json::to_value(&template).unwrap();
        assert_eq!(
            json["body"],
            serde_json::json!(r#"{"cardPoolId":"{{gachaType}}","cardPoolType":"{{gachaType}}"}"#)
        );
        let round_tripped: RequestTemplate = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, template);
    }

    #[test]
    fn unified_record_fields_none_rarity_differs_from_empty_string_rarity() {
        let with_none = sample_unified_record();
        let mut with_empty = sample_unified_record();
        with_empty.rarity = Some(String::new());

        let json_none = serde_json::to_value(&with_none).unwrap();
        let json_empty = serde_json::to_value(&with_empty).unwrap();

        // None 时字段整个不出现——不是「出现但为 null」，证明没有用空串顶替 Option。
        assert!(json_none.get("rarity").is_none());
        // Some("") 时字段出现且确实是空串，与「不存在」是可区分的两种状态。
        assert_eq!(json_empty["rarity"], serde_json::json!(""));
        assert_ne!(json_none, json_empty);

        let round_tripped_none: UnifiedRecordFields = serde_json::from_value(json_none).unwrap();
        let round_tripped_empty: UnifiedRecordFields = serde_json::from_value(json_empty).unwrap();
        assert_eq!(round_tripped_none.rarity, None);
        assert_eq!(round_tripped_empty.rarity, Some(String::new()));
    }

    #[test]
    fn gacha_record_round_trips_with_camel_case_fields() {
        let record = GachaRecord {
            id: 1,
            account_id: 42,
            banner_key: "character-event".to_string(),
            pity_group: "character-event-shared".to_string(),
            record_key: RecordKey::new("gacha_type=301:snowflake_123").unwrap(),
            lang: Some("zh-cn".to_string()),
            occurred_at: 1_754_812_800_000,
            occurred_raw: "2026-08-10 12:00:00".to_string(),
            tz_origin: TzOrigin::Region,
            tz_offset_min: Some(480),
            seq_in_batch: None,
            item_id: "10001".to_string(),
            item_type: Some("角色".to_string()),
            rarity: Some("5".to_string()),
            qty: 1,
            meta_state: MetaState::Complete,
            source: RecordSource::OfficialApi,
            captured_at: 1_754_812_801_000,
            raw_ref: Some(7),
            extra: None,
            stable_id: Some("snowflake_123".to_string()),
            gacha_id: Some("2003".to_string()),
        };

        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["accountId"], serde_json::json!(42));
        assert_eq!(
            json["pityGroup"],
            serde_json::json!("character-event-shared")
        );
        assert_eq!(json["occurredAt"], serde_json::json!(1_754_812_800_000i64));
        assert_eq!(json["tzOffsetMin"], serde_json::json!(480));
        assert_eq!(json["metaState"], serde_json::json!("complete"));
        assert_eq!(json["source"], serde_json::json!("officialApi"));
        assert!(json.get("extra").is_none());
        // record_key 是 transparent newtype，序列化后应当是裸字符串。
        assert_eq!(
            json["recordKey"],
            serde_json::json!("gacha_type=301:snowflake_123")
        );
        // stableId/gachaId 序列化为 camelCase，且是本条记录 stable_id/gacha_id
        // 有值时的独立字段，不是靠拆 record_key 拿回来的——见两个字段的文档。
        assert_eq!(json["stableId"], serde_json::json!("snowflake_123"));
        assert_eq!(json["gachaId"], serde_json::json!("2003"));

        let round_tripped: GachaRecord = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, record);
    }
}
