//! 端到端验证 [`gs_host::archive::import_archive_bytes`]：一份存档的完整
//! 字节 → 嗅探格式 → 适配器 → 账号解析 → 落库。
//!
//! 与 `import_uigf.rs`/`import_wwgacha.rs` 的分工：那两个文件测的是导入
//! **内核**（record_key 一致性、时区归一化、原子性），入口是已经构造好的
//! `ImportBatch` + 已知 `account_id`；这个文件测的是内核外面那一圈——格式
//! 判定、账号解析、多账号存档的拆分。

use std::path::{Path, PathBuf};

use gs_host::archive::{ArchiveImportError, import_archive_bytes};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewAccount, RecordFilter, Storage};

const CAPTURED_AT: i64 = 1_755_000_000_000;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("应当能解析出仓库根目录")
}

fn read_fixture_bytes(relative: &str) -> Vec<u8> {
    std::fs::read(repo_root().join(relative))
        .unwrap_or_else(|err| panic!("读取 fixture \"{relative}\" 失败：{err}"))
}

// ============================================================
// 格式判定
// ============================================================

#[test]
fn imports_a_uigf_archive_end_to_end_and_creates_the_account() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("UIGF 存档应当能端到端导入");

    assert_eq!(report.format_id, "uigf-v4", "应当被判定为 UIGF v4 格式");
    assert_eq!(report.accounts.len(), 1, "这份 fixture 只含一个账号");

    let account = &report.accounts[0];
    assert_eq!(account.game_id, "genshin");
    assert!(account.records_seen > 0, "应当读到记录");
    assert_eq!(
        account.records_inserted, account.records_seen,
        "库空时全部记录都该新增，一条都不该被跳过"
    );

    // 账号确实被建出来了，而不是只往一个凭空的 id 上写记录。
    let accounts = repo.list_accounts().expect("查询账号应当成功");
    assert_eq!(accounts.len(), 1, "应当恰好建出一个账号");
    assert_eq!(accounts[0].plugin_id, "genshin");
    assert_eq!(accounts[0].id, account.account_id);

    let count = repo
        .count_records(account.account_id, &RecordFilter::default())
        .expect("查询记录数应当成功");
    assert_eq!(
        count, account.records_inserted as i64,
        "报告里的新增条数应当与库中实际条数一致"
    );
}

// ============================================================
// 采集边界必须真正落库——不能只在手工构造的测试夹具里"看起来能评估"
// ============================================================
//
// 这两条测试与本文件其余测试的区别：其余测试全部只验证 `import_archive_
// bytes` 落库的记录/账号本身；这两条额外验证**账号表的采集边界列**
// （`earliest_record_at`/`latest_record_at`）在导入成功后确实被写入，并且
// `gs_host::retention::evaluate_account_retention_risk` 能拿着这份真实
// 落库的账号算出一个结果——`retention.rs` 此前的 19 条单测全部手工构造
// `Account { earliest_record_at: Some(..), .. }`，没有一条真正走过
// "导入 → 建号 → 评估" 这条生产路径，因此"驱动字段永远是 NULL、风险评估
// 恒为 None"这个 bug 存在了一整轮复核都没被发现。这里换成走真实的
// `import_archive_bytes` + `repo.list_accounts()`，任何一处"写入采集边界"
// 的代码被删掉或注释掉，这两条测试都会变红。

#[test]
fn importing_an_archive_populates_collection_bounds_so_retention_risk_can_be_evaluated() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT).expect("UIGF 存档应当能端到端导入");

    // 不直接用 import_archive_bytes 返回的 report——那只是导入条数统计，
    // 必须回头用 list_accounts() 真的把账号从库里读回来，这才是界面
    // （list_accounts IPC 命令）拿到的同一份数据。
    let accounts = repo.list_accounts().expect("查询账号应当成功");
    assert_eq!(accounts.len(), 1, "自证前提：这份 fixture 只含一个账号");
    let account = &accounts[0];

    let risk = gs_host::retention::evaluate_account_retention_risk(account, CAPTURED_AT);
    assert!(
        risk.is_some(),
        "真实导入路径落库后应当能评估保留期风险；返回 None 说明账号表的采集边界列\
         （earliest_record_at/latest_record_at）没有被真正写入——功能整个空转，\
         界面会对每一个账号永远显示『无法评估』"
    );
}

#[test]
fn importing_an_archive_writes_earliest_and_latest_record_at_matching_the_persisted_records() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("UIGF 存档应当能端到端导入");
    let account_id = report.accounts[0].account_id;

    // 期望值从库里已落地的记录自己算出来（min/max occurred_at），不是抄一个
    // 独立算出的字面量——这条测试要抓的是"采集边界与实际记录集合不同步"，
    // 不是"occurred_at 归一化算对了没"（那由 import_uigf.rs 覆盖）。
    let records_301 = repo
        .find_records_by_banner(account_id, "301")
        .expect("查询应当成功");
    let records_400 = repo
        .find_records_by_banner(account_id, "400")
        .expect("查询应当成功");
    let occurred_at_values: Vec<i64> = records_301
        .iter()
        .chain(records_400.iter())
        .map(|r| r.occurred_at)
        .collect();
    assert!(!occurred_at_values.is_empty(), "自证前提：应当读到记录");
    let expected_earliest = *occurred_at_values.iter().min().unwrap();
    let expected_latest = *occurred_at_values.iter().max().unwrap();

    let account = repo
        .find_account(account_id)
        .expect("查询应当成功")
        .expect("账号应当存在");
    assert_eq!(
        account.earliest_record_at,
        Some(expected_earliest),
        "earliest_record_at 应当等于库中该账号全部记录里最早的 occurred_at"
    );
    assert_eq!(
        account.latest_record_at,
        Some(expected_latest),
        "latest_record_at 应当等于库中该账号全部记录里最晚的 occurred_at"
    );
}

#[test]
fn creating_a_new_account_during_import_writes_retention_days_from_the_manifest() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("UIGF 存档应当能端到端导入");

    let account = repo
        .find_account(report.accounts[0].account_id)
        .expect("查询应当成功")
        .expect("账号应当存在");
    assert_eq!(
        account.retention_days,
        Some(168),
        "genshin manifest 声明了 retention.conservativeDays = 6*28，\
         新建账号时应当直接写入这一列，不该留 NULL 等着日后补"
    );
}

#[test]
fn creating_a_new_account_for_a_plugin_without_a_retention_policy_leaves_it_null() {
    // 鸣潮真实场景：manifest 没有声明 retention，新建账号时不该编一个天数。
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("wwgacha 存档应当能端到端导入");

    let account = repo
        .find_account(report.accounts[0].account_id)
        .expect("查询应当成功")
        .expect("账号应当存在");
    assert_eq!(
        account.retention_days, None,
        "鸣潮插件没有声明 retention 策略，不能默认任何天数"
    );
}

#[test]
fn imports_a_wwgacha_archive_end_to_end() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("wwgacha 存档应当能端到端导入");

    assert_eq!(report.format_id, "wwgacha");
    assert_eq!(report.accounts.len(), 1);
    assert_eq!(report.accounts[0].game_id, "wuwa");
    assert!(report.accounts[0].records_inserted > 0);

    // wwgacha 存档携带 ServerArea，账号的 region 不该是空串。
    let accounts = repo.list_accounts().expect("查询账号应当成功");
    assert!(
        !accounts[0].region.is_empty(),
        "wwgacha 存档带 ServerArea，建出来的账号 region 不该为空——为空说明区服信息在路上丢了"
    );
}

#[test]
fn rejects_bytes_that_no_adapter_claims() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let err = import_archive_bytes(b"{\"hello\":\"world\"}", &runtime, &repo, CAPTURED_AT)
        .expect_err("无人认领的格式必须报错，不能静默导入 0 条了事");
    assert!(
        matches!(err, ArchiveImportError::UnknownFormat),
        "应当是 UnknownFormat，实际：{err:?}"
    );
}

#[test]
fn returns_error_not_panic_for_non_json_bytes() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let err = import_archive_bytes(&[0xff, 0xfe, 0x00, 0x01], &runtime, &repo, CAPTURED_AT)
        .expect_err("二进制垃圾应当报错");
    assert!(
        matches!(err, ArchiveImportError::UnknownFormat),
        "应当是 UnknownFormat，实际：{err:?}"
    );
}

/// 把一份存档导进一个**一次性内存库**，只为取出里面的 uid。
///
/// 不去解析 fixture 的 JSON 结构：那等于在测试里重新实现一遍适配器的字段
/// 映射，存档格式一变测试就跟着错，而且错的方式是"测试自己算错了"而不是
/// "被测代码错了"。让被测代码自己说它读出来的 uid 是什么，更可靠。
fn uid_in_archive(bytes: &[u8], runtime: &PluginRuntime) -> String {
    let scratch = Storage::open_in_memory().expect("应当能打开内存数据库");
    let report = import_archive_bytes(bytes, runtime, &scratch.repository(), CAPTURED_AT)
        .expect("探测导入应当成功");
    report.accounts[0].uid.clone()
}

// ============================================================
// 账号解析——UIGF 不携带区服，这一组是防"同一玩家分裂成两个账号"的
// ============================================================

#[test]
fn reimporting_the_same_uigf_archive_reuses_the_account_and_is_idempotent() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let first =
        import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT).expect("首次导入应当成功");
    let second = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT + 1)
        .expect("二次导入应当成功（幂等，不是报错）");

    assert_eq!(
        first.accounts[0].account_id, second.accounts[0].account_id,
        "二次导入必须复用同一个账号——UIGF 不携带区服，若按区服建账号会分裂出第二个"
    );
    assert_eq!(
        second.accounts[0].records_inserted, 0,
        "二次导入不该新增任何记录"
    );
    assert_eq!(
        second.accounts[0].records_skipped, second.accounts[0].records_seen,
        "全部记录都该因去重被跳过"
    );

    let accounts = repo.list_accounts().expect("查询账号应当成功");
    assert_eq!(accounts.len(), 1, "库里始终只该有一个账号");
}

#[test]
fn uigf_import_reuses_an_existing_account_created_with_a_real_region() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let uid = uid_in_archive(&bytes, &runtime);

    // 预置一个带**真实区服**的账号，模拟"这个账号是先走采集建出来的"——
    // 采集路径能拿到区服，UIGF 拿不到。这一条验证的正是两条路径落在同一个
    // 账号上，而不是各建各的。
    let existing_id = repo
        .create_account(&NewAccount {
            plugin_id: "genshin".to_string(),
            game_uid: uid.clone(),
            region: "cn_gf01".to_string(),
            display_name: None,
            retention_days: None,
            created_at: CAPTURED_AT,
        })
        .expect("预置账号应当成功");

    let again = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT + 1)
        .expect("已有带真实区服的账号时，导入不携带区服的 UIGF 存档应当落到同一个账号");
    assert_eq!(
        again.accounts[0].account_id, existing_id,
        "UIGF 存档不携带区服，必须按 (plugin_id, uid) 找到那个已有真实区服的账号，\
         而不是另建一个空区服的影子账号——分裂了的话记录会一分为二，且不会有任何报错"
    );
    assert_eq!(again.accounts[0].uid, uid);

    let accounts = repo.list_accounts().expect("查询账号应当成功");
    assert_eq!(accounts.len(), 1, "库里应当仍然只有一个账号");
}

#[test]
fn fails_closed_when_the_archive_has_no_region_and_two_local_accounts_share_the_uid() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let uid = uid_in_archive(&bytes, &runtime);

    // 造两个同游戏同 UID、不同区服的账号——现在按 (plugin_id, uid)
    // 能找到两个，存档又不声明区服，没有任何依据能选对。
    for region in ["cn_gf01", "os_asia"] {
        repo.create_account(&NewAccount {
            plugin_id: "genshin".to_string(),
            game_uid: uid.clone(),
            region: region.to_string(),
            display_name: None,
            retention_days: None,
            created_at: CAPTURED_AT,
        })
        .unwrap_or_else(|err| panic!("建区服 {region} 的账号应当成功：{err}"));
    }

    let err = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT + 1)
        .expect_err("同 UID 两个账号且存档不声明区服时，必须拒绝而不是猜一个");
    match err {
        ArchiveImportError::AmbiguousAccount {
            game_id,
            uid: err_uid,
            existing_regions,
        } => {
            assert_eq!(game_id, "genshin");
            assert_eq!(err_uid, uid);
            assert_eq!(existing_regions.len(), 2, "应当把两个候选区服都报出来");
        }
        other => panic!("应当是 AmbiguousAccount，实际：{other:?}"),
    }
}

/// 鸣潮（wwgacha）存档也必须写出采集边界。
///
/// # 为什么单列一条，而不是"UIGF 那条过了就够了"
///
/// `persist_collection_bounds` 确实只有一个调用点（`import.rs` 里紧跟
/// `insert_records` 之后），两种存档共用同一段代码——所以"逻辑共享"这件事
/// 本身是结构上成立的。但共用的是**写入动作**，不是**输入**：边界值取自
/// `occurred_at` 的 min/max，而两种格式的时间处理路径完全不同（UIGF 走
/// `tz_offset_hours` 换算，wwgacha 是工具本机时间且需要 `tool_localized`
/// 先验）。若鸣潮这条路上 `occurred_at` 有任何形态差异（例如全为 0、或
/// 记录集为空导致 min/max 落空），"共用同一行代码"救不了它。
///
/// 本轮的教训正是这个形状：保留期功能整个空转了一个版本，而 19 条单测
/// 全绿——因为它们都手工构造 `Account`，没有一条问过"真实路径跑完之后，
/// 这两列到底有没有值"。一条格式各自的断言很便宜，漏掉的代价不便宜。
#[test]
fn importing_a_wwgacha_archive_also_writes_collection_bounds() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let repo = storage.repository();

    let bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
        .expect("wwgacha 存档应当能端到端导入");
    let account_id = report.accounts[0].account_id;

    // 期望值同样从库里已落地的记录自己算出来，不写死字面量——这条断言要抓的
    // 是"边界与实际记录集合不同步"，不是"鸣潮的时间归一化算对了没"
    //（后者由 import_wwgacha.rs 覆盖）。
    let records = repo
        .find_records_paged(account_id, &RecordFilter::default(), 10_000, 0)
        .expect("查询应当成功");
    assert!(
        !records.is_empty(),
        "自证前提：这份 fixture 应当落进至少一条记录"
    );
    let expected_earliest = records.iter().map(|r| r.occurred_at).min().unwrap();
    let expected_latest = records.iter().map(|r| r.occurred_at).max().unwrap();

    let account = repo
        .find_account(account_id)
        .expect("查询应当成功")
        .expect("账号应当存在");
    assert_eq!(
        account.earliest_record_at,
        Some(expected_earliest),
        "鸣潮存档导入后 earliest_record_at 应当等于库中最早的 occurred_at"
    );
    assert_eq!(
        account.latest_record_at,
        Some(expected_latest),
        "鸣潮存档导入后 latest_record_at 应当等于库中最晚的 occurred_at"
    );
}
