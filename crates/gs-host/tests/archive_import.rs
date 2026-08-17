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
