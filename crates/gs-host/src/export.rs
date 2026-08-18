//! 导出编排：本地库 → CSV / UIGF v4 字节 + 量化排除报告。
//!
//! 与 [`crate::archive`] 是镜像关系——那边是"字节 → 账号 → 落库"，这边是
//! "账号 → 记录 → 字节"。内核（单条记录能不能表示成 UIGF item、`400→301`
//! 归一化等）落在 [`gs_exchange::uigf`]（理由见该 crate 顶部文档新增的
//! "第三个职责"一节），本模块只做：按 `account_id` 选账号 → 从
//! [`Repository`] 读出记录 → 按格式分派给 CSV / UIGF 两条组装路径 → 把
//! 排除计数拼成前端能直接渲染的 [`ExportReport`]。
//!
//! ## 两种格式的定位完全不同，不是同一份数据的两种编码
//!
//! - **CSV = 全量无损、所有游戏、所有记录**，不受 UIGF 的任何范围/枚举/
//!   必填字段约束——这是"绝不做数据锁定"的真正兜底：UIGF 是给别的工具读的
//!   交换格式，CSV 是保证用户无论如何都能把本地库里的数据整体带走的手段。
//!   因此 [`export_csv`] 从不产出任何排除项，`ExportReport::excluded`
//!   恒为空数组。
//! - **UIGF v4 = 只能覆盖 hk4e/hkrpg/nap**（原神/星铁/绝区零），且受
//!   `docs/_internal/reference/UIGF-v4速查.md` 记录的必填字段/类型/枚举
//!   约束。落不进这三段的记录（鸣潮全部、绝区零 102/103、原神字典未回填、
//!   缺 stable_id、`occurred_raw` 不合规范、星铁缺 gacha_id、账号级时区
//!   无法确定）**必须**逐类计数写进 `ExportReport::excluded`，不允许
//!   "导出成功"却悄悄漏掉几个卡池——这是本任务的硬约束，也是本项目反复
//!   栽跟头的地方（功能不产出结论 / 声称在守的东西实际没在守）。
//!
//! ## 内部外键不导出
//!
//! CSV 省略 `id`（本地自增主键）、`account_id`（内部外键，用
//! `plugin_id`/`game_uid`/`region` 三列代替，离开本地库依然自解释）、
//! `raw_ref`（指向 `raw_payload` 表的行 id，离开本地库没有任何意义，
//! 且 `raw_payload` 本身受 `credential_guard` 保护、从不打算被导出）。

use std::collections::BTreeMap;

use gs_core::{GachaRecord, GsError};
use gs_exchange::uigf::{
    UIGF_LANG_ENUM, UigfExclusionReason, hk4e_export_item, hkrpg_export_item, nap_export_item,
};
use gs_storage::{Account, Repository};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// 导出格式，封闭枚举——IPC 命令参数只能是这两个取值之一，不接受任意字符串
/// （HC-2 窄口纪律，与 `gs_host::settings::ThemePreference` 同一写法）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    UigfV4,
}

/// 单类排除项的原因，前端展示用——覆盖 CSV 之外的全部"记录为什么没能进入
/// UIGF 导出文件"的场景。`Csv` 格式的报告 `excluded` 恒为空，不会出现
/// 这个枚举的任何取值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ExportExclusionReason {
    /// 账号所属插件不在 UIGF 覆盖范围内（当前唯一实例：鸣潮）。
    NotInUigfScope,
    /// 绝区零 `102`/`103` 卡池：不在 UIGF v4.2 `nap.gacha_type` 枚举内。
    ZzzGachaTypeNotInEnum,
    /// 原神记录 `item_id` 仍是本地化物品名，字典回填尚未完成。
    GenshinItemIdUnresolved,
    /// `stable_id` 缺失，或不满足 UIGF `id` 字段格式约束。
    MissingStableId,
    /// `occurred_raw` 不匹配 UIGF `time` 字段的规范正则。
    InvalidOccurredRaw,
    /// 星铁记录缺少 `gacha_id`（该段必填）。
    StarrailMissingGachaId,
    /// 账号名下参与本次导出的记录里，没有任何一条带着可用的
    /// `tz_offset_min`，无法确定 UIGF `timezone`（账号级必填字段）。
    TimezoneUnavailable,
}

impl ExportExclusionReason {
    /// 面向用户的完整中文说明——与本仓库其余"结构化错误自带完整文案"的
    /// 写法一致（如 `gs_host::import::ImportError`），前端不需要自己维护
    /// 一份枚举到文案的映射表。
    pub fn message(self) -> &'static str {
        match self {
            Self::NotInUigfScope => {
                "UIGF v4 交换格式目前只覆盖原神/星铁/绝区零三款米哈游游戏，\
                 这些记录不在范围内——数据本身完好，请改用「导出 CSV」带走全部记录"
            }
            Self::ZzzGachaTypeNotInEnum => {
                "这些绝区零记录属于「独家重映」（102）或「音擎回响」（103）卡池——\
                 UIGF v4.2 规范的 nap.gacha_type 枚举只收录了 1/2/3/5 四个值，尚未\
                 覆盖这两个卡池类型。这是交换格式规范本身的缺口，不是本应用的实现\
                 缺陷；这些记录本身完好，可通过「导出 CSV」带走"
            }
            Self::GenshinItemIdUnresolved => {
                "这些原神记录的物品标识尚未完成字典回填（官方接口不直接返回物品\
                 标识，需要联网反查）——请先在设置页点击「补齐物品名」，再重新导出"
            }
            Self::MissingStableId => {
                "这些记录缺少服务端记录 ID（stable_id），UIGF 的 id 字段是必填项，\
                 无法为它们生成合规条目"
            }
            Self::InvalidOccurredRaw => {
                "这些记录的原始时间字符串不满足 UIGF 规定的 \"YYYY-MM-DD HH:MM:SS\" \
                 格式，为避免生成不合规文件，予以排除"
            }
            Self::StarrailMissingGachaId => {
                "这些星铁记录缺少卡池实例 ID（gacha_id）——UIGF 的星铁段把这个字段\
                 列为必填，无法为它们生成合规条目"
            }
            Self::TimezoneUnavailable => {
                "对应账号名下没有任何一条记录携带可靠的时区信息，无法确定 UIGF \
                 要求的账号级 timezone 字段"
            }
        }
    }
}

/// 一类排除项的计数，[`ExportReport::excluded`] 的元素类型。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExportExclusionBucket {
    pub reason: ExportExclusionReason,
    pub count: i64,
    /// 完整中文说明，即 [`ExportExclusionReason::message`] 的取值——
    /// 冗余存一份是为了前端不需要自己维护映射表，直接渲染即可。
    pub message: String,
}

/// 一次导出的结果报告，`export_records_via_picker` 命令的返回值之一。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub format: ExportFormat,
    /// 实际写入导出文件的账号数（CSV：选中的账号数；UIGF：至少有一条记录
    /// 成功进入某个游戏段 project 的账号数，可能小于选中的账号数）。
    pub accounts_exported: i64,
    /// 实际写入导出文件的记录条数。
    pub records_exported: i64,
    /// 逐类排除计数——**CSV 格式恒为空数组**，UIGF 格式覆盖本模块文档
    /// "两种格式的定位完全不同"一节列出的全部场景。
    pub excluded: Vec<ExportExclusionBucket>,
}

/// 导出流程失败原因。
#[derive(Debug)]
pub enum ExportError {
    /// 调用方指定的 `account_id` 在本地库里不存在。
    AccountNotFound {
        account_id: i64,
    },
    Storage(GsError),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AccountNotFound { account_id } => {
                write!(f, "账号 id={account_id} 在本地库中不存在")
            }
            Self::Storage(err) => write!(f, "导出流程存储层失败：{err}"),
        }
    }
}

impl std::error::Error for ExportError {}

impl From<GsError> for ExportError {
    fn from(err: GsError) -> Self {
        Self::Storage(err)
    }
}

/// 按 `account_id` 选出参与导出的账号——`None` 选全部。
fn select_accounts(
    repo: &Repository<'_>,
    account_id: Option<i64>,
) -> Result<Vec<Account>, ExportError> {
    match account_id {
        Some(id) => {
            let account = repo
                .find_account(id)?
                .ok_or(ExportError::AccountNotFound { account_id: id })?;
            Ok(vec![account])
        }
        None => Ok(repo.list_accounts()?),
    }
}

/// 端到端导出入口：按 `format` 分派，返回可直接写盘的字节与报告。
pub fn export_records(
    repo: &Repository<'_>,
    format: ExportFormat,
    account_id: Option<i64>,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    match format {
        ExportFormat::Csv => export_csv(repo, account_id),
        ExportFormat::UigfV4 => export_uigf(repo, account_id),
    }
}

// ================================================================
// CSV：全量无损
// ================================================================

/// 表头，即导出列的权威顺序——新增列在这里追加，同时要同步
/// [`record_to_csv_row`]，两处顺序必须一致（下面有测试机械核对列数一致）。
const CSV_HEADER: &[&str] = &[
    "plugin_id",
    "game_uid",
    "region",
    "banner_key",
    "pity_group",
    "record_key",
    "lang",
    "occurred_at_ms",
    "occurred_raw",
    "tz_origin",
    "tz_offset_min",
    "seq_in_batch",
    "item_id",
    "item_type",
    "rarity",
    "qty",
    "meta_state",
    "source",
    "captured_at_ms",
    "stable_id",
    "gacha_id",
    "extra",
];

/// RFC 4180 最小转义：字段含逗号/双引号/换行才加引号包裹，内部双引号翻倍。
fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// 枚举字段的稳定字符串表示——直接复用它们已有的 `Serialize`
/// （`#[serde(rename_all = "camelCase")]`），与 IPC/JSON 里的取值完全一致，
/// 不再手写一份平行的 `match` 分支。
fn enum_json_string<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(Value::String(s)) => s,
        // 三个枚举字段（TzOrigin/MetaState/RecordSource）序列化恒为字符串，
        // 这个分支实践中不可达；写出来而不是 `unwrap()`，是为了不让一次
        // 序列化失败演变成 CSV 导出整体 panic。
        _ => String::new(),
    }
}

fn record_to_csv_row(account: &Account, record: &GachaRecord) -> String {
    let fields = [
        account.plugin_id.clone(),
        account.game_uid.clone(),
        account.region.clone(),
        record.banner_key.clone(),
        record.pity_group.clone(),
        record.record_key.as_str().to_string(),
        record.lang.clone().unwrap_or_default(),
        record.occurred_at.to_string(),
        record.occurred_raw.clone(),
        enum_json_string(&record.tz_origin),
        record
            .tz_offset_min
            .map(|v| v.to_string())
            .unwrap_or_default(),
        record
            .seq_in_batch
            .map(|v| v.to_string())
            .unwrap_or_default(),
        record.item_id.clone(),
        record.item_type.clone().unwrap_or_default(),
        record.rarity.clone().unwrap_or_default(),
        record.qty.to_string(),
        enum_json_string(&record.meta_state),
        enum_json_string(&record.source),
        record.captured_at.to_string(),
        record.stable_id.clone().unwrap_or_default(),
        record.gacha_id.clone().unwrap_or_default(),
        record.extra.clone().unwrap_or_default(),
    ];
    fields
        .iter()
        .map(|f| csv_escape(f))
        .collect::<Vec<_>>()
        .join(",")
}

/// 全量无损导出——见本模块顶部文档"两种格式的定位完全不同"一节。
pub fn export_csv(
    repo: &Repository<'_>,
    account_id: Option<i64>,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let accounts = select_accounts(repo, account_id)?;

    let mut out = String::new();
    out.push_str(&CSV_HEADER.join(","));
    out.push('\n');

    let mut records_exported: i64 = 0;
    let mut accounts_exported: i64 = 0;
    for account in &accounts {
        let records = repo.find_all_records_for_account(account.id)?;
        if records.is_empty() {
            continue;
        }
        accounts_exported += 1;
        for record in &records {
            out.push_str(&record_to_csv_row(account, record));
            out.push('\n');
            records_exported += 1;
        }
    }

    let report = ExportReport {
        format: ExportFormat::Csv,
        accounts_exported,
        records_exported,
        excluded: Vec::new(),
    };
    Ok((out.into_bytes(), report))
}

// ================================================================
// UIGF v4：只覆盖 hk4e/hkrpg/nap
// ================================================================

/// 导出格式版本号——固定 `"v4.1"`，不是最新的 `"v4.2"`。
///
/// 理由（`CLAUDE.local.md` 明确要求）：星铁 21/22 联动池是 v4.1 才纳入的
/// 卡池类型，本项目 `plugins/starrail/manifest.ts` 声明了它们；规范原文
/// 对"无需处理星穹铁道的应用"给出的兼容性说明是"v4.1 与 v4.0 兼容"——
/// 既然本项目处理星穹铁道，就不能填一个该版本枚举不接受这两个联动池类型的
/// 号码。**绝不允许输出一个版本号、却在文件里塞该版本枚举不接受的取值**，
/// 这是本任务的硬约束，不是随手选的字符串。
const UIGF_EXPORT_VERSION: &str = "v4.1";

const UIGF_EXPORT_APP: &str = "gacha-studio";

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 把 `records` 按 `classify` 分成"可导出的 (原始记录引用, item JSON)"与
/// "按原因分桶的排除计数"两部分。
fn classify_records<F>(
    records: &[GachaRecord],
    classify: F,
) -> (
    Vec<(&GachaRecord, Value)>,
    BTreeMap<UigfExclusionReason, i64>,
)
where
    F: Fn(&GachaRecord) -> Result<Value, UigfExclusionReason>,
{
    let mut eligible = Vec::new();
    let mut exclusions: BTreeMap<UigfExclusionReason, i64> = BTreeMap::new();
    for record in records {
        match classify(record) {
            Ok(item) => eligible.push((record, item)),
            Err(reason) => *exclusions.entry(reason).or_insert(0) += 1,
        }
    }
    (eligible, exclusions)
}

/// `gs_exchange::uigf::UigfExclusionReason`（游戏无关）→
/// `ExportExclusionReason`（面向用户、带游戏语境）的一一映射——每个变体
/// 只可能来自唯一一个 `*_export_item` 调用点，因此不需要额外的"game"
/// 上下文参数就能唯一确定映射目标。
fn map_item_exclusion_reason(reason: UigfExclusionReason) -> ExportExclusionReason {
    match reason {
        UigfExclusionReason::MissingOrInvalidStableId => ExportExclusionReason::MissingStableId,
        UigfExclusionReason::InvalidOccurredRaw => ExportExclusionReason::InvalidOccurredRaw,
        UigfExclusionReason::MissingGachaId => ExportExclusionReason::StarrailMissingGachaId,
        UigfExclusionReason::ItemIdUnresolved => ExportExclusionReason::GenshinItemIdUnresolved,
        UigfExclusionReason::GachaTypeNotInUigfEnum => ExportExclusionReason::ZzzGachaTypeNotInEnum,
    }
}

/// 账号级 `timezone`（UIGF 要求的小时整数）：取 `eligible` 记录里
/// `tz_offset_min` 出现次数最多的取值换算成小时——正常情况下同一账号的
/// 记录该值高度一致（同一账号的时区不会频繁变化），"取众数"只是在极端
/// 不一致场景下也能给出一个确定性结果，而不是随手挑第一条。
///
/// 全部记录 `tz_offset_min` 皆为 `None`（`TzOrigin::Assumed`，既无来源也
/// 无区服）时返回 `None`——调用方据此把这批记录整体计入
/// `ExportExclusionReason::TimezoneUnavailable`，不编造一个默认时区
/// （`CLAUDE.local.md` 反复强调的 fail-closed 纪律）。
fn dominant_tz_offset_hours(records: &[&GachaRecord]) -> Option<i32> {
    let mut counts: BTreeMap<i32, u32> = BTreeMap::new();
    for record in records {
        if let Some(min) = record.tz_offset_min {
            *counts.entry(min).or_insert(0) += 1;
        }
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(min, _)| min / 60)
}

/// 账号级 `lang`（可选字段）：取 `eligible` 记录里、且落在
/// [`UIGF_LANG_ENUM`] 内的 `lang` 值中出现次数最多的一个；没有任何记录满足
/// （要么全部 `None`，要么取值都不在枚举内）时返回 `None`——调用方据此省略
/// `lang` 字段，不输出规范不接受的取值。
fn dominant_lang(records: &[&GachaRecord]) -> Option<String> {
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for record in records {
        if let Some(lang) = record
            .lang
            .as_deref()
            .filter(|lang| UIGF_LANG_ENUM.contains(lang))
        {
            *counts.entry(lang).or_insert(0) += 1;
        }
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(lang, _)| lang.to_string())
}

/// 把一个账号在某个游戏段里"已通过单条校验"的记录组装成一个 UIGF
/// `UigfProject`。返回 `None` 表示无法确定账号级 `timezone`——调用方需要把
/// `eligible.len()` 计入 [`ExportExclusionReason::TimezoneUnavailable`]。
fn build_uigf_project(account: &Account, eligible: &[(&GachaRecord, Value)]) -> Option<Value> {
    if eligible.is_empty() {
        return None;
    }
    let records_only: Vec<&GachaRecord> = eligible.iter().map(|(record, _)| *record).collect();
    let timezone_hours = dominant_tz_offset_hours(&records_only)?;
    let lang = dominant_lang(&records_only);

    let mut project = serde_json::Map::new();
    project.insert("uid".to_string(), Value::String(account.game_uid.clone()));
    project.insert(
        "timezone".to_string(),
        Value::Number(serde_json::Number::from(timezone_hours)),
    );
    if let Some(lang) = lang {
        project.insert("lang".to_string(), Value::String(lang));
    }
    let list: Vec<Value> = eligible.iter().map(|(_, item)| item.clone()).collect();
    project.insert("list".to_string(), Value::Array(list));
    Some(Value::Object(project))
}

/// 单个账号在某个游戏段（hk4e/hkrpg/nap）内的处理结果：本段贡献的 project
/// （若有）、本段贡献的记录数、按原因分桶的排除计数。
struct SegmentOutcome {
    project: Option<Value>,
    records_included: i64,
    exclusions: BTreeMap<ExportExclusionReason, i64>,
}

fn process_segment<F>(account: &Account, records: &[GachaRecord], classify: F) -> SegmentOutcome
where
    F: Fn(&GachaRecord) -> Result<Value, UigfExclusionReason>,
{
    let (eligible, item_exclusions) = classify_records(records, classify);
    let mut exclusions: BTreeMap<ExportExclusionReason, i64> = BTreeMap::new();
    for (reason, count) in item_exclusions {
        *exclusions
            .entry(map_item_exclusion_reason(reason))
            .or_insert(0) += count;
    }

    match build_uigf_project(account, &eligible) {
        Some(project) => SegmentOutcome {
            project: Some(project),
            records_included: eligible.len() as i64,
            exclusions,
        },
        None if eligible.is_empty() => SegmentOutcome {
            project: None,
            records_included: 0,
            exclusions,
        },
        None => {
            // eligible 非空但没能确定账号级时区：整批计入
            // TimezoneUnavailable，不是静默丢弃——理由见
            // `build_uigf_project` 与 `dominant_tz_offset_hours` 的文档。
            *exclusions
                .entry(ExportExclusionReason::TimezoneUnavailable)
                .or_insert(0) += eligible.len() as i64;
            SegmentOutcome {
                project: None,
                records_included: 0,
                exclusions,
            }
        }
    }
}

/// UIGF v4 导出——见本模块顶部文档"两种格式的定位完全不同"一节。
pub fn export_uigf(
    repo: &Repository<'_>,
    account_id: Option<i64>,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let accounts = select_accounts(repo, account_id)?;

    let mut hk4e_projects = Vec::new();
    let mut hkrpg_projects = Vec::new();
    let mut nap_projects = Vec::new();
    let mut exclusions: BTreeMap<ExportExclusionReason, i64> = BTreeMap::new();
    let mut records_exported: i64 = 0;
    let mut accounts_exported: i64 = 0;

    for account in &accounts {
        let records = repo.find_all_records_for_account(account.id)?;
        if records.is_empty() {
            continue;
        }

        let outcome = match account.plugin_id.as_str() {
            "genshin" => Some((
                process_segment(account, &records, hk4e_export_item),
                &mut hk4e_projects,
            )),
            "starrail" => Some((
                process_segment(account, &records, hkrpg_export_item),
                &mut hkrpg_projects,
            )),
            "zzz" => Some((
                process_segment(account, &records, nap_export_item),
                &mut nap_projects,
            )),
            _ => {
                // 不在 UIGF 覆盖范围内的插件（当前唯一实例：鸣潮）——整个
                // 账号名下的记录全部计入 NotInUigfScope，不逐条判定。
                *exclusions
                    .entry(ExportExclusionReason::NotInUigfScope)
                    .or_insert(0) += records.len() as i64;
                None
            }
        };

        if let Some((segment, projects)) = outcome {
            for (reason, count) in segment.exclusions {
                *exclusions.entry(reason).or_insert(0) += count;
            }
            if let Some(project) = segment.project {
                projects.push(project);
                records_exported += segment.records_included;
                accounts_exported += 1;
            }
        }
    }

    let mut archive = serde_json::Map::new();
    archive.insert(
        "info".to_string(),
        serde_json::json!({
            "export_timestamp": now_seconds(),
            "export_app": UIGF_EXPORT_APP,
            "export_app_version": env!("CARGO_PKG_VERSION"),
            "version": UIGF_EXPORT_VERSION,
        }),
    );
    if !hk4e_projects.is_empty() {
        archive.insert("hk4e".to_string(), Value::Array(hk4e_projects));
    }
    if !hkrpg_projects.is_empty() {
        archive.insert("hkrpg".to_string(), Value::Array(hkrpg_projects));
    }
    if !nap_projects.is_empty() {
        archive.insert("nap".to_string(), Value::Array(nap_projects));
    }

    let bytes = serde_json::to_vec_pretty(&Value::Object(archive))
        .expect("已知形状的 serde_json::Map 序列化不应失败");

    let excluded: Vec<ExportExclusionBucket> = exclusions
        .into_iter()
        .map(|(reason, count)| ExportExclusionBucket {
            reason,
            count,
            message: reason.message().to_string(),
        })
        .collect();

    let report = ExportReport {
        format: ExportFormat::UigfV4,
        accounts_exported,
        records_exported,
        excluded,
    };
    Ok((bytes, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_core::{MetaState, RecordKey, RecordSource, TzOrigin};
    use gs_storage::{NewAccount, NewRawPayload, Storage};

    const CREATED_AT: i64 = 1_755_000_000_000;

    fn open_repo_with_account(storage: &Storage, plugin_id: &str, uid: &str) -> i64 {
        storage
            .repository()
            .create_account(&NewAccount {
                plugin_id: plugin_id.to_string(),
                game_uid: uid.to_string(),
                region: "official".to_string(),
                display_name: None,
                retention_days: None,
                created_at: CREATED_AT,
            })
            .expect("创建账号应当成功")
    }

    fn sample_record(account_id: i64, banner_key: &str, stable_id: &str) -> GachaRecord {
        GachaRecord {
            id: 0,
            account_id,
            banner_key: banner_key.to_string(),
            pity_group: format!("{banner_key}-group"),
            record_key: RecordKey::new(format!("{banner_key}:{stable_id}")).unwrap(),
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
            captured_at: CREATED_AT,
            raw_ref: None,
            extra: None,
            stable_id: Some(stable_id.to_string()),
            gacha_id: None,
        }
    }

    #[test]
    fn csv_header_and_row_have_matching_column_counts() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        repo.insert_records(&[sample_record(account_id, "301", "1400000000000000001")])
            .expect("写入应当成功");

        let (bytes, report) = export_csv(&repo, None).expect("CSV 导出应当成功");
        let text = String::from_utf8(bytes).expect("CSV 应当是合法 UTF-8");
        let mut lines = text.lines();
        let header = lines.next().expect("应当有表头行");
        let row = lines.next().expect("应当有一行数据");

        assert_eq!(header.split(',').count(), CSV_HEADER.len());
        assert_eq!(row.split(',').count(), CSV_HEADER.len());
        assert_eq!(report.records_exported, 1);
        assert_eq!(report.accounts_exported, 1);
        assert!(report.excluded.is_empty(), "CSV 恒不产出排除项");
    }

    #[test]
    fn csv_escapes_commas_and_quotes_in_extra_field() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let mut record = sample_record(account_id, "301", "1400000000000000001");
        // 只含引号不含逗号——`str::split(',')` 本身不理解 CSV 引号语义，
        // 若字段内还有逗号，朴素按逗号切分的断言会被字段内部的逗号干扰，
        // 那是测试断言方式的局限，不是要验证的转义行为，因此这里刻意避开。
        record.extra = Some(r#"just "a quote" here"#.to_string());
        repo.insert_records(&[record]).expect("写入应当成功");

        let (bytes, _report) = export_csv(&repo, None).expect("CSV 导出应当成功");
        let text = String::from_utf8(bytes).expect("CSV 应当是合法 UTF-8");
        let row = text.lines().nth(1).expect("应当有一行数据");
        assert_eq!(row.split(',').count(), CSV_HEADER.len());
        // 独立拼出期望的转义结果（不调用被测的 csv_escape，避免测试与实现
        // 循环自证）：整体包裹一对双引号，内部原有的双引号各自翻倍成两个。
        let expected = format!("{q}just {q}{q}a quote{q}{q} here{q}", q = '"');
        assert!(
            text.contains(&expected),
            "内部双引号应当被翻倍转义，字段整体应当被引号包裹，期望片段 {expected:?} 未出现: {text}"
        );
    }

    #[test]
    fn export_records_via_account_id_none_covers_all_accounts() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let a1 = open_repo_with_account(&storage, "genshin", "100000000");
        let a2 = open_repo_with_account(&storage, "starrail", "200000000");
        let repo = storage.repository();
        repo.insert_records(&[sample_record(a1, "301", "1400000000000000001")])
            .expect("写入应当成功");
        let mut r2 = sample_record(a2, "11", "1500000000000000001");
        r2.gacha_id = Some("2000".to_string());
        repo.insert_records(&[r2]).expect("写入应当成功");

        let (_bytes, report) = export_csv(&repo, None).expect("CSV 导出应当成功");
        assert_eq!(report.accounts_exported, 2);
        assert_eq!(report.records_exported, 2);
    }

    #[test]
    fn export_records_via_specific_account_id_excludes_other_accounts() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let a1 = open_repo_with_account(&storage, "genshin", "100000000");
        let a2 = open_repo_with_account(&storage, "starrail", "200000000");
        let repo = storage.repository();
        repo.insert_records(&[sample_record(a1, "301", "1400000000000000001")])
            .expect("写入应当成功");
        let mut r2 = sample_record(a2, "11", "1500000000000000001");
        r2.gacha_id = Some("2000".to_string());
        repo.insert_records(&[r2]).expect("写入应当成功");

        let (_bytes, report) = export_csv(&repo, Some(a1)).expect("CSV 导出应当成功");
        assert_eq!(report.accounts_exported, 1);
        assert_eq!(report.records_exported, 1);
    }

    #[test]
    fn export_unknown_account_id_returns_account_not_found() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let err = export_csv(&repo, Some(999_999)).expect_err("不存在的账号应当报错");
        assert!(matches!(
            err,
            ExportError::AccountNotFound {
                account_id: 999_999
            }
        ));
    }

    #[test]
    fn export_csv_never_includes_raw_payload_content() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let session_id = repo
            .create_collect_session(&gs_storage::NewCollectSession {
                account_id,
                started_at: CREATED_AT,
                ended_at: None,
                method: "officialApi".to_string(),
                status: "running".to_string(),
                records_new: 0,
                diagnostics: None,
            })
            .expect("创建采集会话应当成功");
        let raw_ref = repo
            .insert_raw_payload(&NewRawPayload {
                session_id,
                seq: 0,
                payload: b"SUPER_SECRET_SESSION_MARKER_12345".to_vec(),
                encoding: None,
                created_at: CREATED_AT,
            })
            .expect("写入原始报文应当成功");
        let mut record = sample_record(account_id, "301", "1400000000000000001");
        record.raw_ref = Some(raw_ref);
        repo.insert_records(&[record]).expect("写入应当成功");

        let (csv_bytes, _) = export_csv(&repo, None).expect("CSV 导出应当成功");
        let (uigf_bytes, _) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        let csv_text = String::from_utf8_lossy(&csv_bytes);
        let uigf_text = String::from_utf8_lossy(&uigf_bytes);
        assert!(!csv_text.contains("SUPER_SECRET_SESSION_MARKER"));
        assert!(!uigf_text.contains("SUPER_SECRET_SESSION_MARKER"));
        assert!(!csv_text.to_lowercase().contains("authkey"));
        assert!(!uigf_text.to_lowercase().contains("authkey"));
    }

    #[test]
    fn export_uigf_spec_compliance_count_and_rank_type_are_strings_id_matches_pattern() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        repo.insert_records(&[sample_record(account_id, "301", "1400000000000000001")])
            .expect("写入应当成功");

        let (bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1);
        let value: Value = serde_json::from_slice(&bytes).expect("应当是合法 JSON");

        assert_eq!(value["info"]["version"], serde_json::json!("v4.1"));
        assert!(
            value["info"]["export_timestamp"].as_i64().unwrap() < 10_000_000_000,
            "export_timestamp 应当是秒级，不是毫秒级"
        );

        let item = &value["hk4e"][0]["list"][0];
        assert!(item["count"].is_string(), "count 必须是字符串");
        assert!(item["rank_type"].is_string(), "rank_type 必须是字符串");
        let id = item["id"].as_str().expect("id 应当是字符串");
        assert!(
            !id.is_empty() && id.len() <= 19 && id.bytes().all(|b| b.is_ascii_digit()),
            "id 应当匹配 ^[0-9]+$ 且长度 1..=19: {id}"
        );
        let time = item["time"].as_str().expect("time 应当是字符串");
        assert!(
            gs_exchange::uigf::occurred_raw_matches_uigf_time_format(time),
            "time 应当匹配 UIGF 规范正则: {time}"
        );
    }

    #[test]
    fn export_uigf_excludes_wuwa_records_with_exact_count() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "wuwa", "300000000");
        let repo = storage.repository();
        repo.insert_records(&[
            sample_record(account_id, "1", "wuwa-1"),
            sample_record(account_id, "1", "wuwa-2"),
            sample_record(account_id, "1", "wuwa-3"),
        ])
        .expect("写入应当成功");

        let (bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 0);
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::NotInUigfScope)
            .expect("应当有 NotInUigfScope 排除桶");
        assert_eq!(bucket.count, 3, "三条鸣潮记录都应当被计入排除数");

        let value: Value = serde_json::from_slice(&bytes).expect("应当是合法 JSON");
        assert!(value.get("hk4e").is_none());
        assert!(value.get("hkrpg").is_none());
        assert!(value.get("nap").is_none());
    }

    #[test]
    fn export_uigf_excludes_zzz_102_and_103_with_exact_count_and_keeps_canonical_banners() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "zzz", "400000000");
        let repo = storage.repository();
        let mut canonical = sample_record(account_id, "2", "1900000000000000001");
        canonical.gacha_id = Some("0".to_string());
        let mut excl_102 = sample_record(account_id, "102", "1900000000000000002");
        excl_102.gacha_id = Some("0".to_string());
        let mut excl_103a = sample_record(account_id, "103", "1900000000000000003");
        excl_103a.gacha_id = Some("0".to_string());
        let mut excl_103b = sample_record(account_id, "103", "1900000000000000004");
        excl_103b.gacha_id = Some("0".to_string());
        repo.insert_records(&[canonical, excl_102, excl_103a, excl_103b])
            .expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1, "只有 banner 2 那条应当被导出");
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::ZzzGachaTypeNotInEnum)
            .expect("应当有 ZzzGachaTypeNotInEnum 排除桶");
        assert_eq!(bucket.count, 3, "102 一条 + 103 两条 = 3 条应当被排除");
        assert!(
            bucket.message.contains("规范"),
            "文案应当说明这是规范缺口，不是实现缺陷: {}",
            bucket.message
        );
    }

    #[test]
    fn export_uigf_excludes_genshin_pending_records_with_exact_count() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let mut pending_a = sample_record(account_id, "301", "1400000000000000001");
        pending_a.meta_state = MetaState::Pending;
        pending_a.item_id = "测试角色A".to_string();
        let mut pending_b = sample_record(account_id, "301", "1400000000000000002");
        pending_b.meta_state = MetaState::Pending;
        pending_b.item_id = "测试角色B".to_string();
        let complete = sample_record(account_id, "301", "1400000000000000003");
        repo.insert_records(&[pending_a, pending_b, complete])
            .expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1, "只有 Complete 的那条应当被导出");
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::GenshinItemIdUnresolved)
            .expect("应当有 GenshinItemIdUnresolved 排除桶");
        assert_eq!(bucket.count, 2);
    }

    #[test]
    fn export_uigf_excludes_records_missing_stable_id_with_exact_count() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let mut missing = sample_record(account_id, "301", "1400000000000000001");
        missing.stable_id = None;
        let present = sample_record(account_id, "301", "1400000000000000002");
        repo.insert_records(&[missing, present])
            .expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1);
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::MissingStableId)
            .expect("应当有 MissingStableId 排除桶");
        assert_eq!(bucket.count, 1);
    }

    #[test]
    fn export_uigf_excludes_records_with_invalid_occurred_raw_with_exact_count() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let mut bad = sample_record(account_id, "301", "1400000000000000001");
        bad.occurred_raw = "2026/08/10 12:00:00".to_string();
        let good = sample_record(account_id, "301", "1400000000000000002");
        repo.insert_records(&[bad, good]).expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1);
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::InvalidOccurredRaw)
            .expect("应当有 InvalidOccurredRaw 排除桶");
        assert_eq!(bucket.count, 1);
    }

    #[test]
    fn export_uigf_excludes_starrail_records_missing_gacha_id_with_exact_count() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "starrail", "200000000");
        let repo = storage.repository();
        let mut missing = sample_record(account_id, "11", "1500000000000000001");
        // gacha_id 保持 None（sample_record 默认值）。
        let mut present = sample_record(account_id, "11", "1500000000000000002");
        present.gacha_id = Some("2128".to_string());
        missing.gacha_id = None;
        repo.insert_records(&[missing, present])
            .expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 1);
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::StarrailMissingGachaId)
            .expect("应当有 StarrailMissingGachaId 排除桶");
        assert_eq!(bucket.count, 1);
    }

    #[test]
    fn export_uigf_excludes_account_when_timezone_cannot_be_determined() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = open_repo_with_account(&storage, "genshin", "100000000");
        let repo = storage.repository();
        let mut record = sample_record(account_id, "301", "1400000000000000001");
        record.tz_origin = TzOrigin::Assumed;
        record.tz_offset_min = None;
        repo.insert_records(&[record]).expect("写入应当成功");

        let (_bytes, report) = export_uigf(&repo, None).expect("UIGF 导出应当成功");
        assert_eq!(report.records_exported, 0);
        let bucket = report
            .excluded
            .iter()
            .find(|b| b.reason == ExportExclusionReason::TimezoneUnavailable)
            .expect("应当有 TimezoneUnavailable 排除桶");
        assert_eq!(bucket.count, 1);
    }
}
