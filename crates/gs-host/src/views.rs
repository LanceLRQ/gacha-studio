//! IPC 视图类型——前端 webview 与 Rust 宿主之间那条边界上传输的形状。
//!
//! # 为什么不放进 `gs-plugin-kit`
//!
//! `gs-plugin-kit` 按 `CLAUDE.local.md` 的定义是「插件作者唯一需要依赖的 TS
//! 包」，里面装的是**插件契约**。IPC 视图类型是应用内部的东西，插件作者
//! 既看不到也用不着，塞进去是分类错误。
//!
//! 还有一层机械原因：HC-3 门禁对 `packages/gs-plugin-kit/types/generated.ts`
//! 导出的**每一个**类型都要求 `schema/index.ts` 里有对应的 zod schema
//! （`scripts/gs-check/checks/codegen-diff.mjs` 的第 ③ 项检查）。那道检查
//! 是为「插件产出的数据不可信、入库前必须运行时校验」设计的；IPC 视图
//! 类型是**宿主自己 serde 序列化出去的**，给它们写 zod 等于用运行时校验去
//! 验自己的输出，是仪式不是防线。把它们放进那个文件，只会逼着人要么写一堆
//! 无意义的 schema、要么去削弱那道门——两条都不该走，所以另开一份产物。
//!
//! 产物落 `web/src/lib/ipc/generated.ts`，唯一消费者是前端。它同样被
//! HC-3 的「重跑 codegen 后 `git status --porcelain` 必须为空」覆盖，手改
//! 会被抓。
//!
//! # 为什么记录直接复用 `GachaRecord` 而不另造 `RecordView`
//!
//! `GachaRecord` 的字段（时间三元组、`meta_state`、`source`、`extra`）恰好
//! 就是界面要展示的全部内容，另造一个视图类型只会得到一份逐字段抄写的
//! 副本，以及一处将来必然会忘记同步的地方。前端 `lib/mock-data.ts` 早就
//! 直接用 `GachaRecord` 建模记录了。

use serde::Serialize;
use ts_rs::TS;

/// 账号列表项。
///
/// 不直接复用 `gs_storage::Account`：那个类型是存储层的行映射，没有
/// `record_count`（界面要用它显示"这个账号有多少条记录"，而那是一次
/// `COUNT(*)` 查询的产物，不是 `account` 表的列），也不该为了前端需要
/// 而给存储层的行结构体加派生字段。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: i64,
    /// 归属插件，即游戏标识（`genshin` / `wuwa` / `starrail` / `zzz`）。
    pub plugin_id: String,
    pub game_uid: String,
    pub region: String,
    pub display_name: Option<String>,
    /// 上次采集时间（毫秒时间戳）。从未采集过为 `None`——**不要**在这里
    /// 填 0 冒充"很久以前"，界面需要区分"没采过"和"很久没采了"，前者该
    /// 引导用户去采集，后者该告警保留期。
    pub last_collected_at: Option<i64>,
    /// 库中该账号最早一条记录的时间，供保留期告警计算用。
    pub earliest_record_at: Option<i64>,
    /// 该账号名下的记录总数。
    pub record_count: i64,
    /// 保留期风险评估，由 [`gs_analysis::retention_policy_for`] 声明的
    /// 保守天数与本账号的采集边界推算，见 `gs_host::retention` 模块文档。
    ///
    /// `None` 表示"无法评估"，**不是"安全"**——插件没有声明保留期策略
    /// （如鸣潮）、或该账号还一条记录都没有时，都没有可靠的判断依据，
    /// 编一个等级出来（无论安全还是告警）都是给用户一个假象。
    pub retention_risk: Option<RetentionRiskView>,
}

/// 保留期风险等级。三档对应"还有充裕缓冲 / 该去采集了 / 保守估计已超期"。
///
/// 只有三档、没有第四档"未知"——"无法评估"这件事由外层 `Option` 表达
/// （见 [`AccountView::retention_risk`]），不塞进这个枚举里：等级本身要回答
/// 的是"风险有多急"，与"有没有能力回答这个问题"是两个维度，混在一起会让
/// 消费方每次 match 这个枚举时都要顺带处理一个语义完全不同的"哨兵值"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum RetentionRiskLevel {
    /// 距保守估计的过期时刻还有 30 天以上缓冲。
    Safe,
    /// 缓冲已经进入 30 天以内（含 0 天）——该提醒用户尽快采集了。
    Watch,
    /// 已经超出保守估计的保留期。**不是"数据已丢失"的断言**——保留期本身
    /// 是保守估计，服务端实际策略可能比这个估计更宽松；措辞与
    /// [`AccountView::retention_risk`] 一致，一律说"可能已丢失"。
    Alert,
}

/// 单个账号的保留期风险评估结果，[`RetentionRiskLevel`] 的三档判据与
/// `possible_loss_from`/`possible_loss_to` 的取值来源见
/// `gs_host::retention::evaluate_account_retention_risk` 的文档。
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RetentionRiskView {
    pub level: RetentionRiskLevel,
    /// 距"最早本地记录理论过期时刻"还剩的天数，可能为负——为负表示已经
    /// 超出保守估计的保留期（对应 [`RetentionRiskLevel::Alert`]）。
    pub remaining_days: i64,
    /// 仅 [`RetentionRiskLevel::Alert`] 时有值：这段时间区间内发生的记录，
    /// 按保留期保守估计**可能**已经无法再从官方接口取回（UTC 毫秒，闭区间）。
    /// 措辞刻意用"可能"——不断言"已丢失"，见字段所在结构体的文档。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub possible_loss_from: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub possible_loss_to: Option<i64>,
}

/// 一页记录。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecordPage {
    /// 当前筛选条件下的记录总数，供界面算总页数。
    pub total: i64,
    /// 页码，从 0 开始。
    pub page: i64,
    /// 每页条数。**这是宿主实际采用的值，不一定等于调用方传入的值**——
    /// 调用方传入的值会被夹到上限，界面应当以返回值为准显示分页器，
    /// 而不是拿自己传出去的那个数去算。
    pub page_size: i64,
    /// 裸名引用 `GachaRecord`——它属于另一份产物（`gs-plugin-kit/types`），
    /// 由生成文件头部的 `import type` 引进来，见 `gs-codegen` 的 `IPC_HEADER`。
    #[ts(type = "GachaRecord[]")]
    pub records: Vec<gs_core::GachaRecord>,
}

/// 一次导入的结果。一份存档可能同时携带多个游戏/多个账号的数据
/// （UIGF v4 的 `hk4e` + `hkrpg` + `nap` 就是这样），因此是一个列表。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// 嗅探命中的交换格式 id（`uigf` / `wwgacha`）。界面用它告诉用户
    /// "我把这份文件当成什么格式读的"——读错格式却读出了东西，是最难
    /// 自查的一类错误，把判断结果摆出来让用户能一眼否掉。
    pub format_id: String,
    pub accounts: Vec<ImportedAccountReport>,
}

/// 导入结果里单个账号的部分。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAccountReport {
    pub game_id: String,
    pub uid: String,
    /// 落库后的账号主键。存档里的账号在本地不存在时会新建，已存在则复用。
    pub account_id: i64,
    pub records_seen: u64,
    pub records_inserted: u64,
    /// `records_seen - records_inserted`：撞 `UNIQUE(account_id, record_key)`
    /// 被 `INSERT OR IGNORE` 跳过的条数。**重复导入同一份存档时这个数等于
    /// 总数是正常的**，不是错误，界面文案不要写成"失败"。
    pub records_skipped: u64,
}

/// 一款已注册插件（游戏）的展示元数据。
///
/// 前端拿不到插件 manifest 本身——manifest 打包进
/// `crates/gs-plugin-runtime/generated/plugins.bundle.js` 只给 QuickJS
/// 用，`web/` 的 `tsconfig` 只 `include` 了 `src`。游戏展示名、稀有度档位
/// （米哈游三游是 `["3","4","5"]`，绝区零是 `["2","3","4"]`，**不假设长度
/// 或具体取值**）、卡池展示名因此必须从 Rust 侧透出，这个类型就是那道投影。
///
/// `rarity`/`banners` 直接复用 [`gs_core::RaritySpec`]/[`gs_core::BannerSpec`]
/// ——manifest 纯数据 JSON 反序列化出来的就是这两个领域类型本身（见
/// `gs-analysis::manifest_lookup` 模块文档），另造一份形状相同的视图类型只会
/// 得到一份逐字段抄写的副本，与 `RecordPage.records` 直接复用 `GachaRecord`
/// 是同一条理由。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub plugin_id: String,
    /// 已解析成单个字符串的展示名，取值优先级见
    /// `gs_analysis::display_name_for` 的文档——不是裸的 `LocalizedText`，
    /// 界面不需要自己再挑一遍语言。
    pub display_name: String,
    #[ts(type = "RaritySpec")]
    pub rarity: gs_core::RaritySpec,
    #[ts(type = "BannerSpec[]")]
    pub banners: Vec<gs_core::BannerSpec>,
    /// 当前运行的操作系统是否在该插件声明的 `platforms` 列表内，取值来自
    /// `gs_analysis::supports_current_platform`。
    ///
    /// **最坏情况能做什么**：这只是一个只读判定结果，不携带任何可执行能力
    /// ——即使这里判定为 `true`，具体某次采集仍可能因为凭据/客户端等其它
    /// 原因失败；判定为 `false` 时前端应当据此禁用该游戏的采集入口，而不是
    /// 让用户点了才在运行时报错，这是 `CLAUDE.local.md`"Windows 优先，
    /// macOS 只读——采集能力需可缺省"在界面层的落点。识别不出当前操作系统时
    /// （如未来的 Linux 构建）恒为 `false`——fail closed，不假装一个未声明
    /// 支持的平台可以采集。
    pub supports_current_platform: bool,
}

/// [`gs_analysis::CurveEvaluation`] 的可序列化投影。
///
/// 原类型不是 `Serialize`（它是分析引擎内部的计算结果，不是为跨 IPC 传输
/// 设计的），且 `Unsupported` 分支携带的是 `&'static str`——跨 IPC 只能是
/// 拥有所有权的 `String`，因此单独定义一个 IPC 视图，不是简单加个 derive
/// 就能复用原类型。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum CurveEvaluationView {
    /// 曲线给出的具体单抽概率。
    Value { value: f64 },
    /// 该曲线分支算不出具体数值（如 `custom` 曲线的公式不在 Rust 侧定义），
    /// `reason` 说明原因，供界面展示或直接隐藏概率提示——不是一个错误。
    Unsupported { reason: String },
}

/// [`gs_analysis::PityPull`] 的可序列化投影，是记录明细表"保底内第几抽"这
/// 一列的数据来源：按 `record_id` 与 [`RecordPage::records`]（或
/// `find_records_paged` 拿到的任意一页）里的 `GachaRecord.id` 关联即可。
///
/// 不带 `account_id`——原类型带这个字段是为了喂给
/// `gs_analysis::derive_rare_events`（要填 `rare_event.account_id`），但
/// [`AccountAnalysisView`] 已经是"单一账号"粒度的返回值，重复携带这个字段
/// 只是让前端多一个永远等于自己已知值的参数。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PityPullView {
    /// 记录的原始卡池 id（如 `"301"`/`"400"`），即使这条 pull 参与的是
    /// 合并计数（原神 301/400 共享保底），这个字段也保留原样——按它筛选
    /// 就能还原"只看某一个卡池"，不需要重新按单一卡池再跑一次保底计数。
    pub banner_key: String,
    pub occurred_at: i64,
    pub item_id: String,
    pub rarity: Option<String>,
    /// 本次抽取距上一次命中保底目标的抽数（含本次）——即"保底内第几抽"。
    pub pulls_since_last_hit: u32,
    pub is_pity_hit: bool,
    /// 对应的 `gacha_record.id`，与记录明细表按这个字段关联。
    pub record_id: i64,
    /// 自上一次命中（不含本次）以来，被跳过的稀有度未知记录数——星铁真实
    /// 存档里确有 `rank_type` 为空串的记录，这个数字提醒"抽数可能被低估"。
    pub unknown_rarity_since_last_hit: u32,
}

/// 一个保底组（[`gs_core::PityGroup`]）在某个账号下的完整分析结果，
/// [`gs_analysis::PityGroupReport`] 的可序列化投影。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PityGroupProgressView {
    pub pity_group_key: String,
    pub hard_pity: u32,
    /// 距上一次命中累计抽数，即"当前保底进度"。
    pub current_pity: u32,
    pub next_pull_probability: CurveEvaluationView,
    /// `rarity IS NULL` 的记录数——这些记录不参与保底计数，但也不能被静默
    /// 丢弃，界面应当能诚实标注"有 N 条记录稀有度未知，未计入保底统计"。
    pub unknown_rarity_count: u32,
    /// 逐抽明细，按 `occurred_at` 升序——记录明细表"保底内第几抽"列直接
    /// 从这里按 `record_id` 关联取值。
    pub pulls: Vec<PityPullView>,
}

/// [`gs_analysis::RarityDistribution`] 的可序列化投影。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RarityDistributionView {
    /// 键覆盖插件 `RaritySpec.ladder` 声明的全部稀有度码，即使某一档计数
    /// 为 0 也会出现在这里。
    #[ts(type = "Record<string, number>")]
    pub counts: std::collections::BTreeMap<String, u32>,
    /// `rarity IS NULL` 的记录数（字典未同步导致的"稀有度未知"）。
    pub unknown_count: u32,
    /// `rarity` 有值但不在 `RaritySpec.ladder` 声明范围内的记录数，正常情况
    /// 恒为 0。
    pub unrecognized_count: u32,
}

/// 单个账号的完整分析结果：游戏详情页"保底进度与稀有度分布"这一整块数据
/// 的来源，一次 IPC 调用取齐，不需要分两次往返。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AccountAnalysisView {
    /// 该账号所属插件声明的每一个保底组各一份报告。**只覆盖 manifest
    /// `pityGroups` 声明过的卡池**——原神的 302/200/500/100 这类未声明共享
    /// 保底的卡池不会出现在任何一份报告里，这是如实反映"没有声明就没有
    /// 保底数据"，不是遗漏。
    pub pity_progress: Vec<PityGroupProgressView>,
    /// 跨该账号全部记录（不限卡池）的稀有度分布。
    pub rarity_distribution: RarityDistributionView,
}

/// 某个插件（游戏）跨账号合并后的稀有度分布。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PluginRarityDistributionView {
    pub plugin_id: String,
    pub distribution: RarityDistributionView,
}

/// 总览页"跨账号统计"的数据来源。
///
/// ⚠️ **不提供一份合并全部游戏的扁平稀有度分布**——不同插件的稀有度码
/// 语义不同（绝区零 `"4"` 是最高档 S 级，原神 `"4"` 是四星），字面量相同
/// 不代表同一档位，合并会产出一份"错但看起来合理"的统计。
/// [`Self::rarity_by_plugin`] 因此按插件分组，不摊平。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OverviewStatsView {
    /// 本地已建档的账号总数。
    pub accounts_count: i64,
    /// 这些账号覆盖的插件（游戏）种数，去重后的 `plugin_id` 计数。
    pub games_count: i64,
    /// 全部账号的记录条数之和。语义是"抽数"而不是"数量"——`DrawCountingConfig`
    /// 缺省 `perRecord`（当前四个已注册插件均未声明 `custom`）时两者相等，
    /// 一条记录就是一抽；本字段固定按 `perRecord` 语义计数（记录条数），
    /// 尚未消费 `DrawCountingConfig`，若日后有插件声明 `custom` 计数口径，
    /// 这里会需要改成走该插件的 `hooks.countDraws`（TS 侧），本 Stage 未覆盖。
    pub total_draws: i64,
    /// 跨账号命中"自己所属插件最高保底档位"（`RaritySpec.pity_target`）的
    /// 总次数——不是字面量"五星"，绝区零的 `pity_target` 是 `"4"`。
    pub total_pity_target_hits: i64,
    pub rarity_by_plugin: Vec<PluginRarityDistributionView>,
}
