//! 保底计数：与具体游戏的概率曲线无关，只做"计数 + 命中即清零"。
//!
//! [`PityCounter`] 是最底层的原语，[`analyze_pity_group`] 在它之上组合
//! [`gs_core::RaritySpec`]（"哪一档算命中"）与 [`gs_core::PityGroup`]
//! （"共享保底的卡池集合 + 概率曲线"），产出面向展示层的完整报告。

use gs_core::{GachaRecord, GuaranteeRule, PityGroup, ProbabilityCurve, RaritySpec};

/// 记录自上一次命中保底目标以来经过的抽数。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PityCounter {
    since_last_hit: u32,
}

impl PityCounter {
    /// 创建一个从零开始计数的保底计数器。
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录一次抽取结果，返回记录后的计数值。
    ///
    /// `is_target` 为 `true` 表示本次命中保底目标稀有度，计数器随之清零；
    /// 否则计数加一。
    pub fn record_pull(&mut self, is_target: bool) -> u32 {
        if is_target {
            self.since_last_hit = 0;
        } else {
            self.since_last_hit += 1;
        }
        self.since_last_hit
    }

    /// 当前计数值，不修改状态。
    pub fn current(&self) -> u32 {
        self.since_last_hit
    }
}

/// [`ProbabilityCurve`] 在某一抽位置上的取值结果。
///
/// 不用裸 `f64` 作返回类型：`Progressive`（鸣潮渐进概率）与 `Custom`
/// （宿主注册的自定义曲线）本 Stage 都不实现具体数学模型——`Progressive`
/// 的查表数据要等 M2 用真实概率表校准，`Custom` 的公式本就不在 Rust 侧、
/// 由宿主运行时按 `id` 分派。用枚举而不是 `Option<f64>`/`Result<f64, _>`，
/// 是因为调用方需要知道"为什么没有数值"（哪条曲线、什么原因），而不只是
/// "没有"。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CurveEvaluation {
    /// 曲线给出的具体单抽概率。
    Value(f64),
    /// 该曲线分支本 Stage 未实现，携带原因说明供调用方展示或记日志，
    /// 不是 panic——`ProbabilityCurve` 从第一天就要能表达这几种曲线，
    /// 但"表达得出"和"算得出来"是两件事，未实现不代表类型设计有问题。
    Unsupported(&'static str),
}

/// 计算 `curve` 在第 `pull_index` 抽（自上一次命中保底目标以来的第几抽，
/// 从 1 开始计数）时的单抽出货概率。
///
/// `SoftPity { base, start, step }` 的语义照抄 `gs_core::pity` 模块文档：
/// "`start` 抽之前概率恒为 `base`，之后每抽按 `step` 递增"——即
/// `pull_index <= start` 时取 `base`，`pull_index > start` 时每多一抽
/// 加一份 `step`。`step` 的类型是 `u32`，取值语义是"百分点"而不是原始小数
/// （如 `step: 0.06` 表示每抽 +6 个百分点，对应 `gs_core::pity` 模块自身的 round-trip
/// 测试用例，那组取值明显是照着原神"74 抽起每抽 +6%"的公开说法写的）。
/// 结果按 `min(1.0)` 钳制，但**不在这里应用硬保底**——"抽到 `hard_pity`
/// 必出"是 `PityGroup.hard_pity` 的语义，与概率曲线是两个独立的机制，
/// 由 [`analyze_pity_group`] 的调用方按需再叠加判断，不混进曲线取值里。
pub fn evaluate_curve(curve: &ProbabilityCurve, pull_index: u32) -> CurveEvaluation {
    match curve {
        ProbabilityCurve::Flat { base } => CurveEvaluation::Value(*base),
        ProbabilityCurve::SoftPity { base, start, step } => {
            let value = if pull_index <= *start {
                *base
            } else {
                let extra_pulls = (pull_index - start) as f64;
                // `step` 与 `base` 同单位（都是概率分数），不再除以 100——
                // 曾经的 `u32` 百分点表示已作废，理由见 `gs_core::ProbabilityCurve`。
                base + step * extra_pulls
            };
            CurveEvaluation::Value(value.min(1.0))
        }
        ProbabilityCurve::Progressive { .. } => CurveEvaluation::Unsupported(
            "鸣潮渐进概率是查表曲线，具体数值要等 M2 用真实概率表校准后再实现，\
             不能沿用米哈游软保底的等差公式硬凑",
        ),
        ProbabilityCurve::Custom { .. } => CurveEvaluation::Unsupported(
            "custom 曲线的公式不在 Rust 侧定义，由宿主运行时按 id 分派到具体实现，\
             分析引擎本身不解析",
        ),
    }
}

/// 单次保底命中的实际结果："歪"还是命中 UP。
///
/// `Unknown` 不是多余的第三态：判断某次命中是否是 UP 需要知道当期 UP
/// 物品列表，而这份数据目前既不在 [`GachaRecord`] 上（它只有 `item_id`/
/// `rarity`，没有 `is_rate_up`），`gs_storage::Repository` 也没有暴露读取
/// `rare_event.is_rate_up` 列的查询方法（该列本身是 1/0/NULL 三态设计，
/// 见存储数据模型 §3.3）——本 Stage 无法从真实数据里稳定推导出这个值，
/// 用 `false` 顶替"不知道"会把"确认歪了"和"不知道歪没歪"混为一谈，
/// 污染下面的担保状态机。详见本 crate 报告里的"偏差与发现"。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitOutcome {
    RateUp,
    Off,
    Unknown,
}

/// 依次把 `rule` 应用到一串保底命中结果上，返回**每次命中发生时，
/// 该次命中是否处于"大保底"担保状态**（即上一次歪导致这一次必中 UP）。
///
/// 只有 `FiftyFifty` 需要跨命中记忆状态；其余三个分支的语义在单次命中的
/// 粒度上是常量，一并处理只是为了让 `match` 覆盖 `GuaranteeRule` 全部
/// 变体，不构成额外的算法工作量：
/// - `AlwaysRateUp`：定义上就没有"歪"的概念，每次命中都视为担保命中；
/// - `None`：没有担保机制，恒为 `false`；
/// - `Weighted`：担保力度是一个概率而非"是否担保"的布尔命题，本 Stage
///   不展开成具体的加权判定逻辑，恒返回 `false`（既不多算也不少算，
///   调用方若要展示"歪率加权"需要另外消费 `rate_up_chance`）。
///
/// `HitOutcome::Unknown` 不改变已有的担保状态——不知道这一次歪没歪，
/// 就没有依据去翻转状态，维持现状是唯一不引入额外假设的选择。
pub fn apply_guarantee_rule(rule: &GuaranteeRule, hits: &[HitOutcome]) -> Vec<bool> {
    match rule {
        GuaranteeRule::AlwaysRateUp {} => vec![true; hits.len()],
        GuaranteeRule::None {} => vec![false; hits.len()],
        GuaranteeRule::Weighted { .. } => vec![false; hits.len()],
        GuaranteeRule::FiftyFifty {} => {
            let mut guaranteed = false;
            hits.iter()
                .map(|outcome| {
                    let was_guaranteed = guaranteed;
                    match outcome {
                        HitOutcome::Off => guaranteed = true,
                        HitOutcome::RateUp => guaranteed = false,
                        HitOutcome::Unknown => {}
                    }
                    was_guaranteed
                })
                .collect()
        }
    }
}

/// [`PityGroupReport::pulls`] 里的一条明细。
#[derive(Debug, Clone, PartialEq)]
pub struct PityPull {
    /// 记录的原始卡池 id（如 `"301"`/`"400"`），即使这条记录参与的是合并
    /// 计数，这个字段也保留原样——展示层"只看 301"就是对 `pulls` 按这个
    /// 字段过滤，不需要也不应该重新按单一卡池再跑一次保底计数（那样算出的
    /// "距上次命中"会是错的，保底本来就是跨这些卡池共享的）。
    pub banner_key: String,
    pub occurred_at: i64,
    pub item_id: String,
    pub rarity: Option<String>,
    /// 本次抽取距上一次命中 `pity_target` 的抽数（含本次）。
    pub pulls_since_last_hit: u32,
    /// 本次是否命中保底目标稀有度。
    pub is_pity_hit: bool,
}

/// 一个 [`PityGroup`] 维度的完整分析结果。
#[derive(Debug, Clone, PartialEq)]
pub struct PityGroupReport {
    pub pity_group_key: String,
    pub hard_pity: u32,
    /// 逐抽明细，按输入记录的顺序排列（调用方应保证按 `occurred_at`
    /// 升序传入，如 `Repository::find_records_by_pity_group` 的返回值）。
    /// `rarity IS NULL` 的记录不出现在这里，见 `unknown_rarity_count`。
    pub pulls: Vec<PityPull>,
    /// `rarity IS NULL` 的记录数：这些记录**不参与**保底计数（无法判断
    /// 是否命中），但也**不能被静默丢弃**——星铁真实存档里确有 `item_id`
    /// 有值而 `rank_type` 为空串（落库后即 `rarity IS NULL`）的记录，
    /// 必须在结果结构里显式带出这个数字，让 UI 能诚实标注"有 N 条记录
    /// 稀有度未知，未计入保底统计"。
    pub unknown_rarity_count: u32,
    /// 距上一次命中累计抽数，等于 `pulls` 最后一条的 `pulls_since_last_hit`
    /// （序列为空、或最后一条恰好命中时为 0）。
    pub current_pity: u32,
    /// 按 `curve` 计算出的"下一抽命中概率"。
    pub next_pull_probability: CurveEvaluation,
}

/// 计算一个 [`PityGroup`] 的完整保底报告。
///
/// `records` 应当是同一 `pity_group` 下的全部记录（如
/// `Repository::find_records_by_pity_group` 的返回值），按 `occurred_at`
/// 升序——原神 301/400 共享保底正是这样合并计数的真实场景（`research/03`
/// §2.2：301 分组的响应里混有 `gacha_type: "400"` 的记录）。是否命中保底
/// 目标完全由 `rarity.pity_target` 决定，不假设它是任何具体字面量——
/// 绝区零 `RaritySpec { ladder: ["2","3","4"], pity_target: "4" }` 与
/// 米哈游三游的 `["3","4","5"] / "5"` 走的是同一段代码。
pub fn analyze_pity_group(
    group: &PityGroup,
    rarity: &RaritySpec,
    records: &[GachaRecord],
) -> PityGroupReport {
    let mut pulls = Vec::with_capacity(records.len());
    let mut unknown_rarity_count = 0u32;
    let mut counter = PityCounter::new();

    for record in records {
        let Some(rarity_code) = record.rarity.as_ref() else {
            unknown_rarity_count += 1;
            continue;
        };
        let is_hit = *rarity_code == rarity.pity_target;
        // 先读出"这是自上次命中以来的第几抽"（含本次），再更新计数器状态——
        // 顺序不能反：`PityCounter::record_pull` 命中时会立即把状态清零，
        // 若先更新再读，命中的那一抽会显示成 0（"清零后的状态"），而不是
        // 它实际发生在第几抽。这条顺序是本模块唯一容易踩的坑，写测试时
        // 已经踩过一次（`analyze_pity_group_counts_hits_and_resets_on_target_rarity`
        // 一开始就是按错误顺序实现，被这条测试当场抓到）。
        let pulls_since_last_hit = counter.current() + 1;
        counter.record_pull(is_hit);
        pulls.push(PityPull {
            banner_key: record.banner_key.clone(),
            occurred_at: record.occurred_at,
            item_id: record.item_id.clone(),
            rarity: record.rarity.clone(),
            pulls_since_last_hit,
            is_pity_hit: is_hit,
        });
    }

    let current_pity = counter.current();
    let next_pull_probability = evaluate_curve(&group.curve, current_pity + 1);

    PityGroupReport {
        pity_group_key: group.key.clone(),
        hard_pity: group.hard_pity,
        pulls,
        unknown_rarity_count,
        current_pity,
        next_pull_probability,
    }
}

/// 米哈游三游软保底的取值来源：`base: 0.006, start: 74, step: 0.06`——与
/// `gs_core::pity` 自身的 round-trip 测试用例一致，也是
/// `plugins/genshin/manifest.ts` 公开说法"74 抽起每抽 +6%"对应的参数。
/// 定义在 `pity` 模块作用域（而不是下面某一个 `mod tests` 内部），是因为
/// [`soft_pity_boundary`] 与 [`tests`] 两个测试子模块都要用到它。
#[cfg(test)]
fn genshin_soft_pity_test_curve() -> ProbabilityCurve {
    ProbabilityCurve::SoftPity {
        base: 0.006,
        start: 74,
        step: 0.06,
    }
}

/// 74 抽拐点专项测试，单独成模块是为了能用
/// `cargo test -p gs-analysis pity::soft_pity_boundary` 单独筛选——嵌套在
/// 常规的 `mod tests` 里会在路径中插入一段 `tests::`，导致这个过滤字符串
/// 匹配不上任何测试全名。
#[cfg(test)]
mod soft_pity_boundary {
    use super::*;

    #[test]
    fn probability_is_flat_up_to_and_including_start() {
        let curve = genshin_soft_pity_test_curve();
        assert_eq!(evaluate_curve(&curve, 1), CurveEvaluation::Value(0.006));
        assert_eq!(evaluate_curve(&curve, 73), CurveEvaluation::Value(0.006));
        assert_eq!(evaluate_curve(&curve, 74), CurveEvaluation::Value(0.006));
    }

    #[test]
    fn probability_rises_linearly_after_start() {
        let curve = genshin_soft_pity_test_curve();
        let CurveEvaluation::Value(at_75) = evaluate_curve(&curve, 75) else {
            panic!("SoftPity 应当返回具体数值");
        };
        let CurveEvaluation::Value(at_76) = evaluate_curve(&curve, 76) else {
            panic!("SoftPity 应当返回具体数值");
        };
        // 74 抽前后确实不同：75 抽比 74 抽（0.006）高出一整份 step。
        assert!((at_75 - 0.066).abs() < f64::EPSILON);
        // 每多一抽再加一份 step，验证是"线性"而不是一次性跳变。
        assert!((at_76 - 0.126).abs() < f64::EPSILON);
    }

    #[test]
    fn probability_caps_at_one() {
        let curve = genshin_soft_pity_test_curve();
        let CurveEvaluation::Value(value) = evaluate_curve(&curve, 1000) else {
            panic!("SoftPity 应当返回具体数值");
        };
        assert_eq!(value, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_core::{MetaState, RecordKey, RecordSource, TzOrigin};

    #[test]
    fn increments_on_miss_and_resets_on_hit() {
        let mut counter = PityCounter::new();
        assert_eq!(counter.record_pull(false), 1);
        assert_eq!(counter.record_pull(false), 2);
        assert_eq!(counter.record_pull(true), 0);
        assert_eq!(counter.record_pull(false), 1);
        assert_eq!(counter.current(), 1);
    }

    #[test]
    fn evaluate_curve_flat_returns_constant_regardless_of_pull_index() {
        let curve = ProbabilityCurve::Flat { base: 0.02 };
        assert_eq!(evaluate_curve(&curve, 1), CurveEvaluation::Value(0.02));
        assert_eq!(evaluate_curve(&curve, 999), CurveEvaluation::Value(0.02));
    }

    #[test]
    fn evaluate_curve_progressive_and_custom_compile_but_are_unsupported() {
        // 本 Stage 不实现具体数学模型，但 match 必须能穷尽全部分支——
        // 这条测试本身就是"类型能编译通过"这条验收标准的证据。
        let progressive = ProbabilityCurve::Progressive {
            base: 0.008,
            start: 66,
            table: vec![0.008, 0.02],
        };
        assert!(matches!(
            evaluate_curve(&progressive, 70),
            CurveEvaluation::Unsupported(_)
        ));

        let custom = ProbabilityCurve::Custom {
            id: "wuwa-progressive-v1".to_string(),
        };
        assert!(matches!(
            evaluate_curve(&custom, 1),
            CurveEvaluation::Unsupported(_)
        ));
    }

    fn record(
        banner_key: &str,
        pity_group: &str,
        occurred_at: i64,
        item_id: &str,
        rarity: Option<&str>,
    ) -> GachaRecord {
        GachaRecord {
            id: 0,
            account_id: 1,
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
        }
    }

    fn genshin_character_event_wish() -> PityGroup {
        PityGroup {
            key: "characterEventWish".to_string(),
            members: vec!["301".to_string(), "400".to_string()],
            hard_pity: 90,
            curve: genshin_soft_pity_test_curve(),
            guarantee: GuaranteeRule::FiftyFifty {},
        }
    }

    fn genshin_rarity_spec() -> RaritySpec {
        RaritySpec {
            ladder: vec!["3".to_string(), "4".to_string(), "5".to_string()],
            pity_target: "5".to_string(),
        }
    }

    #[test]
    fn analyze_pity_group_counts_hits_and_resets_on_target_rarity() {
        let group = genshin_character_event_wish();
        let spec = genshin_rarity_spec();
        let records = vec![
            record("301", "characterEventWish", 1, "角色A", Some("4")),
            record("301", "characterEventWish", 2, "角色B", Some("4")),
            record("301", "characterEventWish", 3, "角色C", Some("5")),
            record("301", "characterEventWish", 4, "角色D", Some("3")),
        ];

        let report = analyze_pity_group(&group, &spec, &records);

        assert_eq!(report.pulls.len(), 4);
        assert_eq!(report.pulls[0].pulls_since_last_hit, 1);
        assert_eq!(report.pulls[1].pulls_since_last_hit, 2);
        assert!(report.pulls[2].is_pity_hit);
        assert_eq!(report.pulls[2].pulls_since_last_hit, 3);
        // 命中之后清零重新计数。
        assert_eq!(report.pulls[3].pulls_since_last_hit, 1);
        assert_eq!(report.current_pity, 1);
        assert_eq!(report.unknown_rarity_count, 0);
    }

    #[test]
    fn analyze_pity_group_merges_shared_members_while_retaining_original_banner_key() {
        // 301 与 400 混合出现，模拟原神真实响应里同一分组内 gacha_type
        // 混有 "301"/"400" 两种取值（research/03 §2.2）。
        let group = genshin_character_event_wish();
        let spec = genshin_rarity_spec();
        let records = vec![
            record("301", "characterEventWish", 1, "角色A", Some("4")),
            record("400", "characterEventWish", 2, "角色B", Some("4")),
            record("301", "characterEventWish", 3, "角色C", Some("5")),
        ];

        let report = analyze_pity_group(&group, &spec, &records);

        // 合并计数：第 3 条记录（跨两个 banner_key）在第 3 抽命中，
        // 不是"各自独立从 1 数起"。
        assert_eq!(report.pulls[2].pulls_since_last_hit, 3);
        assert!(report.pulls[2].is_pity_hit);

        // 但原始 banner_key 逐条保留，展示层按它过滤即可还原"只看 301"。
        let only_301: Vec<_> = report
            .pulls
            .iter()
            .filter(|pull| pull.banner_key == "301")
            .collect();
        assert_eq!(only_301.len(), 2);
        let only_400: Vec<_> = report
            .pulls
            .iter()
            .filter(|pull| pull.banner_key == "400")
            .collect();
        assert_eq!(only_400.len(), 1);
    }

    #[test]
    fn analyze_pity_group_excludes_null_rarity_from_counting_but_reports_it() {
        let group = genshin_character_event_wish();
        let spec = genshin_rarity_spec();
        let records = vec![
            record("301", "characterEventWish", 1, "角色A", Some("4")),
            // 字典未同步导致 rarity 为空串，落库时已被 gs-storage 规整为
            // NULL（见 repository.rs 的 normalize_empty），这里直接构造
            // rarity: None 模拟这条记录。
            record("301", "characterEventWish", 2, "神秘物品", None),
            record("301", "characterEventWish", 3, "角色C", Some("5")),
        ];

        let report = analyze_pity_group(&group, &spec, &records);

        // 未知稀有度的记录不出现在 pulls 里，也不占用一次计数位。
        assert_eq!(report.pulls.len(), 2);
        assert_eq!(report.pulls[1].pulls_since_last_hit, 2);
        // 但计数不为零地被带出来，不是悄悄丢弃。
        assert_eq!(report.unknown_rarity_count, 1);
    }

    #[test]
    fn analyze_pity_group_supports_non_standard_ladder_like_zzz() {
        // 绝区零形态：最高档是 4，不是 5。这条测试若在实现里混进任何
        // "rarity == 5" 之类的字面量假设，pity_target="4" 就永远不会命中，
        // 保底统计会静默全部为零。
        let group = PityGroup {
            key: "zzzAgentEvent".to_string(),
            members: vec!["agent-event".to_string()],
            hard_pity: 90,
            curve: ProbabilityCurve::SoftPity {
                base: 0.01,
                start: 65,
                step: 0.08,
            },
            guarantee: GuaranteeRule::FiftyFifty {},
        };
        let spec = RaritySpec {
            ladder: vec!["2".to_string(), "3".to_string(), "4".to_string()],
            pity_target: "4".to_string(),
        };
        let records = vec![
            record("agent-event", "zzzAgentEvent", 1, "邦布A", Some("2")),
            record("agent-event", "zzzAgentEvent", 2, "邦布B", Some("3")),
            record("agent-event", "zzzAgentEvent", 3, "代理人C", Some("4")),
        ];

        let report = analyze_pity_group(&group, &spec, &records);

        assert!(report.pulls[2].is_pity_hit);
        assert_eq!(report.current_pity, 0);
    }

    #[test]
    fn apply_guarantee_rule_fifty_fifty_forces_rate_up_right_after_off() {
        // 一段自洽的真实历史：歪了之后下一次必中 UP（否则数据本身就不
        // 符合 FiftyFifty 语义，不是这个状态机要处理的问题）。
        let hits = [
            HitOutcome::Off,
            HitOutcome::RateUp,
            HitOutcome::RateUp,
            HitOutcome::Off,
            HitOutcome::RateUp,
        ];
        let guaranteed = apply_guarantee_rule(&GuaranteeRule::FiftyFifty {}, &hits);
        assert_eq!(guaranteed, vec![false, true, false, false, true]);
    }

    #[test]
    fn apply_guarantee_rule_fifty_fifty_keeps_state_across_unknown_outcome() {
        let hits = [HitOutcome::Off, HitOutcome::Unknown, HitOutcome::RateUp];
        let guaranteed = apply_guarantee_rule(&GuaranteeRule::FiftyFifty {}, &hits);
        // Unknown 不翻转状态：第二次命中虽然结果未知，但担保状态仍然是
        // "处于大保底"，如实报告，而不是因为不知道就悄悄清零。
        assert_eq!(guaranteed, vec![false, true, true]);
    }

    #[test]
    fn apply_guarantee_rule_always_rate_up_marks_every_hit() {
        let hits = [HitOutcome::RateUp, HitOutcome::RateUp];
        let guaranteed = apply_guarantee_rule(&GuaranteeRule::AlwaysRateUp {}, &hits);
        assert_eq!(guaranteed, vec![true, true]);
    }

    #[test]
    fn apply_guarantee_rule_none_never_marks_guaranteed() {
        let hits = [HitOutcome::Off, HitOutcome::RateUp];
        let guaranteed = apply_guarantee_rule(&GuaranteeRule::None {}, &hits);
        assert_eq!(guaranteed, vec![false, false]);
    }
}
