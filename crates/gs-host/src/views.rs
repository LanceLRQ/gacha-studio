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
