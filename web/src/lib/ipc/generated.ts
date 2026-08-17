// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-host/src/views.rs 后重跑 `cargo run -p gs-host --bin gs-codegen`。
import type { GachaRecord, RaritySpec, BannerSpec } from "gs-plugin-kit/types";

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
 * 库中该账号最早一条记录的时间，供保留期告警计算用。
 */
earliestRecordAt: number | null, 
/**
 * 该账号名下的记录总数。
 */
recordCount: number, };
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
displayName: string, rarity: RaritySpec, banners: BannerSpec[], };
export type CurveEvaluationView = { "kind": "value", value: number, } | { "kind": "unsupported", reason: string, };
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
unknownRaritySinceLastHit: number, };
export type PityGroupProgressView = { pityGroupKey: string, hardPity: number, 
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
