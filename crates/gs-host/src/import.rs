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
//!
//! ## 同秒内序位漂移的 fail-closed
//!
//! 鸣潮这类声明了批处理 `hooks.deriveRecordKeys` 的插件（判据见
//! [`AuthkeyApiPipeline::has_derive_record_keys`]），
//! `record_key = hash(卡池、规范化时间、物品、组内序位)`，"组内序位"是
//! **正序遍历该分组第几次出现**，从 0 开始计数。这个序位只受"同一分组内
//! 更早成员"的数量影响，因此两个记录集合对同一条记录算出不同的序位，
//! 当且仅当该记录所在分组在两个集合里的成员数不同——而分组只可能在集合的
//! **时间边界**被截断（分组内部若整体缺失，说明中间有记录被完全丢弃，属于
//! 另一类问题，不是本检查要处理的场景）。采集侧已经在插件构造期堵死了
//! "批处理序位 + 增量提前终止"这个组合（`gs_p_authkey` 里
//! `validate_batch_record_keys_not_combined_with_reached_known_stop_condition`
//! 的文档有完整论证），但导入路径没有等价的防线：调用方完全可以把两份
//! 边界不同的存档片段（或一份存档 + 一次增量采集）分两次导入到同一个账号
//! 同一个卡池，只要这两份片段在**任意一个重叠的秒**上成员数不一致，这一秒
//! 里的序位就会在两次导入之间算出不同的值——`INSERT OR IGNORE` 撞不上就
//! 静默重复入库，不会报错，用户看到的只是"这次导入多了几条一模一样的
//! 记录"。
//!
//! ### 检查范围：批次时间区间内、库中也有记录的每一秒
//!
//! 判据：对本批 `[min(occurred_raw), max(occurred_raw)]` 区间内、**库中与
//! 本批都有记录**的每一秒，按 item_id 逐项比对条数，必须完全相等；任一秒
//! 不等即拒绝。三种情况分别讨论：
//! - 某秒**两边都有**记录：条数逐 item_id 相等 ⇔ 分组一致 ⇔ 序位一致——
//!   相等则安全，不等则必须拒绝；
//! - 某秒**只有本批有**、库中没有：这一组是本批新写入的，序位由本批自己
//!   算出，不会与任何已有记录发生冲突——放行；
//! - 某秒**只有库中有**、本批没有：本批根本不触碰这一秒——放行。
//!
//! 只处理"两边都有"的秒，是因为序位漂移的成因是"同一个分组在两次落库之间
//! 用不同的成员集合重新计算了序位"，这件事只可能发生在两次落库都写过这一
//! 秒的场景；任一侧缺席，就没有"重新计算"这回事。
//!
//! "这一秒同 item_id 的条数是否与本批一致"是**充分**条件，不是必要条件：
//! 同一分组内逐字段完全相同的记录彼此可互换（同上那条采集侧校验的文档与
//! 鸣潮真实存档审计已经论证过这一点——组内成员互换不改变 key 的多重集），
//! 因此条数一致就足以保证落库结果正确，不需要也无法进一步比较"顺序是否
//! 也一致"（`seq_in_batch` 这一列在库里恒为 `None`，见
//! [`AuthkeyApiPipeline::build_records`] 里那一行旁的注释，没有任何东西能
//! 反过来验证顺序）。
//!
//! ### 教训：曾经"只检查最早一秒"，为什么当时看起来对、错在哪
//!
//! 第一版实现只查"本批最早一秒"，论证是：本批记录内部不残缺（一次
//! [`AuthkeyApiPipeline::build_records`] 调用要么是整份存档卡池、要么是
//! 一次 API 分页采集的一页，不会漏记录），因此本批与库之间唯一可能不一致
//! 的边界，只有本批最早那一分组——更晚的分组只要出现在这批记录里就是完整
//! 的，不会因为跨集合合并而改变序位。
//!
//! 这句论证只证明了**批次侧**完整，却默认了**库侧在本批覆盖的每一秒上都
//! 同样完整**——这个前提并不成立：库是跨多次导入累积出来的，完全可能只在
//! 某一段时间范围内完整，另一段范围是早先一次残缺导入留下的片段。
//!
//! 具体反例：先导入一份只覆盖 S3~S5、且 S3 这一组本身残缺（只含分组里靠后
//! 的成员）的存档片段——库此时在 S3 上"有记录"，但不完整。再导入一份覆盖
//! S1~S5、S3 这一组完整的更全批次：它的"最早一秒"是 S1，库中 S1 没有任何
//! 记录，旧实现一看"库里这一秒没有记录"就直接放行，完全没有检查 S3——那里
//! 库中已有的（残缺）成员数与本批（完整）成员数明显不同，序位早已漂移，
//! 却因为检查只盯着"最早一秒"而被放过。触发这个序列的真实用法是"先导入
//! 伙伴工具存档（覆盖近 3 个月），之后导入更全的存档或走整池全量采集
//! （覆盖 6 个月）"——这是本项目用户明确说过的用法，不是边角情况。
//!
//! 判定"同一秒"按 `occurred_raw`（原始时间字符串）做字符串精确匹配，不按
//! `occurred_at`（归一化后的 UTC 毫秒）——完整论证见
//! [`gs_storage::Repository::count_records_by_occurred_raw_range`] 的文档。

use std::collections::BTreeMap;

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
    /// 插件声明了批处理 `hooks.deriveRecordKeys`
    /// （[`AuthkeyApiPipeline::has_derive_record_keys`] 为真）时，本批时间
    /// 区间内**某一个库中也有记录的秒**，按 item_id 分组统计出的条数与库中
    /// 不一致——说明这一秒的成员集合在两次采集/导入之间发生了变化，
    /// `record_key` 里的"组内序位"分量会因此在两次导入间漂移。完整论证见
    /// 模块文档"同秒内序位漂移的 fail-closed"一节。
    ///
    /// 一批里可能有多个秒不一致，这里只报**时间上最早**的那一个：报全部会
    /// 让错误信息在整份存档不匹配时长到没法读，而用户的补救动作（清空重导
    /// 或整池采集）对一个和十个不一致是同一个动作，多报没有额外价值。
    SecondCountMismatch {
        plugin_id: String,
        banner_key: String,
        /// 触发检查的那一秒的原始时间字符串（对应 `GachaRecord::occurred_raw`）。
        occurred_raw: String,
        /// 逐 item_id 的 `(item_id, db_count, batch_count)`。库中有但本批
        /// 没有、本批有但库中没有的两种不对称情况都算不一致，都会出现在
        /// 这里（缺失的一侧计数填 0），不只挑"两边都有但数字不同"的那种。
        mismatches: Vec<(String, i64, i64)>,
    },
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
            Self::SecondCountMismatch {
                plugin_id,
                banner_key,
                occurred_raw,
                mismatches,
            } => {
                let detail = mismatches
                    .iter()
                    .map(|(item_id, db_count, batch_count)| {
                        format!("itemId=\"{item_id}\" 库中 {db_count} 条/本批 {batch_count} 条")
                    })
                    .collect::<Vec<_>>()
                    .join("；");
                write!(
                    f,
                    "插件 \"{plugin_id}\" 卡池 \"{banner_key}\" 在时间 \"{occurred_raw}\" \
                     这一秒的记录数与库中已有记录不一致（{detail}）——该插件的 record_key 由 \
                     hooks.deriveRecordKeys 批处理计算，含有同秒内的组内序位分量，这个序位的\
                     正确性建立在\"每次都能看到这一秒完整记录集合\"的前提上；一旦这一秒的成员\
                     集合在两次导入/采集之间发生变化，序位会重新计算并漂移，撞键的记录会被 \
                     INSERT OR IGNORE 静默重复入库，不会报错。两条可行的出路：① 先清空该账号\
                     该卡池的记录，再把这批数据整份重新导入一次；② 改走整池全量采集，不要用\
                     增量或局部存档片段合并。"
                )
            }
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
///
/// `insert_records` 成功之后还有一次派生写入：[`persist_collection_bounds`]
/// 把本批 `occurred_at` 的极值并入账号的采集边界。这次写入不参与上面的
/// "整批发生/不发生"讨论——它读的是已经落库成功的 `all_records`，失败只会
/// 让账号的采集边界这一次没跟上（下次导入/采集会重新尝试合并），不会让已经
/// 成功写入的记录本身出现不一致。
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

        // lang：从 `batch.account.lang` 读取，不再固定传 `None`。
        //
        // 两种存档格式在这里的取值不同，都是各自诚实的表达：wwgacha 存档
        // 确实不携带语言信息（`GameUser.cs` 没有这个字段），`ImportAccount.
        // lang` 恒为 `None`；UIGF v4 存档的 `UigfProject.lang` 字段本身
        // 携带这个信息，`gs_exchange::uigf` 的三个 `*_project_to_batch`
        // 把它原样填进 `ImportAccount.lang`（不在那里归一化，见该字段
        // 文档），这里直接透传。
        //
        // 归一化保证：不管这个参数是 `None` 还是 `Some(_)`，都会经过
        // `AuthkeyApiPipeline::build_records` 里唯一的赋值点做语言代码别名
        // 归一化（`gs_p_authkey` crate 内部的 `locale` 模块，见
        // `build_records` 那一行旁的注释）——本函数不需要、也不应该在这里
        // 重复归一化一遍。空字符串（UIGF 声明了空 `lang` 时）同样原样
        // 传下去，最终由 `Repository::insert_records` 内部的
        // `normalize_empty` 在落库前统一规整成 `NULL`，这里不用提前处理。
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
            batch.account.lang.as_deref(),
            captured_at,
            batch.account.tz_offset_hours,
            RecordSource::Import,
        )?;

        // 同秒内序位漂移检查——只读，不写库，天然兼容上面"原子性"一节的
        // 顺序：仍在把 built 并入 all_records 之前，构建阶段任何一步失败
        // （包括这里）都还没有调用过一次 insert_records。只在插件声明了
        // 批处理 hooks.deriveRecordKeys 时才需要检查，见模块文档"同秒内
        // 序位漂移的 fail-closed"一节。
        if pipeline.has_derive_record_keys() {
            reject_second_count_mismatch(&built, pipeline.plugin_id(), repo, account_id)?;
        }

        all_records.extend(built);
    }

    // 全部卡池都构建成功之后才发生第一次、也是唯一一次写入——见函数文档
    // "原子性"一节。
    let records_inserted = repo.insert_records(&all_records)?;

    // 写入账号的采集边界（earliest_record_at / latest_record_at）——这是
    // `gs_host::retention::evaluate_account_retention_risk` 的驱动字段之一
    // 得以有真实数据可用的唯一生产写入点，完整背景见该模块文档。
    persist_collection_bounds(repo, account_id, &all_records)?;

    Ok(ImportSummary {
        records_seen,
        records_inserted,
        records_skipped: records_seen - records_inserted,
    })
}

/// 把 `records` 的 `occurred_at` 极值并入账号已有的采集边界并落库。
///
/// # 为什么用 `all_records`（构建结果）而不是"只统计本次新插入的行"
///
/// 撞 `UNIQUE(account_id, record_key)` 被 `INSERT OR IGNORE` 跳过的记录，
/// 说明"我们已经见过这条记录"这件事本身并没有因为这次是重复导入而失真——
/// 它的 `occurred_at` 依然是我们对官方数据认知范围的有效证据。按"只统计
/// 新插入的行"来算边界，会让重复导入同一份存档时边界完全不更新，这与
/// "这次导入让我们对已知范围的认知更牢固"这件事实不符。
///
/// # 为什么不写 `last_collected_at`
///
/// 见 [`Repository::touch_account_collection_bounds`] 的文档与
/// `gs_host::retention` 模块文档的反例②：导入只能证明"我们见过这些记录"，
/// 证明不了"官方现在没有更晚的数据"——今天导入一份半年前导出的存档，不等于
/// 今天对官方接口采集过一次。这一列留给尚未接线的 S3 采集路径。
///
/// # 为什么在这里取 min/max，而不是让 `touch_account_collection_bounds`
/// 自己比较
///
/// 该方法的 `COALESCE` 语义是"传 `Some` 就无条件覆盖"，不做大小比较——见
/// 该方法文档"调用方必须自己算好『是否应当覆盖』"一节。本函数因此要先
/// `find_account` 读一次账号当前的边界，与本批记录的极值取 min/max 后，
/// 再把算好的结果传下去。
fn persist_collection_bounds(
    repo: &Repository<'_>,
    account_id: i64,
    records: &[GachaRecord],
) -> Result<(), ImportError> {
    let Some((batch_earliest, batch_latest)) = occurred_at_bounds(records) else {
        // 本批没有任何记录（如某个 batch.banners 为空）：没有新的边界信息，
        // 不产生任何写入，也不需要 fail——空批次不是错误。
        return Ok(());
    };

    let existing = repo.find_account(account_id)?;
    let (existing_earliest, existing_latest) = existing
        .map(|account| (account.earliest_record_at, account.latest_record_at))
        .unwrap_or((None, None));

    let merged_earliest = match existing_earliest {
        Some(current) => current.min(batch_earliest),
        None => batch_earliest,
    };
    let merged_latest = match existing_latest {
        Some(current) => current.max(batch_latest),
        None => batch_latest,
    };

    repo.touch_account_collection_bounds(
        account_id,
        None, // 导入路径不写 last_collected_at，见本函数文档。
        Some(merged_earliest),
        Some(merged_latest),
    )?;
    Ok(())
}

/// 一批记录里 `occurred_at` 的 `(最小值, 最大值)`；空切片返回 `None`。
fn occurred_at_bounds(records: &[GachaRecord]) -> Option<(i64, i64)> {
    let mut iter = records.iter().map(|r| r.occurred_at);
    let first = iter.next()?;
    Some(iter.fold((first, first), |(min, max), value| {
        (min.min(value), max.max(value))
    }))
}

/// [`import_batch`] 循环体内、每个卡池构建完成后调用一次的检查：本批时间
/// 区间内、库中也有记录的每一秒，按 item_id 逐项比对条数是否一致。完整论证
/// 见模块文档"同秒内序位漂移的 fail-closed"一节。
///
/// 先按 `banner_key` 分桶再逐桶检查，而不是把 `built` 当成同一个卡池处理：
/// 一次 [`AuthkeyApiPipeline::build_records`] 的产出**未必同属一个卡池**——
/// `bannerIdentity` 缺省或声明为 `Response` 时，`banner_key` 取自每条记录
/// 自己的字段（`gs_p_authkey` 里 `banner_identity_key = fields.banner_id`），
/// 原神那种"一次查询回来的记录混着 400 与 301"就会落成两个 banner_key。
/// 而去重契约 `UNIQUE(account_id, record_key)` 里的卡池维度是由插件在合成
/// record_key 时纳入的，本检查的分组键必须跟它对齐；混在一起比对会把两个
/// 卡池在同一秒的记录算成同一组，得出的条数根本不是 `deriveRecordKeys`
/// 眼中的那个分组。
fn reject_second_count_mismatch(
    built: &[GachaRecord],
    plugin_id: &str,
    repo: &Repository<'_>,
    account_id: i64,
) -> Result<(), ImportError> {
    let mut by_banner: BTreeMap<&str, Vec<&GachaRecord>> = BTreeMap::new();
    for record in built {
        by_banner
            .entry(record.banner_key.as_str())
            .or_default()
            .push(record);
    }

    // BTreeMap 迭代按 banner_key 升序，多个卡池同时不一致时报的永远是同一个，
    // 不随 HashMap 遍历顺序漂移——错误信息可复现，用户重跑一次看到的是同一条。
    for (banner_key, records) in by_banner {
        reject_second_count_mismatch_for_banner(&records, plugin_id, banner_key, repo, account_id)?;
    }
    Ok(())
}

/// 单个卡池维度的检查主体，见 [`reject_second_count_mismatch`] 的文档。
fn reject_second_count_mismatch_for_banner(
    records: &[&GachaRecord],
    plugin_id: &str,
    banner_key: &str,
    repo: &Repository<'_>,
    account_id: i64,
) -> Result<(), ImportError> {
    // 空桶没有时间区间可言。分桶来自 `built` 自身，正常不会为空，
    // 但用 `let else` 而不是 `unwrap` —— 这里不值得为一个不变量 panic。
    let Some(range_start) = records.iter().map(|r| r.occurred_raw.as_str()).min() else {
        return Ok(());
    };
    let range_end = records
        .iter()
        .map(|r| r.occurred_raw.as_str())
        .max()
        .expect("min 已确认非空，同一迭代器的 max 必然也有值");

    let db_rows =
        repo.count_records_by_occurred_raw_range(account_id, banner_key, range_start, range_end)?;
    if db_rows.is_empty() {
        // 库中这个区间完全没有记录：不存在"跨集合合并"，天然放行。
        return Ok(());
    }

    let mut db_counts: BTreeMap<&str, BTreeMap<&str, i64>> = BTreeMap::new();
    for (occurred_raw, item_id, count) in &db_rows {
        db_counts
            .entry(occurred_raw.as_str())
            .or_default()
            .insert(item_id.as_str(), *count);
    }

    let mut batch_counts: BTreeMap<&str, BTreeMap<&str, i64>> = BTreeMap::new();
    for record in records {
        *batch_counts
            .entry(record.occurred_raw.as_str())
            .or_default()
            .entry(record.item_id.as_str())
            .or_insert(0) += 1;
    }

    // 只遍历本批出现过的秒：库中有而本批没有的秒，本批根本不触碰它，
    // 不可能让它的序位重算。BTreeMap 迭代按 occurred_raw 升序，而
    // occurred_raw 是零填充定宽串（字符串序等价于时间序），所以报出来的
    // 是时间上**最早**的那个不一致的秒，不是随机一个。
    for (occurred_raw, batch_for_second) in &batch_counts {
        let Some(db_for_second) = db_counts.get(occurred_raw) else {
            // 只有本批有、库中没有：这一组由本批新写入，序位由本批自己算出，
            // 不存在"用不同成员集合重算同一组"的问题。
            continue;
        };

        let mismatches = collect_item_count_mismatches(db_for_second, batch_for_second);
        if !mismatches.is_empty() {
            return Err(ImportError::SecondCountMismatch {
                plugin_id: plugin_id.to_string(),
                banner_key: banner_key.to_string(),
                occurred_raw: (*occurred_raw).to_string(),
                mismatches,
            });
        }
    }

    Ok(())
}

/// 比对同一秒内库侧与批次侧的逐 item_id 条数，返回全部不一致项。
///
/// 双向覆盖：库中有但本批没有、本批有但库中没有的 item_id 都要落进比较
/// 范围，缺失的一侧按 0 处理——只比"两边都有的 item_id"会漏掉整组消失或
/// 整组新增这两种最严重的不一致。
fn collect_item_count_mismatches(
    db_for_second: &BTreeMap<&str, i64>,
    batch_for_second: &BTreeMap<&str, i64>,
) -> Vec<(String, i64, i64)> {
    let mut item_ids: Vec<&str> = batch_for_second
        .keys()
        .chain(db_for_second.keys())
        .copied()
        .collect();
    item_ids.sort_unstable();
    item_ids.dedup();

    item_ids
        .into_iter()
        .filter_map(|item_id| {
            let db_count = db_for_second.get(item_id).copied().unwrap_or(0);
            let batch_count = batch_for_second.get(item_id).copied().unwrap_or(0);
            if db_count == batch_count {
                None
            } else {
                Some((item_id.to_string(), db_count, batch_count))
            }
        })
        .collect()
}
