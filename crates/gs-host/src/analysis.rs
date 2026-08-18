//! 保底进度 / 稀有度分布 / 跨账号概览统计的编排逻辑。
//!
//! 与 [`crate::archive`] 同样的纪律：不碰 Tauri、不碰文件系统，只接收
//! `&Repository` 与标识符参数，可以直接用内存库单元测试。
//!
//! `gs-analysis` 已经有 [`gs_analysis::analyze_pity_group`]/
//! [`gs_analysis::rarity_distribution`] 这些纯计算函数，本模块不重新实现
//! 任何一个——只做三件事：① 按账号的 `plugin_id` 从 manifest 取出计算需要的
//! `RaritySpec`/`PityGroup`（`gs_analysis::manifest_lookup` 那一层）；
//! ② 从存储层取出对应的记录；③ 把计算结果投影成 [`crate::views`] 里定义的
//! 可序列化视图类型。

use std::collections::BTreeMap;

use gs_analysis::{CurveEvaluation, HitOutcome, PityGroupReport, PityPull, RarityDistribution};
use gs_core::{GsError, PityGroup};
use gs_storage::Repository;

use crate::views::{
    AccountAnalysisView, CurveEvaluationView, HitOutcomeView, MonthlyActivityView,
    OverviewStatsView, PityGroupProgressView, PityPullView, PluginRarityDistributionView,
    RarityDistributionView,
};

/// 单个账号的保底进度 + 稀有度分布，游戏详情页与记录明细表"保底内第几抽"
/// 列的数据来源，见 [`AccountAnalysisView`] 的文档。
///
/// `account_id` 对应的账号必须已存在——不存在时返回
/// [`GsError::Validation`]，不是 panic：账号 id 由前端拼参数传入，"传了一个
/// 不存在的 id"是可预期的调用方错误，不是本进程内部不变量被破坏。
pub fn account_analysis(
    repo: &Repository<'_>,
    account_id: i64,
) -> Result<AccountAnalysisView, GsError> {
    let account = repo.find_account(account_id)?.ok_or_else(|| {
        GsError::Validation(format!("账号 id={account_id} 不存在于本地库中，无法分析"))
    })?;

    let rarity_spec = gs_analysis::rarity_spec_for(&account.plugin_id);
    let pity_groups = gs_analysis::pity_groups_for(&account.plugin_id);

    let mut pity_progress = Vec::with_capacity(pity_groups.len());
    for group in &pity_groups {
        let records = repo.find_records_by_pity_group(account_id, &group.key)?;
        let report = gs_analysis::analyze_pity_group(group, &rarity_spec, &records);

        // "顶级记录是否歪"这一列的数据来源：在内存里重新跑一遍
        // derive_rare_events（纯函数，不碰库），不依赖 `rare_event` 表已经
        // 落过盘——那张表当前还没有任何写入路径接上（见
        // `gs_analysis::rare_event` 模块文档），account_analysis 本来就是
        // 每次都从 GachaRecord 现算 pity_progress，这里保持同一套架构，
        // 不新引入"必须先跑过一次派生写入"这个前提。`derived.events` 的
        // 顺序与 `report.pulls` 里 `is_pity_hit == true` 的子序列一一对应
        // ——两者内部都是同一次 analyze_pity_group 调用产出的结果，见
        // `derive_rare_events` 的文档。
        let derived = gs_analysis::derive_rare_events(group, &rarity_spec, &records);
        let hit_outcomes: Vec<HitOutcome> = derived
            .events
            .iter()
            .map(|event| gs_analysis::hit_outcome_from_is_rate_up(event.is_rate_up))
            .collect();

        pity_progress.push(pity_group_progress_view(group, report, &hit_outcomes));
    }

    // 稀有度分布覆盖账号名下**全部**记录，不局限于声明过保底组的卡池——
    // 与 pity_progress 只覆盖 manifest.pityGroups 声明过的卡池是两件不同
    // 的事，游戏详情页两块数据的覆盖范围本来就不同（保底进度天然只对
    // 声明了保底的卡池有意义，稀有度分布则是全账号维度的统计）。
    let all_records = repo.find_all_records_for_account(account_id)?;
    let distribution = gs_analysis::rarity_distribution(&all_records, &rarity_spec);

    Ok(AccountAnalysisView {
        pity_progress,
        rarity_distribution: rarity_distribution_view(distribution),
    })
}

/// 按自然月聚合某个账号的抽卡活动，游戏详情页"抽卡时间线（按月）"的数据
/// 来源。聚合本身在 SQL 里完成（[`gs_storage::Repository::monthly_activity`]），
/// 本函数只负责解析出该账号所属插件的顶级保底目标稀有度码（不是字面量
/// `"5"`——绝区零是 `"4"`），再把查询结果投影成 IPC 视图。
///
/// `account_id` 对应的账号必须已存在，理由与错误形态同 [`account_analysis`]。
pub fn monthly_activity(
    repo: &Repository<'_>,
    account_id: i64,
) -> Result<Vec<MonthlyActivityView>, GsError> {
    let account = repo.find_account(account_id)?.ok_or_else(|| {
        GsError::Validation(format!(
            "账号 id={account_id} 不存在于本地库中，无法统计月度活动"
        ))
    })?;

    let rarity_spec = gs_analysis::rarity_spec_for(&account.plugin_id);
    let rows = repo.monthly_activity(account_id, &rarity_spec.pity_target)?;

    Ok(rows
        .into_iter()
        .map(|row| MonthlyActivityView {
            month: row.month,
            draws: row.draws,
            top_tier_hits: row.top_tier_hits,
        })
        .collect())
}

/// 跨账号概览统计，总览页"跨游戏数据"这一块的数据来源。
///
/// 稀有度分布按插件分组、不摊平成一份跨游戏统计——理由见
/// [`OverviewStatsView`] 的文档。
pub fn overview_stats(repo: &Repository<'_>) -> Result<OverviewStatsView, GsError> {
    let accounts = repo.list_accounts()?;

    let mut total_draws: i64 = 0;
    let mut total_pity_target_hits: i64 = 0;
    let mut by_plugin: BTreeMap<String, RarityDistribution> = BTreeMap::new();

    for account in &accounts {
        let records = repo.find_all_records_for_account(account.id)?;
        // “抽数”按 perRecord 语义计数（记录条数），见 OverviewStatsView 文档
        // 里对 total_draws 的说明——当前四个已注册插件均未声明
        // drawCounting: custom，这个假设成立。
        total_draws += records.len() as i64;

        let rarity_spec = gs_analysis::rarity_spec_for(&account.plugin_id);
        let distribution = gs_analysis::rarity_distribution(&records, &rarity_spec);
        total_pity_target_hits += i64::from(
            distribution
                .counts
                .get(&rarity_spec.pity_target)
                .copied()
                .unwrap_or(0),
        );

        merge_rarity_distribution(
            by_plugin.entry(account.plugin_id.clone()).or_default(),
            &distribution,
        );
    }

    Ok(OverviewStatsView {
        accounts_count: accounts.len() as i64,
        games_count: by_plugin.len() as i64,
        total_draws,
        total_pity_target_hits,
        rarity_by_plugin: by_plugin
            .into_iter()
            .map(|(plugin_id, distribution)| PluginRarityDistributionView {
                plugin_id,
                distribution: rarity_distribution_view(distribution),
            })
            .collect(),
    })
}

fn pity_group_progress_view(
    group: &PityGroup,
    report: PityGroupReport,
    hit_outcomes: &[HitOutcome],
) -> PityGroupProgressView {
    // `hit_outcomes` 只覆盖 `is_pity_hit == true` 的那些 pull（对应
    // derive_rare_events 内部的 filter），按 occurred_at 升序，与
    // `report.pulls` 里同样按 occurred_at 升序出现的命中子序列一一对应——
    // 用一个游标顺序消费，不是按下标散取。
    let mut hit_outcomes = hit_outcomes.iter();
    PityGroupProgressView {
        pity_group_key: report.pity_group_key,
        guarantee: group.guarantee.clone(),
        hard_pity: report.hard_pity,
        current_pity: report.current_pity,
        next_pull_probability: curve_evaluation_view(report.next_pull_probability),
        unknown_rarity_count: report.unknown_rarity_count,
        pulls: report
            .pulls
            .into_iter()
            .map(|pull| {
                let hit_outcome = if pull.is_pity_hit {
                    hit_outcomes
                        .next()
                        .map(|outcome| hit_outcome_view(*outcome))
                } else {
                    None
                };
                pity_pull_view(pull, hit_outcome)
            })
            .collect(),
    }
}

fn pity_pull_view(pull: PityPull, hit_outcome: Option<HitOutcomeView>) -> PityPullView {
    PityPullView {
        banner_key: pull.banner_key,
        occurred_at: pull.occurred_at,
        item_id: pull.item_id,
        rarity: pull.rarity,
        pulls_since_last_hit: pull.pulls_since_last_hit,
        is_pity_hit: pull.is_pity_hit,
        record_id: pull.record_id,
        unknown_rarity_since_last_hit: pull.unknown_rarity_since_last_hit,
        hit_outcome,
    }
}

fn hit_outcome_view(outcome: HitOutcome) -> HitOutcomeView {
    match outcome {
        HitOutcome::RateUp => HitOutcomeView::RateUp,
        HitOutcome::Off => HitOutcomeView::Off,
        HitOutcome::Unknown => HitOutcomeView::Unknown,
    }
}

fn curve_evaluation_view(evaluation: CurveEvaluation) -> CurveEvaluationView {
    match evaluation {
        CurveEvaluation::Value(value) => CurveEvaluationView::Value { value },
        CurveEvaluation::Unsupported(reason) => CurveEvaluationView::Unsupported {
            reason: reason.to_string(),
        },
    }
}

fn rarity_distribution_view(distribution: RarityDistribution) -> RarityDistributionView {
    RarityDistributionView {
        counts: distribution.counts,
        unknown_count: distribution.unknown_count,
        unrecognized_count: distribution.unrecognized_count,
    }
}

/// 把 `add` 累加进 `acc`，供 [`overview_stats`] 合并同一插件下多个账号各自
/// 算出的 [`RarityDistribution`]——`gs_analysis::RarityDistribution` 没有
/// `Add`/`AddAssign` 实现（它的定位是单次统计结果，不是累加器），合并逻辑
/// 因此落在调用方这里，不反过来给分析引擎的纯数据类型加一个只有本模块用得
/// 到的运算符重载。
fn merge_rarity_distribution(acc: &mut RarityDistribution, add: &RarityDistribution) {
    for (code, count) in &add.counts {
        *acc.counts.entry(code.clone()).or_insert(0) += count;
    }
    acc.unknown_count += add.unknown_count;
    acc.unrecognized_count += add.unrecognized_count;
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_core::{GachaRecord, MetaState, RecordKey, RecordSource, TzOrigin};
    use gs_storage::{NewAccount, Storage};

    /// 2026-08-15T10:00:00Z，供 `monthly_activity` 相关测试复用。
    const AUG_15_MS: i64 = 1_786_788_000_000;

    fn create_account(repo: &Repository<'_>, plugin_id: &str, game_uid: &str) -> i64 {
        repo.create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: game_uid.to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: Some(168),
            created_at: 1_754_800_000_000,
        })
        .expect("创建测试账号应当成功")
    }

    /// `pity_group` 必须显式传入，不能从 `banner_key` 自动派生——落库时这一列
    /// 存的是"这条记录归属哪个共享保底组"，由采集/导入流程按 manifest
    /// `pityGroups[].members` 反查得到；`find_records_by_pity_group` 正是按
    /// 这一列查询（而不是按 `banner_key`），测试数据必须还原这条真实关系，
    /// 否则 `account_analysis` 从 manifest 拿到的 `PityGroup.key`
    /// （如 `"characterEventWish"`）永远查不到任何记录。未被任何保底组声明
    /// 覆盖的卡池自成一组，`pity_group` 就是它自己的 `banner_key`——与
    /// `gs-analysis::banner_meta_seed::genshin_banner_meta_seed` 的约定一致。
    fn record(
        account_id: i64,
        banner_key: &str,
        pity_group: &str,
        occurred_at: i64,
        item_id: &str,
        rarity: Option<&str>,
    ) -> GachaRecord {
        GachaRecord {
            id: 0,
            account_id,
            banner_key: banner_key.to_string(),
            pity_group: pity_group.to_string(),
            record_key: RecordKey::new(format!("{banner_key}:{occurred_at}:{item_id}")).unwrap(),
            lang: None,
            occurred_at,
            occurred_raw: occurred_at.to_string(),
            tz_origin: TzOrigin::Assumed,
            tz_offset_min: None,
            seq_in_batch: None,
            item_id: item_id.to_string(),
            item_type: None,
            rarity: rarity.map(str::to_string),
            qty: 1,
            meta_state: MetaState::Complete,
            source: RecordSource::OfficialApi,
            captured_at: occurred_at,
            raw_ref: None,
            extra: None,
            stable_id: None,
            gacha_id: None,
        }
    }

    #[test]
    fn account_analysis_rejects_unknown_account_id() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();

        let err = account_analysis(&repo, 999).expect_err("不存在的账号应当报错，不是 panic");
        assert!(matches!(err, GsError::Validation(_)));
    }

    #[test]
    fn account_analysis_reports_pity_progress_only_for_declared_pity_groups() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let account_id = create_account(&repo, "genshin", "100000000");

        // 301/400 共享 characterEventWish 保底组：两条未命中 + 一条命中。
        let mut in_group = vec![
            record(
                account_id,
                "301",
                "characterEventWish",
                1,
                "角色A",
                Some("4"),
            ),
            record(
                account_id,
                "400",
                "characterEventWish",
                2,
                "角色B",
                Some("4"),
            ),
            record(
                account_id,
                "301",
                "characterEventWish",
                3,
                "角色C",
                Some("5"),
            ),
        ];
        // 200（常驻祈愿）不属于任何 pityGroups 声明，自成一组（pity_group ==
        // 自己的 banner_key），用来验证它不会出现在 pity_progress 里，但
        // 仍然计入稀有度分布。
        let mut not_in_group = vec![record(account_id, "200", "200", 4, "武器D", Some("3"))];
        in_group.append(&mut not_in_group);
        repo.insert_records(&in_group).expect("插入应当成功");

        let analysis = account_analysis(&repo, account_id).expect("分析应当成功");

        assert_eq!(
            analysis.pity_progress.len(),
            1,
            "genshin manifest 只声明了一个保底组"
        );
        let group = &analysis.pity_progress[0];
        assert_eq!(group.pity_group_key, "characterEventWish");
        assert_eq!(group.hard_pity, 90);
        assert_eq!(group.pulls.len(), 3, "只有 301/400 三条记录参与这个保底组");
        assert!(group.pulls.iter().all(|p| p.banner_key != "200"));
        assert!(group.pulls[2].is_pity_hit);
        assert_eq!(group.current_pity, 0, "命中之后清零");

        // 200 的记录不出现在任何 pity_progress 里，但仍然计入全账号的
        // 稀有度分布——两块数据覆盖范围不同是有意的，不是遗漏。
        assert_eq!(analysis.rarity_distribution.counts["3"], 1);
        assert_eq!(analysis.rarity_distribution.counts["4"], 2);
        assert_eq!(analysis.rarity_distribution.counts["5"], 1);
    }

    #[test]
    fn account_analysis_exposes_guarantee_rule_and_hit_outcome_for_top_tier_pulls() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let account_id = create_account(&repo, "genshin", "100000000");

        repo.insert_records(&[
            // 未命中，hit_outcome 必须是 None——"是否歪"对非命中的 pull
            // 没有意义。
            record(
                account_id,
                "301",
                "characterEventWish",
                1,
                "角色A",
                Some("4"),
            ),
            // 命中：genshin 的 characterEventWish 组是 fiftyFifty，但当前
            // 没有任何数据源能提供当期 UP 物品列表，hit_outcome 因此必须是
            // Some(Unknown)——不能被静默当成"没歪"。
            record(
                account_id,
                "301",
                "characterEventWish",
                2,
                "角色B",
                Some("5"),
            ),
        ])
        .expect("插入应当成功");

        let analysis = account_analysis(&repo, account_id).expect("分析应当成功");
        let group = &analysis.pity_progress[0];

        assert_eq!(
            group.guarantee,
            gs_core::GuaranteeRule::FiftyFifty {},
            "genshin characterEventWish 声明的是 fiftyFifty，界面据此判断是否渲染「是否歪」列"
        );
        assert_eq!(
            group.pulls[0].hit_outcome, None,
            "未命中保底目标的 pull，「是否歪」不适用"
        );
        assert_eq!(
            group.pulls[1].hit_outcome,
            Some(HitOutcomeView::Unknown),
            "命中了，但当前没有 UP 物品列表数据源，必须如实显示「不知道」，不能伪装成「没歪」"
        );
    }

    #[test]
    fn account_analysis_pulls_carry_record_id_for_joining_with_the_record_table() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let account_id = create_account(&repo, "genshin", "100000000");
        repo.insert_records(&[record(
            account_id,
            "301",
            "characterEventWish",
            1,
            "角色A",
            Some("5"),
        )])
        .expect("插入应当成功");

        let analysis = account_analysis(&repo, account_id).expect("分析应当成功");
        let pull = &analysis.pity_progress[0].pulls[0];

        // record_id 必须是真实落库后的自增主键（不是占位的 0），前端才能
        // 拿它去关联 list_records 返回的某一行。
        assert!(pull.record_id > 0);
    }

    #[test]
    fn account_analysis_supports_zzzs_non_standard_ladder_and_multiple_pity_groups() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let account_id = create_account(&repo, "zzz", "10000001");

        // 绝区零最高档是 "4"，命中判定必须走这个值，不是字面量 "5"。
        repo.insert_records(&[
            record(account_id, "2", "exclusiveChannel", 1, "代理人A", Some("3")),
            record(account_id, "2", "exclusiveChannel", 2, "代理人B", Some("4")),
        ])
        .expect("插入应当成功");

        let analysis = account_analysis(&repo, account_id).expect("分析应当成功");

        assert_eq!(
            analysis.pity_progress.len(),
            6,
            "zzz manifest 声明了 6 个保底组"
        );
        let exclusive = analysis
            .pity_progress
            .iter()
            .find(|g| g.pity_group_key == "exclusiveChannel")
            .expect("应当有 exclusiveChannel 组");
        assert_eq!(exclusive.pulls.len(), 2);
        assert!(exclusive.pulls[1].is_pity_hit, "第二条 4 档记录应当命中");
    }

    #[test]
    fn overview_stats_merges_rarity_across_multiple_accounts_of_the_same_plugin() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let first = create_account(&repo, "genshin", "100000000");
        let second = create_account(&repo, "genshin", "200000000");

        // overview_stats 不消费 pity_group（它只走 rarity_distribution，不走
        // find_records_by_pity_group），这里的取值对本测试的断言没有影响。
        repo.insert_records(&[record(
            first,
            "301",
            "characterEventWish",
            1,
            "角色A",
            Some("5"),
        )])
        .expect("插入应当成功");
        repo.insert_records(&[record(
            second,
            "301",
            "characterEventWish",
            2,
            "角色B",
            Some("5"),
        )])
        .expect("插入应当成功");

        let stats = overview_stats(&repo).expect("统计应当成功");

        assert_eq!(stats.accounts_count, 2);
        assert_eq!(stats.games_count, 1, "两个账号同属一个插件，只算一个游戏");
        assert_eq!(stats.total_draws, 2);
        assert_eq!(stats.total_pity_target_hits, 2);
        assert_eq!(stats.rarity_by_plugin.len(), 1);
        assert_eq!(stats.rarity_by_plugin[0].distribution.counts["5"], 2);
    }

    #[test]
    fn overview_stats_keeps_different_plugins_rarity_ladders_separate() {
        // 绝区零 "4" 是最高档，原神 "4" 是四星——若实现里把两个插件的分布
        // 合并成一份扁平表，这条测试会因为 "4" 的计数被错误相加而失败。
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let genshin_account = create_account(&repo, "genshin", "100000000");
        let zzz_account = create_account(&repo, "zzz", "10000001");

        repo.insert_records(&[record(
            genshin_account,
            "301",
            "characterEventWish",
            1,
            "角色A",
            Some("4"),
        )])
        .expect("插入应当成功");
        repo.insert_records(&[record(
            zzz_account,
            "2",
            "exclusiveChannel",
            2,
            "代理人B",
            Some("4"),
        )])
        .expect("插入应当成功");

        let stats = overview_stats(&repo).expect("统计应当成功");

        assert_eq!(stats.games_count, 2);
        assert_eq!(stats.rarity_by_plugin.len(), 2);
        let genshin_dist = stats
            .rarity_by_plugin
            .iter()
            .find(|p| p.plugin_id == "genshin")
            .expect("应当有 genshin 的分布");
        let zzz_dist = stats
            .rarity_by_plugin
            .iter()
            .find(|p| p.plugin_id == "zzz")
            .expect("应当有 zzz 的分布");
        assert_eq!(genshin_dist.distribution.counts["4"], 1);
        assert_eq!(zzz_dist.distribution.counts["4"], 1);
        // 原神 "4" 是四星，不是保底目标（"5" 才是）；绝区零 "4" 才是保底
        // 目标——两个账号各出一次命中，互不影响。
        assert_eq!(
            stats.total_pity_target_hits, 1,
            "只有绝区零那条 4 档记录命中了它自己的 pity_target"
        );
    }

    #[test]
    fn monthly_activity_rejects_unknown_account_id() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();

        let err = monthly_activity(&repo, 999).expect_err("不存在的账号应当报错，不是 panic");
        assert!(matches!(err, GsError::Validation(_)));
    }

    #[test]
    fn monthly_activity_resolves_the_accounts_own_pity_target_not_a_literal_five() {
        // 绝区零形态：顶级保底目标是 "4"，不是米哈游三游习惯的 "5"——
        // 这条测试锁死 monthly_activity 走 rarity_spec_for(plugin_id).pity_target，
        // 而不是任何硬编码的稀有度字面量。
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();
        let account_id = create_account(&repo, "zzz", "10000001");

        repo.insert_records(&[
            record(
                account_id,
                "2",
                "exclusiveChannel",
                AUG_15_MS,
                "代理人A",
                Some("3"),
            ),
            record(
                account_id,
                "2",
                "exclusiveChannel",
                AUG_15_MS,
                "代理人B",
                Some("4"),
            ),
        ])
        .expect("插入应当成功");

        let months = monthly_activity(&repo, account_id).expect("统计应当成功");

        assert_eq!(months.len(), 1);
        assert_eq!(months[0].month, "2026-08");
        assert_eq!(months[0].draws, 2);
        assert_eq!(
            months[0].top_tier_hits, 1,
            "只有 rarity=\"4\" 那条应当算命中，用字面量 \"5\" 去查会得到 0"
        );
    }

    #[test]
    fn overview_stats_on_empty_database_returns_zeroed_stats_not_an_error() {
        let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
        let repo = storage.repository();

        let stats = overview_stats(&repo).expect("空库也应当能统计成功");

        assert_eq!(stats.accounts_count, 0);
        assert_eq!(stats.games_count, 0);
        assert_eq!(stats.total_draws, 0);
        assert_eq!(stats.total_pity_target_hits, 0);
        assert!(stats.rarity_by_plugin.is_empty());
    }
}
