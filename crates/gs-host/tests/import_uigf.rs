//! 端到端验证：`gs-exchange` 的 UIGF v4.x 适配器接进 `gs-host` 的导入
//! 流程（`src/import.rs`）。组织方式对齐 `import_wwgacha.rs`。
//!
//! 覆盖点：
//! - ★ 采集路径与导入路径对同一批记录算出的 `record_key` 逐项相同——原神/
//!   星铁/绝区零各一组，UIGF fixture 均由对应 `raw_response/*.json` 机械
//!   变换得来（变换规则见各 `fixtures/<game>/meta.toml`）
//! - 二次导入幂等（原神，`timezoneSource: computed`，能走完整的
//!   `import_batch`）
//! - 一份含多游戏多账号的 UIGF v4 文件 → 正确数量的 `ImportBatch`——这条
//!   在 `crates/gs-exchange/src/uigf.rs` 的单元测试里已经覆盖
//!   （`import_produces_one_batch_per_game_and_account_with_correct_ids`），
//!   这里不重复
//! - 三个游戏都能通过 `import_batch` 完整落库，且 `occurred_at` 精确到
//!   毫秒——`ImportAccount.tz_offset_hours`（`gs_exchange::uigf` 模块文档
//!   已记录：UIGF 的 `UigfProject.timezone` 落在这里）现在会被
//!   `import_batch` 读取并传给 `AuthkeyApiPipeline::build_records`，星铁/
//!   绝区零不再无条件 fail closed，见 `crates/gs-host/src/import.rs` 模块
//!   文档"时区来源的 fail-closed"一节。期望的 `occurred_at` 字面量全部是
//!   在测试代码里独立算出来的（不经过被测代码），算式写在各测试内注释里
//! - fail-closed 守卫本身没有因为解冻而失守：`tz_offset_hours` 缺失（模拟
//!   UIGF 之外没有携带时区信息的存档，或 UIGF 本身该字段异常缺失）时，星铁/
//!   绝区零这类 `apiField`/`staticTable` 插件仍然拒绝导入

use std::path::{Path, PathBuf};

use gs_core::{GachaRecord, RecordSource};
use gs_exchange::{ExchangeAdapter, uigf::UigfAdapter};
use gs_host::import::{ImportError, import_batch};
use gs_p_authkey::{AuthkeyApiPipeline, RateLimitPolicy};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewAccount, Storage};
use serde_json::Value;

const CAPTURED_AT: i64 = 1_755_000_000_000;
const FIXTURE_UID: &str = "100000000";

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

/// 原神/星铁/绝区零共用的响应信封形状：`{ retcode, message, data: { list,
/// region, ... } }`——`list` 在 `data` 里，不是 `data` 本身，与 wwgacha
/// 的 `{ code, message, data: [...] }` 不同，因此这里单独写一个辅助函数，
/// 不复用 `import_wwgacha.rs` 的 `read_fixture_records`。
fn read_mihoyo_raw_response_records(relative: &str) -> Vec<Value> {
    let bytes = read_fixture_bytes(relative);
    let value: Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|err| panic!("解析 fixture 失败：{err}"));
    value
        .get("data")
        .and_then(|data| data.get("list"))
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("fixture \"{relative}\" 应当有 data.list 数组"))
        .clone()
}

fn setup_account(storage: &Storage, plugin_id: &str) -> i64 {
    storage
        .repository()
        .create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: FIXTURE_UID.to_string(),
            region: "fixture-region".to_string(),
            display_name: None,
            retention_days: None,
            created_at: 1_754_800_000_000,
        })
        .expect("创建测试账号应当成功")
}

fn pipeline_for<'rt>(plugin_id: &str, runtime: &'rt PluginRuntime) -> AuthkeyApiPipeline<'rt> {
    AuthkeyApiPipeline::new(plugin_id, runtime, RateLimitPolicy::zero_delay_for_tests())
        .unwrap_or_else(|err| panic!("应当能构造 {plugin_id} pipeline：{err}"))
}

/// 按 `record_key`（`${bannerId}:${stableId}`，三个游戏的
/// `hooks.deriveRecordKey` 都是这个形状）从落库结果里定位唯一一条记录——
/// 用来给"occurred_at 精确到毫秒"这类断言一个不依赖行顺序/下标的锚点。
fn record_by_key<'a>(records: &'a [GachaRecord], record_key: &str) -> &'a GachaRecord {
    records
        .iter()
        .find(|r| r.record_key.as_str() == record_key)
        .unwrap_or_else(|| panic!("应当能找到 record_key \"{record_key}\"：{records:?}"))
}

/// 从 UIGF 存档字节里读出**唯一**一个 `ImportBatch`，并断言它就是唯一的一个
/// ——本文件用到的 fixture 全部是单游戏单账号存档。
fn import_single_uigf_batch(archive_bytes: &[u8]) -> gs_exchange::ImportBatch {
    let batches = UigfAdapter
        .import(archive_bytes)
        .expect("UIGF 存档应当能被成功导入");
    assert_eq!(
        batches.len(),
        1,
        "本文件用到的 fixture 都是单游戏单账号存档，应当恰好产出一个 batch，实际: {batches:?}"
    );
    batches.into_iter().next().unwrap()
}

// ============================================================
// ★ record_key 逐项相同：采集路径 vs 导入路径
// ============================================================

/// `raw_response_relative` 可能混有其它卡池的记录（原神 301 页面真实混回
/// 400，见 `fixtures/genshin/raw_response/301_page_1.json`）——先按
/// `banner_id` 过滤出只属于该卡池的子集，再喂给采集路径的
/// `build_records`，这样才能和导入路径产出的、已经按卡池分组过的
/// `ImportBanner.records` 做同口径比较。对星铁/绝区零这两个"单页从不混池"
/// 的 fixture 而言，这一步过滤是空操作。
fn assert_uigf_record_keys_match_across_paths(
    plugin_id: &str,
    raw_response_relative: &str,
    archive_relative: &str,
    banner_id: &str,
) {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for(plugin_id, &runtime);

    let collect_raw_records: Vec<Value> = read_mihoyo_raw_response_records(raw_response_relative)
        .into_iter()
        .filter(|record| record.get("gacha_type").and_then(Value::as_str) == Some(banner_id))
        .collect();
    assert!(
        !collect_raw_records.is_empty(),
        "自证前提：过滤后应当至少留下一条记录"
    );
    let collect_records = pipeline
        .build_records(
            &collect_raw_records,
            banner_id,
            1,
            FIXTURE_UID,
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

    let archive_bytes = read_fixture_bytes(archive_relative);
    let batch = import_single_uigf_batch(&archive_bytes);
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
            FIXTURE_UID,
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
        "插件 \"{plugin_id}\" banner \"{banner_id}\"：采集路径与导入路径算出的 record_key 数组必须逐项相同"
    );
}

#[test]
fn record_keys_are_identical_across_collect_and_import_paths_for_genshin() {
    assert_uigf_record_keys_match_across_paths(
        "genshin",
        "fixtures/genshin/raw_response/301_page_1.json",
        "fixtures/genshin/archive/uigf_v4_genshin.json",
        "301",
    );
}

#[test]
fn record_keys_are_identical_across_collect_and_import_paths_for_starrail() {
    assert_uigf_record_keys_match_across_paths(
        "starrail",
        "fixtures/starrail/raw_response/11_page_1.json",
        "fixtures/starrail/archive/uigf_v4_starrail.json",
        "11",
    );
}

#[test]
fn record_keys_are_identical_across_collect_and_import_paths_for_zzz() {
    assert_uigf_record_keys_match_across_paths(
        "zzz",
        "fixtures/zzz/raw_response/2_page_1.json",
        "fixtures/zzz/archive/uigf_v4_zzz.json",
        "2",
    );
}

// ============================================================
// 端到端落库：原神（timezoneSource: computed，能走完整 import_batch）
// ============================================================

#[test]
fn import_batch_persists_uigf_genshin_archive_and_is_idempotent() {
    let archive_bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let batch = import_single_uigf_batch(&archive_bytes);
    assert_eq!(batch.game_id, "genshin");
    assert_eq!(batch.account.uid, FIXTURE_UID);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "genshin");
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for("genshin", &runtime);

    let first =
        import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT).expect("首次导入应当成功");
    assert_eq!(
        first.records_seen, 5,
        "genshin fixture 共 5 条记录（301 x4 + 400 x1）"
    );
    assert_eq!(first.records_inserted, 5);
    assert_eq!(first.records_skipped, 0);

    let records_301 = repo
        .find_records_by_banner(account_id, "301")
        .expect("查询应当成功");
    let records_400 = repo
        .find_records_by_banner(account_id, "400")
        .expect("查询应当成功");
    assert_eq!(records_301.len(), 4);
    assert_eq!(records_400.len(), 1);
    assert!(
        records_301
            .iter()
            .chain(records_400.iter())
            .all(|r| r.source == RecordSource::Import),
        "导入路径落库的记录 source 应当全部是 RecordSource::Import"
    );

    // ★ occurred_at 精确到毫秒，字面量独立算出、不经过被测代码：
    // fixture 里 id "1400000000000000006" 那条记录 time = "2026-06-01
    // 12:00:00"。原神 timezoneSource: computed 且声明了
    // hooks.resolveTimezone（`plugins/genshin/hooks.ts`），UID
    // "100000000" 首位数字 '1' 落在默认分支，hook 返回 8（不读
    // ImportAccount.tz_offset_hours，但这份 fixture 的 timezone 同样声明
    // 为 8，两者巧合一致，不影响这条断言的独立性——算式用的是 hook 的 8，
    // 不是 fixture 的 8）。
    //   1. 把 "2026-06-01 12:00:00" 当作字面 UTC 解析（不经过任何本地时区）
    //      得到 naive_as_utc_unix_seconds = 1780315200
    //      （用 Python 独立验证：
    //      `calendar.timegm((2026,6,1,12,0,0,0,0,0))` == 1780315200，
    //      与 `datetime(2026,6,1,12,0,0,tzinfo=timezone.utc).timestamp()`
    //      == 1780315200.0 相互印证，两种独立算法结果一致）
    //   2. 减去偏移量：1780315200 - 8*3600 = 1780315200 - 28800 = 1780286400
    //   3. 转成毫秒：1780286400 * 1000 = 1780286400000
    let record = record_by_key(&records_301, "301:1400000000000000006");
    assert_eq!(
        record.occurred_at, 1_780_286_400_000,
        "occurred_at 应当精确等于按「朴素时间视为 UTC 再减 8 小时偏移」算出的字面量"
    );

    // 二次导入幂等：captured_at 故意与首次不同，验证幂等性靠的是
    // record_key 唯一约束，与"本地采集完成时刻"这个字段无关——与
    // `import_wwgacha.rs` 的 `import_batch_is_idempotent_across_two_runs`
    // 同一思路。
    let second = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT + 1)
        .expect("二次导入应当成功（幂等）");
    assert_eq!(second.records_seen, 5);
    assert_eq!(
        second.records_inserted, 0,
        "同一份 UIGF 存档二次导入不应产生任何新增行"
    );
    assert_eq!(second.records_skipped, 5);

    let total = repo
        .find_records_by_banner(account_id, "301")
        .expect("查询应当成功")
        .len()
        + repo
            .find_records_by_banner(account_id, "400")
            .expect("查询应当成功")
            .len();
    assert_eq!(total, 5, "库里记录总数不应因二次导入翻倍");
}

// ============================================================
// 星铁 / 绝区零：ImportAccount.tz_offset_hours 解冻后，import_batch 走通
// ============================================================
//
// 这两条测试的语义在本次改动中**反转**过一次：改前，`ImportBatch`/
// `ImportAccount` 没有携带时区偏移的字段，`import_batch` 对 `apiField`/
// `staticTable` 插件的 fail-closed 检查是无条件触发，星铁/绝区零的 UIGF
// 导入因此总是失败，那两条测试断言的是 `result.is_err()`。解冻
// `ImportAccount.tz_offset_hours` 之后，UIGF 存档自带的 `timezone`
// 字段会经由 `gs_exchange::uigf` 的 `*_project_to_batch` 填进这个字段、
// 再经 `import_batch` 传给 `AuthkeyApiPipeline::build_records` 的
// `page_tz_offset_hours` 参数（`crates/gs-host/src/import.rs` 模块文档
// "时区来源的 fail-closed"一节），fail-closed 检查的两个条件不再同时成立，
// 因此这两个插件现在应当**导入成功**——不是"以前测错了"，是接口形状本身
// 变了，测试跟着接口的真实行为走。

/// 星铁 `timezoneSource: apiField("region_time_zone")`：UIGF 存档自带的
/// `timezone` 字段语义上就是这个字段本来要读的值，`import_batch` 现在会
/// 把它传给 `page_tz_offset_hours`，导入应当成功且 `occurred_at` 精确。
#[test]
fn import_batch_persists_uigf_starrail_archive_with_correct_occurred_at() {
    let archive_bytes = read_fixture_bytes("fixtures/starrail/archive/uigf_v4_starrail.json");
    let batch = import_single_uigf_batch(&archive_bytes);
    assert_eq!(batch.account.tz_offset_hours, Some(8));

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "starrail");
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for("starrail", &runtime);

    let summary = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT)
        .expect("星铁 UIGF 存档自带 tz_offset_hours，导入应当成功");
    assert_eq!(summary.records_seen, 9);
    assert_eq!(summary.records_inserted, 9);
    assert_eq!(summary.records_skipped, 0);

    let records = repo
        .find_records_by_banner(account_id, "11")
        .expect("查询应当成功");
    assert_eq!(records.len(), 9);
    assert!(records.iter().all(|r| r.source == RecordSource::Import));

    // ★ occurred_at 精确到毫秒，字面量独立算出、不经过被测代码：
    // fixture 里 id "1500000000000000009" 那条记录 time = "2101-07-15
    // 10:21:49"，声明 timezone = 8。
    //   1. "2101-07-15 10:21:49" 当作字面 UTC 解析
    //      naive_as_utc_unix_seconds = 4150866109
    //      （Python 独立验证：`calendar.timegm((2101,7,15,10,21,49,0,0,0))`
    //      与 `datetime(2101,7,15,10,21,49,tzinfo=timezone.utc).timestamp()`
    //      两种算法都得到 4150866109，相互印证）
    //   2. 减去偏移量：4150866109 - 8*3600 = 4150866109 - 28800 = 4150837309
    //   3. 转成毫秒：4150837309 * 1000 = 4150837309000
    let record = record_by_key(&records, "11:1500000000000000009");
    assert_eq!(
        record.occurred_at, 4_150_837_309_000,
        "occurred_at 应当精确等于按「朴素时间视为 UTC 再减 8 小时偏移」算出的字面量"
    );
}

/// 绝区零 `timezoneSource: staticTable(field="region")`：UIGF 存档没有
/// `region` 字段可查表，但直接携带了偏移量本身，效果等价于替调用方跳过
/// 了查表这一步，`import_batch` 现在会把它传给 `page_tz_offset_hours`，
/// 导入应当成功且 `occurred_at` 精确。
#[test]
fn import_batch_persists_uigf_zzz_archive_with_correct_occurred_at() {
    let archive_bytes = read_fixture_bytes("fixtures/zzz/archive/uigf_v4_zzz.json");
    let batch = import_single_uigf_batch(&archive_bytes);
    assert_eq!(batch.account.tz_offset_hours, Some(8));

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "zzz");
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for("zzz", &runtime);

    let summary = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT)
        .expect("绝区零 UIGF 存档自带 tz_offset_hours，导入应当成功");
    assert_eq!(summary.records_seen, 6);
    assert_eq!(summary.records_inserted, 6);
    assert_eq!(summary.records_skipped, 0);

    let records = repo
        .find_records_by_banner(account_id, "2")
        .expect("查询应当成功");
    assert_eq!(records.len(), 6);
    assert!(records.iter().all(|r| r.source == RecordSource::Import));

    // ★ occurred_at 精确到毫秒，字面量独立算出、不经过被测代码：
    // fixture 里 id "1900000000000000006" 那条记录 time = "2099-01-02
    // 16:47:31"，声明 timezone = 8。
    //   1. "2099-01-02 16:47:31" 当作字面 UTC 解析
    //      naive_as_utc_unix_seconds = 4071055651
    //      （Python 独立验证：`calendar.timegm((2099,1,2,16,47,31,0,0,0))`
    //      与 `datetime(2099,1,2,16,47,31,tzinfo=timezone.utc).timestamp()`
    //      两种算法都得到 4071055651，相互印证）
    //   2. 减去偏移量：4071055651 - 8*3600 = 4071055651 - 28800 = 4071026851
    //   3. 转成毫秒：4071026851 * 1000 = 4071026851000
    let record = record_by_key(&records, "2:1900000000000000006");
    assert_eq!(
        record.occurred_at, 4_071_026_851_000,
        "occurred_at 应当精确等于按「朴素时间视为 UTC 再减 8 小时偏移」算出的字面量"
    );
}

// ============================================================
// fail-closed 守卫本身没有因解冻而失守
// ============================================================

/// `import_wwgacha.rs` 的
/// `import_batch_fails_closed_when_plugin_declares_api_field_and_archive_has_no_tz_offset`
/// 已经从"这个存档格式恒不携带时区"的角度证明过守卫还在——本测试从 UIGF
/// 路径本身再证一次：拿一份真实 UIGF 存档产出的 `ImportBatch`，手工清空
/// `tz_offset_hours`（`ImportAccount` 字段是 `pub`，可以直接改），模拟
/// "这份存档本该携带时区信息、但这个字段缺失"的情况，断言仍然 fail
/// closed——不是因为它现在总是能通过就不再检查了。
#[test]
fn import_batch_fails_closed_for_uigf_archive_when_tz_offset_hours_is_missing() {
    let archive_bytes = read_fixture_bytes("fixtures/starrail/archive/uigf_v4_starrail.json");
    let mut batch = import_single_uigf_batch(&archive_bytes);
    batch.account.tz_offset_hours = None;

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "starrail");
    let repo = storage.repository();
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for("starrail", &runtime);

    let result = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT);
    let err = result.expect_err("tz_offset_hours 缺失时，星铁 apiField 插件应当仍然 fail closed");
    assert!(
        matches!(&err, ImportError::TimezoneUnavailable { plugin_id } if plugin_id == "starrail"),
        "错误应当是 TimezoneUnavailable 且携带插件 id，实际：{err:?}"
    );

    let records = repo
        .find_records_by_banner(account_id, "11")
        .expect("查询应当成功");
    assert!(records.is_empty(), "fail closed 应当在任何记录落库之前发生");
}

// ============================================================
// timezone 字段语义：两份仅 timezone 不同的存档，落库后 occurred_at 之差
// 恰好等于声明的小时数之差——走完整的 import_batch，不是绕过它单独测
// build_records
// ============================================================

/// UIGF 存档声明的 `timezone` 字段，语义是"假设记录的朴素时间属于这个
/// 偏移量"（`crates/gs-exchange/src/uigf.rs` 模块文档"时间字段"一节，
/// 校准依据 `converters.rs:1610-1654` 的读取逻辑）。适配器本身不做这层
/// 换算（原样透传 `time` 字符串），换算发生在 `import_batch` 传给
/// `AuthkeyApiPipeline::build_records` 的 `page_tz_offset_hours` 参数里。
///
/// 与上面两条"精确到毫秒"的测试互补：那两条各自只锚定**一条**记录的绝对
/// 值，这条测试覆盖**全部 9 条**记录的相对值（逐条核对 A/B 两次落库的
/// `occurred_at` 之差），用来抓"只有部分记录漂移"这类不会被单点断言
/// 抓到的问题——例如某条记录因为分组/排序错位被喂进了 pipeline 两次不同
/// 的调用而各自算出不一致的偏移。
///
/// ⚠️ **必须用星铁，不能用原神**：原神插件声明了
/// `hooks.resolveTimezone`（按 UID 首位数字推断，与 `tz_offset_hours`
/// 无关），`AuthkeyApiPipeline::build_records` 在 `timezoneSource:
/// computed` 且插件声明了这个 hook 时会**无条件**改用 hook 的返回值，
/// 完全忽略 `ImportAccount.tz_offset_hours`——用原神测这条语义，改变
/// timezone 参数对 `occurred_at` 不会有任何影响，测的是错误的分支。星铁
/// 声明的是 `timezoneSource: apiField`，没有声明 `resolveTimezone`，会
/// 老实使用 `import_batch` 传下去的偏移量。
#[test]
fn timezone_field_changes_occurred_at_by_the_declared_delta_hours() {
    let archive_a = read_fixture_bytes("fixtures/starrail/archive/uigf_v4_starrail.json");
    let archive_b =
        read_fixture_bytes("fixtures/starrail/archive/uigf_v4_starrail_timezone_variant.json");

    let batch_a = import_single_uigf_batch(&archive_a);
    let batch_b = import_single_uigf_batch(&archive_b);
    let tz_a = batch_a
        .account
        .tz_offset_hours
        .expect("星铁 UIGF 存档应当带有 tz_offset_hours");
    let tz_b = batch_b
        .account
        .tz_offset_hours
        .expect("星铁 UIGF 存档应当带有 tz_offset_hours");
    assert_ne!(tz_a, tz_b, "自证前提：两份 fixture 的 timezone 必须不同");

    let banner_a = batch_a
        .banners
        .iter()
        .find(|b| b.banner_id == "11")
        .expect("应当有 banner 11");
    let banner_b = batch_b
        .banners
        .iter()
        .find(|b| b.banner_id == "11")
        .expect("应当有 banner 11");
    // 自证前提：两份 fixture 除 timezone 外完全相同——适配器还原出的
    // 记录（含 time 字符串）应当逐项相等，差异只应该体现在下面落库后的
    // occurred_at 上，不是适配器自己在还原阶段就偷偷做了换算。
    assert_eq!(
        banner_a.records, banner_b.records,
        "两份 fixture 除 timezone 外应当完全相同，适配器不应该把 timezone 换算进 time 字段"
    );

    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = pipeline_for("starrail", &runtime);

    let storage_a = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_a = setup_account(&storage_a, "starrail");
    let repo_a = storage_a.repository();
    import_batch(&batch_a, &pipeline, &repo_a, account_a, CAPTURED_AT).expect("导入 A 应当成功");
    let records_a = repo_a
        .find_records_by_banner(account_a, "11")
        .expect("查询应当成功");

    let storage_b = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_b = setup_account(&storage_b, "starrail");
    let repo_b = storage_b.repository();
    import_batch(&batch_b, &pipeline, &repo_b, account_b, CAPTURED_AT).expect("导入 B 应当成功");
    let records_b = repo_b
        .find_records_by_banner(account_b, "11")
        .expect("查询应当成功");

    assert_eq!(records_a.len(), 9);
    assert_eq!(records_b.len(), 9);

    let expected_delta_ms = i64::from(tz_a - tz_b) * 3600 * 1000;
    for a in &records_a {
        let b = record_by_key(&records_b, a.record_key.as_str());
        assert_eq!(
            b.occurred_at - a.occurred_at,
            expected_delta_ms,
            "record_key \"{}\" 在两个不同 timezone 声明下的 occurred_at 之差应当恰好等于 \
             声明的小时数之差：tz_a={tz_a}, tz_b={tz_b}",
            a.record_key.as_str()
        );
    }
}
