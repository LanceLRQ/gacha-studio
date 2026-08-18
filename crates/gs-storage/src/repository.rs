//! 存储层的读写接口，供 S3 的采集流程与 S5 的分析引擎调用。
//!
//! 本模块只负责"把 `gs_core` 的领域类型搬进/搬出 SQLite"，不含任何业务判断
//! （比如"哪个稀有度算出金"由调用方通过 [`Repository::find_records_by_rarity`]
//! 的参数传入，本模块不内置任何游戏专属常量）。

use crate::credential_guard;
use gs_core::{GachaRecord, GsError, RecordKey};
use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};

/// 把任意实现 [`std::fmt::Display`] 的底层错误（这里固定是 `rusqlite::Error`）
/// 包装成跨层统一的 [`GsError::Storage`]。
fn storage_err(err: impl std::fmt::Display) -> GsError {
    GsError::Storage(err.to_string())
}

/// 把 `T` 序列化为 SQL 要存的字符串。用于 `gs_core` 里那些已经带
/// `#[serde(rename_all = "camelCase")]` 的简单枚举（`TzOrigin` /
/// `MetaState` / `RecordSource`）——复用已有的 `Serialize` 实现，
/// 不再手写一份平行的字符串映射表：手写映射表会在 `gs-core` 侧改了变体名
/// 而这边忘记同步时悄悄失配（编译期不会报错，只会在查询时"查不到"），
/// 而复用 `derive` 出来的实现能让两边天然保持一致。
fn enum_to_sql<T: serde::Serialize>(value: T) -> Result<String, GsError> {
    match serde_json::to_value(value).map_err(storage_err)? {
        serde_json::Value::String(s) => Ok(s),
        other => Err(GsError::Storage(format!(
            "预期枚举序列化为字符串，实际得到: {other}"
        ))),
    }
}

/// [`enum_to_sql`] 的反方向：把 SQL 里读出来的字符串还原成枚举。
fn enum_from_sql<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, GsError> {
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .map_err(|err| GsError::Storage(format!("无法解析枚举取值 `{value}`: {err}")))
}

/// 把空字符串规整为 `None`（对应写入时的 `NULL`）。
///
/// 源数据的空串若原样入库，会一路穿过非空校验；只有 `NULL` 才能强制每个
/// 消费点显式处理"有记录、缺元数据"的情况（星铁 5372 条真实存档中有 1 条
/// `name`/`item_type`/`rank_type` 全为空串，正是这个场景）。这道规整放在
/// 存储层而不是只指望上游归一化层做好，是因为它是贯穿全程的正确性断言
/// （`milestones/00-实施总览.md` §8.3），存储层作为最终落盘前的一道关口，
/// 不单点信任上游。
fn normalize_empty(value: &Option<String>) -> Option<String> {
    match value {
        Some(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

const GACHA_RECORD_SELECT_COLUMNS: &str = "id, account_id, banner_key, pity_group, record_key, \
    lang, occurred_at, occurred_raw, tz_origin, tz_offset_min, seq_in_batch, item_id, \
    item_type, rarity, qty, meta_state, source, captured_at, raw_ref, extra, stable_id, gacha_id";

/// [`Repository::monthly_activity`] 的一行：某个账号在某个自然月的抽卡活动。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthlyActivityRow {
    /// 自然月，格式 `YYYY-MM`（UTC 日历月），见 `monthly_activity` 的文档。
    pub month: String,
    /// 该月抽数（记录条数，`perRecord` 语义，与 `OverviewStatsView.total_draws`
    /// 同一口径）。
    pub draws: i64,
    /// 该月命中调用方传入的稀有度目标（通常是 `RaritySpec.pity_target`）的
    /// 次数——**是否顶级**由调用方决定，本方法不内置任何具体游戏的稀有度
    /// 常量，理由同本文件其余按参数化稀有度码查询的方法（如
    /// [`Repository::find_records_by_rarity`]）。
    pub top_tier_hits: i64,
}

/// [`Repository::find_records_paged`] / [`Repository::count_records`] 共用的
/// 筛选条件。用结构体而不是给这两个方法各加一排 `Option` 参数——它们的
/// 筛选条件必须逐字段保持一致（分页器总数才不会跟实际翻页结果对不上，见
/// [`Repository::count_records`] 的文档），一份共享结构体能让"新增一个
/// 筛选项时两个方法都要跟着改"这件事在函数签名上就看得见，不是改了一个、
/// 忘了另一个才在测试里暴露。
///
/// `#[derive(Default)]`：所有字段留空即"不筛选、返回该账号下全部记录"，
/// 调用方按需用结构体更新语法只填自己关心的字段。
#[derive(Debug, Clone, Copy, Default)]
pub struct RecordFilter<'a> {
    pub banner_key: Option<&'a str>,
    /// 传哪些稀有度值就筛哪些——不是"顶级/次级/其余"这种语义分档。稀有度
    /// 阶梯长度和取值因游戏而异（绝区零是 `["2","3","4"]`，米哈游三游是
    /// `["3","4","5"]`），语义分档需要知道"哪一档算顶级"，那是插件
    /// manifest 的知识（`RaritySpec.pity_target`），存储层不该替调用方做
    /// 这个判断，理由同 [`Repository::find_records_by_rarity`] 已有的注释。
    ///
    /// `Some(&[])`（显式传入零个稀有度值）与 `None`（不筛选）语义不同：
    /// 前者是"筛出空集"，后者是"不限制这一维度"——SQL `IN ()` 本身是非法
    /// 语法，这两种输入在拼 SQL 之前就被分开处理，见
    /// [`rarities_select_nothing`]。
    pub rarities: Option<&'a [String]>,
    /// 时间区间，按 `occurred_at`（已归一化的 UTC 毫秒时间戳，不是原始
    /// 字符串 `occurred_raw`）过滤，两端都是闭区间，`None` 表示不限制
    /// 那一端。
    pub occurred_from: Option<i64>,
    pub occurred_to: Option<i64>,
    /// 物品名搜索：对 `item_id` 做子串匹配。原神的 `item_id` 本身就是
    /// 本地化物品名（原神 API 不返回 item_id，见
    /// `plugins/genshin/manifest.ts` `extractRecord` 的说明），因此"按
    /// 物品名搜索"对原神而言就是对 `item_id` 做匹配，不需要额外的 name
    /// 列。用户输入里的 `%`/`_` 会被转义成字面量，见 [`escape_like_pattern`]。
    pub item_search: Option<&'a str>,
}

/// `filter.rarities` 显式传入了一个空切片时短路：SQL `IN ()` 语法非法，
/// 且"选中零个稀有度"这个意图本身就该直接得到空结果，不需要真的拼一条
/// SQL 去问数据库。
fn rarities_select_nothing(rarities: Option<&[String]>) -> bool {
    matches!(rarities, Some(list) if list.is_empty())
}

/// 转义 LIKE 模式里的通配符，让用户搜索词按字面匹配——物品名恰好包含
/// `%`/`_` 时不应该被当成"任意字符/任意长度"的通配符。反斜杠本身也要
/// 转义，否则用户输入里带反斜杠会改变后面字符的转义语义。
fn escape_like_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 把 `account_id` + `filter` 拼成 `WHERE` 子句（不含 `WHERE` 关键字本身）
/// 与对应的参数列表，供 [`Repository::find_records_paged`] /
/// [`Repository::count_records`] 共用——两个方法各自在结果后面追加
/// `ORDER BY ... LIMIT ... OFFSET ...` 或 `COUNT(*)`，筛选这部分完全相同。
///
/// 调用方须先用 [`rarities_select_nothing`] 排除"显式选中零个稀有度"的
/// 情形，本函数不处理那个短路分支（到这里时 `filter.rarities` 若为
/// `Some`，切片必然非空）。
///
/// 用不带编号的 `?` 占位符而不是 `?1,?2,...`：本文件其余方法固定参数
/// 个数、`?N` 写起来更直观；这里筛选条件是动态的，参数个数随调用方传入的
/// `rarities` 长度变化，编号会随之变化，不带编号让 rusqlite 按位置顺序
/// 绑定，不需要在拼接时手动同步编号。
fn build_record_filter_where(
    account_id: i64,
    filter: &RecordFilter<'_>,
) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clauses = vec!["account_id = ?".to_string()];
    let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(account_id)];

    if let Some(banner_key) = filter.banner_key {
        clauses.push("banner_key = ?".to_string());
        params.push(Box::new(banner_key.to_string()));
    }

    if let Some(rarities) = filter.rarities {
        let placeholders = vec!["?"; rarities.len()].join(",");
        clauses.push(format!("rarity IN ({placeholders})"));
        for value in rarities {
            params.push(Box::new(value.clone()));
        }
    }

    if let Some(from) = filter.occurred_from {
        clauses.push("occurred_at >= ?".to_string());
        params.push(Box::new(from));
    }
    if let Some(to) = filter.occurred_to {
        clauses.push("occurred_at <= ?".to_string());
        params.push(Box::new(to));
    }

    if let Some(search) = filter.item_search {
        clauses.push("item_id LIKE ? ESCAPE '\\'".to_string());
        params.push(Box::new(format!("%{}%", escape_like_pattern(search))));
    }

    (clauses.join(" AND "), params)
}

/// [`GachaRecord`] 落库前对应的列名列表，比 [`GACHA_RECORD_SELECT_COLUMNS`]
/// 少一个 `id`——`id` 由 SQLite 的 `INTEGER PRIMARY KEY` 自动生成，写入路径
/// 里传入的 `GachaRecord::id` 会被忽略（调用方可以填任意占位值，惯例填 `0`，
/// 语义是"尚未持久化"）。
const GACHA_RECORD_INSERT_COLUMNS: &str = "account_id, banner_key, pity_group, record_key, \
    lang, occurred_at, occurred_raw, tz_origin, tz_offset_min, seq_in_batch, item_id, \
    item_type, rarity, qty, meta_state, source, captured_at, raw_ref, extra, stable_id, gacha_id";
const GACHA_RECORD_INSERT_ARITY: usize = 21;

/// 从查询结果的一行里取出的原始列值，枚举字段先原样存成 `String`。
///
/// 拆成中间结构而不是直接在 `query_map` 闭包里构造 [`GachaRecord`]，是因为
/// 枚举转换（[`enum_from_sql`]）与 [`RecordKey::new`] 校验返回的是
/// [`GsError`]，而 `query_map` 的闭包签名要求返回 `rusqlite::Result`——
/// 两种错误类型不能在同一个闭包里用 `?` 直接短路，所以先收集原始值，
/// 再在闭包外统一做会产生 `GsError` 的转换。
struct GachaRecordRow {
    id: i64,
    account_id: i64,
    banner_key: String,
    pity_group: String,
    record_key: String,
    lang: Option<String>,
    occurred_at: i64,
    occurred_raw: String,
    tz_origin: String,
    tz_offset_min: Option<i32>,
    seq_in_batch: Option<i32>,
    item_id: String,
    item_type: Option<String>,
    rarity: Option<String>,
    qty: i64,
    meta_state: String,
    source: String,
    captured_at: i64,
    raw_ref: Option<i64>,
    extra: Option<String>,
    stable_id: Option<String>,
    gacha_id: Option<String>,
}

impl GachaRecordRow {
    fn into_domain(self) -> Result<GachaRecord, GsError> {
        Ok(GachaRecord {
            id: self.id,
            account_id: self.account_id,
            banner_key: self.banner_key,
            pity_group: self.pity_group,
            record_key: RecordKey::new(self.record_key)?,
            lang: self.lang,
            occurred_at: self.occurred_at,
            occurred_raw: self.occurred_raw,
            tz_origin: enum_from_sql(&self.tz_origin)?,
            tz_offset_min: self.tz_offset_min,
            seq_in_batch: self.seq_in_batch,
            item_id: self.item_id,
            item_type: self.item_type,
            rarity: self.rarity,
            qty: self.qty,
            meta_state: enum_from_sql(&self.meta_state)?,
            source: enum_from_sql(&self.source)?,
            captured_at: self.captured_at,
            raw_ref: self.raw_ref,
            extra: self.extra,
            stable_id: self.stable_id,
            gacha_id: self.gacha_id,
        })
    }
}

fn map_gacha_record_row(row: &Row<'_>) -> rusqlite::Result<GachaRecordRow> {
    Ok(GachaRecordRow {
        id: row.get(0)?,
        account_id: row.get(1)?,
        banner_key: row.get(2)?,
        pity_group: row.get(3)?,
        record_key: row.get(4)?,
        lang: row.get(5)?,
        occurred_at: row.get(6)?,
        occurred_raw: row.get(7)?,
        tz_origin: row.get(8)?,
        tz_offset_min: row.get(9)?,
        seq_in_batch: row.get(10)?,
        item_id: row.get(11)?,
        item_type: row.get(12)?,
        rarity: row.get(13)?,
        qty: row.get(14)?,
        meta_state: row.get(15)?,
        source: row.get(16)?,
        captured_at: row.get(17)?,
        raw_ref: row.get(18)?,
        extra: row.get(19)?,
        stable_id: row.get(20)?,
        gacha_id: row.get(21)?,
    })
}

/// 把 `query_map` 产出的 `rusqlite::Result<GachaRecordRow>` 迭代器收集成
/// 领域类型，两段可能失败的转换（行读取 / 枚举与 RecordKey 校验）统一在
/// 这里 `?` 短路。
fn rows_into_records(
    rows: impl Iterator<Item = rusqlite::Result<GachaRecordRow>>,
) -> Result<Vec<GachaRecord>, GsError> {
    rows.map(|row| {
        row.map_err(storage_err)
            .and_then(GachaRecordRow::into_domain)
    })
    .collect()
}

/// 一条尚未持久化的出金事件（`rare_event` 表，L2）。
///
/// `origin` 由调用方显式指定，不是按写入路径隐式推断——`NewBannerSnapshot`
/// 已经是这个先例（同样是调用方显式传入的字段），两条写入路径的心智模型
/// 保持一致：显式字段 + review 是这个项目一贯的安全模型（参照
/// `plugins/index.ts` 显式注册表而非自动收集的同一条理由），不需要每个
/// 写入路径都在类型层面堵死"传错值"这一种可能。
pub struct NewRareEvent {
    pub account_id: i64,
    pub banner_key: String,
    pub pity_group: String,
    pub occurred_at: i64,
    pub item_id: String,
    pub rarity: String,
    /// 距上次出金的抽数（含本次）。塔吉多这类权威接口会直接给这个值；
    /// 从 L1 派生时同样能算出来（`gs_analysis::derive_rare_events`），
    /// 理论上恒有值，但类型上仍用 `Option` 与表结构 `pity_count INTEGER`
    /// （可空）保持形状一致。
    pub pity_count: Option<i64>,
    /// 1/0/NULL 三态，`None` 表示"不知道"。**不能用 `Some(false)` 顶替
    /// "不知道"**——那会把"确认没歪"和"不知道歪没歪"混为一谈，污染歪率
    /// 统计（存储数据模型设计文档 §4.2）。从 L1 派生时（本 Stage 唯一的
    /// 写入方）恒为 `None`，因为没有任何数据源能提供当期 UP 物品列表。
    pub is_rate_up: Option<bool>,
    pub origin: SnapshotOrigin,
    /// 自由文本来源标识，如 `'tajiduo'`（权威）/ `'derived:pity'`
    /// （从 L1 用保底计数算法派生）——理由同 `NewBannerSnapshot.source`，
    /// 取值随来源而异，不是封闭集合，不用枚举收窄。
    pub source: String,
    /// 指回产生这条出金事件的 L1 记录。`origin` 为 `Derived` 时应当总是
    /// `Some`（派生数据必然能指回它的来源）；`Authoritative` 时通常是
    /// `None`（塔吉多这类接口不知道本地是否已采集到对应的 L1 记录）。
    pub record_id: Option<i64>,
    pub extra: Option<String>,
}

const RARE_EVENT_SELECT_COLUMNS: &str = "id, account_id, banner_key, pity_group, occurred_at, \
    item_id, rarity, pity_count, is_rate_up, origin, source, record_id, extra";
const RARE_EVENT_INSERT_COLUMNS: &str = "account_id, banner_key, pity_group, occurred_at, \
    item_id, rarity, pity_count, is_rate_up, origin, source, record_id, extra";
const RARE_EVENT_INSERT_ARITY: usize = 12;

/// `rare_event` 表的一行。`origin`/`source` 保留原始字符串而不是解析成
/// 枚举——这两列目前只用于展示与按值过滤（如测试里的
/// `row.origin == "authoritative"`），没有消费点需要把 `origin` 转回
/// [`SnapshotOrigin`] 再往下传，多一层解析只会是无谓的转换成本。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RareEventRow {
    pub id: i64,
    pub account_id: i64,
    pub banner_key: String,
    pub pity_group: String,
    pub occurred_at: i64,
    pub item_id: String,
    pub rarity: String,
    pub pity_count: Option<i64>,
    pub is_rate_up: Option<bool>,
    pub origin: String,
    pub source: String,
    pub record_id: Option<i64>,
    pub extra: Option<String>,
}

/// 一个尚未持久化的账号。`retention_days` 落的是插件声明的
/// `RetentionPolicy.conservativeDays`（保守估计天数，不是精确天数）。
pub struct NewAccount {
    pub plugin_id: String,
    pub game_uid: String,
    pub region: String,
    pub display_name: Option<String>,
    pub retention_days: Option<i64>,
    pub created_at: i64,
}

/// 落库后的账号，对应存储数据模型设计文档 §3.1。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: i64,
    pub plugin_id: String,
    pub game_uid: String,
    pub region: String,
    pub display_name: Option<String>,
    pub retention_days: Option<i64>,
    pub last_collected_at: Option<i64>,
    /// 本地已知最早一条记录的游戏内发生时刻。**只有展示价值**（"你的记录
    /// 覆盖 X 至今"）——不再驱动保留期风险等级，见
    /// [`Self::latest_record_at`] 与 `gs_host::retention` 模块文档。
    pub earliest_record_at: Option<i64>,
    /// 本地已知最晚一条记录的游戏内发生时刻。与 `last_collected_at` 共同
    /// 驱动 `gs_host::retention::evaluate_account_retention_risk`——取两者
    /// 中较晚（max）的一个作为"我们对官方数据的认知截止到哪一刻"，理由见
    /// 该函数文档与迁移 `0004_account_latest_record_at.sql` 的注释。
    pub latest_record_at: Option<i64>,
    pub created_at: i64,
}

const ACCOUNT_SELECT_COLUMNS: &str = "id, plugin_id, game_uid, region, display_name, \
    retention_days, last_collected_at, earliest_record_at, latest_record_at, created_at";

fn map_account_row(row: &Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        plugin_id: row.get(1)?,
        game_uid: row.get(2)?,
        region: row.get(3)?,
        display_name: row.get(4)?,
        retention_days: row.get(5)?,
        last_collected_at: row.get(6)?,
        earliest_record_at: row.get(7)?,
        latest_record_at: row.get(8)?,
        created_at: row.get(9)?,
    })
}

/// `banner_snapshot.origin` 只有两个取值，用枚举收窄写入路径的输入——
/// `v_integrity` 视图硬编码 `WHERE origin = 'authoritative'`，若这里允许
/// 传任意字符串，一次拼写错误就会让某条快照静默地永远不参与完整性校验。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotOrigin {
    /// 来自官方接口（如塔吉多）或分页元信息，不可重算，必须持久化。
    Authoritative,
    /// 从 L1 记录推导，可随时重算，不做增量维护。
    Derived,
}

impl SnapshotOrigin {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Authoritative => "authoritative",
            Self::Derived => "derived",
        }
    }
}

/// 一条尚未持久化的卡池统计快照。
pub struct NewBannerSnapshot {
    pub account_id: i64,
    pub banner_key: String,
    pub captured_at: i64,
    pub draw_count: Option<i64>,
    pub rare_count: Option<i64>,
    pub pity_current: Option<i64>,
    pub pity_max: Option<i64>,
    pub origin: SnapshotOrigin,
    /// 自由文本来源标识，如 `'tajiduo'` / `'pagination'`——取值随游戏/采集
    /// 通道而异，不是一个封闭集合，因此不用枚举收窄（这与 `origin` 只有
    /// 两个固定取值的情况不同）。
    pub source: String,
    /// 页码基准写 `{"page_count":…, "page_size":…, "precision":"page"}`；
    /// 权威基准可以省略（`v_integrity` 视图里缺省即视为 `'exact'`）。
    pub extra: Option<String>,
}

/// 一条尚未持久化的卡池元数据。
pub struct NewBannerMeta {
    pub plugin_id: String,
    pub banner_key: String,
    pub pity_group: String,
    pub name: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub rate_up_items: Option<String>,
    pub pity_max: Option<i64>,
    pub curve_type: Option<String>,
    pub guarantee_rule: Option<String>,
    pub data_ver: i64,
}

/// 一条尚未持久化的物品目录条目——MetadataProvider 回填侧写入，见
/// [`Repository::upsert_item_catalog`]。
pub struct NewItemCatalogEntry {
    pub plugin_id: String,
    pub item_id: String,
    pub lang: String,
    pub name: String,
    pub rarity: Option<String>,
    pub item_type: Option<String>,
    pub icon_url: Option<String>,
    /// 字典版本标记，供未来的远程增量更新比对（`item_catalog` 表注释）。
    /// MetadataProvider 的在线形态（`api.uigf.org`）不提供版本号，只提供
    /// MD5——本轮回填未实现基于 MD5 的增量检测（见
    /// `gs_host::metadata_backfill` 模块文档"已知取舍"一节），因此这里填
    /// 写入时刻的 UTC 毫秒时间戳，语义是"这条记录最后一次被写入的时间"，
    /// 单调递增即可满足"新版本覆盖旧版本"的写入语义，不承诺是官方字典的
    /// 真实版本号。
    pub data_ver: i64,
}

/// 一条已持久化的物品目录条目（查询结果），见 [`Repository::find_item_catalog_entry`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemCatalogEntry {
    pub plugin_id: String,
    pub item_id: String,
    pub lang: String,
    pub name: String,
    pub rarity: Option<String>,
    pub item_type: Option<String>,
    pub icon_url: Option<String>,
    pub data_ver: i64,
}

/// 一条尚未持久化的采集会话。
pub struct NewCollectSession {
    pub account_id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub method: String,
    pub status: String,
    pub records_new: i64,
    pub diagnostics: Option<String>,
}

/// 一条尚未持久化的原始报文。
pub struct NewRawPayload {
    pub session_id: i64,
    pub seq: i64,
    pub payload: Vec<u8>,
    pub encoding: Option<String>,
    pub created_at: i64,
}

/// `v_integrity` 视图的一行，`precision` 恒为 `'exact'` 或 `'page'`。
///
/// `page_size`/`page_count` 只在 `precision == "page"` 时有值——它们是
/// `json_extract` 自 `banner_snapshot.extra` 直接拿出来的（迁移
/// `0002_v_integrity_page_columns`），调用方（`gs-analysis` 的
/// `evaluate_draw_count_gap`）不需要再自己解一遍 `extra` JSON。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrityRow {
    pub account_id: i64,
    pub banner_key: String,
    pub official_draws: Option<i64>,
    pub local_draws: i64,
    pub official_rares: Option<i64>,
    pub local_rares: i64,
    pub precision: String,
    pub page_size: Option<i64>,
    pub page_count: Option<i64>,
}

/// `app_setting.key` 的受控枚举——不接受任意字符串。新增一个设置项就是在
/// 这里加一个变体：这样"这张表目前到底存了哪些 key"在编译期就能看全，
/// PR diff 也能一眼看见新增了什么，不是运行时才发现前端传了个没人见过的
/// key 进来。这与 [`SnapshotOrigin`] 用枚举收窄 `banner_snapshot.origin`
/// 是同一条纪律：凡是会被拿去当 `WHERE`/`INSERT` 目标的封闭取值集合，都不
/// 该在类型层面留一个"传任意字符串"的口子。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingKey {
    /// 界面主题偏好（浅色/深色/跟随系统）。取值语义由
    /// `gs_host::settings::ThemePreference` 定义，存储层不理解这个字符串
    /// 的具体含义，只负责原样存取。
    ThemePreference,
}

impl SettingKey {
    fn as_sql(self) -> &'static str {
        match self {
            Self::ThemePreference => "theme_preference",
        }
    }
}

/// `v_unknown_banner` 视图的一行：有记录但 `banner_meta` 未收录的卡池。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownBannerRow {
    pub account_id: i64,
    pub plugin_id: String,
    pub banner_key: String,
    pub record_count: i64,
    pub last_occurred_at: i64,
}

/// 存储层的读写入口，借用 [`crate::Storage`] 内部的连接，生命周期不长于它。
pub struct Repository<'conn> {
    conn: &'conn Connection,
}

impl<'conn> Repository<'conn> {
    pub(crate) fn new(conn: &'conn Connection) -> Self {
        Self { conn }
    }

    // ------------------------------------------------------------------
    // gacha_record
    // ------------------------------------------------------------------

    /// 批量写入记录，`INSERT OR IGNORE` 语义——命中 `UNIQUE(account_id,
    /// record_key)` 的行被静默跳过，不报错。
    ///
    /// 返回**实际新增的行数**（而不是入参条数）：S3 的 `reachedKnown` 终止
    /// 条件靠"连续 N 页新增为零"判断，这个返回值正是它的依据。SQLite 对
    /// `INSERT OR IGNORE` 的 `changes()` 语义天然就是"成功插入的行数"，
    /// 被 IGNORE 掉的冲突行不计入，不需要额外查询前后差集。
    ///
    /// `record.id` 被忽略（见 [`GACHA_RECORD_INSERT_COLUMNS`] 的说明）；
    /// `lang` / `item_type` / `rarity` / `stable_id` / `gacha_id` 的空字符串
    /// 会被规整为 `NULL`（见 [`normalize_empty`]）。
    pub fn insert_records(&self, records: &[GachaRecord]) -> Result<u64, GsError> {
        if records.is_empty() {
            return Ok(0);
        }

        // 多值 INSERT 的占位符个数是 条数 × 21，会撞上 SQLite 的
        // SQLITE_LIMIT_VARIABLE_NUMBER。分页采集每页 20 条撞不到，**只有导入路径会炸**
        // ——星铁真实存档实测 5372 条（research/03），一次交进来就是 112812 个变量。
        // 这类坑的特点是单测全绿、真实数据一跑就挂，所以按运行时上限分批。
        //
        // 分批之后单条 execute 的原子性就没了，必须自己包一层事务：
        // 中途失败要整批回滚，不能留下"插了一半"的状态——那会让调用方
        // （S3 的增量合并靠新增行数判断是否翻到已知记录）读到错误的进度。
        let max_variables = self
            .conn
            .limit(rusqlite::limits::Limit::SQLITE_LIMIT_VARIABLE_NUMBER)
            .map_err(storage_err)?
            .max(1) as usize;
        let chunk_size = (max_variables / GACHA_RECORD_INSERT_ARITY).max(1);

        if records.len() > chunk_size {
            let mut total = 0u64;
            self.conn
                .execute_batch("SAVEPOINT gs_insert_records")
                .map_err(storage_err)?;
            for chunk in records.chunks(chunk_size) {
                match self.insert_records_single_statement(chunk) {
                    Ok(count) => total += count,
                    Err(err) => {
                        // 回滚失败时保留原始错误——原始错误才是根因，
                        // 回滚失败只是它的后果。
                        let _ = self.conn.execute_batch(
                            "ROLLBACK TO gs_insert_records; RELEASE gs_insert_records",
                        );
                        return Err(err);
                    }
                }
            }
            self.conn
                .execute_batch("RELEASE gs_insert_records")
                .map_err(storage_err)?;
            return Ok(total);
        }

        self.insert_records_single_statement(records)
    }

    /// 单条多值 `INSERT` 写入一批记录，调用方须保证批量不超过变量数上限。
    fn insert_records_single_statement(&self, records: &[GachaRecord]) -> Result<u64, GsError> {
        let placeholder_group = format!("({})", vec!["?"; GACHA_RECORD_INSERT_ARITY].join(","));
        let sql = format!(
            "INSERT OR IGNORE INTO gacha_record ({GACHA_RECORD_INSERT_COLUMNS}) VALUES {}",
            vec![placeholder_group.as_str(); records.len()].join(",")
        );

        let mut owned_params: Vec<Box<dyn ToSql>> =
            Vec::with_capacity(records.len() * GACHA_RECORD_INSERT_ARITY);
        for record in records {
            owned_params.push(Box::new(record.account_id));
            owned_params.push(Box::new(record.banner_key.clone()));
            owned_params.push(Box::new(record.pity_group.clone()));
            owned_params.push(Box::new(record.record_key.as_str().to_string()));
            owned_params.push(Box::new(normalize_empty(&record.lang)));
            owned_params.push(Box::new(record.occurred_at));
            owned_params.push(Box::new(record.occurred_raw.clone()));
            owned_params.push(Box::new(enum_to_sql(record.tz_origin)?));
            owned_params.push(Box::new(record.tz_offset_min));
            owned_params.push(Box::new(record.seq_in_batch));
            owned_params.push(Box::new(record.item_id.clone()));
            owned_params.push(Box::new(normalize_empty(&record.item_type)));
            owned_params.push(Box::new(normalize_empty(&record.rarity)));
            owned_params.push(Box::new(record.qty));
            owned_params.push(Box::new(enum_to_sql(record.meta_state)?));
            owned_params.push(Box::new(enum_to_sql(record.source)?));
            owned_params.push(Box::new(record.captured_at));
            owned_params.push(Box::new(record.raw_ref));
            owned_params.push(Box::new(record.extra.clone()));
            owned_params.push(Box::new(normalize_empty(&record.stable_id)));
            owned_params.push(Box::new(normalize_empty(&record.gacha_id)));
        }
        let param_refs: Vec<&dyn ToSql> = owned_params.iter().map(Box::as_ref).collect();

        let changed = self
            .conn
            .execute(&sql, param_refs.as_slice())
            .map_err(storage_err)?;
        Ok(changed as u64)
    }

    /// 按 `(account_id, banner_key)` 查询，用于展示原始卡池维度的记录。
    pub fn find_records_by_banner(
        &self,
        account_id: i64,
        banner_key: &str,
    ) -> Result<Vec<GachaRecord>, GsError> {
        let sql = format!(
            "SELECT {GACHA_RECORD_SELECT_COLUMNS} FROM gacha_record \
             WHERE account_id = ?1 AND banner_key = ?2 ORDER BY occurred_at"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id, banner_key], map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 分页查询记录，筛选条件见 [`RecordFilter`]（`Default::default()` 即
    /// 跨全部卡池、不限稀有度/时间/物品名，与本方法改造前"`banner_key` 为
    /// `None`"的行为一致）。
    ///
    /// 与 [`Self::find_records_by_banner`] 分开而不是给它加可选参数：那个方法
    /// 是分析链路用的（一次要拿全量算保底），这个是界面用的（一次只要一屏）。
    /// 两者的正确行为相反——分析拿不全就是错的，界面拿全量就是把几千条记录
    /// 一次塞进 IPC。
    ///
    /// 排序按 `occurred_at DESC, id DESC`：界面默认展示最近的抽卡。第二排序键
    /// 不能省——同秒多条记录（鸣潮十连一次落 10 条同 `occurred_at`）只按第一
    /// 键排序时 SQLite 不保证稳定顺序，翻页会出现同一条记录在两页都出现、
    /// 另一条一页都不出现。
    pub fn find_records_paged(
        &self,
        account_id: i64,
        filter: &RecordFilter<'_>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<GachaRecord>, GsError> {
        if rarities_select_nothing(filter.rarities) {
            return Ok(Vec::new());
        }

        let (where_sql, mut owned_params) = build_record_filter_where(account_id, filter);
        owned_params.push(Box::new(limit));
        owned_params.push(Box::new(offset));
        let param_refs: Vec<&dyn ToSql> = owned_params.iter().map(Box::as_ref).collect();

        let sql = format!(
            "SELECT {GACHA_RECORD_SELECT_COLUMNS} FROM gacha_record WHERE {where_sql} \
             ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(param_refs.as_slice(), map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 满足 [`RecordFilter`] 的记录总数。供界面算总页数——与
    /// [`Self::find_records_paged`] 的筛选条件必须保持一致，否则页码算出来
    /// 是错的；两者共用 [`build_record_filter_where`] 正是为了机械保证这一点，
    /// 不依赖调用方手动同步两处筛选逻辑。
    pub fn count_records(
        &self,
        account_id: i64,
        filter: &RecordFilter<'_>,
    ) -> Result<i64, GsError> {
        if rarities_select_nothing(filter.rarities) {
            return Ok(0);
        }

        let (where_sql, owned_params) = build_record_filter_where(account_id, filter);
        let param_refs: Vec<&dyn ToSql> = owned_params.iter().map(Box::as_ref).collect();
        let sql = format!("SELECT COUNT(*) FROM gacha_record WHERE {where_sql}");
        self.conn
            .query_row(&sql, param_refs.as_slice(), |row| row.get::<_, i64>(0))
            .map_err(storage_err)
    }

    /// 不分页地取出某个账号的**全部**记录，供 `gs-host` 的分析编排（跨账号
    /// 统计、稀有度分布）在进程内直接消费——不经过 IPC，不受
    /// `src-tauri::commands::MAX_PAGE_SIZE` 那道"一次调用最多拿多少条"的
    /// 上限约束（那道上限是为了防止 webview 一次性把整张表通过 IPC 序列化
    /// 出去，本方法的调用方从始至终待在 Rust 进程内，不适用同一顾虑）。
    ///
    /// 不接受任何筛选条件：调用方（`gs_analysis::rarity_distribution` 等）
    /// 需要的正是"这个账号名下全部记录"，筛选是它们拿到数据之后自己做的事。
    pub fn find_all_records_for_account(
        &self,
        account_id: i64,
    ) -> Result<Vec<GachaRecord>, GsError> {
        let sql = format!(
            "SELECT {GACHA_RECORD_SELECT_COLUMNS} FROM gacha_record \
             WHERE account_id = ?1 ORDER BY occurred_at DESC, id DESC"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id], map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 某个插件名下**全部**账号里、`meta_state = 'pending'` 的记录——
    /// MetadataProvider 回填侧的扫描入口，对应 `idx_record_meta_pending`
    /// 那条部分索引（`WHERE meta_state != 'complete'`）。
    ///
    /// 只筛 `'pending'`，不含 `'unresolvable'`：后者语义是"已经尝试过、
    /// 确认查不到"，本仓库当前没有任何代码路径会产出这个状态（`determine_
    /// meta_state` 只会打 `Complete`/`Pending`），但一旦将来有了，回填流程
    /// 重复扫描"已经放弃"的记录既不必要，也可能与"放弃"背后的业务判断
    /// 冲突——这是留给那条业务规则落地时再决定的事，不该由本方法隐式代劳。
    ///
    /// 用 `JOIN account` 而不是要求调用方先自己查出账号 id 列表再逐个查：
    /// 一个插件下可能有多个账号（多语言/多区服），回填是按插件维度批量处理
    /// 的（同一插件的 `metadata` Provider 只声明一次），调用方不需要关心
    /// 账号边界。
    pub fn find_pending_records_by_plugin(
        &self,
        plugin_id: &str,
    ) -> Result<Vec<GachaRecord>, GsError> {
        let sql = format!(
            "SELECT {cols} FROM gacha_record gr \
             JOIN account a ON a.id = gr.account_id \
             WHERE a.plugin_id = ?1 AND gr.meta_state = 'pending' \
             ORDER BY gr.id",
            cols = GACHA_RECORD_SELECT_COLUMNS
                .split(", ")
                .map(|col| format!("gr.{col}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![plugin_id], map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 把一条 `pending` 记录的 `item_id` 替换成 MetadataProvider 反查出的
    /// 真正物品标识，并把 `meta_state` 推进到 `complete`。
    ///
    /// `WHERE ... AND meta_state = 'pending'` 是防御性守卫：只更新仍处于
    /// `pending` 的行，即使调用方传入一个已经是 `complete`（或未来的
    /// `unresolvable`）的 `record_id`，也不会覆盖它已有的 `item_id`——
    /// 调用方（`gs_host::metadata_backfill`）的正常调用序列本来就只会传
    /// `find_pending_records_by_plugin` 查出的 id，这条守卫是"方法自身的
    /// 行为契约不依赖调用方永远传对"的纵深防御，成本只是一个 WHERE 条件。
    ///
    /// 没有匹配行（id 不存在，或存在但已不是 pending）不是错误——静默
    /// 0 行更新，调用方不需要为这个边界情况特殊处理返回值。
    pub fn resolve_pending_record_item_id(
        &self,
        record_id: i64,
        resolved_item_id: &str,
    ) -> Result<(), GsError> {
        self.conn
            .execute(
                "UPDATE gacha_record SET item_id = ?2, meta_state = 'complete' \
                 WHERE id = ?1 AND meta_state = 'pending'",
                params![record_id, resolved_item_id],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// 列出全部账号，按 `(plugin_id, game_uid)` 升序——界面侧栏与账号切换器
    /// 要的是一个稳定顺序，用插入顺序（`id`）会让同一个游戏的账号散在列表各处。
    pub fn list_accounts(&self) -> Result<Vec<Account>, GsError> {
        let sql =
            format!("SELECT {ACCOUNT_SELECT_COLUMNS} FROM account ORDER BY plugin_id, game_uid");
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt.query_map([], map_account_row).map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    /// 按 `(account_id, pity_group)` 查询，用于合并保底的卡池集合统计
    /// （301/400 这类共享保底但 `banner_key` 不同的场景，见存储数据模型
    /// 设计文档 §3.2.4 上方的实测约束）。
    pub fn find_records_by_pity_group(
        &self,
        account_id: i64,
        pity_group: &str,
    ) -> Result<Vec<GachaRecord>, GsError> {
        let sql = format!(
            "SELECT {GACHA_RECORD_SELECT_COLUMNS} FROM gacha_record \
             WHERE account_id = ?1 AND pity_group = ?2 ORDER BY occurred_at"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id, pity_group], map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 按稀有度码查询。参数只能是调用方传入的具体值（插件 `RaritySpec`
    /// 声明的 `pity_target` 这类标识符），接口设计上就不给"传字面量常量"
    /// 的机会——`WHERE rarity = 5` 这种写法在绝区零上会静默返回空集，
    /// 稀有度阶梯不得假设 3/4/5。
    pub fn find_records_by_rarity(
        &self,
        account_id: i64,
        rarity: &str,
    ) -> Result<Vec<GachaRecord>, GsError> {
        let sql = format!(
            "SELECT {GACHA_RECORD_SELECT_COLUMNS} FROM gacha_record \
             WHERE account_id = ?1 AND rarity = ?2 ORDER BY occurred_at"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id, rarity], map_gacha_record_row)
            .map_err(storage_err)?;
        rows_into_records(rows)
    }

    /// 按 `(account_id, banner_key)` 精确匹配、`occurred_raw` 落在
    /// `[range_start, range_end]`（两端都闭合）区间内的 `gacha_record` 行，
    /// `GROUP BY occurred_raw, item_id` 返回区间内每一秒、每个 item_id 的
    /// 出现次数。
    ///
    /// 供 `gs-host` 的导入流程判断"本批覆盖的时间区间内，哪些秒的记录集合
    /// 与库中已有记录不一致"——鸣潮这类声明了批处理 `hooks.deriveRecordKeys`
    /// 的插件，`record_key` 含有"同一秒内第几次出现"这个序位分量，序位的
    /// 正确性建立在"每次都能看到这一秒的完整记录集合"这个前提上。查这个
    /// 前提是否成立，只能靠"这一秒库里已有的记录，与本次要落库的记录，按
    /// item_id 分组后条数是否相等"这个间接信号——存储层本身不知道"序位"这
    /// 回事（`seq_in_batch` 列恒为 `None`，见
    /// `gs_p_authkey::pipeline::AuthkeyApiPipeline::build_records` 里那一行
    /// 旁的注释），这道检查因此必须落在调用方（导入流程），本方法只负责把
    /// 判断需要的原始计数如实吐出来。
    ///
    /// 一次区间查询、不逐秒查询：一批导入记录可能覆盖几个月，落在几千个
    /// 不同的秒上，调用方若对每一秒都单独查一次库，往返次数会随批次大小
    /// 线性增长；`GROUP BY occurred_raw, item_id` 让整个区间只需要一次
    /// 查询、一次全表扫描（走 `(account_id, banner_key, occurred_raw)` 前缀
    /// 索引时是范围扫描），调用方在内存里按 `occurred_raw` 分组即可逐秒
    /// 比对。
    ///
    /// 为什么按 `occurred_raw` 而不是 `occurred_at`：`occurred_raw` 是插件
    /// `extractRecord` 产出的原始时间字符串，与批处理 hook（TS 侧
    /// `deriveRecordKeys`）用来分组的 `record.time` 字节级对应——同一次
    /// `extractRecord` 遍历产出的同一份数据分别喂给了这两处消费者。
    /// `occurred_at` 则要先经过 `tz_offset_hours` 换算，这个偏移量在两次
    /// 导入/采集之间不保证稳定（`computed` 插件按 UID 逐条算、`apiField`/
    /// `staticTable` 插件依赖调用方能否拿到页级响应体或存档自带的偏移量），
    /// 用它做"是否同一秒"的判据本身就不稳定，同一条实际记录可能因为两次
    /// 换算用了不同的偏移量而被判成"不同秒"。两种 `rawFormat` 声明
    /// （`SpaceSeparated`: `%Y-%m-%d %H:%M:%S`，`IsoLocal`:
    /// `%Y-%m-%dT%H:%M:%S`）都是零填充定宽格式，字符串精确相等本身就等价
    /// 于同一秒、字符串序也等价于时间序（区间查询的 `>=`/`<=` 因此可以直接
    /// 对字符串比较）——前提是同一批记录用的是同一种 `rawFormat`，这在构造
    /// 期是常量，对同一次调用天然成立。
    ///
    /// 区间两端都闭合（`>= range_start AND <= range_end`）：调用方传入的是
    /// 本批记录里实际出现过的最早/最晚 `occurred_raw`，这两个值本身就是
    /// 需要参与比对的秒，闭区间不会漏查它们；若误写成开区间或半开区间，
    /// 会在批次恰好只覆盖单一秒（`range_start == range_end`）时查出一个
    /// 空区间，调用方永远查不到库里那一秒的记录，检查形同虚设。
    ///
    /// 为什么返回 `Vec<(String, String, i64)>` 而不是替调用方转成嵌套
    /// `HashMap`：本方法只做"读 + 映射成领域类型"，不掺业务判断——"哪些
    /// item_id 算不一致""库中有但本批没有的算不算"这类判断是调用方的职责，
    /// 同 [`Self::unknown_banners`]/[`Self::integrity_report`] 的一贯风格：
    /// 这两个方法同样只把查询结果原样吐给调用方，不在存储层预判调用方会
    /// 怎么用这份数据。
    pub fn count_records_by_occurred_raw_range(
        &self,
        account_id: i64,
        banner_key: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<Vec<(String, String, i64)>, GsError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT occurred_raw, item_id, COUNT(*) FROM gacha_record \
                 WHERE account_id = ?1 AND banner_key = ?2 \
                 AND occurred_raw >= ?3 AND occurred_raw <= ?4 \
                 GROUP BY occurred_raw, item_id",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map(
                params![account_id, banner_key, range_start, range_end],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    /// 按自然月聚合某个账号的抽卡活动：每月抽数 + 命中 `top_tier_rarity`
    /// 的次数。游戏详情页"抽卡时间线（按月）"的数据来源。
    ///
    /// 聚合下沉到 SQL（`GROUP BY` + `SUM(CASE WHEN ...)`），不是"查全量
    /// 记录再在 Rust 里 group by"——星铁真实存档实测 5372 条，`list_records`
    /// 是带 200 上限的分页窄口，为画一张图表把全账号记录拉过 IPC 或哪怕只是
    /// 拉进 Rust 进程内存再手动分组，都违反那道窄口存在的理由；一次 SQL
    /// 聚合查询只往返一次，返回值大小与"这个账号跨了多少个自然月"成正比
    /// （通常是几十行），不是与记录条数成正比。
    ///
    /// 按 `occurred_at`（已归一化的 UTC 毫秒时间戳）分月，不是
    /// `occurred_raw`（原始时间字符串）——理由与 [`Self::find_records_paged`]
    /// 等方法按 `occurred_at` 做时间区间筛选一致，是本仓库对"哪个时间字段
    /// 代表机器可比较的时刻"这件事的统一口径：`occurred_raw` 的格式因插件
    /// 声明的 `rawFormat` 而异（`"%Y-%m-%d %H:%M:%S"` 或 ISO 本地时间），
    /// 不能直接喂给 SQL 日期函数；`occurred_at` 是全账号唯一保证统一单位
    /// （UTC 毫秒）、可直接用 `strftime` 处理的字段。
    ///
    /// 代价如实记录：`tz_origin` 为 `Assumed`（既无来源也无区服，宿主假设
    /// 本机时区）的记录，其 `occurred_at` 本身就带有这份不确定性，落在
    /// 月份边界附近的一两条记录可能被聚合进相邻的自然月——这是
    /// `GachaRecord.occurred_at` 文档已经承认的"是否可信取决于 tz_origin"
    /// 这条既有设计的自然延伸，本方法复用同一份信任度，不重新发明一套按
    /// `occurred_raw` 解析时区的独立路径（那条路径本身也不是每个插件都有
    /// 稳定可用的时区来源，见 `GachaRecord` 时间三元组的文档）。
    ///
    /// `strftime('%Y-%m', occurred_at / 1000, 'unixepoch')`：SQLite 的
    /// `unixepoch` 修饰符要求参数是**秒**，`occurred_at` 是毫秒，先除以
    /// 1000（整数除法截断到秒精度，聚合到月份粒度不受影响）。
    pub fn monthly_activity(
        &self,
        account_id: i64,
        top_tier_rarity: &str,
    ) -> Result<Vec<MonthlyActivityRow>, GsError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT strftime('%Y-%m', occurred_at / 1000, 'unixepoch') AS month, \
                 COUNT(*) AS draws, \
                 SUM(CASE WHEN rarity = ?2 THEN 1 ELSE 0 END) AS top_tier_hits \
                 FROM gacha_record WHERE account_id = ?1 \
                 GROUP BY month ORDER BY month",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id, top_tier_rarity], |row| {
                Ok(MonthlyActivityRow {
                    month: row.get(0)?,
                    draws: row.get(1)?,
                    top_tier_hits: row.get(2)?,
                })
            })
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    // ------------------------------------------------------------------
    // rare_event
    // ------------------------------------------------------------------

    /// 写入单条出金事件，不去重、不做冲突处理——命中
    /// `UNIQUE(account_id, banner_key, occurred_at, item_id)` 时直接把
    /// `rusqlite` 的约束错误原样报出来。这条路径面向权威数据的单条写入
    /// （如塔吉多按次拉取的出金事件），语义与 [`Self::insert_banner_snapshot`]
    /// 一致：一次只描述一件事实，不需要静默吞掉冲突。
    ///
    /// 批量派生数据的写入走 [`Self::replace_derived_rare_events`]，那条路径
    /// 才需要"重复没关系"的 `INSERT OR IGNORE` 语义——两者服务的场景不同，
    /// 不合并成一个参数可控的方法。
    pub fn insert_rare_event(&self, new: &NewRareEvent) -> Result<i64, GsError> {
        self.conn
            .execute(
                &format!(
                    "INSERT INTO rare_event ({RARE_EVENT_INSERT_COLUMNS}) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
                ),
                params![
                    new.account_id,
                    new.banner_key,
                    new.pity_group,
                    new.occurred_at,
                    new.item_id,
                    new.rarity,
                    new.pity_count,
                    new.is_rate_up.map(|value| value as i64),
                    new.origin.as_sql(),
                    new.source,
                    new.record_id,
                    new.extra
                ],
            )
            .map_err(storage_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 全量重算替换某个 `(account_id, pity_group)` 下 `origin = 'derived'`
    /// 的出金事件：先删掉旧的 derived 行，再整批插入 `events`。
    ///
    /// `origin = 'authoritative'` 的行永远不会被这次 DELETE 触碰——WHERE
    /// 子句显式带 `origin = 'derived'`，这是存储数据模型设计文档 §七.4
    /// "派生数据可随时重算、不做增量维护；权威数据不可重算"在写入路径上的
    /// 唯一落点。删除范围按 `pity_group` 而不是 `banner_key`：派生算法本身
    /// 是按 `pity_group` 合并计数的（原神 301/400 共享保底），重算就要把
    /// 这个分组下全部 `banner_key` 的旧派生结果一并换掉，只删一个
    /// `banner_key` 会留下用旧计数算出来的另一半，两份结果互相矛盾。
    ///
    /// 删除与插入包在同一个 SAVEPOINT 里：这是"重新算一遍、整批替换旧结果"
    /// 的操作，中途失败若不回滚，会留下"旧数据已删、新数据没插完"的中间
    /// 状态——那比"没有触发重算"更糟，调用方（分析引擎）看到的行数会比
    /// 真实情况更少。
    ///
    /// 返回实际插入的行数（`INSERT OR IGNORE` 语义，理由见
    /// [`Self::insert_rare_events_chunked`]）。
    pub fn replace_derived_rare_events(
        &self,
        account_id: i64,
        pity_group: &str,
        events: &[NewRareEvent],
    ) -> Result<u64, GsError> {
        self.conn
            .execute_batch("SAVEPOINT gs_replace_derived_rare_events")
            .map_err(storage_err)?;

        let outcome = (|| -> Result<u64, GsError> {
            self.conn
                .execute(
                    "DELETE FROM rare_event WHERE account_id = ?1 AND pity_group = ?2 \
                     AND origin = 'derived'",
                    params![account_id, pity_group],
                )
                .map_err(storage_err)?;
            self.insert_rare_events_chunked(events)
        })();

        match &outcome {
            Ok(_) => self
                .conn
                .execute_batch("RELEASE gs_replace_derived_rare_events")
                .map_err(storage_err)?,
            Err(_) => {
                // 回滚失败时保留原始错误——回滚失败只是原始错误的后果，
                // 不是根因，理由同 `insert_records` 的同一处理。
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO gs_replace_derived_rare_events; \
                     RELEASE gs_replace_derived_rare_events",
                );
            }
        }
        outcome
    }

    /// 分块 + 多值 `INSERT OR IGNORE` 写入一批出金事件，复用
    /// `insert_records` 已经踩过的 `SQLITE_LIMIT_VARIABLE_NUMBER` 分块策略
    /// ——原理相同：一次多值 INSERT 的占位符个数是 条数 × 12，一个保底组
    /// 累积的出金事件数量远小于逐抽记录，正常情况下撞不到上限，但"正常情况
    /// 撞不到"正是 `insert_records` 那次踩坑的教训，不能假设这里也一样安全
    /// 而跳过分块。
    ///
    /// 用 `OR IGNORE` 而不是要求零冲突：派生数据的写入语义是"重算一遍"，
    /// 如果某条派生结果恰好撞上了 `UNIQUE(account_id, banner_key,
    /// occurred_at, item_id)`（比如这个位置已经有一条权威数据），静默跳过
    /// 优先保留权威数据，比让整批重算因为一条冲突而失败更符合"派生数据让路
    /// 给权威数据"的既定优先级（存储数据模型设计文档 §二"查询时优先取
    /// authoritative"）。
    fn insert_rare_events_chunked(&self, events: &[NewRareEvent]) -> Result<u64, GsError> {
        if events.is_empty() {
            return Ok(0);
        }

        let max_variables = self
            .conn
            .limit(rusqlite::limits::Limit::SQLITE_LIMIT_VARIABLE_NUMBER)
            .map_err(storage_err)?
            .max(1) as usize;
        let chunk_size = (max_variables / RARE_EVENT_INSERT_ARITY).max(1);

        let mut total = 0u64;
        for chunk in events.chunks(chunk_size) {
            total += self.insert_rare_events_single_statement(chunk)?;
        }
        Ok(total)
    }

    fn insert_rare_events_single_statement(&self, events: &[NewRareEvent]) -> Result<u64, GsError> {
        let placeholder_group = format!("({})", ["?"; RARE_EVENT_INSERT_ARITY].join(","));
        let sql = format!(
            "INSERT OR IGNORE INTO rare_event ({RARE_EVENT_INSERT_COLUMNS}) VALUES {}",
            vec![placeholder_group.as_str(); events.len()].join(",")
        );

        let mut owned_params: Vec<Box<dyn ToSql>> =
            Vec::with_capacity(events.len() * RARE_EVENT_INSERT_ARITY);
        for event in events {
            owned_params.push(Box::new(event.account_id));
            owned_params.push(Box::new(event.banner_key.clone()));
            owned_params.push(Box::new(event.pity_group.clone()));
            owned_params.push(Box::new(event.occurred_at));
            owned_params.push(Box::new(event.item_id.clone()));
            owned_params.push(Box::new(event.rarity.clone()));
            owned_params.push(Box::new(event.pity_count));
            owned_params.push(Box::new(event.is_rate_up.map(|value| value as i64)));
            owned_params.push(Box::new(event.origin.as_sql()));
            owned_params.push(Box::new(event.source.clone()));
            owned_params.push(Box::new(event.record_id));
            owned_params.push(Box::new(event.extra.clone()));
        }
        let param_refs: Vec<&dyn ToSql> = owned_params.iter().map(Box::as_ref).collect();

        let changed = self
            .conn
            .execute(&sql, param_refs.as_slice())
            .map_err(storage_err)?;
        Ok(changed as u64)
    }

    /// 按 `(account_id, pity_group)` 查询出金事件，按 `occurred_at` 升序——
    /// `GuaranteeRule::FiftyFifty` 状态机（`gs_analysis::pity::apply_guarantee_rule`）
    /// 是有状态的顺序处理，顺序错了结果就是错的，这里直接保证，不指望
    /// 调用方自己再排一遍序。
    pub fn find_rare_events_by_pity_group(
        &self,
        account_id: i64,
        pity_group: &str,
    ) -> Result<Vec<RareEventRow>, GsError> {
        let sql = format!(
            "SELECT {RARE_EVENT_SELECT_COLUMNS} FROM rare_event \
             WHERE account_id = ?1 AND pity_group = ?2 ORDER BY occurred_at"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![account_id, pity_group], |row| {
                let is_rate_up: Option<i64> = row.get(8)?;
                Ok(RareEventRow {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    banner_key: row.get(2)?,
                    pity_group: row.get(3)?,
                    occurred_at: row.get(4)?,
                    item_id: row.get(5)?,
                    rarity: row.get(6)?,
                    pity_count: row.get(7)?,
                    is_rate_up: is_rate_up.map(|value| value != 0),
                    origin: row.get(9)?,
                    source: row.get(10)?,
                    record_id: row.get(11)?,
                    extra: row.get(12)?,
                })
            })
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    // ------------------------------------------------------------------
    // account
    // ------------------------------------------------------------------

    /// 创建账号，返回自增 `id`。
    pub fn create_account(&self, new: &NewAccount) -> Result<i64, GsError> {
        self.conn
            .execute(
                "INSERT INTO account (plugin_id, game_uid, region, display_name, \
                 retention_days, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    new.plugin_id,
                    new.game_uid,
                    new.region,
                    new.display_name,
                    new.retention_days,
                    new.created_at
                ],
            )
            .map_err(storage_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 按主键查询账号，不存在时返回 `None`（不是错误）。
    pub fn find_account(&self, id: i64) -> Result<Option<Account>, GsError> {
        let sql = format!("SELECT {ACCOUNT_SELECT_COLUMNS} FROM account WHERE id = ?1");
        self.conn
            .query_row(&sql, params![id], map_account_row)
            .optional()
            .map_err(storage_err)
    }

    /// 按 `(plugin_id, game_uid)` 查询，**不含区服**——返回同一游戏同一 UID
    /// 下的全部账号。
    ///
    /// 存在的理由：`account` 的身份三元组是 `(plugin_id, game_uid, region)`，
    /// 但**不是每种交换格式的存档都携带区服**。UIGF v4 就完全没有这个字段，
    /// 它的适配器永远产出 `region: None`（`gs_exchange::uigf` 里三处
    /// `region: None`）。若把 `None` 落成空串当作一个"区服值"，同一个玩家
    /// 从 UIGF 导入的账号，与日后走 API 采集（那条路能拿到真实区服）建出来的
    /// 账号，会是**两个不同的账号**——记录一分为二，跨源合并、保底连续性、
    /// 保留期告警全部跟着错，而且不会有任何报错。
    ///
    /// 调用方（导入流程）用它做的判断是：存档没声明区服时，按 `(plugin_id,
    /// game_uid)` 找现有账号，恰好一个就复用，一个都没有就新建，
    /// **多于一个则拒绝**——那种情况下没有任何依据能选对，猜一个比报错更坏。
    pub fn find_accounts_by_plugin_and_uid(
        &self,
        plugin_id: &str,
        game_uid: &str,
    ) -> Result<Vec<Account>, GsError> {
        let sql = format!(
            "SELECT {ACCOUNT_SELECT_COLUMNS} FROM account \
             WHERE plugin_id = ?1 AND game_uid = ?2 ORDER BY region"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(storage_err)?;
        let rows = stmt
            .query_map(params![plugin_id, game_uid], map_account_row)
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    /// 按 `(plugin_id, game_uid, region)` 唯一约束查询，用于采集流程判断
    /// "这个账号是否已经建过档"。
    pub fn find_account_by_identity(
        &self,
        plugin_id: &str,
        game_uid: &str,
        region: &str,
    ) -> Result<Option<Account>, GsError> {
        let sql = format!(
            "SELECT {ACCOUNT_SELECT_COLUMNS} FROM account \
             WHERE plugin_id = ?1 AND game_uid = ?2 AND region = ?3"
        );
        self.conn
            .query_row(&sql, params![plugin_id, game_uid, region], map_account_row)
            .optional()
            .map_err(storage_err)
    }

    /// 补写账号的 `retention_days`。
    ///
    /// 只用于**补齐历史空洞**——账号创建时（`create_account`）本该已经从
    /// 插件 manifest 的 `retention.conservativeDays` 写好这一列；本方法存在
    /// 的唯一理由是修正"创建时没能写上"的既成事实（这一列在这条消费路径
    /// 补齐之前一律是 `NULL`），调用方（`gs_host::retention::
    /// backfill_missing_retention_days`）已经自行判断过"这一列确实是
    /// `NULL`"才会调用，本方法因此不做条件更新（不带 `WHERE retention_days
    /// IS NULL`），无条件覆盖——调用方的判断就是唯一的守门条件，这里重复
    /// 一遍只会让"什么时候真的会写"这件事分散在两个地方。
    pub fn update_account_retention_days(
        &self,
        id: i64,
        retention_days: i64,
    ) -> Result<(), GsError> {
        self.conn
            .execute(
                "UPDATE account SET retention_days = ?2 WHERE id = ?1",
                params![id, retention_days],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// 更新账号的采集边界。三个参数各自独立，只在传入 `Some` 时覆盖旧值
    /// （`COALESCE` 到旧值）——本方法不做 min/max 比较，调用方必须自己算好
    /// "是否应当覆盖"再传进来（调用方通常已经持有旧账号状态，比如导入路径
    /// 在写入前会先 `find_account` 读一次）。
    ///
    /// # 三个字段各自的语义，不能互相替代
    ///
    /// - `last_collected_at`：主动确认"到此刻为止我全知道"。**只有真正执行
    ///   过一次采集（S3 采集链路，本仓库尚未接线）才应该传 `Some`**——导入
    ///   路径必须永远传 `None`，因为导入只能证明"我们见过这些记录"，证明
    ///   不了"官方现在没有更晚的数据"；今天导入一份半年前的存档不等于
    ///   今天采集过一次，见 `gs_host::retention` 模块文档的反例②。
    /// - `earliest_record_at` / `latest_record_at`：本地已知最早/最晚一条
    ///   记录的游戏内发生时刻，导入与采集路径都可以写。
    pub fn touch_account_collection_bounds(
        &self,
        id: i64,
        last_collected_at: Option<i64>,
        earliest_record_at: Option<i64>,
        latest_record_at: Option<i64>,
    ) -> Result<(), GsError> {
        self.conn
            .execute(
                "UPDATE account SET \
                 last_collected_at = COALESCE(?2, last_collected_at), \
                 earliest_record_at = COALESCE(?3, earliest_record_at), \
                 latest_record_at = COALESCE(?4, latest_record_at) \
                 WHERE id = ?1",
                params![id, last_collected_at, earliest_record_at, latest_record_at],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// 删除账号（级联清理留给调用方按需处理；本 Stage 不实现自动级联，
    /// 因为具体删除范围——是否连带清空记录、快照——是产品决策，不是存储层
    /// 该替调用方拍板的事）。
    pub fn delete_account(&self, id: i64) -> Result<(), GsError> {
        self.conn
            .execute("DELETE FROM account WHERE id = ?1", params![id])
            .map_err(storage_err)?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // banner_snapshot / banner_meta
    // ------------------------------------------------------------------

    /// 写入一条卡池统计快照。存成时间序列而非单行覆盖——每次采集追加一条，
    /// 见 `banner_snapshot` 表上的注释。
    pub fn insert_banner_snapshot(&self, new: &NewBannerSnapshot) -> Result<i64, GsError> {
        self.conn
            .execute(
                "INSERT INTO banner_snapshot (account_id, banner_key, captured_at, draw_count, \
                 rare_count, pity_current, pity_max, origin, source, extra) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    new.account_id,
                    new.banner_key,
                    new.captured_at,
                    new.draw_count,
                    new.rare_count,
                    new.pity_current,
                    new.pity_max,
                    new.origin.as_sql(),
                    new.source,
                    new.extra
                ],
            )
            .map_err(storage_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 写入（或按 `(plugin_id, banner_key)` 主键覆盖）一条卡池元数据。
    /// 新卡池元数据热更新走的正是这条路径——`banner_key` 稳定的前提下，
    /// 历史记录会在下次查询时自动关联补全，无需重新采集。
    pub fn upsert_banner_meta(&self, new: &NewBannerMeta) -> Result<(), GsError> {
        self.conn
            .execute(
                "INSERT INTO banner_meta (plugin_id, banner_key, pity_group, name, start_at, \
                 end_at, rate_up_items, pity_max, curve_type, guarantee_rule, data_ver) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
                 ON CONFLICT(plugin_id, banner_key) DO UPDATE SET \
                 pity_group = excluded.pity_group, name = excluded.name, \
                 start_at = excluded.start_at, end_at = excluded.end_at, \
                 rate_up_items = excluded.rate_up_items, pity_max = excluded.pity_max, \
                 curve_type = excluded.curve_type, guarantee_rule = excluded.guarantee_rule, \
                 data_ver = excluded.data_ver",
                params![
                    new.plugin_id,
                    new.banner_key,
                    new.pity_group,
                    new.name,
                    new.start_at,
                    new.end_at,
                    new.rate_up_items,
                    new.pity_max,
                    new.curve_type,
                    new.guarantee_rule,
                    new.data_ver
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // item_catalog：MetadataProvider 回填侧的落点
    // ------------------------------------------------------------------

    /// 写入（或按 `(plugin_id, item_id, lang)` 主键覆盖）一条物品目录条目。
    ///
    /// 消费点：`gs_host::metadata_backfill`——用 MetadataProvider 反查出真正
    /// `item_id` 之后，把反查用到的 name（回填前的 `gacha_record.item_id`
    /// 旧值）连同该记录本来就有的 `rarity`/`item_type` 一并写进这张表，让
    /// `(plugin_id, item_id, lang)` 三元组第一次有了真实的写入方——建库以来
    /// 这张表只有 schema，没有任何代码写过它。
    ///
    /// 覆盖写入而非拒绝重复：字典可能远程更新（`data_ver` 正是为此设计），
    /// 同一物品在新版本字典里改名/换稀有度是合法的业务场景，与
    /// [`Self::upsert_banner_meta`] 同一模式。
    pub fn upsert_item_catalog(&self, new: &NewItemCatalogEntry) -> Result<(), GsError> {
        self.conn
            .execute(
                "INSERT INTO item_catalog (plugin_id, item_id, lang, name, rarity, item_type, \
                 icon_url, data_ver) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
                 ON CONFLICT(plugin_id, item_id, lang) DO UPDATE SET \
                 name = excluded.name, rarity = excluded.rarity, item_type = excluded.item_type, \
                 icon_url = excluded.icon_url, data_ver = excluded.data_ver",
                params![
                    new.plugin_id,
                    new.item_id,
                    new.lang,
                    new.name,
                    new.rarity,
                    new.item_type,
                    new.icon_url,
                    new.data_ver
                ],
            )
            .map_err(storage_err)?;
        Ok(())
    }

    /// 按主键查询一条物品目录条目，供测试与未来的展示侧读取路径复用。
    pub fn find_item_catalog_entry(
        &self,
        plugin_id: &str,
        item_id: &str,
        lang: &str,
    ) -> Result<Option<ItemCatalogEntry>, GsError> {
        self.conn
            .query_row(
                "SELECT plugin_id, item_id, lang, name, rarity, item_type, icon_url, data_ver \
                 FROM item_catalog WHERE plugin_id = ?1 AND item_id = ?2 AND lang = ?3",
                params![plugin_id, item_id, lang],
                |row| {
                    Ok(ItemCatalogEntry {
                        plugin_id: row.get(0)?,
                        item_id: row.get(1)?,
                        lang: row.get(2)?,
                        name: row.get(3)?,
                        rarity: row.get(4)?,
                        item_type: row.get(5)?,
                        icon_url: row.get(6)?,
                        data_ver: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(storage_err)
    }

    // ------------------------------------------------------------------
    // collect_session / raw_payload
    // ------------------------------------------------------------------

    /// 创建一次采集会话，返回自增 `id`——`raw_payload` 写入前需要一个
    /// 已存在的 `session_id`（外键约束）。
    pub fn create_collect_session(&self, new: &NewCollectSession) -> Result<i64, GsError> {
        self.conn
            .execute(
                "INSERT INTO collect_session (account_id, started_at, ended_at, method, \
                 status, records_new, diagnostics) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    new.account_id,
                    new.started_at,
                    new.ended_at,
                    new.method,
                    new.status,
                    new.records_new,
                    new.diagnostics
                ],
            )
            .map_err(storage_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 写入一条原始报文。入库前强制过 [`credential_guard::find_forbidden_pattern`]——
    /// 命中即拒绝写入并返回 [`GsError::Validation`]，不做"脱敏后放行"。
    /// 这是最后一道机械防线，即使 L0/L1 已经剥离过凭据，这里也不单点信任。
    pub fn insert_raw_payload(&self, new: &NewRawPayload) -> Result<i64, GsError> {
        if let Some(pattern) = credential_guard::find_forbidden_pattern(&new.payload) {
            return Err(GsError::Validation(format!(
                "raw_payload 拒绝写入：内容命中禁止入库的凭据特征模式 `{pattern}`；\
                 凭据永不入库是本项目的红线约束，即使上游已经剥离过也不在此单点信任"
            )));
        }
        self.conn
            .execute(
                "INSERT INTO raw_payload (session_id, seq, payload, encoding, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    new.session_id,
                    new.seq,
                    new.payload,
                    new.encoding,
                    new.created_at
                ],
            )
            .map_err(storage_err)?;
        Ok(self.conn.last_insert_rowid())
    }

    // ------------------------------------------------------------------
    // 视图
    // ------------------------------------------------------------------

    /// 查询 `v_integrity` 视图的全部行。
    pub fn integrity_report(&self) -> Result<Vec<IntegrityRow>, GsError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT account_id, banner_key, official_draws, local_draws, official_rares, \
                 local_rares, precision, page_size, page_count FROM v_integrity",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(IntegrityRow {
                    account_id: row.get(0)?,
                    banner_key: row.get(1)?,
                    official_draws: row.get(2)?,
                    local_draws: row.get(3)?,
                    official_rares: row.get(4)?,
                    local_rares: row.get(5)?,
                    precision: row.get(6)?,
                    page_size: row.get(7)?,
                    page_count: row.get(8)?,
                })
            })
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    /// 查询 `v_unknown_banner` 视图的全部行，供 UI 提示
    /// "检测到 N 个未收录卡池"（`N` 即返回向量的长度）。
    pub fn unknown_banners(&self) -> Result<Vec<UnknownBannerRow>, GsError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT account_id, plugin_id, banner_key, record_count, last_occurred_at \
                 FROM v_unknown_banner",
            )
            .map_err(storage_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(UnknownBannerRow {
                    account_id: row.get(0)?,
                    plugin_id: row.get(1)?,
                    banner_key: row.get(2)?,
                    record_count: row.get(3)?,
                    last_occurred_at: row.get(4)?,
                })
            })
            .map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    // ------------------------------------------------------------------
    // app_setting
    // ------------------------------------------------------------------

    /// 读取一个设置项的原始字符串值，未设置过时返回 `None`（不是错误）——
    /// 调用方（`gs_host::settings`）据此决定回退到默认值还是别的语义，理由
    /// 同 [`Self::find_account`] 对"不存在"的处理方式。
    pub fn get_setting(&self, key: SettingKey) -> Result<Option<String>, GsError> {
        self.conn
            .query_row(
                "SELECT value FROM app_setting WHERE key = ?1",
                params![key.as_sql()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_err)
    }

    /// 写入（或覆盖）一个设置项。`INSERT ... ON CONFLICT DO UPDATE`——设置项
    /// 语义上只有"当前值"，不是时间序列（与 `banner_snapshot` 故意追加成
    /// 历史记录不同，见该表上的注释），覆盖是这里唯一正确的写入语义。
    pub fn set_setting(&self, key: SettingKey, value: &str) -> Result<(), GsError> {
        self.conn
            .execute(
                "INSERT INTO app_setting (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key.as_sql(), value],
            )
            .map_err(storage_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Storage;
    use gs_core::{MetaState, RecordSource, TzOrigin};

    #[test]
    fn update_account_retention_days_backfills_a_previously_null_column() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = repo
            .create_account(&NewAccount {
                plugin_id: "wuwa".to_string(),
                game_uid: "100000000".to_string(),
                region: "official".to_string(),
                display_name: None,
                retention_days: None,
                created_at: 1_754_800_000_000,
            })
            .expect("创建账号应当成功");

        let before = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(before.retention_days, None, "补写前应当是 NULL");

        repo.update_account_retention_days(account_id, 168)
            .expect("补写应当成功");

        let after = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(after.retention_days, Some(168), "补写后应当读到新值");
        // 补写只动 retention_days 这一列，其余字段应当原样保留。
        assert_eq!(after.plugin_id, before.plugin_id);
        assert_eq!(after.game_uid, before.game_uid);
    }

    #[test]
    fn touch_account_collection_bounds_only_overwrites_columns_passed_as_some() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = repo
            .create_account(&NewAccount {
                plugin_id: "genshin".to_string(),
                game_uid: "100000000".to_string(),
                region: "official".to_string(),
                display_name: None,
                retention_days: None,
                created_at: 1_754_800_000_000,
            })
            .expect("创建账号应当成功");

        let fresh = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(
            fresh.last_collected_at, None,
            "自证前提：新账号三列均为 NULL"
        );
        assert_eq!(fresh.earliest_record_at, None);
        assert_eq!(fresh.latest_record_at, None);

        // 只写 earliest/latest，last_collected_at 传 None——对应导入路径的
        // 真实调用形状：导入永远不写 last_collected_at，见方法文档。
        repo.touch_account_collection_bounds(account_id, None, Some(100), Some(200))
            .expect("写入应当成功");
        let after_import = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(
            after_import.last_collected_at, None,
            "传 None 的列不应被覆盖"
        );
        assert_eq!(after_import.earliest_record_at, Some(100));
        assert_eq!(after_import.latest_record_at, Some(200));

        // 之后再模拟一次真正的采集：只写 last_collected_at，earliest/latest
        // 传 None——已有的两列不应被冲掉。
        repo.touch_account_collection_bounds(account_id, Some(300), None, None)
            .expect("写入应当成功");
        let after_collect = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(after_collect.last_collected_at, Some(300));
        assert_eq!(
            after_collect.earliest_record_at,
            Some(100),
            "上一步写入的 earliest_record_at 不应被这次传 None 冲掉"
        );
        assert_eq!(
            after_collect.latest_record_at,
            Some(200),
            "上一步写入的 latest_record_at 不应被这次传 None 冲掉"
        );
    }

    #[test]
    fn normalize_empty_turns_empty_string_into_none() {
        assert_eq!(normalize_empty(&Some(String::new())), None);
        assert_eq!(
            normalize_empty(&Some("5".to_string())),
            Some("5".to_string())
        );
        assert_eq!(normalize_empty(&None), None);
    }

    // ------------------------------------------------------------------
    // app_setting
    // ------------------------------------------------------------------

    #[test]
    fn get_setting_returns_none_when_never_set() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        assert_eq!(
            repo.get_setting(SettingKey::ThemePreference)
                .expect("查询应当成功"),
            None,
            "未设置过的 key 应当返回 None，不是错误"
        );
    }

    #[test]
    fn set_then_get_setting_round_trips() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        repo.set_setting(SettingKey::ThemePreference, "dark")
            .expect("写入应当成功");
        assert_eq!(
            repo.get_setting(SettingKey::ThemePreference)
                .expect("查询应当成功"),
            Some("dark".to_string())
        );
    }

    #[test]
    fn set_setting_overwrites_previous_value_without_duplicating_rows() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        repo.set_setting(SettingKey::ThemePreference, "dark")
            .expect("首次写入应当成功");
        repo.set_setting(SettingKey::ThemePreference, "light")
            .expect("覆盖写入应当成功");
        assert_eq!(
            repo.get_setting(SettingKey::ThemePreference)
                .expect("查询应当成功"),
            Some("light".to_string()),
            "覆盖写入后应读到新值，而不是旧值或报唯一约束冲突"
        );
    }

    #[test]
    fn migrating_empty_database_creates_app_setting_table() {
        // 迁移能在空库上跑通，且 app_setting 确实存在——这是本迁移最基础的
        // 断言，migrations.rs 的 object_count 断言已经覆盖了数量，这里额外
        // 直接按表名查一遍，定位更精确。
        let storage = Storage::open_in_memory().expect("应当能在空库上成功应用全部迁移");
        let repo = storage.repository();
        // 表存在的证明：对一个刚建好、从未写过的 key 查询不报错。
        assert_eq!(
            repo.get_setting(SettingKey::ThemePreference)
                .expect("app_setting 表应当已经建好，查询不应报错"),
            None
        );
    }

    #[test]
    fn enum_round_trips_through_sql_string() {
        let sql = enum_to_sql(TzOrigin::Region).expect("应当序列化成功");
        assert_eq!(sql, "region");
        let back: TzOrigin = enum_from_sql(&sql).expect("应当反序列化成功");
        assert_eq!(back, TzOrigin::Region);

        let sql = enum_to_sql(MetaState::Pending).expect("应当序列化成功");
        assert_eq!(sql, "pending");
        let back: MetaState = enum_from_sql(&sql).expect("应当反序列化成功");
        assert_eq!(back, MetaState::Pending);

        let sql = enum_to_sql(RecordSource::OfficialApi).expect("应当序列化成功");
        assert_eq!(sql, "officialApi");
        let back: RecordSource = enum_from_sql(&sql).expect("应当反序列化成功");
        assert_eq!(back, RecordSource::OfficialApi);
    }

    // ------------------------------------------------------------------
    // MetadataProvider 回填侧：find_pending_records_by_plugin /
    // resolve_pending_record_item_id / upsert_item_catalog
    // ------------------------------------------------------------------

    /// 构造一条测试用记录，`item_id` 用调用方传入的值（回填测试里用它模拟
    /// "本地化物品名"这个临时值），`meta_state`/`lang` 是本组测试真正关心的
    /// 两个维度，其余字段填最简单的合法值。
    fn pending_test_record(
        account_id: i64,
        record_key: &str,
        meta_state: MetaState,
        lang: Option<&str>,
        item_id: &str,
    ) -> GachaRecord {
        GachaRecord {
            id: 0,
            account_id,
            banner_key: "301".to_string(),
            pity_group: "characterEventWish".to_string(),
            record_key: RecordKey::new(record_key.to_string()).expect("record_key 应当合法"),
            lang: lang.map(str::to_string),
            occurred_at: 1_754_800_000_000,
            occurred_raw: "2026-08-10 12:00:00".to_string(),
            tz_origin: TzOrigin::Assumed,
            tz_offset_min: None,
            seq_in_batch: None,
            item_id: item_id.to_string(),
            item_type: Some("character".to_string()),
            rarity: Some("5".to_string()),
            qty: 1,
            meta_state,
            source: RecordSource::Import,
            captured_at: 1_754_800_000_000,
            raw_ref: None,
            extra: None,
            stable_id: None,
            gacha_id: None,
        }
    }

    fn test_account(repo: &Repository<'_>, plugin_id: &str, game_uid: &str) -> i64 {
        repo.create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: game_uid.to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: None,
            created_at: 1_754_800_000_000,
        })
        .expect("创建账号应当成功")
    }

    #[test]
    fn find_pending_records_by_plugin_only_returns_pending_rows_for_that_plugin() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let genshin_account = test_account(&repo, "genshin", "100000001");
        let wuwa_account = test_account(&repo, "wuwa", "200000001");

        let pending_genshin = pending_test_record(
            genshin_account,
            "rk-1",
            MetaState::Pending,
            Some("zh-cn"),
            "无锋剑",
        );
        let complete_genshin = pending_test_record(
            genshin_account,
            "rk-2",
            MetaState::Complete,
            Some("zh-cn"),
            "11101",
        );
        let pending_wuwa = pending_test_record(
            wuwa_account,
            "rk-3",
            MetaState::Pending,
            Some("zh-cn"),
            "resource-1",
        );

        repo.insert_records(&[pending_genshin, complete_genshin, pending_wuwa])
            .expect("写入应当成功");

        let found = repo
            .find_pending_records_by_plugin("genshin")
            .expect("查询应当成功");
        assert_eq!(
            found.len(),
            1,
            "只应返回 genshin 账号下 meta_state=pending 的那一条"
        );
        assert_eq!(found[0].record_key.as_str(), "rk-1");
        assert_eq!(found[0].meta_state, MetaState::Pending);
    }

    #[test]
    fn find_pending_records_by_plugin_returns_empty_when_none_pending() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        assert_eq!(
            repo.find_pending_records_by_plugin("genshin")
                .expect("查询应当成功，即使没有任何账号"),
            Vec::new()
        );
    }

    #[test]
    fn resolve_pending_record_item_id_updates_item_id_and_flips_meta_state_to_complete() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = test_account(&repo, "genshin", "100000001");
        let pending = pending_test_record(
            account_id,
            "rk-1",
            MetaState::Pending,
            Some("zh-cn"),
            "无锋剑",
        );
        repo.insert_records(&[pending]).expect("写入应当成功");
        let record_id = repo
            .find_pending_records_by_plugin("genshin")
            .expect("查询应当成功")[0]
            .id;

        repo.resolve_pending_record_item_id(record_id, "11101")
            .expect("回填写入应当成功");

        let all = repo
            .find_all_records_for_account(account_id)
            .expect("查询应当成功");
        let resolved = all
            .into_iter()
            .find(|r| r.id == record_id)
            .expect("记录应当仍然存在");
        assert_eq!(
            resolved.item_id, "11101",
            "item_id 应当被替换成真正的物品标识"
        );
        assert_eq!(
            resolved.meta_state,
            MetaState::Complete,
            "回填成功后 meta_state 应当推进到 complete"
        );
    }

    #[test]
    fn resolve_pending_record_item_id_does_not_touch_records_that_are_already_complete() {
        // 防御性 WHERE 守卫：只更新仍处于 pending 状态的行，即使调用方传入
        // 一个已经是 complete 的 record_id，也不应当覆盖它已有的 item_id
        // ——这条记录理论上不会出现在 find_pending_records_by_plugin 的结果
        // 里，但方法本身的行为契约不应该依赖调用方"只会传对的 id"这个假设。
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = test_account(&repo, "genshin", "100000001");
        let complete = pending_test_record(
            account_id,
            "rk-1",
            MetaState::Complete,
            Some("zh-cn"),
            "11101",
        );
        repo.insert_records(&[complete]).expect("写入应当成功");
        let record_id = repo
            .find_all_records_for_account(account_id)
            .expect("查询应当成功")[0]
            .id;

        repo.resolve_pending_record_item_id(record_id, "should-not-apply")
            .expect("即使没有行被更新，方法本身也不应当报错");

        let unchanged = repo
            .find_all_records_for_account(account_id)
            .expect("查询应当成功")
            .into_iter()
            .find(|r| r.id == record_id)
            .expect("记录应当仍然存在");
        assert_eq!(unchanged.item_id, "11101", "已经 complete 的记录不应被覆盖");
    }

    #[test]
    fn upsert_item_catalog_inserts_then_updates_on_primary_key_conflict() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();

        repo.upsert_item_catalog(&NewItemCatalogEntry {
            plugin_id: "genshin".to_string(),
            item_id: "11101".to_string(),
            lang: "zh-cn".to_string(),
            name: "无锋剑".to_string(),
            rarity: Some("3".to_string()),
            item_type: Some("weapon".to_string()),
            icon_url: None,
            data_ver: 1,
        })
        .expect("首次写入应当成功");

        let inserted = repo
            .find_item_catalog_entry("genshin", "11101", "zh-cn")
            .expect("查询应当成功")
            .expect("应当已经存在");
        assert_eq!(inserted.name, "无锋剑");
        assert_eq!(inserted.data_ver, 1);

        // 同一个 (plugin_id, item_id, lang) 主键再写一次，字典更新场景。
        repo.upsert_item_catalog(&NewItemCatalogEntry {
            plugin_id: "genshin".to_string(),
            item_id: "11101".to_string(),
            lang: "zh-cn".to_string(),
            name: "无锋剑改名".to_string(),
            rarity: Some("4".to_string()),
            item_type: Some("weapon".to_string()),
            icon_url: None,
            data_ver: 2,
        })
        .expect("冲突覆盖写入应当成功");

        let updated = repo
            .find_item_catalog_entry("genshin", "11101", "zh-cn")
            .expect("查询应当成功")
            .expect("应当仍然存在");
        assert_eq!(
            updated.name, "无锋剑改名",
            "同主键再次写入应当覆盖旧值，不是报错或忽略"
        );
        assert_eq!(updated.rarity, Some("4".to_string()));
        assert_eq!(updated.data_ver, 2);

        // 不同 lang 是不同主键，两条应当共存，互不覆盖。
        repo.upsert_item_catalog(&NewItemCatalogEntry {
            plugin_id: "genshin".to_string(),
            item_id: "11101".to_string(),
            lang: "en-us".to_string(),
            name: "Sharpshooter's Oath".to_string(),
            rarity: Some("4".to_string()),
            item_type: Some("weapon".to_string()),
            icon_url: None,
            data_ver: 1,
        })
        .expect("不同语言的写入应当成功");
        assert_eq!(
            repo.find_item_catalog_entry("genshin", "11101", "zh-cn")
                .expect("查询应当成功")
                .expect("zh-cn 那条不应被 en-us 的写入影响")
                .name,
            "无锋剑改名"
        );
    }

    #[test]
    fn find_item_catalog_entry_returns_none_when_not_found() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        assert_eq!(
            repo.find_item_catalog_entry("genshin", "does-not-exist", "zh-cn")
                .expect("查询应当成功"),
            None
        );
    }
}
