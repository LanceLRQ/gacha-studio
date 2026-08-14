//! 端到端验证：`gs-exchange` 的 wwgacha 存档适配器接进 `gs-host` 的导入
//! 流程（`src/import.rs`）。
//!
//! 覆盖点对应 M2-S6 验收要求：
//! - 真实脱敏存档能被识别、导入、落库，且逐项字段（不只是总数）符合预期
//! - 二次导入幂等（`UNIQUE(account_id, record_key)` 生效）
//! - ★ 采集路径与导入路径对同一批记录算出的 `record_key` 逐项相同——这是
//!   `docs/_internal/milestones/03-M2-鸣潮插件与抽象证伪.md` §4.6.3 裁定
//!   "导入必须复用采集通路"唯一能机械验证的判据
//! - 声明 `timezoneSource: apiField` 的插件在导入路径下 fail closed
//! - 存档字节损坏时返回错误而不是 panic

use std::path::{Path, PathBuf};

use gs_core::RecordSource;
use gs_exchange::{
    ExchangeAdapter, ImportBanner, ImportBatch, SniffResult, wwgacha::WwgachaAdapter,
};
use gs_host::import::{ImportError, import_batch};
use gs_p_authkey::{AuthkeyApiPipeline, RateLimitPolicy};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewAccount, Storage};

const CAPTURED_AT: i64 = 1_755_000_000_000;

fn repo_root() -> PathBuf {
    // gs-host 位于 crates/gs-host，向上跳两级到仓库根，定位 fixtures/。
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("应当能解析出仓库根目录")
}

fn read_fixture_bytes(relative: &str) -> Vec<u8> {
    std::fs::read(repo_root().join(relative))
        .unwrap_or_else(|err| panic!("读取 fixture \"{relative}\" 失败：{err}"))
}

/// `raw_response/*.json` 是 `{ code, message, data: [...] }` 信封，只取
/// `data` 数组——与采集路径 `extractList` 拆出来的形状一致。
fn read_fixture_records(relative: &str) -> Vec<serde_json::Value> {
    let bytes = read_fixture_bytes(relative);
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|err| panic!("解析 fixture 失败：{err}"));
    value
        .get("data")
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| panic!("fixture \"{relative}\" 应当有 data 数组"))
        .clone()
}

fn setup_account(storage: &Storage) -> i64 {
    storage
        .repository()
        .create_account(&NewAccount {
            plugin_id: "wuwa".to_string(),
            game_uid: "100000000".to_string(),
            region: "fixture-server-area".to_string(),
            display_name: None,
            retention_days: None,
            created_at: 1_754_800_000_000,
        })
        .expect("创建测试账号应当成功")
}

fn wuwa_pipeline(runtime: &PluginRuntime) -> AuthkeyApiPipeline<'_> {
    AuthkeyApiPipeline::new("wuwa", runtime, RateLimitPolicy::zero_delay_for_tests())
        .expect("应当能构造 wuwa pipeline")
}

/// `ExchangeAdapter::import` 现在返回 `Vec<ImportBatch>`（trait 改造见
/// `crates/gs-exchange/src/lib.rs` 顶部文档），但单份 wwgacha 存档永远只
/// 对应一个游戏一个账号——这里统一断言"恰好一个"再取出。
fn import_single_wwgacha_batch(archive_bytes: &[u8]) -> ImportBatch {
    let batches = WwgachaAdapter
        .import(archive_bytes)
        .expect("真实脱敏存档应当能被成功导入");
    assert_eq!(
        batches.len(),
        1,
        "单份 wwgacha 存档应当恰好产出一个 ImportBatch，实际: {batches:?}"
    );
    batches.into_iter().next().unwrap()
}

#[test]
fn import_batch_persists_wwgacha_archive_matching_expected_counts_and_source() {
    let archive_bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");

    let adapter = WwgachaAdapter;
    assert_eq!(
        adapter.sniff(&archive_bytes),
        SniffResult::Confident {
            format_version: None
        },
        "真实脱敏存档应当被 wwgacha 适配器明确识别"
    );

    let batch = import_single_wwgacha_batch(&archive_bytes);
    assert_eq!(batch.game_id, "wuwa");
    let banner_1 = batch
        .banners
        .iter()
        .find(|b| b.banner_id == "1")
        .expect("导入结果应当有 banner \"1\"");
    let banner_10 = batch
        .banners
        .iter()
        .find(|b| b.banner_id == "10")
        .expect("导入结果应当有 banner \"10\"");
    assert_eq!(banner_1.records.len(), 17);
    assert_eq!(banner_10.records.len(), 6);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage);
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let summary =
        import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT).expect("导入应当成功");
    assert_eq!(summary.records_seen, 23);
    assert_eq!(summary.records_inserted, 23);
    assert_eq!(summary.records_skipped, 0);

    let records_1 = repo
        .find_records_by_banner(account_id, "1")
        .expect("查询应当成功");
    let records_10 = repo
        .find_records_by_banner(account_id, "10")
        .expect("查询应当成功");
    assert_eq!(records_1.len(), 17);
    assert_eq!(records_10.len(), 6);

    // 逐项断言 source：导入路径与采集路径唯一应当不同的字段，若被写死成
    // OfficialApi，只看总数/条数的断言完全抓不到。
    assert!(
        records_1
            .iter()
            .chain(records_10.iter())
            .all(|r| r.source == RecordSource::Import),
        "导入路径落库的记录 source 应当全部是 RecordSource::Import"
    );

    // 逐项断言 banner_key 与卡池归属一致——`bannerIdentity: "query"` 覆盖
    // 是否在导入路径也生效。
    assert!(records_1.iter().all(|r| r.banner_key == "1"));
    assert!(records_10.iter().all(|r| r.banner_key == "10"));

    // 逐项断言 item_id 非空、record_key 全局唯一（23 条互不相同）。
    assert!(
        records_1
            .iter()
            .chain(records_10.iter())
            .all(|r| !r.item_id.is_empty())
    );
    let mut all_keys: Vec<String> = records_1
        .iter()
        .chain(records_10.iter())
        .map(|r| r.record_key.as_str().to_string())
        .collect();
    all_keys.sort();
    all_keys.dedup();
    assert_eq!(all_keys.len(), 23, "23 条记录的 record_key 应当互不相同");
}

#[test]
fn import_batch_is_idempotent_across_two_runs() {
    let archive_bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let batch = import_single_wwgacha_batch(&archive_bytes);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage);
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let first =
        import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT).expect("首次导入应当成功");
    assert_eq!(first.records_inserted, 23);
    assert_eq!(first.records_skipped, 0);

    // captured_at 故意与首次不同：验证幂等性靠的是 record_key 唯一约束，
    // 与"本地采集完成时刻"这个字段无关。
    let second = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT + 1)
        .expect("二次导入应当成功（幂等）");
    assert_eq!(second.records_seen, 23);
    assert_eq!(
        second.records_inserted, 0,
        "同一份存档二次导入不应产生任何新增行"
    );
    assert_eq!(second.records_skipped, 23);

    let total: usize = ["1", "10"]
        .iter()
        .map(|banner_id| {
            repo.find_records_by_banner(account_id, banner_id)
                .expect("查询应当成功")
                .len()
        })
        .sum();
    assert_eq!(total, 23, "库里记录总数不应因二次导入翻倍");
}

/// M2-S6 最关键的一条不变量（裁定文档 §4.6.3）：同一批记录，一份走采集
/// 路径（读 `raw_response/*.json`，模拟 API 响应，天然倒序）、一份走导入
/// 路径（读 `archive/wwgacha_archive.json`，经适配器 `import()` 已经把
/// 存档的正序还原回 API 的倒序），两条路径调用同一个
/// `AuthkeyApiPipeline::build_records` 算出的 `record_key` 数组必须逐项
/// 相同——顺序也要相同，不只是集合相等，见 `fixtures/wuwa/meta.toml` 里
/// `archive/` 一节的说明。
fn assert_record_keys_match_across_paths(banner_id: &str, raw_response_fixture: &str) {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    // 采集路径：raw_response 本身就是 extractList 拆出来的原始倒序，
    // 不需要任何变换。
    let collect_raw_records = read_fixture_records(raw_response_fixture);
    let collect_records = pipeline
        .build_records(
            &collect_raw_records,
            banner_id,
            1,
            "100000000",
            None,
            None,
            CAPTURED_AT,
            None,
            RecordSource::OfficialApi,
        )
        .expect("采集路径 build_records 应当成功");
    let collect_keys: Vec<String> = collect_records
        .iter()
        .map(|r| r.record_key.as_str().to_string())
        .collect();
    assert_eq!(
        collect_keys.len(),
        collect_raw_records.len(),
        "自证前提：采集路径应当为每条原始记录都产出一个 key"
    );

    // 导入路径：经 wwgacha 适配器 import() 拿到已经还原成 API 倒序的记录。
    let archive_bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let batch = import_single_wwgacha_batch(&archive_bytes);
    let banner = batch
        .banners
        .iter()
        .find(|b| b.banner_id == banner_id)
        .unwrap_or_else(|| panic!("导入结果应当有 banner \"{banner_id}\""));
    let import_records = pipeline
        .build_records(
            &banner.records,
            banner_id,
            1,
            "100000000",
            None,
            None,
            CAPTURED_AT,
            None,
            RecordSource::Import,
        )
        .expect("导入路径 build_records 应当成功");
    let import_keys: Vec<String> = import_records
        .iter()
        .map(|r| r.record_key.as_str().to_string())
        .collect();

    assert_eq!(
        collect_keys, import_keys,
        "banner \"{banner_id}\"：采集路径与导入路径算出的 record_key 数组必须逐项相同"
    );
}

#[test]
fn record_keys_are_identical_across_collect_and_import_paths_for_pool_1() {
    assert_record_keys_match_across_paths("1", "fixtures/wuwa/raw_response/1_page_1.json");
}

#[test]
fn record_keys_are_identical_across_collect_and_import_paths_for_pool_10() {
    assert_record_keys_match_across_paths("10", "fixtures/wuwa/raw_response/10_page_1.json");
}

/// 声明 `timezoneSource: apiField` 的插件、且存档本身不携带时区信息时，
/// 导入路径下必须 fail closed——这是 `ImportError::TimezoneUnavailable`
/// 的两个成立条件之一（另一条见 `crates/gs-host/src/import.rs` 模块文档
/// "时区来源的 fail-closed"一节）。wwgacha 存档格式没有时区字段，
/// `WwgachaAdapter` 产出的 `ImportAccount.tz_offset_hours` 恒为
/// `None`（见 `gs-exchange/src/wwgacha.rs`），天然满足"不携带时区信息"这
/// 一半条件；wuwa 真实插件没有声明 `apiField` 分支（对它是空操作），因此
/// 这里用 `AuthkeyApiPipeline::from_manifest_json_for_test`（`test-support`
/// feature，见该函数文档）在 wuwa 真实 manifest 基础上合成一份声明了
/// `apiField` 的变体，凑齐另一半条件，专门覆盖到这个报错分支——这条测试
/// 因此也是"UIGF 解冻 `ImportAccount.tz_offset_hours` 之后，fail-closed
/// 守卫本身没有失守"的回归证据。
#[test]
fn import_batch_fails_closed_when_plugin_declares_api_field_and_archive_has_no_tz_offset() {
    let mut manifest_value = gs_plugin_runtime::plugin_manifest_data("wuwa")
        .expect("wuwa manifest 纯数据应当已经打包（先跑 node scripts/gs-bundle-plugins.mjs）")
        .clone();
    manifest_value["time"] = serde_json::json!({
        "timezoneSource": { "kind": "apiField", "field": "region_time_zone" }
    });

    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline =
        AuthkeyApiPipeline::from_manifest_json_for_test("wuwa", &runtime, manifest_value)
            .expect("应当能用合成 manifest 构造 pipeline");

    let archive_bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let batch = import_single_wwgacha_batch(&archive_bytes);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage);
    let repo = storage.repository();

    let result = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT);
    let err = result
        .expect_err("timezoneSource: apiField 且存档不携带 tz_offset_hours 时导入应当 fail closed");
    assert!(
        matches!(
            &err,
            ImportError::TimezoneUnavailable { plugin_id } if plugin_id == "wuwa"
        ),
        "错误应当是 TimezoneUnavailable 且携带插件 id，实际：{err:?}"
    );
    let message = err.to_string();
    assert!(
        message.contains("apiField") && message.contains("没有携带"),
        "错误信息里应当能看出原因（apiField + 存档没有携带时区），实际：{message}"
    );

    // fail closed 必须发生在任何一条记录落库之前。
    let records = repo
        .find_records_by_banner(account_id, "1")
        .expect("查询应当成功");
    assert!(records.is_empty(), "fail closed 应当在任何记录落库之前发生");
}

#[test]
fn adapter_import_returns_error_not_panic_for_corrupted_archive_bytes() {
    // 缺 GachaPoolData 且 JSON 本身未闭合——模拟"存档字节损坏"。
    let corrupted = br#"{"UID": 100000000, "ServerID": "s", "ServerArea": "a""#;
    let result = WwgachaAdapter.import(corrupted);
    assert!(
        result.is_err(),
        "损坏的存档字节应当返回 Err，而不是 panic 或静默产出空结果"
    );
}

/// `import_batch` 原子性回归测试——见 `crates/gs-host/src/import.rs`
/// `import_batch` 文档"原子性"一节。构造一个额外的、注定会失败的第三个
/// 卡池（记录不是 JSON 对象，wuwa 的 `extractRecord` 会直接 throw），追加
/// 到真实存档已有的两个合法卡池（"1"/"10"）之后，断言：
/// - 整体导入返回 `Err`（第三个卡池的构建失败会传播）
/// - 前两个合法卡池**一条记录都不落库**——不是"落了一部分、第三个失败"，
///   而是构建阶段全部完成之前，数据库连一次写入尝试都没有发生过。
#[test]
fn import_batch_does_not_persist_any_records_when_a_later_banner_fails() {
    let archive_bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
    let mut batch = import_single_wwgacha_batch(&archive_bytes);
    batch.banners.push(ImportBanner {
        banner_id: "99".to_string(),
        records: vec![serde_json::Value::Null],
    });

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage);
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let result = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT);
    assert!(
        result.is_err(),
        "追加的第三个卡池记录不是对象，构建阶段应当失败并传播为 Err"
    );

    let records_1 = repo
        .find_records_by_banner(account_id, "1")
        .expect("查询应当成功");
    let records_10 = repo
        .find_records_by_banner(account_id, "10")
        .expect("查询应当成功");
    assert!(
        records_1.is_empty() && records_10.is_empty(),
        "第三个卡池构建失败时，前两个合法卡池也不应该有任何记录落库：\
         records_1={records_1:?}, records_10={records_10:?}"
    );
}
