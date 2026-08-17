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
//! # 用哪个字段驱动风险等级——`earliest_record_at`，不是 `last_collected_at`
//!
//! 两者回答的是不同的问题，不能互相替代：
//! - `earliest_record_at`（本地已采集到的最早一条记录，游戏内发生时刻）
//!   回答"我们本地收藏的最老锚点，按保守估计还有多久会被官方判定为
//!   『过了保留期』"——这正是 [`gs_storage::Account::earliest_record_at`]
//!   自己的文档写的"供保留期告警计算用"。
//! - `last_collected_at`（上次成功采集时刻）回答的是完全不同的问题："多久
//!   没有同步新数据了"，是一个采集健康度/新鲜度信号，不直接等价于"数据
//!   即将丢失"——一个刚刚同步过的账号，如果游戏账号本身历史很长，
//!   `earliest_record_at` 依然可能早就跨过保留期保守估计（那批最早的记录
//!   本来就已经被我们采集下来、安全存在本地库里了，官方那边还留不留着不
//!   影响我们已经有的数据）。
//!
//! 因此风险等级只由 `earliest_record_at` 驱动。`last_collected_at` 目前
//! 没有接入这套等级判定——它是一个独立的"采集新鲜度"信号（前端设计稿
//! `web/src/lib/risk.ts` 里那套被冻结的四态模型走的正是这条信号，见该文件
//! 头部的冻结说明），与本模块回答的"最早记录是否已经进入『可能已丢失』
//! 区间"是两件不同的事，不在本模块里混着算。

use gs_core::GsError;
use gs_storage::{Account, Repository};

use crate::views::{RetentionRiskLevel, RetentionRiskView};

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// [`RetentionRiskLevel::Watch`] 的阈值：剩余天数 `<= 30` 即进入提醒档。
const WATCH_THRESHOLD_DAYS: i64 = 30;

/// 评估单个账号的保留期风险。
///
/// 返回 `None` 表示"无法评估"，调用方不应把它当作"安全"处理：
/// - `account.earliest_record_at` 为 `None`：账号一条记录都还没有，没有
///   可参照的锚点——本地既没有"最早记录"，也就没有"这条记录快过期了"这件
///   事可言。猜一个等级（无论 Safe 还是 Alert）都是编造出来的，不如老实
///   说"评估不了"，让界面展示"尚无记录"而不是一个看起来言之凿凿的假结论。
/// - `account.retention_days` 为 `None`：账号所属插件没有声明保留期策略
///   （鸣潮就是真实例子，见 `plugins/wuwa/manifest.ts` 的说明：没有可靠
///   来源给出鸣潮的保留期天数，宁可不声明）。没有比较基准就没法算"还剩
///   多少天"，同样不默认任何天数去凑出一个答案。
///
/// `now_millis` 由调用方显式传入（UTC 毫秒），不在函数内部取真实时钟——
/// 保持纯函数、可用固定时间戳精确覆盖每一个边界分支。
pub fn evaluate_account_retention_risk(
    account: &Account,
    now_millis: i64,
) -> Option<RetentionRiskView> {
    let earliest = account.earliest_record_at?;
    let retention_days = account.retention_days?;

    let retention_span_ms = retention_days.saturating_mul(MS_PER_DAY);
    let expires_at = earliest.saturating_add(retention_span_ms);
    let remaining_ms = expires_at.saturating_sub(now_millis);
    // 用 div_euclid 而不是 `/`：后者朝零截断，`-1 小时` 这种"刚超期不到
    // 一天"的情况会被截成 0 天，落进 Watch 档而不是 Alert——`div_euclid`
    // 对正除数恒等价于向下取整（floor），能让"哪怕只超期 1 小时也算已超期"
    // 正确落在 remaining_days < 0 这一支。
    let remaining_days = remaining_ms.div_euclid(MS_PER_DAY);

    let level = if remaining_days > WATCH_THRESHOLD_DAYS {
        RetentionRiskLevel::Safe
    } else if remaining_days >= 0 {
        RetentionRiskLevel::Watch
    } else {
        RetentionRiskLevel::Alert
    };

    // 只有 Alert 才附带"可能已丢失"的区间——区间上界是当前保留期保守估计
    // 划出的截止线（now - retention_days），下界是我们本地已知的最早记录
    // 本身；`remaining_days < 0` 已经保证 `earliest < retention_cutoff`，
    // 区间必然是合法的非空闭区间，不需要额外判断谁比谁大。
    let (possible_loss_from, possible_loss_to) = if level == RetentionRiskLevel::Alert {
        let retention_cutoff = now_millis.saturating_sub(retention_span_ms);
        (Some(earliest), Some(retention_cutoff))
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

    fn account(earliest_record_at: Option<i64>, retention_days: Option<i64>) -> Account {
        Account {
            id: 1,
            plugin_id: "genshin".to_string(),
            game_uid: "100000000".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days,
            last_collected_at: None,
            earliest_record_at,
            created_at: 0,
        }
    }

    #[test]
    fn returns_none_when_account_has_no_records_yet() {
        // 没有 earliest_record_at：账号存在但一条记录都没有，没有锚点可算。
        let acc = account(None, Some(168));
        assert_eq!(evaluate_account_retention_risk(&acc, NOW), None);
    }

    #[test]
    fn returns_none_when_plugin_declares_no_retention_policy() {
        // 鸣潮的真实场景：retention_days 是 None，不能默认任何天数。
        let acc = account(Some(NOW - 200 * DAY), None);
        assert_eq!(evaluate_account_retention_risk(&acc, NOW), None);
    }

    #[test]
    fn classifies_safe_when_more_than_thirty_days_of_buffer_remain() {
        // earliest 距过期还有 40 天缓冲（168 天保留期，40 天前刚好够）。
        let retention_days = 168;
        let earliest = NOW - (retention_days - 40) * DAY;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, 40);
        assert_eq!(risk.possible_loss_from, None);
        assert_eq!(risk.possible_loss_to, None);
    }

    #[test]
    fn classifies_watch_at_the_exact_thirty_day_boundary() {
        // 剩余天数恰好等于 30——任务要求"提醒：≤ 30 天"，边界本身归 Watch。
        let retention_days = 168;
        let earliest = NOW - (retention_days - 30) * DAY;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Watch);
        assert_eq!(risk.remaining_days, 30);
    }

    #[test]
    fn classifies_watch_at_thirty_one_days_is_still_safe() {
        // 31 天严格大于阈值——确认"> 30 天安全"的严格不等号方向没有写反。
        let retention_days = 168;
        let earliest = NOW - (retention_days - 31) * DAY;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Safe);
        assert_eq!(risk.remaining_days, 31);
    }

    #[test]
    fn classifies_watch_at_zero_remaining_days() {
        // 剩余 0 天：还没有真的超期，但已经是最后一天，仍属于 Watch 而非 Alert。
        let retention_days = 168;
        let earliest = NOW - retention_days * DAY;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Watch);
        assert_eq!(risk.remaining_days, 0);
    }

    #[test]
    fn classifies_alert_once_past_expiry_and_reports_a_valid_loss_window() {
        // 超期 10 天。
        let retention_days = 168;
        let earliest = NOW - (retention_days + 10) * DAY;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Alert);
        assert_eq!(risk.remaining_days, -10);

        let loss_from = risk.possible_loss_from.expect("Alert 必须带下界");
        let loss_to = risk.possible_loss_to.expect("Alert 必须带上界");
        assert_eq!(loss_from, earliest);
        assert_eq!(loss_to, NOW - retention_days * DAY);
        assert!(loss_from < loss_to, "区间必须是合法的非空闭区间");
    }

    #[test]
    fn classifies_alert_even_when_expired_by_less_than_a_full_day() {
        // 只超期 1 小时——验证 div_euclid 没有被截断成"剩 0 天"误判成 Watch。
        let retention_days = 168;
        let earliest = NOW - retention_days * DAY - 60 * 60 * 1000;
        let acc = account(Some(earliest), Some(retention_days));

        let risk = evaluate_account_retention_risk(&acc, NOW).expect("应当能评估");
        assert_eq!(risk.level, RetentionRiskLevel::Alert);
        assert!(risk.remaining_days < 0);
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
