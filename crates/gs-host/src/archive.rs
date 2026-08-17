//! 存档文件的端到端导入编排：字节 → 嗅探格式 → 适配器 → 账号解析 → 落库。
//!
//! 与 [`crate::import`] 的分工：那个模块处理**单个已构造好的
//! [`ImportBatch`] + 已知 `account_id`**，是导入的内核；这个模块处理它外面
//! 那一圈——一份文件是什么格式、里面有几个账号、这些账号在本地对应哪条
//! `account` 记录。分开是因为内核那部分的正确性（record_key 一致、序位不
//! 漂移、原子性）远比这一圈难，值得独立测试，不该和"找账号"混在一起。
//!
//! **本模块不碰文件系统，也不碰 Tauri**——入口收的是 `&[u8]`。选文件是
//! `src-tauri` 那一层的事，路径不跨 IPC 边界（见
//! `docs/_internal/features/2026-08-14-IPC窄口与前端接线-design.md` §三）。
//! 这样这一整套编排逻辑可以用字节数组直接测，不需要起一个 Tauri app。

use gs_core::GsError;
use gs_exchange::{AdapterRegistry, ExchangeAdapter, ImportBatch, uigf, wwgacha};
use gs_p_authkey::{AuthkeyApiPipeline, RateLimitPolicy};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewAccount, Repository};

use crate::import::{self, ImportError};
use crate::views::{ImportReport, ImportedAccountReport};

/// 嗅探时读取的文件前缀长度。
///
/// [`ExchangeAdapter::sniff`] 的契约明确说 `head` 只是文件开头若干字节、
/// 不保证完整——这个常量就是"若干"的取值。8 KiB 足够覆盖 UIGF 的 `info`
/// 头与 wwgacha 存档的四个顶层键，又不至于为了判个格式把几十 MB 的存档
/// 整个读进内存。
const SNIFF_HEAD_BYTES: usize = 8 * 1024;

/// 存档导入失败的原因。
#[derive(Debug)]
pub enum ArchiveImportError {
    /// 没有任何适配器认领这份文件。
    UnknownFormat,
    /// 多个适配器都给出 `Confident`——存档格式判定有歧义，拒绝猜。
    AmbiguousFormat {
        candidates: Vec<String>,
    },
    /// 适配器解析存档本身失败。
    Adapter(gs_exchange::ImportError),
    /// 存档没有声明区服，而本地已有多个同游戏同 UID 的账号——没有任何依据
    /// 能选对，见 [`Repository::find_accounts_by_plugin_and_uid`] 的文档。
    AmbiguousAccount {
        game_id: String,
        uid: String,
        existing_regions: Vec<String>,
    },
    /// 构造插件流水线失败（多半是存档声明的 `game_id` 没有对应的已注册插件）。
    Pipeline {
        game_id: String,
        detail: String,
    },
    /// 落库阶段失败，含同秒序位漂移这条 fail-closed。
    Import(ImportError),
    Storage(GsError),
}

impl std::fmt::Display for ArchiveImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownFormat => write!(
                f,
                "无法识别这份文件的格式——已注册的交换格式适配器没有一个认领它。\
                 当前支持：UIGF v4.x（原神/星铁/绝区零）与 WWGachaExport 本地存档（鸣潮）"
            ),
            Self::AmbiguousFormat { candidates } => write!(
                f,
                "这份文件同时被多个格式适配器判定为明确匹配（{}）——格式判定有歧义，\
                 拒绝任选其一导入。读错格式却读出了东西是最难自查的一类错误",
                candidates.join("、")
            ),
            Self::Adapter(err) => write!(f, "{err}"),
            Self::AmbiguousAccount {
                game_id,
                uid,
                existing_regions,
            } => write!(
                f,
                "存档没有声明区服，而本地已经有 {} 个同游戏（{game_id}）同 UID（{uid}）\
                 的账号，区服分别是 {}——无法判断这份存档属于哪一个。\
                 请先在账号管理里合并或删除多余的账号再导入",
                existing_regions.len(),
                existing_regions.join("、")
            ),
            Self::Pipeline { game_id, detail } => write!(
                f,
                "无法为存档声明的游戏 \"{game_id}\" 构造采集流水线：{detail}——\
                 多半是这个游戏还没有对应的已注册插件"
            ),
            Self::Import(err) => write!(f, "{err}"),
            Self::Storage(err) => write!(f, "存档导入的存储层失败：{err}"),
        }
    }
}

impl std::error::Error for ArchiveImportError {}

impl From<ImportError> for ArchiveImportError {
    fn from(err: ImportError) -> Self {
        Self::Import(err)
    }
}

impl From<GsError> for ArchiveImportError {
    fn from(err: GsError) -> Self {
        Self::Storage(err)
    }
}

/// 构造一个装齐全部已知交换格式适配器的注册表。
///
/// 显式逐个 `register`，不做自动收集——理由与 `plugins/index.ts` 用显式
/// 注册表一致：新增一个能读用户文件的适配器，必须在 PR diff 里一眼可见。
pub fn default_registry() -> AdapterRegistry {
    let mut registry = AdapterRegistry::new();
    registry.register(Box::new(uigf::UigfAdapter));
    registry.register(Box::new(wwgacha::WwgachaAdapter));
    registry
}

/// 端到端导入一份存档的完整字节。
pub fn import_archive_bytes(
    data: &[u8],
    plugin_runtime: &PluginRuntime,
    repo: &Repository<'_>,
    captured_at: i64,
) -> Result<ImportReport, ArchiveImportError> {
    let registry = default_registry();
    let head = &data[..data.len().min(SNIFF_HEAD_BYTES)];
    let matches = registry.sniff(head);

    // 先看 Confident。多于一个就是歧义，拒绝——两个适配器都"确定"是自己的
    // 格式时，任选一个都可能读出看似合理实则错位的数据。
    let adapter: &dyn ExchangeAdapter = match matches.confident.len() {
        1 => matches.confident[0],
        0 => {
            // 退到 Possible：`sniff` 只看到前缀时可能给不出 Confident，
            // 但这时我们手上有完整文件，让唯一的候选去真正解析一次比直接
            // 判"不认识"更准确——解析失败会走 Adapter 分支报出具体原因。
            match matches.possible.len() {
                1 => matches.possible[0],
                0 => return Err(ArchiveImportError::UnknownFormat),
                _ => {
                    return Err(ArchiveImportError::AmbiguousFormat {
                        candidates: matches
                            .possible
                            .iter()
                            .map(|a| a.format_id().to_string())
                            .collect(),
                    });
                }
            }
        }
        _ => {
            return Err(ArchiveImportError::AmbiguousFormat {
                candidates: matches
                    .confident
                    .iter()
                    .map(|a| a.format_id().to_string())
                    .collect(),
            });
        }
    };

    let format_id = adapter.format_id().to_string();
    let batches = adapter.import(data).map_err(ArchiveImportError::Adapter)?;

    let mut accounts = Vec::with_capacity(batches.len());
    for batch in &batches {
        accounts.push(import_one_batch(batch, plugin_runtime, repo, captured_at)?);
    }

    Ok(ImportReport {
        format_id,
        accounts,
    })
}

/// 单个 batch：解析出它对应的本地账号，然后交给 [`crate::import::import_batch`]。
fn import_one_batch(
    batch: &ImportBatch,
    plugin_runtime: &PluginRuntime,
    repo: &Repository<'_>,
    captured_at: i64,
) -> Result<ImportedAccountReport, ArchiveImportError> {
    let account_id = resolve_account_id(batch, repo, captured_at)?;

    // 限速策略在导入路径上没有实际作用——`import_batch` 一次网络请求都不发，
    // 只是 `AuthkeyApiPipeline::new` 的必填参数。给 `default()` 而不是
    // `zero_delay_for_tests()`：后者是测试专用入口，在生产代码里出现会让人
    // 误以为这条路径被特殊对待过。
    let pipeline =
        AuthkeyApiPipeline::new(&batch.game_id, plugin_runtime, RateLimitPolicy::default())
            .map_err(|err| ArchiveImportError::Pipeline {
                game_id: batch.game_id.clone(),
                detail: err.to_string(),
            })?;

    let summary = import::import_batch(batch, &pipeline, repo, account_id, captured_at)?;

    Ok(ImportedAccountReport {
        game_id: batch.game_id.clone(),
        uid: batch.account.uid.clone(),
        account_id,
        records_seen: summary.records_seen,
        records_inserted: summary.records_inserted,
        records_skipped: summary.records_skipped,
    })
}

/// 按插件 manifest 声明的保留期换算出建账号时应写入的 `retention_days`。
///
/// manifest 没有声明 `retention`（`RetentionPolicy` 是可选字段，鸣潮就是
/// 真实的"不声明"案例）时返回 `None`——不默认任何天数，理由见
/// `gs_analysis::retention_policy_for` 与 `gs_host::retention` 模块文档。
fn retention_days_for_new_account(plugin_id: &str) -> Option<i64> {
    gs_analysis::retention_policy_for(plugin_id).map(|policy| i64::from(policy.conservative_days))
}

/// 把存档里的账号标识解析成本地 `account.id`，必要时新建。
///
/// 分两条路，取决于存档**有没有声明区服**：
/// - 声明了：直接走 `(plugin_id, game_uid, region)` 三元组，与采集路径一致。
/// - 没声明（UIGF v4 永远走这条）：按 `(plugin_id, game_uid)` 找。恰好一个
///   就复用它——**这是这条路存在的全部意义**，不复用的话同一个玩家会因为
///   "UIGF 不带区服"而多出一个空区服的影子账号，记录一分为二。一个都没有
///   就新建（区服落空串，表示"存档未携带"）。多于一个直接报错，见
///   [`ArchiveImportError::AmbiguousAccount`]。
fn resolve_account_id(
    batch: &ImportBatch,
    repo: &Repository<'_>,
    captured_at: i64,
) -> Result<i64, ArchiveImportError> {
    let plugin_id = batch.game_id.as_str();
    let uid = batch.account.uid.as_str();

    if let Some(region) = batch.account.region.as_deref() {
        if let Some(existing) = repo.find_account_by_identity(plugin_id, uid, region)? {
            return Ok(existing.id);
        }
        return Ok(repo.create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: uid.to_string(),
            region: region.to_string(),
            display_name: None,
            retention_days: retention_days_for_new_account(plugin_id),
            created_at: captured_at,
        })?);
    }

    let existing = repo.find_accounts_by_plugin_and_uid(plugin_id, uid)?;
    match existing.len() {
        1 => Ok(existing[0].id),
        0 => Ok(repo.create_account(&NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: uid.to_string(),
            // 空串表示"存档未携带区服信息"，不是某个真实区服的名字。
            // 日后这个账号真的走一次采集拿到了真实区服，需要的是把这条记录
            // 的 region 补上，而不是再建一个新账号——那属于账号管理的职责，
            // 本函数不越权去改已有账号的身份字段。
            region: String::new(),
            display_name: None,
            retention_days: retention_days_for_new_account(plugin_id),
            created_at: captured_at,
        })?),
        _ => Err(ArchiveImportError::AmbiguousAccount {
            game_id: plugin_id.to_string(),
            uid: uid.to_string(),
            existing_regions: existing.into_iter().map(|a| a.region).collect(),
        }),
    }
}
