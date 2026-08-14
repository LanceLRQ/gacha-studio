//! 存档导入流程：把 [`gs_exchange::ImportBatch`] 落库。
//!
//! ## 为什么必须复用采集通路，不能自建映射
//!
//! `docs/_internal/milestones/03-M2-鸣潮插件与抽象证伪.md` §4.6.3 裁定：
//! 导入必须走与采集**完全相同**的 `manifest.fields.extractRecord →
//! hooks.deriveRecordKeys`，同一条记录两边才会算出同一个 `record_key`。
//! `gs_exchange` 的适配器因此不产出 `UnifiedRecordFields`，只产出"已经还原
//! 成 API 元素形状"的 `serde_json::Value`（且已把存档的正序翻回 API 的
//! 倒序，见 `gs_exchange::wwgacha` 模块文档），本模块要做的只是把这批
//! `Value` 喂进 [`AuthkeyApiPipeline::build_records`]——采集用的同一段逻辑
//! （M2-S6 从 `collect_banner` 循环体里抽出来，见该方法文档）。若这里另起
//! 一套字段映射，`UNIQUE(account_id, record_key)` 就形同虚设：同一条实际
//! 记录会在库里存两份，这正是 HoYo.Gacha 因 `record_key` 裸用雪花 ID 付出过
//! 整表重建代价的同一类问题。
//!
//! ## 时区来源的 fail-closed
//!
//! 插件若声明 `timezoneSource: apiField`/`staticTable`，正常采集时是读
//! **页级 API 响应体**里的字段算出时区；导入路径没有响应体，但存档本身
//! 可能携带了等价的信息——[`gs_exchange::ImportAccount::tz_offset_hours`]
//! 就是这条口子（UIGF v4 的 `UigfProject.timezone` 落在这里，见
//! `gs_exchange::uigf` 模块文档）。因此这里的判断不是"插件声明了这两种
//! `timezoneSource` 就一律拒绝"，而是"**声明了这两种来源、且这批存档没有
//! 携带时区信息**才拒绝"：两个条件同时成立才 fail closed，任一条件不成立
//! 都能正常导入。
//!
//! 为什么"存档自带的偏移量"能够替代"读页级响应体"，不是"退而求其次的近似"：
//! 星铁 `apiField("region_time_zone")` 读的就是服务器时区本身；绝区零
//! `staticTable(field="region")` 是"区服码 → 偏移"的查表，UIGF 存档直接
//! 给出偏移量等价于替调用方跳过了这次查表，二者最终都归约到同一个整数小时
//! 偏移量，语义上没有损失。原神 `timezoneSource: computed` 且声明了
//! `hooks.resolveTimezone`（按 UID 首位数字推断）的分支完全不读这个参数
//! （见 [`AuthkeyApiPipeline::build_records`] 里 `tz_offset_hours` 的分支
//! 选择逻辑），因此对原神而言这个判断从一开始就不会触发——原神从来不需要
//! 这条 fail-closed 检查，不管存档带不带 `tz_offset_hours`。
//!
//! 必须显式失败（当存档确实没有携带时区信息时），不能静默传 `None`：静默
//! 传的后果是时间按"无时区"归一化、`tz_origin` 落成不真实的 `Assumed`，
//! 且这一切不报错——正是本项目反复记录的"门之所以通过，是因为它什么都没
//! 检查"这类失效模式。检查逻辑见
//! [`AuthkeyApiPipeline::timezone_source_requires_page_response`] 的文档。
//! `computed` 分支走 hook、不依赖响应体，可以正常支持；未声明（`None`）
//! 也正常，两者都返回 `false`，不受这条 fail-closed 检查影响。

use gs_core::{GachaRecord, RecordSource};
use gs_exchange::ImportBatch;
use gs_p_authkey::{AuthkeyApiPipeline, PipelineError};
use gs_storage::Repository;

/// 一次导入的结果小结。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportSummary {
    /// 本次导入涉及的记录总数（跨全部卡池累加，写库前的原始条数）。
    pub records_seen: u64,
    /// 实际新增落库的行数——`INSERT OR IGNORE` 命中 `UNIQUE(account_id,
    /// record_key)` 的行不计入，见 [`Repository::insert_records`]。
    pub records_inserted: u64,
    /// `records_seen - records_inserted`：因去重被跳过的行数。多数情况下
    /// 就是"这批记录已经导入过一次"的直接证据（幂等性）。
    pub records_skipped: u64,
}

/// 导入流程失败原因。
#[derive(Debug)]
pub enum ImportError {
    /// 插件的 `time.timezoneSource` 声明为 `apiField`/`staticTable`，需要
    /// 时区信息才能正确归一化时间，但这批存档既没有页级 API 响应体、也没有
    /// 自带 `tz_offset_hours`——两个条件同时成立才会走到这个变体，见模块
    /// 文档"时区来源的 fail-closed"一节。
    TimezoneUnavailable { plugin_id: String },
    /// 复用采集通路（[`AuthkeyApiPipeline::build_records`]）时失败：字段
    /// 映射、record_key 派生等环节报错都归到这里，不重新分类——
    /// [`PipelineError`] 自身的变体已经足够具体。
    Pipeline(PipelineError),
    /// 落库失败。
    Storage(gs_core::GsError),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TimezoneUnavailable { plugin_id } => write!(
                f,
                "插件 \"{plugin_id}\" 的时区来源声明（timezoneSource: apiField/staticTable）\
                 需要时区信息，而这份存档没有携带——既没有页级 API 响应体，也没有自带时区偏移"
            ),
            Self::Pipeline(err) => write!(f, "{err}"),
            Self::Storage(err) => write!(f, "导入流程存储层失败：{err}"),
        }
    }
}

impl std::error::Error for ImportError {}

impl From<PipelineError> for ImportError {
    fn from(err: PipelineError) -> Self {
        Self::Pipeline(err)
    }
}

impl From<gs_core::GsError> for ImportError {
    fn from(err: gs_core::GsError) -> Self {
        Self::Storage(err)
    }
}

/// 把 `batch` 落库：对每个卡池调用与采集完全相同的
/// [`AuthkeyApiPipeline::build_records`]，`source` 固定为
/// [`RecordSource::Import`]。
///
/// `pipeline` 必须已经按 `batch.game_id` 对应的插件构造好——本函数不做
/// "batch 归属哪个插件"的路由，那是调用方（未来的 IPC 命令层）的职责，
/// 与 `AuthkeyApiPipeline::collect_banner` 也不负责"该用哪个插件"是同一
/// 分工。
///
/// # 原子性：整批要么全部落库，要么一行都不落
///
/// 现状（改前）：`for banner in &batch.banners` 循环体内逐卡池调用
/// `insert_records`，若第 3 个卡池在 `build_records` 阶段失败（例如某条
/// 记录字段不满足插件契约），前两个卡池已经写入数据库，调用方拿到 `Err`
/// 却读不到"哪些已经落库、哪些没有"，留下一个不上不下的部分导入状态。
///
/// [`Repository`] 没有对外暴露事务/SAVEPOINT 原语——`conn` 字段是
/// `gs-storage` crate 私有的（`crates/gs-storage/src/repository.rs:371`），
/// 本函数所在的改动范围不包含 gs-storage，没有办法像
/// [`Repository::insert_records`] 内部（`repository.rs:414-436`）那样直接
/// 对连接发 `SAVEPOINT`/`ROLLBACK TO`/`RELEASE` SQL。改用一种不需要连接
/// 访问权限也能达到同等原子性的顺序：先把全部卡池的 [`GachaRecord`] 都
/// 构建完——`build_records` 是纯计算，不接触数据库——任何一个卡池构建失败
/// 就直接返回 `Err`，此时还没有调用过一次 `insert_records`，数据库里自然
/// 没有本次导入的任何一行；全部卡池都构建成功后，再对合并后的整批记录只
/// 调用一次 [`Repository::insert_records`]（该方法自己在超过 SQLite
/// 变量数上限时会分块并包一层 SAVEPOINT，行为不变，也不受这里改动影响）。
/// 落库这一步因此要么整批发生要么整批不发生，效果上不弱于"整个循环外包
/// 一层 SAVEPOINT"——中途构建失败时数据库甚至连一次写入尝试都没有发生过。
pub fn import_batch(
    batch: &ImportBatch,
    pipeline: &AuthkeyApiPipeline<'_>,
    repo: &Repository<'_>,
    account_id: i64,
    captured_at: i64,
) -> Result<ImportSummary, ImportError> {
    // fail-closed 检查必须在处理任何一个卡池之前做：这是插件声明本身与
    // 这批存档账号信息的属性，与某个具体卡池是否有记录无关，不该等翻到
    // 某一页才发现"这批数据其实没法算时区"。两个条件同时成立才拒绝——见
    // 模块文档"时区来源的 fail-closed"一节。
    if pipeline.timezone_source_requires_page_response() && batch.account.tz_offset_hours.is_none()
    {
        return Err(ImportError::TimezoneUnavailable {
            plugin_id: pipeline.plugin_id().to_string(),
        });
    }

    let uid = batch.account.uid.as_str();
    let region = batch.account.region.as_deref();

    let mut records_seen: u64 = 0;
    let mut all_records: Vec<GachaRecord> = Vec::new();

    for banner in &batch.banners {
        records_seen += banner.records.len() as u64;

        // lang：导入路径没有采集会话那样的凭据 URL 可以现取 &lang= 参数，
        // 存档本身也不携带语言信息（`GameUser.cs` 没有这个字段）——留空，
        // 是诚实地表达"确实没有"，不编造一个默认语言。
        //
        // page_tz_offset_hours：改传 `batch.account.tz_offset_hours`，不再
        // 硬编码 `None`——存档自带时区偏移的情况下（如 UIGF），这就是那个
        // 偏移量本身；存档不携带时区信息的情况下（如 wwgacha）,这里是
        // `None`，效果与改前完全一致。`computed` 分支（原神）走 hook、
        // 完全不读这个参数，传什么都无副作用；`apiField`/`staticTable`
        // 分支（星铁/绝区零）若真的传了 `None` 到这里，说明上面的
        // fail-closed 检查已经先一步拦下了，不会执行到这一行。
        let built: Vec<GachaRecord> = pipeline.build_records(
            &banner.records,
            &banner.banner_id,
            account_id,
            uid,
            region,
            None,
            captured_at,
            batch.account.tz_offset_hours,
            RecordSource::Import,
        )?;

        all_records.extend(built);
    }

    // 全部卡池都构建成功之后才发生第一次、也是唯一一次写入——见函数文档
    // "原子性"一节。
    let records_inserted = repo.insert_records(&all_records)?;

    Ok(ImportSummary {
        records_seen,
        records_inserted,
        records_skipped: records_seen - records_inserted,
    })
}
