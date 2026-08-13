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
//! 导入路径拿不到页级 API 响应体，插件若声明 `timezoneSource: apiField` 或
//! `staticTable`，导入时根本取不到时区——这两个分支都要读响应体里的字段。
//! 必须显式失败，不能静默传 `None`：静默传的后果是时间按"无时区"归一化、
//! `tz_origin` 落成不真实的 `Assumed`，且这一切不报错——正是本项目反复记录
//! 的"门之所以通过，是因为它什么都没检查"这类失效模式。检查逻辑见
//! [`AuthkeyApiPipeline::timezone_source_requires_page_response`] 的文档。
//! `computed` 分支走 hook、不依赖响应体，可以正常支持；未声明（`None`）
//! 也正常，两者都返回 `false`。

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
    /// 插件的 `time.timezoneSource` 声明为 `apiField`/`staticTable`，但
    /// 导入路径没有页级 API 响应体可读，当前无法支持——fail closed，见
    /// 模块文档"时区来源的 fail-closed"一节。
    TimezoneSourceRequiresApiResponse { plugin_id: String },
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
            Self::TimezoneSourceRequiresApiResponse { plugin_id } => write!(
                f,
                "插件 \"{plugin_id}\" 的时区来自 API 响应字段（timezoneSource: \
                 apiField/staticTable），导入路径没有响应体，当前无法支持"
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
pub fn import_batch(
    batch: &ImportBatch,
    pipeline: &AuthkeyApiPipeline<'_>,
    repo: &Repository<'_>,
    account_id: i64,
    captured_at: i64,
) -> Result<ImportSummary, ImportError> {
    // fail-closed 检查必须在处理任何一个卡池之前做：这是插件声明本身的
    // 属性，与某个具体卡池是否有记录无关，不该等翻到某一页才发现"这批
    // 数据其实没法算时区"。
    if pipeline.timezone_source_requires_page_response() {
        return Err(ImportError::TimezoneSourceRequiresApiResponse {
            plugin_id: pipeline.plugin_id().to_string(),
        });
    }

    let uid = batch.account.uid.as_str();
    let region = batch.account.region.as_deref();

    let mut records_seen: u64 = 0;
    let mut records_inserted: u64 = 0;

    for banner in &batch.banners {
        records_seen += banner.records.len() as u64;

        // lang：导入路径没有采集会话那样的凭据 URL 可以现取 &lang= 参数，
        // 存档本身也不携带语言信息（`GameUser.cs` 没有这个字段）——留空，
        // 是诚实地表达"确实没有"，不编造一个默认语言。
        //
        // page_tz_offset_hours：上面的 fail-closed 检查已经排除了"插件
        // 需要页级响应体才能算出时区"这一种情况——这里传 `None` 对应的是
        // `build_records` 里 `_ => page_tz_offset_hours` 分支，与
        // `timezoneSource` 未声明时采集路径本来的取值完全相同，不是新引入
        // 的降级。
        let built: Vec<GachaRecord> = pipeline.build_records(
            &banner.records,
            &banner.banner_id,
            account_id,
            uid,
            region,
            None,
            captured_at,
            None,
            RecordSource::Import,
        )?;

        records_inserted += repo.insert_records(&built)?;
    }

    Ok(ImportSummary {
        records_seen,
        records_inserted,
        records_skipped: records_seen - records_inserted,
    })
}
