//! 导出编排的端到端验证：真实 fixture → 真实 [`import_archive_bytes`] 落库
//! → [`gs_host::export`] 产出字节 → 关键场景各自的断言。
//!
//! 逐类排除计数、CSV 转义细节等**单条记录级别**的判定已经在
//! `crates/gs-host/src/export.rs` 的单元测试里覆盖（那些测试同样走真实的
//! `Repository::insert_records` 落库路径，不是手搓结构体拼字符串）；本文件
//! 只负责需要**真实存档 fixture + 真实导入路径**才能证明的两件事：
//!
//! 1. ★ 往返测试——导出 UIGF v4 字节，喂给真实的
//!    [`gs_host::archive::import_archive_bytes`] 重新导入进一个**全新的**
//!    数据库，断言两边的 `record_key` 集合完全相同。这是"数据真的能带走"
//!    最强的证据，任务要求"必须走真实导入路径，不许自己写个简化解析器来
//!    对拍"。
//! 2. CSV 全量无损 vs UIGF 范围收窄——同一份鸣潮 fixture，CSV 必须包含它，
//!    UIGF 必须把它计入 `NotInUigfScope` 排除桶，两者对同一份数据给出不同
//!    结论，这正是本模块"两种格式的定位完全不同"设计的可观察结果。
//!
//! ## 往返测试为什么选星铁 + 绝区零，不选原神
//!
//! 原神插件 `itemIdSource: "displayName"`——`item_id` 来自 API 响应的
//! `name` 字段，而 `GachaRecord` 从不持久化 `name`（只有回填后的真实
//! `item_id`）。UIGF 导出会正确地把回填后的数字 `item_id` 写进 `id` 字段
//! 旁的 `item_id`，但**重新导入时**，原神的 `extractRecord` 只认
//! `raw.name`，不读 `raw.item_id`（`plugins/genshin/hooks.ts` 的
//! `deriveRecordKey` 倒是只依赖 `bannerId`+`stableId`，不受影响，
//! `record_key` 集合因此仍然会相同）——但这不是本文件要证明的最短路径，
//! 星铁/绝区零的 `item_id` 直接来自 API 响应本身，不经历这层间接，用它们
//! 做往返测试更直接地对应"这份数据确实完整地能被带走"这句话的字面含义。
//! 原神字典未回填时应当被排除、不进入导出文件这件事，由
//! `crates/gs-host/src/export.rs` 的
//! `export_uigf_excludes_genshin_pending_records_with_exact_count` 单测覆盖。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use gs_host::archive::import_archive_bytes;
use gs_host::export::{ExportExclusionReason, ExportFormat, export_records};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::Storage;

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

/// 某个 storage 里全部账号、全部记录的 `record_key` 集合。
fn all_record_keys(storage: &Storage) -> HashSet<String> {
    let repo = storage.repository();
    let mut keys = HashSet::new();
    for account in repo.list_accounts().expect("查询账号应当成功") {
        for record in repo
            .find_all_records_for_account(account.id)
            .expect("查询记录应当成功")
        {
            keys.insert(record.record_key.as_str().to_string());
        }
    }
    keys
}

// ================================================================
// ★ 往返测试
// ================================================================

#[test]
fn uigf_export_round_trips_through_real_import_with_identical_record_key_sets() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");

    // 源库：真实导入星铁 + 绝区零两份 UIGF fixture。
    let source_storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    {
        let repo = source_storage.repository();
        let starrail_bytes = read_fixture_bytes("fixtures/starrail/archive/uigf_v4_starrail.json");
        import_archive_bytes(&starrail_bytes, &runtime, &repo, CAPTURED_AT)
            .expect("星铁 UIGF fixture 应当能端到端导入");
        let zzz_bytes = read_fixture_bytes("fixtures/zzz/archive/uigf_v4_zzz.json");
        import_archive_bytes(&zzz_bytes, &runtime, &repo, CAPTURED_AT)
            .expect("绝区零 UIGF fixture 应当能端到端导入");
    }

    let original_keys = all_record_keys(&source_storage);
    assert!(
        original_keys.len() >= 15,
        "自证前提：两份 fixture 合计应当有一定规模的记录，实际 {}",
        original_keys.len()
    );

    // 导出 UIGF v4——断言报告没有静默丢记录：导出条数应当等于源库总条数。
    let (exported_bytes, report) = {
        let repo = source_storage.repository();
        export_records(&repo, ExportFormat::UigfV4, None).expect("UIGF 导出应当成功")
    };
    assert_eq!(
        report.records_exported as usize,
        original_keys.len(),
        "星铁 + 绝区零 fixture 的记录字段形态完整，不应当产生任何排除，报告: {report:?}"
    );
    assert!(
        report.excluded.is_empty(),
        "不应当有任何排除桶，实际: {:?}",
        report.excluded
    );

    // 目标库：全新的、与源库完全无关的数据库——真实证明"这份导出文件本身
    // 就带着完整信息"，不是靠复用同一个连接的隐藏状态蒙混过去。
    let target_storage = Storage::open_in_memory().expect("应当能打开目标内存数据库");
    {
        let repo = target_storage.repository();
        import_archive_bytes(&exported_bytes, &runtime, &repo, CAPTURED_AT + 1)
            .expect("导出的 UIGF v4 字节应当能被真实导入流程重新导入");
    }

    let round_tripped_keys = all_record_keys(&target_storage);
    assert_eq!(
        round_tripped_keys, original_keys,
        "往返导入后的 record_key 集合应当与导出前完全一致"
    );
}

// ================================================================
// CSV 全量无损 vs UIGF 范围收窄：同一份数据，两种结论
// ================================================================

#[test]
fn wuwa_records_appear_in_csv_but_are_excluded_from_uigf() {
    let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
    let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
    {
        let repo = storage.repository();
        let bytes = read_fixture_bytes("fixtures/wuwa/archive/wwgacha_archive.json");
        let report = import_archive_bytes(&bytes, &runtime, &repo, CAPTURED_AT)
            .expect("鸣潮 wwgacha 存档 fixture 应当能端到端导入");
        assert!(
            report.accounts[0].records_inserted > 0,
            "自证前提：应当导入到记录"
        );
    }

    let repo = storage.repository();

    let (csv_bytes, csv_report) =
        export_records(&repo, ExportFormat::Csv, None).expect("CSV 导出应当成功");
    let csv_text = String::from_utf8(csv_bytes).expect("CSV 应当是合法 UTF-8");
    assert!(
        csv_text.lines().any(|line| line.starts_with("wuwa,")),
        "CSV 应当原样包含鸣潮记录（plugin_id 列为 wuwa），全量无损不受 UIGF 范围约束"
    );
    assert!(csv_report.excluded.is_empty(), "CSV 恒不产出排除项");
    assert!(csv_report.records_exported > 0);

    let (uigf_bytes, uigf_report) =
        export_records(&repo, ExportFormat::UigfV4, None).expect("UIGF 导出应当成功");
    assert_eq!(
        uigf_report.records_exported, 0,
        "鸣潮不在 UIGF 覆盖范围内，UIGF 导出不应当产出任何记录"
    );
    let bucket = uigf_report
        .excluded
        .iter()
        .find(|b| b.reason == ExportExclusionReason::NotInUigfScope)
        .expect("应当有 NotInUigfScope 排除桶");
    assert!(bucket.count > 0);
    let uigf_value: serde_json::Value =
        serde_json::from_slice(&uigf_bytes).expect("UIGF 导出应当是合法 JSON");
    assert!(
        uigf_value.get("hk4e").is_none()
            && uigf_value.get("hkrpg").is_none()
            && uigf_value.get("nap").is_none(),
        "全部记录都是鸣潮，三个游戏段都不应当出现"
    );
}
