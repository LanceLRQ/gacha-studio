//! `gs-codegen`：从 `gs-core` 的 Rust 类型生成 TypeScript 绑定。
//!
//! # 为什么显式列出全部导出类型
//!
//! `gs-core` 的类型不写 `#[ts(export)]`（那会让导出散落在各模块的
//! `#[cfg(test)]` 生成代码里，review 时看不全）。改为在这里用一份显式清单
//! 逐个调用 `T::decl(&cfg)`——新增导出类型必须在这份清单里手动追加一行，
//! PR diff 一眼可见哪个类型是新加的。这与 `plugins/index.ts` 用显式注册表
//! 而非自动收集是同一个理由。
//!
//! # 为什么产物必须是确定性的
//!
//! HC-3 门禁的验收方式是「重跑 `cargo run -p gs-host --bin gs-codegen` 后
//! `git diff` 必须为空」。ts-rs 内部对依赖类型的收集用的是 `HashSet`/
//! `HashMap`，遍历顺序不保证稳定；如果让 ts-rs 自己决定写入顺序（比如用
//! `export_to_string` 之类会展开依赖图的接口），两次运行之间可能产生纯粹
//! 因遍历顺序不同造成的 diff，把门禁变成永远红灯。本文件绕开这个问题的
//! 方式很直接：只用 `T::decl(&cfg)` 取每个类型**自身**的声明字符串（不含
//! 依赖展开、不含 import 语句），按下面 `type_decls` 清单里手写的固定顺序
//! 拼接。类型之间的引用靠 TS 的类型声明可以互相前向引用这一特性解决，不需要
//! 按依赖关系排序。

use gs_core::{
    AcquireError, BackoffKind, BannerBaseline, BannerIdentitySource, BannerSpec, Dependency,
    DrawCountingConfig, ErrorSemantic, GachaRecord, GameClientSize, GuaranteeRule, HostEnv,
    HttpMethod, LocalizedText, MetaState, MetadataEntry, NetworkError, NoCredentialReason,
    PityGroup, Platform, PreconditionLevel, PreconditionStatus, ProbabilityCurve, RareEventRef,
    RaritySpec, RateLimitConfig, RawTimeConvention, RawTimeFormat, RecordKey, RecordSource,
    RequestTemplate, RetentionPolicy, RetryConfig, StopCondition, TimeConfig, TimezoneSource,
    TzOrigin, UnifiedRecordFields,
};
use gs_host::views::{
    AccountAnalysisView, AccountView, CurveEvaluationView, GameView, ImportReport,
    ImportedAccountReport, OverviewStatsView, PityGroupProgressView, PityPullView,
    PluginRarityDistributionView, RarityDistributionView, RecordPage,
};
use std::fs;
use std::path::PathBuf;
use ts_rs::{Config, TS};

/// 生成文件相对仓库根的路径。
const OUTPUT_RELATIVE_PATH: &str = "packages/gs-plugin-kit/types/generated.ts";

/// 生成文件首行的固定说明，见任务约束「生成产物必须是确定性的」第 3 条。
const HEADER: &str = "// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-core 后重跑 `cargo run -p gs-host --bin gs-codegen`。";

/// IPC 视图类型的生成落点。唯一消费者是前端，不进 `gs-plugin-kit`——
/// 完整理由见 `crates/gs-host/src/views.rs` 的模块文档。
const IPC_OUTPUT_RELATIVE_PATH: &str = "web/src/lib/ipc/generated.ts";

/// IPC 产物的文件头。比上面那份多一行 `import type`：这份文件里的类型会
/// 引用 `GachaRecord`（`RecordPage.records` 的元素类型）、`RaritySpec`/
/// `BannerSpec`（`GameView.rarity`/`GameView.banners`），而它们都属于另一份
/// 产物。两份产物之间用真实的 TS import 连接，不复制一份声明过来——
/// 复制会得到两个同名但可能悄悄漂移的类型。
const IPC_HEADER: &str = "// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-host/src/views.rs 后重跑 `cargo run -p gs-host --bin gs-codegen`。\n\
import type { GachaRecord, RaritySpec, BannerSpec } from \"gs-plugin-kit/types\";";

fn main() {
    // ts-rs 对 i64/u64/i128/u128 的默认映射是 `bigint`，不是 `number`。这在
    // 本项目里是错的：领域类型经 serde_json 序列化后通过 Tauri IPC/JSON 传输，
    // `JSON.parse` 永远不会产出 `bigint`——TS 类型标 `bigint` 而运行时实际是
    // `number`，是一个会在运行时露出来的类型谎言。我们的 i64 字段（时间戳、
    // 自增主键）都在 `Number.isSafeInteger` 范围内，因此显式覆盖成 `number`，
    // 不用默认值。
    let cfg = Config::new().with_large_int("number");

    // 显式清单：类型名 + 一句话来源，顺序即输出顺序。新增类型在这里追加一行。
    let type_decls: Vec<(&str, String)> = vec![
        // --- record.rs：基础值对象 ---
        ("LocalizedText", LocalizedText::decl(&cfg)),
        ("Platform", Platform::decl(&cfg)),
        ("RaritySpec", RaritySpec::decl(&cfg)),
        ("RetentionPolicy", RetentionPolicy::decl(&cfg)),
        ("DrawCountingConfig", DrawCountingConfig::decl(&cfg)),
        ("BannerSpec", BannerSpec::decl(&cfg)),
        ("HttpMethod", HttpMethod::decl(&cfg)),
        ("RequestTemplate", RequestTemplate::decl(&cfg)),
        ("MetadataEntry", MetadataEntry::decl(&cfg)),
        ("RareEventRef", RareEventRef::decl(&cfg)),
        ("BannerBaseline", BannerBaseline::decl(&cfg)),
        ("UnifiedRecordFields", UnifiedRecordFields::decl(&cfg)),
        // --- record.rs：GachaRecord 与其字段类型 ---
        ("TzOrigin", TzOrigin::decl(&cfg)),
        ("MetaState", MetaState::decl(&cfg)),
        ("RecordSource", RecordSource::decl(&cfg)),
        // BannerIdentitySource 不是 GachaRecord 的字段类型（不影响它的形状），
        // 但由 packages/gs-plugin-kit/manifest.ts 的
        // CredentialedApiPipelineParams.bannerIdentity 引用，且与本节其余
        // record.rs 判别联合同源，因此归在这一组导出，不单开一个分组。
        ("BannerIdentitySource", BannerIdentitySource::decl(&cfg)),
        // RecordKey 未列在原始导出清单里，但 GachaRecord.record_key 直接引用它，
        // 不导出的话生成文件里会出现指向未定义类型的引用，因此补上。
        ("RecordKey", RecordKey::decl(&cfg)),
        ("GachaRecord", GachaRecord::decl(&cfg)),
        // --- pity.rs：保底相关 ---
        ("ProbabilityCurve", ProbabilityCurve::decl(&cfg)),
        ("GuaranteeRule", GuaranteeRule::decl(&cfg)),
        ("PityGroup", PityGroup::decl(&cfg)),
        // --- collect.rs：采集流程配置 ---
        ("RateLimitConfig", RateLimitConfig::decl(&cfg)),
        ("RetryConfig", RetryConfig::decl(&cfg)),
        ("BackoffKind", BackoffKind::decl(&cfg)),
        ("ErrorSemantic", ErrorSemantic::decl(&cfg)),
        ("StopCondition", StopCondition::decl(&cfg)),
        ("TimeConfig", TimeConfig::decl(&cfg)),
        ("RawTimeConvention", RawTimeConvention::decl(&cfg)),
        ("RawTimeFormat", RawTimeFormat::decl(&cfg)),
        ("TimezoneSource", TimezoneSource::decl(&cfg)),
        ("PreconditionLevel", PreconditionLevel::decl(&cfg)),
        ("PreconditionStatus", PreconditionStatus::decl(&cfg)),
        ("HostEnv", HostEnv::decl(&cfg)),
        ("GameClientSize", GameClientSize::decl(&cfg)),
        // --- error.rs：结构化采集错误 ---
        ("AcquireError", AcquireError::decl(&cfg)),
        ("Dependency", Dependency::decl(&cfg)),
        ("NetworkError", NetworkError::decl(&cfg)),
        ("NoCredentialReason", NoCredentialReason::decl(&cfg)),
    ];

    write_generated(OUTPUT_RELATIVE_PATH, HEADER, &type_decls);

    // --- 第二份产物：IPC 视图类型 ---
    //
    // 与上面那份分开写，理由见 `crates/gs-host/src/views.rs` 的模块文档
    // （一句话：那份是插件契约、要过 HC-3 的 zod 覆盖率检查，这份是应用
    // 自己的 IPC 形状、给它写 zod 是用运行时校验去验自己的输出）。
    let ipc_decls: Vec<(&str, String)> = vec![
        ("AccountView", AccountView::decl(&cfg)),
        ("RecordPage", RecordPage::decl(&cfg)),
        ("ImportReport", ImportReport::decl(&cfg)),
        ("ImportedAccountReport", ImportedAccountReport::decl(&cfg)),
        // --- 插件展示元数据（list_games） ---
        ("GameView", GameView::decl(&cfg)),
        // --- 分析结果（account_analysis / overview_stats） ---
        ("CurveEvaluationView", CurveEvaluationView::decl(&cfg)),
        ("PityPullView", PityPullView::decl(&cfg)),
        ("PityGroupProgressView", PityGroupProgressView::decl(&cfg)),
        ("RarityDistributionView", RarityDistributionView::decl(&cfg)),
        ("AccountAnalysisView", AccountAnalysisView::decl(&cfg)),
        (
            "PluginRarityDistributionView",
            PluginRarityDistributionView::decl(&cfg),
        ),
        ("OverviewStatsView", OverviewStatsView::decl(&cfg)),
    ];
    write_generated(IPC_OUTPUT_RELATIVE_PATH, IPC_HEADER, &ipc_decls);
}

/// 把一份显式类型清单拼成 TS 文件写盘。
///
/// 两份产物共用同一套拼接规则——尤其是"按清单里手写的固定顺序输出"这条：
/// ts-rs 内部用 `HashMap` 收集依赖，让它自行展开会让两次运行产生纯粹因
/// 遍历顺序不同造成的 diff，把 HC-3 变成永远红灯，见本文件头部说明。
fn write_generated(relative_path: &str, header: &str, decls: &[(&str, String)]) {
    let mut body = String::new();
    // 元组的类型名（`_name`）只在清单里作 review 时的可读标注用，
    // 类型名本身已经出现在 `decl()` 的输出文本里，不需要在这里重复拼接。
    for (_name, decl) in decls {
        // `decl()` 只返回 `type Foo = ...;`，没有 `export` 关键字，这里手动补上；
        // 也没有依赖类型的 import 语句，符合「单文件打包、类型间用裸名互相引用」的设计。
        body.push_str("export ");
        body.push_str(decl);
        body.push('\n');
    }

    let content = format!("{header}\n\n{body}");
    let output_path = repo_root().join(relative_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .unwrap_or_else(|err| panic!("创建目录 {} 失败: {err}", parent.display()));
    }
    fs::write(&output_path, &content)
        .unwrap_or_else(|err| panic!("写入 {} 失败: {err}", output_path.display()));

    println!("已生成 {} 个类型 -> {}", decls.len(), output_path.display());
}

/// 从当前二进制所在 crate 的 `CARGO_MANIFEST_DIR`（`<repo>/crates/gs-host`）
/// 回推仓库根目录。
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // crates/
        .and_then(|p| p.parent()) // <repo>
        .expect("gs-host 的 CARGO_MANIFEST_DIR 应当位于 <repo>/crates/gs-host")
        .to_path_buf()
}

// 确定性测试（连跑两次产物字节必须一致）在 `tests/gs_codegen_determinism.rs`
// 里，不放在这个文件的 `#[cfg(test)] mod tests` 里。原因：`CARGO_BIN_EXE_<name>`
// 这个环境变量在「同一个 bin target 的单元测试」里对自身不可用——`env!()` 在
// 编译当前二进制时还不知道自身最终产物的路径，是自引用的先有鸡还是先有蛋问题
// （`cargo test` 报 `environment variable CARGO_BIN_EXE_gs-codegen not defined
// at compile time`）。放进 `tests/` 目录的集成测试则没有这个问题：集成测试是
// 独立的编译目标，cargo 会先把 `gs-codegen` 构建完，再把它的路径通过环境变量
// 交给集成测试。
