// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-host/src/views.rs 后重跑 `cargo run -p gs-host --bin gs-codegen`。
import type { GachaRecord } from "gs-plugin-kit/types";

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
