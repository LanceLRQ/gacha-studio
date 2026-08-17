//! IPC 窄口命令。
//!
//! # 这一层做什么、不做什么
//!
//! **只做三件事**：从托管状态里取出 `HostRuntime`、把参数夹到合法范围、
//! 把 `gs-host` 的结构化错误转成前端能显示的字符串。业务逻辑一行都不写在
//! 这里——那些在 `gs_host::archive` / `gs_host::import` 里，可以脱离 Tauri
//! 直接测试。这一层唯一无法脱离 Tauri 测试的部分（文件对话框、托管状态）
//! 因此被压到最薄。
//!
//! # 安全边界（HC-2）
//!
//! Tauri 2 里**应用自定义命令不走 capability**——官方文档原文：「By default,
//! all commands registered in your app using the `tauri::Builder::invoke_handler`
//! function are allowed to be used by all the windows and webviews of the app」。
//! 要限制得用 `AppManifest::commands`，那是另一套机制，不是往 capabilities
//! 里加 permission 标识符。
//!
//! 后果很直接：**下面每个命令都自动对 webview 全开，没有任何机械门会拦**。
//! 安全负担 100% 落在命令签名本身够不够窄，以及
//! `docs/_internal/audit/AUDIT-2026-08-11-HC2能力窄口审计.md` 的人工审计。
//!
//! 具体到文件选择：`tauri-plugin-dialog` 已注册，但 `capabilities/default.json`
//! **没有授予它任何权限**，因此前端调不到它的 JS API；对话框只在下面的
//! Rust 命令内部弹出。这样用户选中的路径**从不越过 IPC 边界**，前端既拿不到
//! 路径、也无法指定路径——`import_archive_via_picker` 是无参数的。
//! 反面教材是 `import_archive(path: String)`：那就是 `readFile(anyPath)`
//! 换了个名字，见 `milestones/00-实施总览.md` §十一。

use std::sync::Mutex;

use gs_host::HostRuntime;
use gs_host::archive::import_archive_bytes;
use gs_host::views::{AccountView, ImportReport, RecordPage};
use gs_plugin_runtime::PluginRuntime;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// 单页记录数的硬上限。
///
/// 夹在这里而不是信任前端传来的值：这个参数直接变成 SQL 的 `LIMIT`，
/// 前端（或任何能在 webview 里跑 JS 的人）传一个巨大的值，就等于让宿主把
/// 整张表序列化成 JSON 塞过 IPC。星铁真实存档实测 5372 条，一次全量传输
/// 既慢又没有任何界面会真的一次渲染那么多行。
const MAX_PAGE_SIZE: i64 = 200;
const DEFAULT_PAGE_SIZE: i64 = 50;

/// 托管状态的类型别名。`Mutex` 的理由见 `lib.rs` 里 `app.manage` 那段注释。
type RuntimeState<'a> = State<'a, Mutex<HostRuntime>>;

/// 把任意实现了 `Display` 的错误转成前端消息。
///
/// 前端拿到的是**已经本地化过的完整中文说明**——`gs-host` 那边的错误类型
/// 每一个变体都自带"发生了什么 + 怎么办"的文案（如同秒序位漂移那条会直接
/// 给出两条补救路径）。这里不再包一层"操作失败："之类的前缀，那只会把
/// 真正有用的信息往后推。
fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// 骨架阶段的探针命令：验证宿主运行时能独立完成初始化。
///
/// **最坏情况能做什么**：拿到一个布尔值。不接受参数、不返回任何路径 /
/// 凭据 / 配置内容，用内存库而非应用真实的库，不触碰磁盘。
#[tauri::command]
pub fn host_runtime_ready() -> bool {
    HostRuntime::bootstrap_in_memory().is_ok()
}

/// 列出本地全部账号。
///
/// **最坏情况能做什么**：读出本地库里的账号列表，含游戏 UID。UID 本就是
/// 用户自己的数据、不出网；这条命令也不接受任何参数，没有注入面。
#[tauri::command]
pub fn list_accounts(state: RuntimeState<'_>) -> Result<Vec<AccountView>, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    let accounts = repo.list_accounts().map_err(to_message)?;

    accounts
        .into_iter()
        .map(|account| {
            let record_count = repo.count_records(account.id, None).map_err(to_message)?;
            Ok(AccountView {
                id: account.id,
                plugin_id: account.plugin_id,
                game_uid: account.game_uid,
                region: account.region,
                display_name: account.display_name,
                last_collected_at: account.last_collected_at,
                earliest_record_at: account.earliest_record_at,
                record_count,
            })
        })
        .collect()
}

/// 分页读取某个账号的抽卡记录。
///
/// **最坏情况能做什么**：分页读本地记录。`page_size` 被夹到
/// [`MAX_PAGE_SIZE`]，无法用一次调用把整张表拖出来；`account_id` 是个整数，
/// 猜到别的 id 也只能读到同一个本地库里本来就属于这个用户的数据。
#[tauri::command]
pub fn list_records(
    state: RuntimeState<'_>,
    account_id: i64,
    banner_key: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<RecordPage, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();

    // 夹取而不是报错：页码/页长是界面参数，越界时给一个合理结果比让用户
    // 看见一条"参数不合法"更有用；真正需要 fail-closed 的是数据正确性，
    // 不是分页器。
    let page_size = page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let page = page.unwrap_or(0).max(0);

    let banner_key = banner_key.as_deref();
    let total = repo
        .count_records(account_id, banner_key)
        .map_err(to_message)?;
    let records = repo
        .find_records_paged(account_id, banner_key, page_size, page * page_size)
        .map_err(to_message)?;

    Ok(RecordPage {
        total,
        page,
        page_size,
        records,
    })
}

/// 弹出文件选择框，把用户选中的存档导入本地库。
///
/// **无参数**——调用方无法指定路径，见本模块头部的安全边界说明。
///
/// 返回 `None` 表示用户取消了选择，不是错误。前端据此区分"取消"与"失败"：
/// 用 `Err` 表达取消会让界面弹一个红色错误提示，而用户只是按了取消。
///
/// **最坏情况能做什么**：让用户看见一个文件选择框。用户不选就什么都不发生。
/// 无法指定路径、无法读取用户没有主动选中的文件、也无法把读到的内容原样
/// 回传给前端——返回的只有导入条数统计。
#[tauri::command]
pub async fn import_archive_via_picker(
    app: tauri::AppHandle,
    state: RuntimeState<'_>,
) -> Result<Option<ImportReport>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("抽卡存档", &["json"])
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(None);
    };

    // `FilePath` 在桌面端总能转成真实路径；转不出来时如实报错，不静默当成
    // 取消——那会让用户以为自己点了取消。
    let path = picked
        .into_path()
        .map_err(|err| format!("无法解析选中的文件路径：{err}"))?;
    let bytes = std::fs::read(&path).map_err(|err| {
        // 路径不进错误信息：这个字符串会被送到前端，而它正是我们不让前端
        // 知道的东西。文件名对用户排查也没有帮助——是他自己刚选的。
        format!("读取选中的文件失败：{err}")
    })?;

    // 每次导入现建一个 QuickJS 运行时。导入是用户手动触发的低频操作，
    // 建一次的开销无关紧要；而把 `PluginRuntime` 常驻进托管状态会带来
    // `Send`/`Sync` 约束上的连锁问题，为一个低频路径不值得。
    let plugin_runtime = PluginRuntime::new().map_err(to_message)?;

    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    let report =
        import_archive_bytes(&bytes, &plugin_runtime, &repo, now_millis()).map_err(to_message)?;
    Ok(Some(report))
}

/// `Mutex` 被毒化时的消息。毒化只可能发生在某个持有锁的命令 panic 之后，
/// 那时数据库连接的状态不可知，继续用它比报错更危险。
const POISONED: &str = "宿主运行时状态已损坏（此前有命令执行中崩溃），请重启应用";

/// 当前 UTC 毫秒时间戳，作为记录的 `captured_at`。
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        // 系统时钟早于 1970 时退回 0：`captured_at` 只是"我们什么时候拿到
        // 这条记录"的溯源信息，不参与去重也不参与保底计算，用一个明显异常
        // 的值继续跑，比让整次导入失败更合理。
        .unwrap_or(0)
}
