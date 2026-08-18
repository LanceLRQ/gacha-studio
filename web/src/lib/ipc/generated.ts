// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-host/src/views.rs 后重跑 `cargo run -p gs-host --bin gs-codegen`。
import type { GachaRecord, RaritySpec, BannerSpec, GuaranteeRule } from "gs-plugin-kit/types";

export type RetentionRiskLevel = "safe" | "watch" | "urgent" | "blocked";
export type RetentionRiskView = { level: RetentionRiskLevel, 
/**
 * 距保留期保守估计的过期时刻还剩的天数，可能为负——为负表示已经超出
 * 保守估计的保留期（落在 [`RetentionRiskLevel::Urgent`] 档内，但
 * `Urgent` 不止负数这一种情况，还覆盖"剩余 0~27 天、尚未超期"）。
 */
remainingDays: number, 
/**
 * 仅 `remaining_days` 为负（已超期）时有值：这段时间区间内发生的
 * 记录，按保留期保守估计**可能**已经无法再从官方接口取回（UTC 毫秒，
 * 闭区间）。措辞刻意用"可能"——不断言"已丢失"，见字段所在结构体的文档。
 */
possibleLossFrom?: number, possibleLossTo?: number, };
export type AccountView = { id: number, 
/**
 * 归属插件，即游戏标识（`genshin` / `wuwa` / `starrail` / `zzz`）。
 */
pluginId: string, gameUid: string, region: string, displayName: string | null, 
/**
 * 上次采集时间（毫秒时间戳）。从未采集过为 `None`——**不要**在这里
 * 填 0 冒充"很久以前"，界面需要区分"没采过"和"很久没采了"，前者该
 * 引导用户去采集，后者该告警保留期。
 */
lastCollectedAt: number | null, 
/**
 * 库中该账号最早一条记录的时间。**只有展示价值**（"你的记录覆盖 X
 * 至今"），**不驱动**保留期风险等级——驱动字段是
 * `max(last_collected_at, latest_record_at)`，理由见
 * `gs_host::retention` 模块文档。
 */
earliestRecordAt: number | null, 
/**
 * 该账号名下的记录总数。
 */
recordCount: number, 
/**
 * 保留期风险评估，由 [`gs_analysis::retention_policy_for`] 声明的
 * 保守天数与本账号的采集边界推算，见 `gs_host::retention` 模块文档。
 *
 * `None` 表示"无法评估"，**不是"安全"**——插件没有声明保留期策略
 * （如鸣潮）、或该账号还一条记录都没有时，都没有可靠的判断依据，
 * 编一个等级出来（无论安全还是告警）都是给用户一个假象。
 */
retentionRisk: RetentionRiskView | null, };
export type RecordPage = { 
/**
 * 当前筛选条件下的记录总数，供界面算总页数。
 */
total: number, 
/**
 * 页码，从 0 开始。
 */
page: number, 
/**
 * 每页条数。**这是宿主实际采用的值，不一定等于调用方传入的值**——
 * 调用方传入的值会被夹到上限，界面应当以返回值为准显示分页器，
 * 而不是拿自己传出去的那个数去算。
 */
pageSize: number, 
/**
 * 裸名引用 `GachaRecord`——它属于另一份产物（`gs-plugin-kit/types`），
 * 由生成文件头部的 `import type` 引进来，见 `gs-codegen` 的 `IPC_HEADER`。
 */
records: GachaRecord[], };
export type ImportReport = { 
/**
 * 嗅探命中的交换格式 id（`uigf` / `wwgacha`）。界面用它告诉用户
 * "我把这份文件当成什么格式读的"——读错格式却读出了东西，是最难
 * 自查的一类错误，把判断结果摆出来让用户能一眼否掉。
 */
formatId: string, accounts: Array<ImportedAccountReport>, };
export type ImportedAccountReport = { gameId: string, uid: string, 
/**
 * 落库后的账号主键。存档里的账号在本地不存在时会新建，已存在则复用。
 */
accountId: number, recordsSeen: number, recordsInserted: number, 
/**
 * `records_seen - records_inserted`：撞 `UNIQUE(account_id, record_key)`
 * 被 `INSERT OR IGNORE` 跳过的条数。**重复导入同一份存档时这个数等于
 * 总数是正常的**，不是错误，界面文案不要写成"失败"。
 */
recordsSkipped: number, };
export type GameView = { pluginId: string, 
/**
 * 已解析成单个字符串的展示名，取值优先级见
 * `gs_analysis::display_name_for` 的文档——不是裸的 `LocalizedText`，
 * 界面不需要自己再挑一遍语言。
 */
displayName: string, rarity: RaritySpec, 
/**
 * `rarity.tier_labels` 解析成"稀有度码 → 展示字符串"后的投影，取值
 * 优先级见 `gs_analysis::tier_labels_for` 的文档（`"zh-CN"` 优先，
 * 未声明的码兜底成"N 星"）——与 `display_name` 是同一条理由：界面
 * 不需要自己再挑一遍语言，也不再靠"稀有度码 + 星"这个通用规则硬拼，
 * 绝区零因此能显示"S"而不是"4星"。
 */
tierLabels: Record<string, string>, banners: BannerSpec[], 
/**
 * 当前运行的操作系统是否在该插件声明的 `platforms` 列表内，取值来自
 * `gs_analysis::supports_current_platform`。
 *
 * **最坏情况能做什么**：这只是一个只读判定结果，不携带任何可执行能力
 * ——即使这里判定为 `true`，具体某次采集仍可能因为凭据/客户端等其它
 * 原因失败；判定为 `false` 时前端应当据此禁用该游戏的采集入口，而不是
 * 让用户点了才在运行时报错，这是 `CLAUDE.local.md`"Windows 优先，
 * macOS 只读——采集能力需可缺省"在界面层的落点。识别不出当前操作系统时
 * （如未来的 Linux 构建）恒为 `false`——fail closed，不假装一个未声明
 * 支持的平台可以采集。
 */
supportsCurrentPlatform: boolean, };
export type CurveEvaluationView = { "kind": "value", value: number, } | { "kind": "unsupported", reason: string, };
export type HitOutcomeView = "rateUp" | "off" | "unknown";
export type PityPullView = { 
/**
 * 记录的原始卡池 id（如 `"301"`/`"400"`），即使这条 pull 参与的是
 * 合并计数（原神 301/400 共享保底），这个字段也保留原样——按它筛选
 * 就能还原"只看某一个卡池"，不需要重新按单一卡池再跑一次保底计数。
 */
bannerKey: string, occurredAt: number, itemId: string, rarity: string | null, 
/**
 * 本次抽取距上一次命中保底目标的抽数（含本次）——即"保底内第几抽"。
 */
pullsSinceLastHit: number, isPityHit: boolean, 
/**
 * 对应的 `gacha_record.id`，与记录明细表按这个字段关联。
 */
recordId: number, 
/**
 * 自上一次命中（不含本次）以来，被跳过的稀有度未知记录数——星铁真实
 * 存档里确有 `rank_type` 为空串的记录，这个数字提醒"抽数可能被低估"。
 */
unknownRaritySinceLastHit: number, 
/**
 * 这次命中是"歪了"还是中了 UP，`None` 表示这条 pull 根本不是一次
 * 顶级保底命中（`is_pity_hit == false`）——"是否歪"这个问题对非命中
 * 的 pull 没有意义，用 `None` 而不是塞一个 `Unknown` 占位，让"不适用"
 * 与"命中了但不知道歪没歪"（`Some(HitOutcomeView::Unknown)`）保持
 * 可区分的两种状态。
 *
 * 取值来自 [`gs_analysis::derive_rare_events`] 产出的 `is_rate_up`
 * 三态经 [`gs_analysis::hit_outcome_from_is_rate_up`] 映射——当前
 * 没有任何数据源能提供当期 UP 物品列表，因此命中的 pull 实际取值恒为
 * `Some(HitOutcomeView::Unknown)`，如实反映"不知道"，不编造。
 *
 * ⚠️ **只有 [`PityGroupProgressView::guarantee`] 是 `fiftyFifty` 时，
 * 这个字段才有"歪"的语义**——`alwaysRateUp`/`none`/`weighted` 三种
 * 担保规则下，即使这里有值，界面也不应该渲染成"是/否"，理由见
 * `PityGroupProgressView::guarantee` 的文档。
 */
hitOutcome: HitOutcomeView | null, };
export type PityGroupProgressView = { pityGroupKey: string, hardPity: number, 
/**
 * 这个保底组的担保规则，直接复用 [`gs_core::GuaranteeRule`]——manifest
 * 纯数据 JSON 反序列化出来的就是这个领域类型本身，理由与 `GameView`
 * 复用 `RaritySpec`/`BannerSpec` 一致，不再造一份形状相同的投影。
 *
 * 存在的理由：界面需要用它判断 `pulls[].hit_outcome` 这一列该不该
 * 渲染成"是否歪"——**只有 `fiftyFifty` 才有"歪"这个概念**，`none`
 * 没有担保机制，`alwaysRateUp` 结构上不存在"歪"的可能，`weighted`
 * 虽然理论上也有"未中 UP"的结果，但 `gs_analysis::apply_guarantee_rule`
 * 本 Stage 未展开成具体的加权状态机（恒返回 `false`，见该函数文档），
 * 三者都不该在"是否歪"这一列显示"是/否"，否则会显示成一片假的"没歪"
 * ——那是噪音，不是数据。
 */
guarantee: GuaranteeRule, 
/**
 * 距上一次命中累计抽数，即"当前保底进度"。
 */
currentPity: number, nextPullProbability: CurveEvaluationView, 
/**
 * `rarity IS NULL` 的记录数——这些记录不参与保底计数，但也不能被静默
 * 丢弃，界面应当能诚实标注"有 N 条记录稀有度未知，未计入保底统计"。
 */
unknownRarityCount: number, 
/**
 * 逐抽明细，按 `occurred_at` 升序——记录明细表"保底内第几抽"列直接
 * 从这里按 `record_id` 关联取值。
 */
pulls: Array<PityPullView>, };
export type RarityDistributionView = { 
/**
 * 键覆盖插件 `RaritySpec.ladder` 声明的全部稀有度码，即使某一档计数
 * 为 0 也会出现在这里。
 */
counts: Record<string, number>, 
/**
 * `rarity IS NULL` 的记录数（字典未同步导致的"稀有度未知"）。
 */
unknownCount: number, 
/**
 * `rarity` 有值但不在 `RaritySpec.ladder` 声明范围内的记录数，正常情况
 * 恒为 0。
 */
unrecognizedCount: number, };
export type AccountAnalysisView = { 
/**
 * 该账号所属插件声明的每一个保底组各一份报告。**只覆盖 manifest
 * `pityGroups` 声明过的卡池**——原神的 302/200/500/100 这类未声明共享
 * 保底的卡池不会出现在任何一份报告里，这是如实反映"没有声明就没有
 * 保底数据"，不是遗漏。
 */
pityProgress: Array<PityGroupProgressView>, 
/**
 * 跨该账号全部记录（不限卡池）的稀有度分布。
 */
rarityDistribution: RarityDistributionView, };
export type PluginRarityDistributionView = { pluginId: string, distribution: RarityDistributionView, };
export type OverviewStatsView = { 
/**
 * 本地已建档的账号总数。
 */
accountsCount: number, 
/**
 * 这些账号覆盖的插件（游戏）种数，去重后的 `plugin_id` 计数。
 */
gamesCount: number, 
/**
 * 全部账号的记录条数之和。语义是"抽数"而不是"数量"——`DrawCountingConfig`
 * 缺省 `perRecord`（当前四个已注册插件均未声明 `custom`）时两者相等，
 * 一条记录就是一抽；本字段固定按 `perRecord` 语义计数（记录条数），
 * 尚未消费 `DrawCountingConfig`，若日后有插件声明 `custom` 计数口径，
 * 这里会需要改成走该插件的 `hooks.countDraws`（TS 侧），本 Stage 未覆盖。
 */
totalDraws: number, 
/**
 * 跨账号命中"自己所属插件最高保底档位"（`RaritySpec.pity_target`）的
 * 总次数——不是字面量"五星"，绝区零的 `pity_target` 是 `"4"`。
 */
totalPityTargetHits: number, rarityByPlugin: Array<PluginRarityDistributionView>, };
export type MonthlyActivityView = { 
/**
 * 自然月，格式 `YYYY-MM`。
 */
month: string, draws: number, topTierHits: number, };
export type ThemePreference = "light" | "dark" | "system";
export type MetadataBackfillReport = { pluginId: string, 
/**
 * 成功反查、`item_id` 已替换、`meta_state` 已推进到 `complete`。
 */
resolved: number, 
/**
 * 有可用字典，但记录的 name 在字典里查不到——保持 `pending`。
 */
stillPending: number, 
/**
 * `gacha_record.lang` 是 `NULL`，不知道用哪个语言的字典——保持 `pending`。
 */
skippedNoLang: number, 
/**
 * 这个记录的语言完全没有可用字典（远端下载与本地缓存都失败，或语言
 * 本身不在已知的字典 API 短码表里）——保持 `pending`。
 */
skippedNoDictionary: number, };
export type ExportFormat = "csv" | "uigfV4";
export type ExportExclusionReason = "notInUigfScope" | "zzzGachaTypeNotInEnum" | "genshinItemIdUnresolved" | "missingStableId" | "invalidOccurredRaw" | "starrailMissingGachaId" | "timezoneUnavailable";
export type ExportExclusionBucket = { reason: ExportExclusionReason, count: number, 
/**
 * 完整中文说明，即 [`ExportExclusionReason::message`] 的取值——
 * 冗余存一份是为了前端不需要自己维护映射表，直接渲染即可。
 */
message: string, };
export type ExportReport = { format: ExportFormat, 
/**
 * 实际写入导出文件的账号数（CSV：选中的账号数；UIGF：至少有一条记录
 * 成功进入某个游戏段 project 的账号数，可能小于选中的账号数）。
 */
accountsExported: number, 
/**
 * 实际写入导出文件的记录条数。
 */
recordsExported: number, 
/**
 * 逐类排除计数——**CSV 格式恒为空数组**，UIGF 格式覆盖本模块文档
 * "两种格式的定位完全不同"一节列出的全部场景。
 */
excluded: Array<ExportExclusionBucket>, };
