//! 保留期风险评估：账号是否需要用户尽快采集，避免官方接口的抽卡记录
//! 永久失效。
//!
//! # 这解决什么问题
//!
//! 各游戏官方只保留有限期的抽卡记录（异环游戏内明示 6 个月，米哈游约 6
//! 个月），超期后永久无法导出。插件 manifest 已经声明了这个保守估计
//! （`RetentionPolicy.conservativeDays`，见 `plugins/genshin/manifest.ts`），
//! 但声明本身不会主动提醒任何人——本模块把"声明的天数"与"账号的采集边界"
//! 结合起来，算出一个具体账号现在处于哪个风险等级。
//!
//! 与 [`crate::archive`]/[`crate::analysis`] 同样的纪律：不碰 Tauri、不碰
//! 文件系统，"当前时间"由调用方显式传入而不是内部调用
//! `SystemTime::now()`——后者会让本模块的判据分支没法用固定时间戳精确
//! 覆盖，`evaluate_account_retention_risk` 因此把 `now_millis` 做成参数。
//!
//! # 用哪个字段驱动风险等级——`max(last_collected_at, latest_record_at)`
//!
//! 这是本模块第二版的设计（第一版只用 `earliest_record_at` 驱动，已经
//! 证明是错的——见下方"第一版错在哪"一节）。当前语义：驱动字段回答的是
//! "我们对官方数据的认知截止到哪一刻"：
//! - `last_collected_at`：**主动确认**"到此刻为止我全知道"——只有真正执行
//!   过一次采集才会被写入（S3 采集链路，本仓库尚未接线，见
//!   `gs_storage::Repository::touch_account_collection_bounds` 文档）。
//! - `latest_record_at`：**被动下界**"至少到这条为止我有"——账号名下本地
//!   已知最晚一条记录的游戏内发生时刻，导入路径就能写（见
//!   `crate::import::persist_collection_bounds`）。
//!
//! 必须取两者的 **max**，任何一个单独拿来用都会造出系统性误判——各自的
//! 反例互相独立，缺一不可：
//! - **只用 `latest_record_at`**：用户这次主动采集了，但期间恰好没有新
//!   抽卡——`latest_record_at` 不会前进，会对一个"官方数据我们其实全知道"
//!   的账号误报"快丢数据了"。
//! - **只用"操作时刻"（即把 `last_collected_at` 设成导入发生的那一刻）**：
//!   用户今天导入一份半年前导出的存档，会被误判为"安全"，而实际上存档
//!   终点到现在这段官方数据已经很可能永久丢失——这正是为什么
//!   `persist_collection_bounds` 只写 `latest_record_at`、永远不写
//!   `last_collected_at`：导入只能证明"我们见过这些记录"，证明不了
//!   "官方现在没有更晚的数据"。
//!
//! 两者都是 `None` 时返回 `None`（"无法评估"），不默认成安全——语义与
//! `retention_days` 缺失时相同，见 [`evaluate_account_retention_risk`] 文档。
//!
//! # 第一版错在哪：`earliest_record_at` 是被证伪的驱动字段
//!
//! `earliest_record_at`（本地已知最早一条记录）固定不动，而"现在"持续
//! 前进——`remaining_days` 只会单调递减，从不因为用户勤快采集而回升。
//! 后果：任何玩满 `retention_days` 天的账号最终都会永久停在最高告警档，
//! 且无论采集多勤快都消不掉，因为驱动字段压根不记录"采集"这件事。消不掉
//! 的告警会训练用户忽略它，等于这个功能没有任何行动价值——`earliest_
//! record_at` 依然保留在 `Account` 上，但现在只有展示价值（"你的记录覆盖
//! X 至今"），不再参与本模块的计算，见 [`gs_storage::Account::
//! earliest_record_at`] 的文档。

use gs_core::GsError;
use gs_storage::{Account, Repository};

use crate::views::{RetentionRiskLevel, RetentionRiskView};

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// "一个月"的折算天数。**用 28 天，不用日历月的 30/31 天**——与
/// `RetentionPolicy.conservativeDays` 本身的折算口径保持一致（原神 manifest
/// `6 * 28`，见迁移 `0001_initial.sql` 里 `retention_days` 列上的注释：
/// "官方措辞是『6 个月』，月长不一，按 6×28 这类较短值取，告警宁早勿晚"）。
/// 两处都是"保守估计"，用同一个更短的月长口径，是同一条"宁早勿晚"纪律的
/// 两个落点，不是两套互相独立的取值——选 30 天会让阈值口径与
/// `retention_days` 本身的口径不一致，没有必要引入这个不一致。
const DAYS_PER_MONTH: i64 = 28;

/// [`RetentionRiskLevel::Urgent`] 的阈值：剩余天数 `< 28` 即进入紧急档
/// （含已超期，超期时 `remaining_days` 为负，同样 `< 28`）。
const URGENT_THRESHOLD_DAYS: i64 = DAYS_PER_MONTH;

/// [`RetentionRiskLevel::Safe`] 的阈值：剩余天数 `>= 84`（3 个月）才算安全。
const SAFE_THRESHOLD_DAYS: i64 = DAYS_PER_MONTH * 3;

/// 评估单个账号的保留期风险。
///
/// 返回 `None` 表示"无法评估"，调用方不应把它当作"安全"处理：
/// - `last_collected_at` 与 `latest_record_at` 皆为 `None`：账号一条记录
///   都还没有、也从未真正采集过，没有可参照的锚点——猜一个等级（无论 Safe
///   还是 Urgent）都是编造出来的，不如老实说"评估不了"。
/// - `account.retention_days` 为 `None`：账号所属插件没有声明保留期策略
///   （鸣潮就是真实例子，见 `plugins/wuwa/manifest.ts` 的说明：没有可靠
///   来源给出鸣潮的保留期天数，宁可不声明）。没有比较基准就没法算"还剩
///   多少天"，同样不默认任何天数去凑出一个答案。
///
/// `now_millis` 由调用方显式传入（UTC 毫秒），不在函数内部取真实时钟——
/// 保持纯函数、可用固定时间戳精确覆盖每一个边界分支。
///
/// # 为什么这里永远不会返回 [`RetentionRiskLevel::Blocked`]
///
/// `Blocked` 回答的是"采集链路本身坏了"（游戏目录失效 / 连续采集失败），
/// 判定它需要 `gameDirValid`/`consecutiveFailureCount` 两个信号——本仓库
/// 目前没有任何命令校验游戏目录、也没有连续失败计数（两者都要等 S3 采集
/// 链路接线后才存在）。本函数因此只在 `Safe`/`Watch`/`Urgent` 三档之间
/// 判定，`Blocked` 是特意留出的结构入口，不是遗漏——没有真实数据支撑就
/// 不编，编出一个假的"阻塞"状态比不显示更坏。
pub fn evaluate_account_retention_risk(
    account: &Account,
    now_millis: i64,
) -> Option<RetentionRiskView> {
    // anchor：我们对官方数据认知截止到哪一刻，取两个信号里较晚的一个——
    // 完整论证见模块文档"用哪个字段驱动风险等级"一节。
    let anchor = match (account.last_collected_at, account.latest_record_at) {
        (None, None) => return None,
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (Some(a), Some(b)) => a.max(b),
    };
    let retention_days = account.retention_days?;

    let retention_span_ms = retention_days.saturating_mul(MS_PER_DAY);
    let expires_at = anchor.saturating_add(retention_span_ms);
    let remaining_ms = expires_at.saturating_sub(now_millis);
    // 用 div_euclid 而不是 `/`：后者朝零截断，`-1 小时` 这种"刚超期不到
    // 一天"的情况会被截成 0 天，落进 Watch 档而不是 Urgent——`div_euclid`
    // 对正除数恒等价于向下取整（floor），能让"哪怕只超期 1 小时也算已超期"
    // 正确落在 remaining_days < 0 这一支。
    let remaining_days = remaining_ms.div_euclid(MS_PER_DAY);

    let level = if remaining_days >= SAFE_THRESHOLD_DAYS {
        RetentionRiskLevel::Safe
    } else if remaining_days >= URGENT_THRESHOLD_DAYS {
        RetentionRiskLevel::Watch
    } else {
        // remaining_days < 28，含负数（已超期）——超期是最需要行动的状态，
        // 与"快到期但还没到"合并为同一档，不像旧的三态模型那样单独分出
        // 一档，见 `RetentionRiskLevel::Urgent` 的文档。
        RetentionRiskLevel::Urgent
    };

    // "可能已丢失"区间只在真正超期（remaining_days < 0，即
    // anchor < now - retention_days）时才有意义——区间是
    // [anchor, now - retention_days]：这段时间官方大概率有过记录，而我们
    // 认知范围止步于 anchor，没能采到，按保留期保守估计现在大概率已经拿
    // 不回来了。`remaining_days < 0` 已经保证这个区间非空，不需要额外判断
    // 谁比谁大。
    //
    // 这个条件比"level == Urgent"更窄——Urgent 还覆盖"剩余 0~27 天、尚未
    // 超期"的情况，那种情况下官方数据仍然完整，谈不上"可能已丢失"。
    let (possible_loss_from, possible_loss_to) = if remaining_days < 0 {
        let retention_cutoff = now_millis.saturating_sub(retention_span_ms);
        (Some(anchor), Some(retention_cutoff))
    } else {
        (None, None)
    };

    Some(RetentionRiskView {
        level,
        remaining_days,
        possible_loss_from,
        possible_loss_to,
    })
}

/// 补齐账号表里为空的 `retention_days` 列。
///
/// # 为什么在读账号列表时补，而不是只在建账号/导入时补
///
/// 账号创建目前只有一条生产路径——[`crate::archive::resolve_account_id`]
/// ——新建账号时已经会从 manifest 直接写好 `retention_days`
/// （见该函数内 `retention_days_for_new_account` 的调用）。但已经存在于
/// 本地库、且是在这条写入逻辑补齐**之前**建的账号，只有当用户又一次导入
/// 同一账号的存档时，才会被那条创建逻辑重新碰到——而大多数用户导入一次
/// 之后只会打开应用查看，不会特意再导一遍存档去"顺带"触发补写。
///
/// 账号列表命令（`list_accounts`）是当前唯一一个"每次打开应用都会被调用、
/// 且天然会遍历全部账号"的入口，在这里补齐能让历史账号在下次打开应用时
/// 就自愈，不需要用户知道"要去重新导入一次才能修好"这种实现细节——这与
/// 迁移脚本"下次访问时自动补齐"的思路一致，只是落点是应用层而不是数据库
/// 迁移。
///
/// # 幂等与写入范围
///
/// 只处理 `retention_days IS NULL` 的账号：已经有值的（无论是创建时写入
/// 的，还是本函数上次补过的）不重复写，避免每次打开账号列表都对着一批
/// 早就补齐的账号发起无意义的 UPDATE。若插件没有声明保留期策略（鸣潮），
/// [`gs_analysis::retention_policy_for`] 返回 `None`，本函数原样跳过——
/// 不写入任何"猜出来"的天数，账号会持续保持 `NULL`，直到该插件哪天真的
/// 声明了保留期。
pub fn backfill_missing_retention_days(repo: &Repository<'_>) -> Result<(), GsError> {
    let accounts = repo.list_accounts()?;
    for account in accounts {
        if account.retention_days.is_some() {
            continue;
        }
        if let Some(policy) = gs_analysis::retention_policy_for(&account.plugin_id) {
            repo.update_account_retention_days(account.id, i64::from(policy.conservative_days))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_storage::{NewAccount, Storage};

    const DAY: i64 = MS_PER_DAY;
    /// 任意基准时刻，取值本身没有意义，只是让测试用例不必写裸的大数字。
    const NOW: i64 = 1_800_000_000_000;

    /// `earliest_record_at` 在本模块的计算里已经不再驱动任何东西（只保留
    /// 展示价值），这里固定传 `None`——需要显式覆盖驱动字段的测试直接构造
    /// `Account { .. }` 字面量，不通过这个 helper。
    fn account(
        last_collected_at: Option<i64>,
        latest_record_at: Option<i64>,
        retention_days: Option<i64>,
    ) -> Account {
        Account {
            id: 1,
            plugin_id: "genshin".to_string(),
            game_uid: "100000000".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days,
            last_collected_at,
            earliest_record_at: None,
            latest_record_at,
            created_at: 0,
        }
    }

    #[test]
    fn returns_none_when_both_collection_anchors_are_absent() {
        // last_collected_at 与 latest_record_at 皆为 None：账号存在但从未
        // 采集、也没有任何记录，没有锚点可算。
        let acc = account(None, None, Some(168));
        assert_eq!(evaluate_account_retention_risk(&acc, NOW), None);
    }

    #[test]
    fn returns_none_when_plugin_declares_no_retention_policy() {
        // 鸣潮的真实场景：retention_days 是 None，不能默认任何天数。
        let acc = account(None, Some(NOW - 200 * DAY), None);
        assert_eq!(evaluate_account_retention_risk(&acc, NOW), None);
    }

    #[test]
    fn classifies_safe_when_more_than_three_months_of_buffer_remain() {
        // latest_record_at 距过期还有 90 天缓冲（168 天保留期）。
        let retention_days = 168;
        let latest = NOW - (retention_days - 90) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, 90);
        assert_eq!(risk.possible_loss_from, None);
        assert_eq!(risk.possible_loss_to, None);
    }

    #[test]
    fn classifies_watch_at_the_exact_eighty_four_day_boundary_is_still_safe() {
        // 剩余天数恰好等于 84（3 个月，SAFE_THRESHOLD_DAYS）——边界本身归
        // Safe（`remaining_days >= SAFE_THRESHOLD_DAYS`），不是 Watch。
        let retention_days = 168;
        let latest = NOW - (retention_days - 84) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, 84);
    }

    #[test]
    fn classifies_watch_at_eighty_three_days_just_below_the_safe_boundary() {
        // 83 天严格小于 84——确认 Safe 阈值的不等号方向没有写反。
        let retention_days = 168;
        let latest = NOW - (retention_days - 83) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Watch);
        assert_eq!(risk.remaining_days, 83);
    }

    #[test]
    fn classifies_watch_at_the_exact_twenty_eight_day_boundary() {
        // 剩余天数恰好等于 28（1 个月，URGENT_THRESHOLD_DAYS）——边界本身
        // 归 Watch（`remaining_days >= URGENT_THRESHOLD_DAYS`），不是 Urgent。
        let retention_days = 168;
        let latest = NOW - (retention_days - 28) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Watch);
        assert_eq!(risk.remaining_days, 28);
    }

    #[test]
    fn classifies_urgent_at_twenty_seven_days_just_below_the_watch_boundary() {
        // 27 天严格小于 28——确认 Urgent 阈值的不等号方向没有写反。
        let retention_days = 168;
        let latest = NOW - (retention_days - 27) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Urgent);
        assert_eq!(risk.remaining_days, 27);
        // 尚未超期（remaining_days >= 0），不应该有"可能已丢失"区间。
        assert_eq!(risk.possible_loss_from, None);
        assert_eq!(risk.possible_loss_to, None);
    }

    #[test]
    fn classifies_urgent_at_zero_remaining_days() {
        // 剩余 0 天：还没有真的超期，但已经是最后一天，属于 Urgent（< 28）。
        let retention_days = 168;
        let latest = NOW - retention_days * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Urgent);
        assert_eq!(risk.remaining_days, 0);
    }

    #[test]
    fn classifies_urgent_once_past_expiry_and_reports_a_valid_loss_window() {
        // 超期 10 天。
        let retention_days = 168;
        let latest = NOW - (retention_days + 10) * DAY;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Urgent);
        assert_eq!(risk.remaining_days, -10);

        let loss_from = risk.possible_loss_from.expect("超期必须带下界");
        let loss_to = risk.possible_loss_to.expect("超期必须带上界");
        assert_eq!(
            loss_from, latest,
            "区间下界应当是 anchor（这里是 latest_record_at）"
        );
        assert_eq!(loss_to, NOW - retention_days * DAY);
        assert!(loss_from < loss_to, "区间必须是合法的非空闭区间");
    }

    #[test]
    fn classifies_urgent_even_when_expired_by_less_than_a_full_day() {
        // 只超期 1 小时——验证 div_euclid 没有被截断成"剩 0 天"误判成 Watch。
        let retention_days = 168;
        let latest = NOW - retention_days * DAY - 60 * 60 * 1000;
        let acc = account(None, Some(latest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Urgent);
        assert!(risk.remaining_days < 0);
    }

    // ========================================================
    // anchor = max(last_collected_at, latest_record_at)——两个反例各证伪
    // 一个单独字段，缺一不可
    // ========================================================

    #[test]
    fn anchor_uses_last_collected_at_when_it_is_more_recent_than_latest_record_at() {
        // 反例①："只用 latest_record_at" 会诬告的场景：latest_record_at
        // 停留在 100 天前（很久没抽卡了），但用户刚刚（0 天前）真的采集过
        // 一次——只用 latest_record_at 算出的 remaining_days 会是负数
        // （168 - 100 已经过了保留期？不，这里换算成明确超期数字更直接）。
        let retention_days = 168;
        let stale_latest_record_at = NOW - 200 * DAY; // 早就超过 168 天保留期
        let fresh_last_collected_at = NOW; // 刚刚采集过

        let acc = account(
            Some(fresh_last_collected_at),
            Some(stale_latest_record_at),
            Some(retention_days),
        );
        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");

        // 若只用 latest_record_at（不取 max），remaining_days 会是
        // 168 - 200 = -32，落进 Urgent 甚至带"可能已丢失"区间——那是假的：
        // 用户刚采集过，官方数据我们其实全知道。取 max 后 anchor = NOW，
        // remaining_days 应当等于完整的 retention_days，稳稳落在 Safe。
        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, retention_days);
        assert_eq!(
            risk.possible_loss_from, None,
            "anchor 取到了刚采集的时刻，不应该报出丢失区间"
        );
    }

    #[test]
    fn anchor_uses_latest_record_at_when_last_collected_at_is_absent() {
        // 反例②："只用『操作时刻』当 last_collected_at" 会误报安全的场景：
        // 用户今天导入一份半年前导出的存档——导入路径按设计永远不写
        // last_collected_at（见 `persist_collection_bounds` 文档），这里
        // last_collected_at 固定是 None，只有 latest_record_at 是半年前。
        let retention_days = 168; // 168 天 ≈ 6 个月保守估计
        let half_year_ago = NOW - 182 * DAY;

        let acc = account(None, Some(half_year_ago), Some(retention_days));
        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");

        // 若错误地把"导入发生的这一刻"当成 last_collected_at 传进来，
        // anchor 会变成 NOW，算出 remaining_days == retention_days（Safe）
        // ——那是假的安全。正确做法：last_collected_at 是 None，anchor 只能
        // 取 latest_record_at（182 天前），168 天保留期已经超期 14 天，
        // 必须落在 Urgent 且带丢失区间。
        assert_eq!(risk.level, RetentionRiskLevel::Urgent);
        assert_eq!(risk.remaining_days, retention_days - 182);
        assert!(
            risk.remaining_days < 0,
            "自证前提：半年前的存档终点应当已超期"
        );
        assert_eq!(risk.possible_loss_from, Some(half_year_ago));
    }

    #[test]
    fn anchor_uses_latest_record_at_when_it_is_more_recent_than_last_collected_at() {
        // 对称场景：last_collected_at 是很久以前的一次采集，但之后又导入了
        // 一份更晚的存档，latest_record_at 因此比 last_collected_at 更新——
        // anchor 必须跟着走向更新的那个信号，不能"偏爱"某一侧固定不变。
        let retention_days = 168;
        let stale_last_collected_at = NOW - 200 * DAY;
        let fresher_latest_record_at = NOW - 10 * DAY;

        let acc = account(
            Some(stale_last_collected_at),
            Some(fresher_latest_record_at),
            Some(retention_days),
        );
        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");

        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, retention_days - 10);
    }

    fn open_repo_with_account(plugin_id: &str, retention_days: Option<i64>) -> (Storage, i64) {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let account_id = storage
            .repository()
            .create_account(&NewAccount {
                plugin_id: plugin_id.to_string(),
                game_uid: "100000000".to_string(),
                region: "official".to_string(),
                display_name: None,
                retention_days,
                created_at: 0,
            })
            .expect("创建账号应当成功");
        (storage, account_id)
    }

    #[test]
    fn backfill_fills_in_retention_days_from_manifest_for_a_null_account() {
        let (storage, account_id) = open_repo_with_account("genshin", None);
        let repo = storage.repository();

        backfill_missing_retention_days(&repo).expect("补写应当成功");

        let account = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(account.retention_days, Some(168));
    }

    #[test]
    fn backfill_does_not_touch_an_account_that_already_has_a_value() {
        // 已经有值（哪怕值本身与当前 manifest 不同）不应被覆盖——本函数只
        // 补 NULL，不做"与 manifest 强制同步"这件事。
        let (storage, account_id) = open_repo_with_account("genshin", Some(999));
        let repo = storage.repository();

        backfill_missing_retention_days(&repo).expect("补写应当成功");

        let account = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(account.retention_days, Some(999), "已有值不应被覆盖");
    }

    #[test]
    fn backfill_leaves_null_when_the_plugin_declares_no_retention_policy() {
        // 鸣潮没有声明 retention——补写应当保持 NULL，不能编一个天数。
        let (storage, account_id) = open_repo_with_account("wuwa", None);
        let repo = storage.repository();

        backfill_missing_retention_days(&repo).expect("补写应当成功（哪怕无事可做）");

        let account = repo
            .find_account(account_id)
            .expect("查询应当成功")
            .expect("账号应当存在");
        assert_eq!(account.retention_days, None);
    }
}
