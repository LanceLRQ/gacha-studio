//! 端到端验证：`gs-host` 导入流程对"鸣潮同秒内序位漂移"这条 fail-closed
//! 检查（`src/import.rs` 模块文档"同秒内序位漂移的 fail-closed"一节）。
//!
//! 与 `import_wwgacha.rs`/`import_uigf.rs` 分开成独立文件——任务范围要求
//! 不修改已存在的测试函数，新检查的测试因此单独落地。
//!
//! 判据：对本批 `[min(occurred_raw), max(occurred_raw)]` 区间内、**库中与
//! 本批都有记录**的每一秒，按 item_id 逐项比对条数，必须完全相等。
//!
//! 覆盖点：
//! 1. 库中在本批区间内完全没有记录 → 放行
//!    （`second_count_check_passes_when_db_has_no_records_in_the_batch_range`）
//! 2. 同一份存档片段二次导入 → 幂等放行
//!    （`second_count_check_passes_when_reimporting_identical_batch`）
//! 3. 真实会漂移的场景：`fixtures/wuwa/raw_response/1_page_1.json` 里
//!    `2099-01-01T00:00:00` 这一秒天然是同秒碰撞组（10 条，`21020043`/
//!    `21010013` 各出现 2 次），先导入这一秒的一个残缺子集（7 条），再导入
//!    这一秒的完整集合（10 条）→ 第二次必须报错
//!    （`second_import_covering_more_of_the_same_second_is_rejected`）
//! 4. 非批处理 key 的插件（genshin，走 `hooks.deriveRecordKey` 单数）完全
//!    不受影响（`plugins_without_batch_record_keys_are_unaffected`）
//! 5. 多个秒同时在批次里时，报的是**时间上最早**的那个不一致的秒，不是最晚
//!    的——覆盖点 1~4 的数据全部只落在单一秒上，`.min()`/`.max()` 在那些
//!    场景里没有区别，这一条专门构造"批次里混有两个不同秒、只有较早那个
//!    漂移"来堵住这个盲区
//!    （`rejects_earliest_second_mismatch_even_when_a_later_second_is_consistent`）
//! 6. **批次向更早方向扩展、而区间内某个较晚的秒在库里是残缺的** → 必须拒绝。
//!    这是"只检查最早一秒"那版实现的真实漏判，也是把判据改成"扫整个区间"的
//!    直接原因（`rejects_when_batch_starts_earlier_than_db_and_an_inner_
//!    second_is_incomplete_in_db`）
//! 7. 不一致的秒夹在区间中间、两个端点都与库中一致 → 必须拒绝。证明检查扫的
//!    是整个区间而不是只看端点
//!    （`rejects_a_mismatching_second_in_the_middle_of_the_batch_range`）
//!
//! 覆盖点 6、7 经变异测试确认确实在防守：把实现里遍历重叠秒的循环改成
//! `.take(1)`（等价于退回"只查最早一秒"）时，**恰好这两条变红**，其余五条
//! 全绿。

use std::path::{Path, PathBuf};

use gs_exchange::{ExchangeAdapter, ImportAccount, ImportBanner, ImportBatch, uigf::UigfAdapter};
use gs_host::import::{ImportError, import_batch};
use gs_p_authkey::{AuthkeyApiPipeline, RateLimitPolicy};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewAccount, Storage};
use serde_json::Value;

const CAPTURED_AT: i64 = 1_755_000_000_000;
const WUWA_BANNER_ID: &str = "1";
/// `fixtures/wuwa/raw_response/1_page_1.json` 里天然的同秒碰撞组，见文件
/// 头部覆盖点 3 的说明。
const COLLISION_SECOND: &str = "2099-01-01T00:00:00";
/// 同一份 fixture 里的第二个天然同秒组（`idx[0..5]`，5 条，全部是
/// `resourceId=21030043`）——时间字符串比 `COLLISION_SECOND` 更晚
/// （"2100" > "2099"，字典序与时间先后一致）。只在覆盖点 5 里使用，专门
/// 用来跟 `COLLISION_SECOND` 搭配构造"批次里混有两个不同秒"的场景。
const LATER_CONSISTENT_SECOND: &str = "2100-01-06T22:53:07";
/// 合成出来的、比 `COLLISION_SECOND` 更早的一秒。fixture 里没有比它更早的
/// 真实记录，而覆盖点 7 需要一个"两端一致、中间不一致"里的**最早端**，
/// 只能自己造，见 [`with_time`]。格式必须仍是 `isoLocal`
/// （`plugins/wuwa/manifest.ts` 声明的 `rawFormat`），否则 Rust 侧
/// `parse_record_time` 会直接报错，测不到本要测的东西。
const EARLIEST_SYNTHETIC_SECOND: &str = "2098-01-01T00:00:00";

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

/// `raw_response/*.json` 的 `data` 数组，形状与采集路径 `extractList` 拆出
/// 来的一致，见 `import_wwgacha.rs` 的同名辅助函数。
fn read_wuwa_raw_records() -> Vec<Value> {
    let bytes = read_fixture_bytes("fixtures/wuwa/raw_response/1_page_1.json");
    let value: Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|err| panic!("解析 fixture 失败：{err}"));
    value
        .get("data")
        .and_then(Value::as_array)
        .expect("fixture 应当有 data 数组")
        .clone()
}

/// 挑出 `time` 恰好等于 `second` 的那些记录，保持原顺序。
fn records_at(raw_records: &[Value], second: &str) -> Vec<Value> {
    raw_records
        .iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(second))
        .cloned()
        .collect()
}

/// 复制一条记录并改写它的 `time`，用来合成 fixture 天然没有的时间点。
/// 只在覆盖点 7 用到——那条测试要的是"两个端点都一致、中间不一致"，而
/// fixture 里没有比 `COLLISION_SECOND` 更早的记录可以充当端点。
fn with_time(record: &Value, second: &str) -> Value {
    let mut cloned = record.clone();
    cloned
        .as_object_mut()
        .expect("fixture 里的记录应当都是 JSON 对象")
        .insert("time".to_string(), Value::String(second.to_string()));
    cloned
}

fn setup_account(storage: &Storage, plugin_id: &str) -> i64 {
    storage
        .repository()
        .create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
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

/// 用一段原始记录切片直接合成一个单卡池 `ImportBatch`——不经过任何存档
/// 适配器，直接构造，方便按需拼出"残缺子集 / 完整集合"这类真实存档不会
/// 天然产生的对照场景。`tz_offset_hours`/`region`/`server_id` 全部留空：
/// wuwa 未声明 `timezoneSource: apiField/staticTable`（manifest 里明确
/// 留白，见 `plugins/wuwa/manifest.ts` 对应注释），不需要这些字段就能
/// 正常导入。
fn synthetic_wuwa_batch(records: Vec<Value>) -> ImportBatch {
    ImportBatch {
        format_id: "test-synthetic".to_string(),
        game_id: "wuwa".to_string(),
        account: ImportAccount {
            uid: "100000000".to_string(),
            region: None,
            server_id: None,
            tz_offset_hours: None,
            lang: None,
        },
        banners: vec![ImportBanner {
            banner_id: WUWA_BANNER_ID.to_string(),
            records,
        }],
    }
}

// ============================================================
// 覆盖点 1：库空时放行
// ============================================================

#[test]
fn second_count_check_passes_when_db_has_no_records_in_the_batch_range() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);
    // 自证前提：wuwa 是这条新检查唯一会实际触发的插件，先确认它确实声明了
    // 批处理 hooks.deriveRecordKeys——否则下面的"导入成功"断言不能说明新
    // 检查真的放行过，只能说明它压根没被触发。
    assert!(
        pipeline.has_derive_record_keys(),
        "自证前提：wuwa 应当声明批处理 hooks.deriveRecordKeys，新检查才会对它生效"
    );

    let raw_records = read_wuwa_raw_records();
    let collision_second: Vec<Value> = raw_records
        .into_iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(COLLISION_SECOND))
        .collect();
    assert_eq!(collision_second.len(), 10, "自证前提：该秒应当有 10 条记录");
    let batch = synthetic_wuwa_batch(collision_second);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    let summary = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT)
        .expect("库中该秒没有任何已有记录时，新检查应当放行，导入应当成功");
    assert_eq!(summary.records_inserted, 10);
}

// ============================================================
// 覆盖点 2：同一份存档片段二次导入，幂等放行
// ============================================================

#[test]
fn second_count_check_passes_when_reimporting_identical_batch() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let raw_records = read_wuwa_raw_records();
    let collision_second: Vec<Value> = raw_records
        .into_iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(COLLISION_SECOND))
        .collect();
    let batch = synthetic_wuwa_batch(collision_second);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    let first =
        import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT).expect("首次导入应当成功");
    assert_eq!(first.records_inserted, 10);

    // 二次导入的 built 集合与库中该秒已有记录按 item_id 分组后条数逐项
    // 相等——新检查应当放行，而不是把"完全相同"误判成"不一致"。
    let second = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT + 1)
        .expect("同一份存档片段二次导入应当放行（幂等）");
    assert_eq!(second.records_inserted, 0);
    assert_eq!(second.records_skipped, 10);
}

// ============================================================
// 覆盖点 3：真实会漂移的场景 → 第二次导入必须报错
// ============================================================

#[test]
fn second_import_covering_more_of_the_same_second_is_rejected() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let raw_records = read_wuwa_raw_records();
    let collision_second: Vec<Value> = raw_records
        .into_iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(COLLISION_SECOND))
        .collect();
    assert_eq!(collision_second.len(), 10, "自证前提：该秒应当有 10 条记录");

    // Batch A：这一秒的前 7 条（残缺子集，模拟"存档片段"）。
    let batch_a = synthetic_wuwa_batch(collision_second[0..7].to_vec());
    // Batch B：这一秒的完整 10 条（模拟"更完整的一次采集/另一份存档片段"）
    // ——比 Batch A 多出 21010013 x2、1601 x1，且与 DB 里已有的计数不一致。
    let batch_b = synthetic_wuwa_batch(collision_second[0..10].to_vec());

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    let first = import_batch(&batch_a, &pipeline, &repo, account_id, CAPTURED_AT)
        .expect("Batch A（残缺子集）首次导入应当成功");
    assert_eq!(first.records_inserted, 7);

    let result = import_batch(&batch_b, &pipeline, &repo, account_id, CAPTURED_AT + 1);
    let err = result
        .expect_err("Batch B 与库中已有记录在最早一秒的 item_id 计数不一致，第二次导入应当被拒绝");
    assert!(
        matches!(
            &err,
            ImportError::SecondCountMismatch { plugin_id, banner_key, occurred_raw, .. }
                if plugin_id == "wuwa" && banner_key == WUWA_BANNER_ID && occurred_raw == COLLISION_SECOND
        ),
        "错误应当是 SecondCountMismatch，且携带插件 id/卡池/时间三项定位信息，实际：{err:?}"
    );
    let message = err.to_string();
    assert!(
        message.contains(WUWA_BANNER_ID) && message.contains(COLLISION_SECOND),
        "错误信息里应当能看出是哪个卡池、哪一秒，实际：{message}"
    );
    assert!(
        message.contains("21010013") || message.contains("1601"),
        "错误信息里应当至少能看出一个不一致的 item_id（Batch B 独有的 21010013/1601），实际：{message}"
    );

    // fail closed 必须发生在 Batch B 的任何记录落库之前——库里该秒的记录
    // 总数应当仍然是 Batch A 的 7 条，不多不少。
    let records = repo
        .find_records_by_banner(account_id, WUWA_BANNER_ID)
        .expect("查询应当成功");
    assert_eq!(
        records.len(),
        7,
        "第二次导入被拒绝后，库里该卡池的记录总数不应变化"
    );
}

// ============================================================
// 覆盖点 4：非批处理 key 的插件（genshin）完全不受影响
// ============================================================

#[test]
fn plugins_without_batch_record_keys_are_unaffected() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline =
        AuthkeyApiPipeline::new("genshin", &runtime, RateLimitPolicy::zero_delay_for_tests())
            .expect("应当能构造 genshin pipeline");
    assert!(
        !pipeline.has_derive_record_keys(),
        "genshin 走逐条 hooks.deriveRecordKey，不应当声明批处理 hooks.deriveRecordKeys"
    );

    let archive_bytes = read_fixture_bytes("fixtures/genshin/archive/uigf_v4_genshin.json");
    let batches = UigfAdapter
        .import(&archive_bytes)
        .expect("genshin UIGF 存档应当能被成功导入");
    assert_eq!(batches.len(), 1);
    let batch = batches.into_iter().next().unwrap();

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "genshin");
    let repo = storage.repository();

    let first =
        import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT).expect("首次导入应当成功");
    assert_eq!(first.records_inserted, 5, "genshin fixture 共 5 条记录");

    // 新检查整体跳过（has_derive_record_keys() == false），二次导入的幂等
    // 行为应当与新检查加入之前完全一致，不应被这条与它无关的检查误伤。
    let second = import_batch(&batch, &pipeline, &repo, account_id, CAPTURED_AT + 1)
        .expect("genshin 二次导入应当照常幂等放行，不受新检查影响");
    assert_eq!(second.records_inserted, 0);
    assert_eq!(second.records_skipped, 5);
}

// ============================================================
// 覆盖点 5：检查取的是"最早一秒"，不是"最晚一秒"
// ============================================================

/// 上面覆盖点 1~4 的每一条，批次里全部记录都只落在单一秒上——`.min()`（正确
/// 实现）与 `.max()`（错误实现，比如把源码里的 `.min()` 手滑改成 `.max()`）
/// 在只有一个候选值的集合上算出完全相同的结果，因此那四条测试无法区分这
/// 两种实现，是真实存在的检测盲区。
///
/// 这里专门构造一个批次，混入两个不同秒：`COLLISION_SECOND`（较早，两次
/// 导入之间会漂移）与 `LATER_CONSISTENT_SECOND`（较晚，两次导入完全一致，
/// 不会漂移）。正确实现（取最早一秒）应当因为较早那组不一致而报错；如果
/// 被错误地改成取最晚一秒，会去看较晚那组——那组两次导入完全一致，检查会
/// 误判放行，从而让较早那组的漂移悄悄溜过去。
#[test]
fn rejects_earliest_second_mismatch_even_when_a_later_second_is_consistent() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let raw_records = read_wuwa_raw_records();
    let earliest_full: Vec<Value> = raw_records
        .iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(COLLISION_SECOND))
        .cloned()
        .collect();
    assert_eq!(
        earliest_full.len(),
        10,
        "自证前提：较早那一秒应当有 10 条记录"
    );
    let later_full: Vec<Value> = raw_records
        .into_iter()
        .filter(|r| r.get("time").and_then(Value::as_str) == Some(LATER_CONSISTENT_SECOND))
        .collect();
    assert_eq!(later_full.len(), 5, "自证前提：较晚那一秒应当有 5 条记录");

    // 第一次导入：较早那一秒只导入残缺子集（7 条），较晚那一秒导入完整
    // 集合（5 条）——库空，两组都没有已有记录可比较，导入应当直接成功。
    let mut first_records = earliest_full[0..7].to_vec();
    first_records.extend(later_full.clone());
    let batch_1 = synthetic_wuwa_batch(first_records);

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    let first = import_batch(&batch_1, &pipeline, &repo, account_id, CAPTURED_AT)
        .expect("首次导入应当成功（库空，两组都没有已有记录可比较）");
    assert_eq!(first.records_inserted, 12);

    // 第二次导入：较早那一秒补全成完整 10 条（与库里已有的 7 条不一致），
    // 较晚那一秒仍然是完整 5 条（与库里已有的 5 条完全一致）——只有较早
    // 那一秒存在漂移风险。
    let mut second_records = earliest_full;
    second_records.extend(later_full);
    let batch_2 = synthetic_wuwa_batch(second_records);

    let result = import_batch(&batch_2, &pipeline, &repo, account_id, CAPTURED_AT + 1);
    let err = result.expect_err(
        "较早一秒与库中记录不一致，即使较晚一秒完全一致，第二次导入也应当被拒绝——\
         若检查错误地只看最晚一秒，这里会误判放行",
    );
    assert!(
        matches!(
            &err,
            ImportError::SecondCountMismatch { occurred_raw, .. }
                if occurred_raw == COLLISION_SECOND
        ),
        "错误应当指向较早那一秒（COLLISION_SECOND），而不是较晚那一秒——这正是区分\
         \"取最早一秒\"与\"取最晚一秒\"两种实现的关键断言，实际：{err:?}"
    );
}

// ============================================================
// 覆盖点 6：批次起点早于库中已有数据，而区间内某一秒在库里是残缺的
//
// 这一条是"只检查最早一秒"那版实现的真实漏判，也是把判据从"最早一秒"
// 改成"区间内每一个重叠秒"的直接原因，见 `src/import.rs` 模块文档
// "教训：曾经只检查最早一秒"一节。
// ============================================================

#[test]
fn rejects_when_batch_starts_earlier_than_db_and_an_inner_second_is_incomplete_in_db() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let raw_records = read_wuwa_raw_records();
    let collision_full: Vec<Value> = records_at(&raw_records, COLLISION_SECOND);
    let later_full: Vec<Value> = records_at(&raw_records, LATER_CONSISTENT_SECOND);
    assert_eq!(collision_full.len(), 10, "自证前提：较早那一秒应当有 10 条");
    assert_eq!(later_full.len(), 5, "自证前提：较晚那一秒应当有 5 条");

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    // 第一次导入：只覆盖**较晚**那一秒，而且是残缺子集（5 条里的 3 条）。
    // 这一批的最早一秒就是 LATER_CONSISTENT_SECOND 本身。
    let first = import_batch(
        &synthetic_wuwa_batch(later_full[0..3].to_vec()),
        &pipeline,
        &repo,
        account_id,
        CAPTURED_AT,
    )
    .expect("首次导入应当成功：库空，没有任何已有记录可比较");
    assert_eq!(first.records_inserted, 3);

    // 第二次导入：向**更早**的方向扩展（补上 COLLISION_SECOND 整组 10 条），
    // 同时把较晚那一秒补全成 5 条。
    //
    // 关键点：这一批的最早一秒是 COLLISION_SECOND，而库中在这一秒**一条
    // 记录都没有**——"只查最早一秒"的旧实现在这里会看到"库里这一秒是空的"
    // 就直接放行，完全不会去看 LATER_CONSISTENT_SECOND 那一秒库中只有 3 条、
    // 本批却有 5 条。那 3 条已落库记录的序位是按 3 条的集合算出来的，本批
    // 会按 5 条重算，两边 record_key 不同 → INSERT OR IGNORE 撞不上 →
    // 静默重复入库。
    let mut second_records = collision_full;
    second_records.extend(later_full);
    let result = import_batch(
        &synthetic_wuwa_batch(second_records),
        &pipeline,
        &repo,
        account_id,
        CAPTURED_AT + 1,
    );

    let err = result.expect_err(
        "批次向更早方向扩展、而区间内较晚那一秒在库中是残缺的——必须拒绝。\
         若实现只检查最早一秒，会因为库中最早那一秒为空而误判放行",
    );
    assert!(
        matches!(
            &err,
            ImportError::SecondCountMismatch { occurred_raw, mismatches, .. }
                if occurred_raw == LATER_CONSISTENT_SECOND
                    && mismatches.iter().any(|(_, db, batch)| *db == 3 && *batch == 5)
        ),
        "错误应当指向较晚那一秒（库中 3 条 / 本批 5 条），实际：{err:?}"
    );

    // 落库侧自证：拒绝之后库里仍然只有第一次那 3 条，没有被写进去任何东西。
    let persisted = repo
        .find_records_by_banner(account_id, WUWA_BANNER_ID)
        .expect("查询应当成功");
    assert_eq!(persisted.len(), 3, "被拒绝的导入不得写入任何记录");
}

// ============================================================
// 覆盖点 7：不一致的秒既不是区间最早也不是区间最晚，而是夹在中间
//
// 证明检查扫的是整个区间，不是只看两个端点——只看端点的实现会漏掉它。
// ============================================================

#[test]
fn rejects_a_mismatching_second_in_the_middle_of_the_batch_range() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let pipeline = wuwa_pipeline(&runtime);

    let raw_records = read_wuwa_raw_records();
    let collision_full = records_at(&raw_records, COLLISION_SECOND);
    let later_full = records_at(&raw_records, LATER_CONSISTENT_SECOND);

    // 合成一个比 COLLISION_SECOND 更早的秒，让 COLLISION_SECOND 落到区间
    // 中间。fixture 天然没有比它更早的记录，而这个测试要的恰恰是"两个端点
    // 都一致、中间不一致"，只能自己造——批次本来就是合成的，见
    // `synthetic_wuwa_batch` 的文档。
    let earliest_pair: Vec<Value> = collision_full
        .iter()
        .take(2)
        .map(|record| with_time(record, EARLIEST_SYNTHETIC_SECOND))
        .collect();

    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    let account_id = setup_account(&storage, "wuwa");
    let repo = storage.repository();

    // 第一次导入：最早的秒完整（2 条）、中间的秒残缺（10 条里的 7 条）、
    // 最晚的秒完整（5 条）。
    let mut first_records = earliest_pair.clone();
    first_records.extend(collision_full[0..7].to_vec());
    first_records.extend(later_full.clone());
    let first = import_batch(
        &synthetic_wuwa_batch(first_records),
        &pipeline,
        &repo,
        account_id,
        CAPTURED_AT,
    )
    .expect("首次导入应当成功：库空");
    assert_eq!(first.records_inserted, 14);

    // 第二次导入：两个端点原样不动（因此都与库中完全一致），只有中间那一秒
    // 从 7 条补全成 10 条。只比对端点的实现在这里会全部判为一致并放行。
    let mut second_records = earliest_pair;
    second_records.extend(collision_full);
    second_records.extend(later_full);
    let result = import_batch(
        &synthetic_wuwa_batch(second_records),
        &pipeline,
        &repo,
        account_id,
        CAPTURED_AT + 1,
    );

    let err = result.expect_err(
        "区间中间那一秒与库中不一致——必须拒绝。两个端点都与库中完全一致，\
         只比对端点的实现会在这里误判放行",
    );
    assert!(
        matches!(
            &err,
            ImportError::SecondCountMismatch { occurred_raw, .. }
                if occurred_raw == COLLISION_SECOND
        ),
        "错误应当指向区间中间那一秒（COLLISION_SECOND），既不是最早的 \
         {EARLIEST_SYNTHETIC_SECOND}，也不是最晚的 {LATER_CONSISTENT_SECOND}，实际：{err:?}"
    );
}
