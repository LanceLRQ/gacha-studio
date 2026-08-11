//! `BaselineProvider::InGamePageCount` 的分析侧消费逻辑：对比
//! `banner_snapshot(source='pagination')` 写入的官方下界与本地
//! `gacha_record` 计数，产出"缺口"结果。
//!
//! 页码基准天生是区间而不是精确值：官方接口按页返回，最后一页可能没
//! 满——异环实证「官方 59 页 × 5 条/页 → 291~295 条，本地实得 286 条」，
//! 正确结论是「缺 5~9 条」而不是「缺 7 条」。本模块的 [`IntegrityGap`]
//! 用两个不同的枚举分支表达"精确值"与"区间"，接口形状上就不给调用方
//! 把区间读成单个数字的机会——`Range` 分支要求先解构出 `min`/`max` 两个
//! 字段，没有能把它直接转换成一个 `i64` 的路径。

use gs_storage::IntegrityRow;

/// 一个整数区间，`min <= max`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrawCountRange {
    pub min: i64,
    pub max: i64,
}

/// 本地记录数与官方基准比对后的缺口结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrityGap {
    /// `v_integrity.official_draws` 为 `NULL`：还没有任何权威/页码快照
    /// 可比对，不下结论（不是"缺 0 条"，是"不知道"）。
    NoBaseline,
    /// 本地记录数已达到或超过官方基准，判定为完整。
    Complete,
    /// 精确基准（塔吉多等权威接口）下的确切缺口条数。
    Exact { missing: i64 },
    /// 页码基准下的缺口区间。宽度取决于 `page_size - 1`——`page_size`
    /// 未知时宽度退化为 0（`min == max`），这不代表"确定缺这么多"，
    /// 只是在缺少页大小信息时能给出的最保守估计，见本模块顶部说明与
    /// 下方 `evaluate_draw_count_gap` 的参数文档。
    Range { missing: DrawCountRange },
}

/// 依据 `row.precision` 决定返回精确值还是区间。
///
/// `page_size` 由调用方显式传入，而不是从 `row` 里读——`v_integrity`
/// 视图目前只从 `banner_snapshot.extra` 里提取了 `precision` 字段，没有
/// 一并提取 `page_size`/`page_count`（迁移 SQL 里写入时两者都在，只是视图
/// 没有 `json_extract` 出来），`gs_storage::Repository` 也没有暴露读取
/// 原始 `extra` JSON 的查询方法。这是本 Stage 发现的一处真实接口缺口，
/// 不在本 crate 里通过绕开 `gs-storage` 或伪造数据来"解决"——按任务边界，
/// `gs-storage` 不是本 Stage 可改的范围，缺口原样记录，留给调用方在
/// 缺口补上前自行提供 `page_size`（若确实拿不到，传 `None`，函数会给出
/// 一个宽度为零、但类型上仍标注为 `Range` 的保守区间，不会伪装成精确值）。
pub fn evaluate_draw_count_gap(row: &IntegrityRow, page_size: Option<u32>) -> IntegrityGap {
    let Some(official) = row.official_draws else {
        return IntegrityGap::NoBaseline;
    };

    let missing = official - row.local_draws;
    if missing <= 0 {
        return IntegrityGap::Complete;
    }

    match row.precision.as_str() {
        "page" => {
            let width = page_size.map_or(0, |size| i64::from(size.saturating_sub(1)));
            IntegrityGap::Range {
                missing: DrawCountRange {
                    min: missing,
                    max: missing + width,
                },
            }
        }
        // "exact" 或视图缺省值：权威接口给的是精确值，不需要展宽成区间。
        _ => IntegrityGap::Exact { missing },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(official_draws: Option<i64>, local_draws: i64, precision: &str) -> IntegrityRow {
        IntegrityRow {
            account_id: 1,
            banner_key: "301".to_string(),
            official_draws,
            local_draws,
            official_rares: None,
            local_rares: 0,
            precision: precision.to_string(),
        }
    }

    #[test]
    fn returns_no_baseline_when_official_draws_is_absent() {
        let row = row(None, 100, "exact");
        assert_eq!(
            evaluate_draw_count_gap(&row, None),
            IntegrityGap::NoBaseline
        );
    }

    #[test]
    fn returns_complete_when_local_meets_or_exceeds_official() {
        let exact_match = row(Some(100), 100, "exact");
        assert_eq!(
            evaluate_draw_count_gap(&exact_match, None),
            IntegrityGap::Complete
        );

        let local_ahead = row(Some(100), 105, "exact");
        assert_eq!(
            evaluate_draw_count_gap(&local_ahead, None),
            IntegrityGap::Complete
        );
    }

    #[test]
    fn returns_exact_missing_count_for_authoritative_precision() {
        let row = row(Some(100), 93, "exact");
        assert_eq!(
            evaluate_draw_count_gap(&row, None),
            IntegrityGap::Exact { missing: 7 }
        );
    }

    #[test]
    fn returns_range_for_page_precision_matching_the_nte_calibration() {
        // 异环实证：official_draws 已经是页码下界 291（(59-1)*5+1），
        // page_size=5，本地 286 条 → 缺 5~9 条，而不是"缺 7 条"。
        let row = row(Some(291), 286, "page");
        let outcome = evaluate_draw_count_gap(&row, Some(5));
        assert_eq!(
            outcome,
            IntegrityGap::Range {
                missing: DrawCountRange { min: 5, max: 9 }
            }
        );
    }

    #[test]
    fn range_outcome_cannot_be_read_as_a_single_number_without_destructuring() {
        let row = row(Some(291), 286, "page");
        let outcome = evaluate_draw_count_gap(&row, Some(5));

        // 唯一能从 Range 里拿到数字的路径是显式解构出 min/max 两个字段——
        // 不存在类似 Exact 分支 `missing: i64` 那样的单一数值字段，
        // 因此无法写出「假装这是精确值」的调用代码（例如 `outcome as i64`
        // 或 `outcome.missing` 均无法编译）。
        let IntegrityGap::Range { missing } = outcome else {
            panic!("page 精度应当产出区间");
        };
        assert_eq!(missing.min, 5);
        assert_eq!(missing.max, 9);
        assert_ne!(
            missing.min, missing.max,
            "验证这确实是一个区间而非退化成单点"
        );
    }

    #[test]
    fn page_precision_without_known_page_size_still_signals_a_range_not_an_exact_value() {
        // page_size 缺失时，接口形状依然返回 Range（宽度退化为 0），
        // 而不是悄悄降级成 Exact——调用方仍然能从类型上看出"这是页码基准"。
        let row = row(Some(291), 286, "page");
        let outcome = evaluate_draw_count_gap(&row, None);
        assert_eq!(
            outcome,
            IntegrityGap::Range {
                missing: DrawCountRange { min: 5, max: 5 }
            }
        );
        assert!(matches!(outcome, IntegrityGap::Range { .. }));
    }
}
