//! 两个视图的关键契约：
//! - `v_unknown_banner` 必须用 LEFT JOIN——未收录卡池的记录不能因为
//!   INNER JOIN 而从结果里消失；
//! - `v_integrity` 暴露 `precision` 字段，区分页码基准（区间估计）与
//!   权威基准（精确值），UI 不得把区间估计显示成精确值。

mod common;

use common::{create_test_account, sample_record};
use gs_storage::{NewBannerMeta, NewBannerSnapshot, SnapshotOrigin, Storage};

#[test]
fn unknown_banner_view_lists_banners_without_banner_meta_row() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    // 一个卡池有 banner_meta 收录，一个没有。
    repo.upsert_banner_meta(&NewBannerMeta {
        plugin_id: "genshin".to_string(),
        banner_key: "genshin:character-event".to_string(),
        pity_group: "genshin:character-event-shared".to_string(),
        name: Some("角色活动祈愿".to_string()),
        start_at: None,
        end_at: None,
        rate_up_items: None,
        pity_max: Some(90),
        curve_type: Some("softPity".to_string()),
        guarantee_rule: Some("fiftyFifty".to_string()),
        data_ver: 1,
    })
    .expect("写入 banner_meta 应当成功");

    let known = sample_record(account_id, "genshin:character-event", "301:1");
    let unknown = sample_record(account_id, "genshin:new-pool-not-yet-catalogued", "999:1");
    repo.insert_records(&[known, unknown])
        .expect("插入应当成功");

    let rows = repo.unknown_banners().expect("查询应当成功");
    assert_eq!(rows.len(), 1, "只有未收录的那个卡池应当出现在视图里");
    assert_eq!(rows[0].banner_key, "genshin:new-pool-not-yet-catalogued");
    assert_eq!(
        rows[0].record_count, 1,
        "未收录卡池的记录必须能在视图里被看见，不能因为 JOIN 不到元数据就消失"
    );

    // 已收录的卡池不出现在这个视图里，但它的记录本身仍然完好，
    // 证明 LEFT JOIN 没有连带丢失已知卡池的记录（用 INNER JOIN 才会丢）。
    let known_records = repo
        .find_records_by_banner(account_id, "genshin:character-event")
        .expect("查询应当成功");
    assert_eq!(known_records.len(), 1);
}

#[test]
fn integrity_view_exposes_page_precision_for_pagination_baseline() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "nte");

    // 页码基准：采集通道翻页时顺手记录，draw_count 是区间下界。
    repo.insert_banner_snapshot(&NewBannerSnapshot {
        account_id,
        banner_key: "nte:limited".to_string(),
        captured_at: 1_754_800_000_000,
        draw_count: Some(291),
        rare_count: None,
        pity_current: None,
        pity_max: Some(90),
        origin: SnapshotOrigin::Authoritative,
        source: "pagination".to_string(),
        extra: Some(r#"{"page_count":59,"page_size":5,"precision":"page"}"#.to_string()),
    })
    .expect("写入快照应当成功");

    let rows = repo.integrity_report().expect("查询应当成功");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].precision, "page",
        "页码基准必须能被 UI 识别为区间估计，不得显示成伪精确值"
    );
}

#[test]
fn integrity_view_defaults_precision_to_exact_when_absent() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "nte");

    // 权威基准（如塔吉多）给的是精确值，extra 不带 precision 键。
    repo.insert_banner_snapshot(&NewBannerSnapshot {
        account_id,
        banner_key: "nte:limited".to_string(),
        captured_at: 1_754_800_000_000,
        draw_count: Some(295),
        rare_count: Some(5),
        pity_current: None,
        pity_max: Some(90),
        origin: SnapshotOrigin::Authoritative,
        source: "tajiduo".to_string(),
        extra: None,
    })
    .expect("写入快照应当成功");

    let rows = repo.integrity_report().expect("查询应当成功");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].precision, "exact",
        "extra 里没有 precision 键时应当默认视为 exact"
    );
}
