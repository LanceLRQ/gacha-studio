//! `RecordFilter` 的筛选契约：稀有度 / 时间区间 / 物品名搜索三项新筛选条件
//! 必须同时对 `find_records_paged` 与 `count_records` 生效——两者筛选条件
//! 不一致时，分页器算出的总页数会和实际翻页结果对不上（`repository.rs` 里
//! `count_records` 的文档已经点出这条纪律，这里用测试守住它，不是只写在
//! 注释里）。

mod common;

use common::{create_test_account, sample_record};
use gs_storage::{RecordFilter, Storage};

#[test]
fn filters_by_a_set_of_rarity_values() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let mut three_star = sample_record(account_id, "301", "301:1");
    three_star.rarity = Some("3".to_string());
    let mut four_star = sample_record(account_id, "301", "301:2");
    four_star.rarity = Some("4".to_string());
    let mut five_star = sample_record(account_id, "301", "301:3");
    five_star.rarity = Some("5".to_string());
    repo.insert_records(&[three_star, four_star, five_star])
        .expect("插入应当成功");

    let rarities = vec!["4".to_string(), "5".to_string()];
    let filter = RecordFilter {
        rarities: Some(&rarities),
        ..Default::default()
    };

    let hits = repo
        .find_records_paged(account_id, &filter, 10, 0)
        .expect("查询应当成功");
    let total = repo
        .count_records(account_id, &filter)
        .expect("计数应当成功");

    assert_eq!(hits.len(), 2, "只应命中 4 星与 5 星两条");
    assert_eq!(
        total, 2,
        "count_records 必须和 find_records_paged 的命中数一致"
    );
    assert!(hits.iter().all(|r| r.rarity.as_deref() != Some("3")));
}

#[test]
fn empty_rarity_selection_matches_nothing_not_everything() {
    // Some(&[]) 是"显式选中零个稀有度"，语义是"什么都不筛中"，不是
    // "没有传筛选条件"（那应该用 None）——SQL `IN ()` 本身是非法语法，
    // 这条测试同时验证两件事：语义正确 + 不会因为拼出非法 SQL 而报错。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");
    repo.insert_records(&[sample_record(account_id, "301", "301:1")])
        .expect("插入应当成功");

    let empty: Vec<String> = Vec::new();
    let filter = RecordFilter {
        rarities: Some(&empty),
        ..Default::default()
    };

    let hits = repo
        .find_records_paged(account_id, &filter, 10, 0)
        .expect("查询应当成功，不应因为空 IN 列表而报 SQL 语法错误");
    let total = repo
        .count_records(account_id, &filter)
        .expect("计数应当成功");

    assert!(hits.is_empty());
    assert_eq!(total, 0);
}

#[test]
fn filters_by_occurred_at_range_inclusive_on_both_ends() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let mut before = sample_record(account_id, "301", "301:1");
    before.occurred_at = 1_000;
    let mut lower_bound = sample_record(account_id, "301", "301:2");
    lower_bound.occurred_at = 2_000;
    let mut inside = sample_record(account_id, "301", "301:3");
    inside.occurred_at = 3_000;
    let mut upper_bound = sample_record(account_id, "301", "301:4");
    upper_bound.occurred_at = 4_000;
    let mut after = sample_record(account_id, "301", "301:5");
    after.occurred_at = 5_000;
    repo.insert_records(&[before, lower_bound, inside, upper_bound, after])
        .expect("插入应当成功");

    let filter = RecordFilter {
        occurred_from: Some(2_000),
        occurred_to: Some(4_000),
        ..Default::default()
    };

    let hits = repo
        .find_records_paged(account_id, &filter, 10, 0)
        .expect("查询应当成功");
    let total = repo
        .count_records(account_id, &filter)
        .expect("计数应当成功");

    assert_eq!(total, 3, "两端边界值本身应当被包含（闭区间）");
    assert_eq!(hits.len(), 3);
    assert!(
        hits.iter()
            .all(|r| r.occurred_at >= 2_000 && r.occurred_at <= 4_000)
    );
}

#[test]
fn filters_by_item_name_substring() {
    // 原神的 item_id 本身就是本地化物品名（原神 API 不返回 item_id，见
    // plugins/genshin/manifest.ts extractRecord 的说明），因此"按物品名搜索"
    // 对原神而言就是对 item_id 做子串匹配，不需要额外的 name 列。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let mut hu_tao = sample_record(account_id, "301", "301:1");
    hu_tao.item_id = "胡桃".to_string();
    let mut xiao = sample_record(account_id, "301", "301:2");
    xiao.item_id = "魈".to_string();
    repo.insert_records(&[hu_tao, xiao]).expect("插入应当成功");

    let filter = RecordFilter {
        item_search: Some("胡"),
        ..Default::default()
    };

    let hits = repo
        .find_records_paged(account_id, &filter, 10, 0)
        .expect("查询应当成功");
    let total = repo
        .count_records(account_id, &filter)
        .expect("计数应当成功");

    assert_eq!(total, 1);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item_id, "胡桃");
}

#[test]
fn item_search_escapes_like_wildcard_characters() {
    // 物品名恰好包含 SQL LIKE 的通配符字符（% / _）时必须按字面匹配，
    // 不能被悄悄当成通配符——否则用户搜一个带下划线的物品名，会连带搜出
    // 一堆完全无关的记录，这是本模块唯一容易踩的坑。
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    let mut literal_underscore = sample_record(account_id, "301", "301:1");
    literal_underscore.item_id = "武器_测试款".to_string();
    // ⚠️ 这条反例样本的形状是本测试成立的**唯一**前提，改动前先想清楚：
    // 「器」与「测」之间必须**恰好隔一个字符**。`_` 作为 LIKE 通配符的语义是
    // 「任意单个字符」，只有当反例在这个位置真有一个字符时，"转义"与"不转义"
    // 才会产生不同结果。曾经这里写的是「武器测试款其他」（器、测紧邻），
    // 那条样本在两种情形下都不匹配，于是把 escape_like_pattern 整个换成恒等
    // 函数、全仓 353 个测试也一条都不红——测试名与注释承诺了转义被守住，
    // 实际什么都没验证。
    let mut unrelated = sample_record(account_id, "301", "301:2");
    unrelated.item_id = "武器新测试款".to_string();
    repo.insert_records(&[literal_underscore, unrelated])
        .expect("插入应当成功");

    let filter = RecordFilter {
        item_search: Some("器_测"),
        ..Default::default()
    };

    let hits = repo
        .find_records_paged(account_id, &filter, 10, 0)
        .expect("查询应当成功");

    assert_eq!(
        hits.len(),
        1,
        "下划线必须按字面匹配，若被当成通配符会连带命中第二条不含下划线的记录"
    );
    assert_eq!(hits[0].item_id, "武器_测试款");
}

#[test]
fn combined_filters_keep_find_and_count_consistent() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "genshin");

    for i in 0..20 {
        let mut record = sample_record(account_id, "301", &format!("301:{i}"));
        record.rarity = Some(if i % 3 == 0 { "5" } else { "4" }.to_string());
        record.occurred_at = 1_000 * i as i64;
        record.item_id = format!("物品{i}");
        repo.insert_records(&[record]).expect("插入应当成功");
    }
    // 干扰数据：另一个卡池、不该被上面的筛选命中。
    repo.insert_records(&[sample_record(account_id, "200", "200:1")])
        .expect("插入应当成功");

    let rarities = vec!["5".to_string()];
    let filter = RecordFilter {
        banner_key: Some("301"),
        rarities: Some(&rarities),
        occurred_from: Some(0),
        occurred_to: Some(15_000),
        ..Default::default()
    };

    let total = repo
        .count_records(account_id, &filter)
        .expect("计数应当成功");
    // 分页取小页，翻完全部页后累计条数必须等于 count_records 报告的总数——
    // 这才是"分页器总数与实际翻页结果一致"这条契约的真实体现，不能只测
    // page_size 大于总数的单页场景。
    let mut collected = Vec::new();
    let mut page = 0i64;
    loop {
        let batch = repo
            .find_records_paged(account_id, &filter, 2, page * 2)
            .expect("查询应当成功");
        if batch.is_empty() {
            break;
        }
        collected.extend(batch);
        page += 1;
    }

    assert_eq!(collected.len() as i64, total);
    assert!(collected.iter().all(|r| r.banner_key == "301"));
    assert!(collected.iter().all(|r| r.rarity.as_deref() == Some("5")));
    assert!(collected.iter().all(|r| r.occurred_at <= 15_000));
}

#[test]
fn find_all_records_for_account_ignores_paging_and_returns_everything() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let repo = storage.repository();
    let account_id = create_test_account(&repo, "starrail");

    let records: Vec<_> = (0..250)
        .map(|i| sample_record(account_id, "11", &format!("11:{i}")))
        .collect();
    repo.insert_records(&records).expect("插入应当成功");

    // 250 条超过 IPC 层的单页上限（200），证明这个方法不受那层限制——
    // 它是给 gs-host 分析编排在进程内用的内部接口，不是直接透给前端的
    // 分页查询。
    let all = repo
        .find_all_records_for_account(account_id)
        .expect("查询应当成功");
    assert_eq!(all.len(), 250);
}
