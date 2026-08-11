//! 稀有度阶梯不得假设 3/4/5。
//!
//! 绝区零实测 `rank_type` 取值 `["2","3","4"]`，最高档是 4，pity_target
//! 同样是 "4"。查询必须走参数化 `WHERE rarity = :pity_target`，接口设计上
//! 不给调用方传字面量常量的机会。

mod common;

use common::{create_test_account, sample_record};
use gs_storage::Storage;

#[test]
fn queries_records_by_non_standard_rarity_ladder() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "zzz");

    // 绝区零形态：ladder ["2","3","4"]，pity_target "4"，最高档不是 5。
    let mut s_rank = sample_record(account_id, "zzz:exclusive-channel", "channel-1:1");
    s_rank.rarity = Some("4".to_string());
    let mut a_rank = sample_record(account_id, "zzz:exclusive-channel", "channel-1:2");
    a_rank.rarity = Some("3".to_string());

    repo.insert_records(&[s_rank, a_rank])
        .expect("插入应当成功");

    // 调用方按插件声明的 pity_target 传参，不是宿主硬编码的字面量。
    let pity_target = "4";
    let hits = repo
        .find_records_by_rarity(account_id, pity_target)
        .expect("查询应当成功");
    assert_eq!(hits.len(), 1, "绝区零最高档是 4，用 4 查询应当命中");
    assert_eq!(hits[0].rarity.as_deref(), Some("4"));

    // 用米哈游三游习惯的字面量 5 去查——不应命中，证明查询本身没有硬编码假设。
    let no_hits = repo
        .find_records_by_rarity(account_id, "5")
        .expect("查询应当成功");
    assert!(
        no_hits.is_empty(),
        "绝区零没有稀有度码 5，若这里命中说明查询里藏了 3/4/5 的硬编码假设"
    );
}
