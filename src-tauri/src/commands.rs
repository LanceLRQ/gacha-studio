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

use base64::Engine;
use gs_host::HostRuntime;
use gs_host::archive::import_archive_bytes;
use gs_host::icon_cache::ReqwestIconFetcher;
use gs_host::metadata_backfill::ReqwestDictionaryFetcher;
use gs_host::settings::ThemePreference;
use gs_host::views::{
    AccountAnalysisView, AccountView, GameView, ImportReport, MetadataBackfillReport,
    MonthlyActivityView, OverviewStatsView, RecordPage,
};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::RecordFilter;
use tauri::{Manager, State};
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
///
/// 调用前会先补齐历史账号里为空的 `retention_days`
/// （[`gs_host::retention::backfill_missing_retention_days`]）——账号列表是
/// 唯一一个"每次打开应用都会被调用、且遍历全部账号"的入口，补写的理由见
/// 该函数的文档。补写只会把 `NULL` 列改成插件 manifest 声明的保守天数，
/// 不读取、不返回任何路径/凭据类内容，不扩大本命令的"最坏情况"范围。
#[tauri::command]
pub fn list_accounts(state: RuntimeState<'_>) -> Result<Vec<AccountView>, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();

    gs_host::retention::backfill_missing_retention_days(&repo).map_err(to_message)?;

    let accounts = repo.list_accounts().map_err(to_message)?;
    let now = now_millis();

    accounts
        .into_iter()
        .map(|account| {
            let record_count = repo
                .count_records(account.id, &RecordFilter::default())
                .map_err(to_message)?;
            let retention_risk = gs_host::retention::evaluate_account_retention_risk(&account, now);
            Ok(AccountView {
                id: account.id,
                plugin_id: account.plugin_id,
                game_uid: account.game_uid,
                region: account.region,
                display_name: account.display_name,
                last_collected_at: account.last_collected_at,
                earliest_record_at: account.earliest_record_at,
                record_count,
                retention_risk,
            })
        })
        .collect()
}

/// 分页读取某个账号的抽卡记录，支持按卡池 / 稀有度集合 / 时间区间 / 物品名
/// 子串筛选。
///
/// 筛选下沉到 SQL（[`gs_storage::RecordFilter`]），不是"全量拉取后前端本地
/// 筛"——星铁真实存档实测 5372 条、单页上限 200，全量要 27 个来回，且违反
/// [`MAX_PAGE_SIZE`] 存在的理由（见下方"最坏情况"）。
///
/// **最坏情况能做什么**：分页读本地记录。`page_size` 被夹到
/// [`MAX_PAGE_SIZE`]，无法用一次调用把整张表拖出来；`account_id` 是个整数，
/// 猜到别的 id 也只能读到同一个本地库里本来就属于这个用户的数据。新增的
/// 四个筛选参数（`rarities`/`occurred_from`/`occurred_to`/`item_search`）
/// 同样只是缩小结果集的过滤条件，不能扩大可读范围——不传等价于不筛选，
/// 不会比原有行为读到更多数据；`item_search` 走参数化 `LIKE` 查询（见
/// `gs_storage::repository` 里 `escape_like_pattern` 的转义处理），不是拼接
/// SQL 字符串，没有注入面。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_records(
    state: RuntimeState<'_>,
    account_id: i64,
    banner_key: Option<String>,
    rarities: Option<Vec<String>>,
    occurred_from: Option<i64>,
    occurred_to: Option<i64>,
    item_search: Option<String>,
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

    let filter = RecordFilter {
        banner_key: banner_key.as_deref(),
        rarities: rarities.as_deref(),
        occurred_from,
        occurred_to,
        item_search: item_search.as_deref(),
    };

    // count_records 与 find_records_paged 必须传同一个 filter——这不是
    // "顺手保持一致"，是这两个方法能配合出正确分页器的唯一前提，见
    // gs_storage::Repository::count_records 的文档。
    let total = repo
        .count_records(account_id, &filter)
        .map_err(to_message)?;
    let records = repo
        .find_records_paged(account_id, &filter, page_size, page * page_size)
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

/// 弹出保存对话框，把本地库的抽卡记录导出成 CSV 或 UIGF v4 文件。
///
/// **保存对话框在 Rust 侧弹**，命令本身不接受任何路径参数——与
/// `import_archive_via_picker` 同一条安全边界（见本模块头部说明）：调用方
/// 无法指定写到哪个路径，用户选中的路径全程留在 Rust 侧，不回传前端、也不
/// 进错误信息。
///
/// `format` 是封闭枚举（[`ExportFormat`]），不是字符串——IPC 反序列化阶段
/// 就会拒绝任何不在 `csv`/`uigfV4` 之内的取值。`account_id` 是 `Option<i64>`
/// 本地账号主键，`None` 表示导出全部账号——与其它按账号读取的命令
/// （`list_records`/`account_analysis`）同一等级：裸整数，没有越权维度可言，
/// 本地库里的账号本来就全部属于同一个用户。
///
/// 返回 `None` 表示用户取消了保存，不是错误——与 `import_archive_via_picker`
/// 同一条区分"取消"与"失败"的纪律，前端不应据此弹红色提示。
///
/// **最坏情况能做什么**：让用户看见一个保存对话框，写出的字节只包含本地库
/// 已有的、本来就属于这个用户的数据（CSV 全量各字段；UIGF 只含 hk4e/hkrpg/
/// nap 三段允许出现的字段）——不包含 `authkey`、`raw_payload` 原文、抽卡
/// 链接签名，这几类凭据类信息从未进入 `GachaRecord` 结构，无从导出（数据
/// 模型层面的保证，不是这里额外做了脱敏）。用户不选保存位置就什么都不发生。
#[tauri::command]
pub async fn export_records_via_picker(
    app: tauri::AppHandle,
    state: RuntimeState<'_>,
    format: gs_host::export::ExportFormat,
    account_id: Option<i64>,
) -> Result<Option<gs_host::export::ExportReport>, String> {
    let (default_file_name, filter_name, extension) = match format {
        gs_host::export::ExportFormat::Csv => ("gacha-studio-export.csv", "CSV", "csv"),
        gs_host::export::ExportFormat::UigfV4 => {
            ("gacha-studio-export-uigf-v4.json", "UIGF v4 JSON", "json")
        }
    };

    let picked = app
        .dialog()
        .file()
        .add_filter(filter_name, &[extension])
        .set_file_name(default_file_name)
        .blocking_save_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| format!("无法解析选中的保存路径：{err}"))?;

    let (bytes, report) = {
        let runtime = state.lock().map_err(|_| POISONED.to_string())?;
        let repo = runtime.storage().repository();
        gs_host::export::export_records(&repo, format, account_id).map_err(to_message)?
    };

    std::fs::write(&path, &bytes).map_err(|err| format!("写入导出文件失败：{err}"))?;
    Ok(Some(report))
}

/// 列出全部已注册插件（游戏）的展示元数据：展示名、稀有度档位、卡池展示名。
///
/// 前端拿不到插件 manifest 本身（打包进 QuickJS 用的 bundle，`web/`
/// 的 tsconfig 不 include 它），游戏名/稀有度档位/卡池展示名因此必须从
/// Rust 侧透出，见 [`gs_host::views::GameView`] 的文档。
///
/// **最坏情况能做什么**：读出编译期内嵌进二进制的静态 manifest 数据（不是
/// 用户数据，不触碰磁盘/网络）。无参数，没有注入面。
#[tauri::command]
pub fn list_games() -> Vec<GameView> {
    gs_host::catalog::list_games()
}

/// 单个账号的保底进度 + 稀有度分布，供游戏详情页与记录明细表"保底内第几抽"
/// 列使用。
///
/// **最坏情况能做什么**：读出这一个账号名下的记录并做统计计算，不接受
/// 任何路径/凭据类参数——`account_id` 是本地库里的整数主键，猜到别的 id
/// 也只能读到同一个本地库里本来就属于这个用户的另一个账号的统计结果。
#[tauri::command]
pub fn account_analysis(
    state: RuntimeState<'_>,
    account_id: i64,
) -> Result<AccountAnalysisView, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    gs_host::analysis::account_analysis(&repo, account_id).map_err(to_message)
}

/// 按账号统计月度抽卡活动（自然月 → 抽数 + 顶级保底命中数），供游戏详情页
/// "抽卡时间线（按月）"使用。
///
/// 聚合下沉到 SQL（[`gs_storage::Repository::monthly_activity`]），不是
/// "拉全量记录再在前端/Rust 里手动分组"——星铁真实存档实测 5372 条，
/// `list_records` 是带 200 上限的分页窄口，为画一张图表拉全量记录会违反
/// 那道窄口存在的理由，见本文件顶部注释。
///
/// **最坏情况能做什么**：与 [`account_analysis`] 同一等级——`account_id`
/// 是本地库里的整数主键，不是路径，猜到别的 id 也只能读到同一个本地库里
/// 本来就属于这个用户的另一个账号的月度统计，返回值只有"月份 + 两个计数"，
/// 不含任何单条记录的明细。
#[tauri::command]
pub fn monthly_activity(
    state: RuntimeState<'_>,
    account_id: i64,
) -> Result<Vec<MonthlyActivityView>, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    gs_host::analysis::monthly_activity(&repo, account_id).map_err(to_message)
}

/// 跨账号概览统计，供总览页"跨游戏数据"这一块使用。
///
/// **最坏情况能做什么**：读出本地库里全部账号的记录并做统计计算。无参数，
/// 没有注入面；返回的是聚合数字与按插件分组的稀有度分布，不含任何单条
/// 记录的明细。
#[tauri::command]
pub fn overview_stats(state: RuntimeState<'_>) -> Result<OverviewStatsView, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    gs_host::analysis::overview_stats(&repo).map_err(to_message)
}

/// 读取宿主持久化的主题偏好。
///
/// **最坏情况能做什么**：读出宿主库 `app_setting` 表里一个封闭三态枚举值
/// （`light`/`dark`/`system`）或 `None`（从未设置过）。无参数，没有注入面。
#[tauri::command]
pub fn get_theme_preference(state: RuntimeState<'_>) -> Result<Option<ThemePreference>, String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    gs_host::settings::get_theme_preference(&repo).map_err(to_message)
}

/// 写入主题偏好。
///
/// **HC-2**：参数 `preference` 是一个封闭三态枚举（[`ThemePreference`]），
/// 不是字符串——Tauri 的 IPC 参数在反序列化阶段就会拒绝任何不在
/// `light`/`dark`/`system` 三者之内的取值，不存在"前端传一个乱七八糟的字符
/// 串、宿主原样落库"的路径。这与 `set_setting(anyKey, anyValue)` 那种开放
/// 接口是两回事：那种接口的"键"和"值"都是任意字符串，等价于把宿主数据库
/// 当成一个可以从前端写任意键值对的通用 KV 后门；本命令的"键"（写哪个设置
/// 项）由函数名本身固定死，"值"被类型系统收窄到三选一，`gs_storage::SettingKey`
/// 这个受控枚举从未越过 IPC 边界暴露给前端。
///
/// **最坏情况能做什么**：把宿主库 `app_setting` 表里那一行改成三个值之一。
#[tauri::command]
pub fn set_theme_preference(
    state: RuntimeState<'_>,
    preference: ThemePreference,
) -> Result<(), String> {
    let runtime = state.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();
    gs_host::settings::set_theme_preference(&repo, preference).map_err(to_message)
}

/// 按 `game_id` 下载（或读取本地缓存的）游戏图标，返回可直接塞进
/// `<img src>` 的 base64 data URL。
///
/// **HC-2**：参数只有 `game_id`，不接受 URL。真正要下载的地址由宿主自己
/// 按 `game_id` 去已注册插件的 manifest 里查
/// （[`gs_host::catalog::icon_url_for`]），前端永远看不到、也无法指定这个
/// URL——`ensure_game_icon(url: String)` 那种形状等价于把 `fetch(anyUrl)`
/// 交给前端，是标准 SSRF 原语（`CLAUDE.local.md`"窄口参数只能是
/// gameId/paradigmId 这类标识符，绝不能是裸路径"一节）。
///
/// 找不到该 `game_id`、该插件没声明 `iconUrl`、下载失败、或内容校验不
/// 通过，统一返回 `None`——图标缺席是设计好的正常路径（界面走"游戏名首字 +
/// 游戏色圆底" fallback，见 `web/src/lib/game-icon.ts`），不冒泡成错误打断
/// 渲染；只有"应用数据目录建不出来/图标缓存目录写不进去"这类真正的本地
/// 故障才返回 `Err`。
///
/// **最坏情况能做什么**：让宿主向"某个已注册插件在编译期声明好的固定
/// https 地址"发起一次 GET 请求，下载不超过 2MB 的字节，校验 magic bytes +
/// content-type 后写进应用数据目录下的图标缓存子目录。`game_id` 本身只是
/// 一个字符串标识符——不在已注册插件集合里的 id 一律返回 `None`；不携带
/// 任何 cookie/凭据/referer。
///
/// 本命令必须是 `async fn`：同步命令在 Tauri 2 里默认走
/// `ExecutionContext::Blocking`，`tauri-macros` 生成的 `body_blocking` 把
/// 函数体**内联执行**在调用方线程上——对文件对话框这类命令没问题，但网络
/// 请求内联执行会直接卡住界面，等同于把 UI 冻结到下载完成为止，不可接受。
///
/// 但 `async fn` 本身不够——**这里曾经有一个必现的运行时 panic**：`async fn`
/// 会被 Tauri 派发到它自己的 Tokio 运行时上执行，而
/// [`gs_host::icon_cache::ReqwestIconFetcher`] 内部用的
/// `reqwest::blocking::Client` 会在**构造/销毁时自建一个 Tokio 运行时**；
/// 在已经身处一个 Tokio 运行时（Tauri 派发 async 命令的那个）的线程上再
/// 构造并丢弃这样一个客户端，会触发
/// `Cannot drop a runtime in a context where blocking is not allowed`
/// panic——**每一次调用都会炸**，而前端 `ipc-client.ts` 对这个命令的调用
/// 点用 `.catch(() => null)` 把异常吞掉当成"这个游戏没有图标"，于是表现
/// 为"图标永远不出现，界面上只看到静默的兜底头像"，没有任何报错浮出来。
///
/// 修复：把真正会触碰 `reqwest::blocking` 的部分（[`download_icon_data_url`]）
/// 整体丢进 [`tauri::async_runtime::spawn_blocking`]——它调度到 Tokio
/// 专门给"允许阻塞"的操作准备的独立线程池，不是当前这个不允许阻塞的
/// async 工作线程，在那里构造/销毁 `reqwest::blocking::Client` 不会撞上
/// 这条限制。`cache_root` 必须在进入 `spawn_blocking` 之前、在 async 上下文
/// 里用 `&AppHandle` 解析好，再把解析出来的 `PathBuf`（拥有所有权的值）
/// move 进闭包——`AppHandle` 的路径解析依赖 Tauri 内部状态，不能被直接
/// 带进这个独立线程池执行。
///
/// 这不是"与 [`import_archive_via_picker`] 同一惯例"（早前的注释这么写过，
/// 是错的，已经改正）——那条命令做的是文件对话框和 `std::fs::read`，从不
/// 创建嵌套的 Tokio 运行时，所以从来不会撞上这个坑；网络客户端是完全
/// 不同的情况，两者不能类比。
///
/// 回归测试 `ensure_game_icon_survives_download_failure_inside_tauri_async_runtime`
/// （本文件测试模块）复现的就是这个 panic：在 `tauri::async_runtime::block_on`
/// 驱动的异步上下文里调用 [`download_icon_data_url`]，若有人把
/// `spawn_blocking` 那层去掉，这条测试会直接 panic 失败，不会静默变成
/// "碰巧还是绿的"。
#[tauri::command]
pub async fn ensure_game_icon(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Option<String>, String> {
    let Some(icon_url) = gs_host::catalog::icon_url_for(&game_id) else {
        return Ok(None);
    };

    let cache_root = resolve_icon_cache_root(&app)?;
    download_icon_data_url(cache_root, game_id, icon_url).await
}

/// `ensure_game_icon` 的核心逻辑，拆成独立函数是为了不依赖真实的
/// `AppHandle` 就能单测——`cache_root`/`game_id`/`icon_url` 全部是拥有
/// 所有权的值，测试可以直接构造，不需要启动一个真实的 Tauri App。
///
/// 真正做网络请求与落盘的部分必须经 `spawn_blocking` 调度，理由见
/// [`ensure_game_icon`] 文档——这不是可选的性能优化，是避免一个必现 panic
/// 的正确性要求。
async fn download_icon_data_url(
    cache_root: std::path::PathBuf,
    game_id: String,
    icon_url: String,
) -> Result<Option<String>, String> {
    let icon = tauri::async_runtime::spawn_blocking(move || {
        gs_host::icon_cache::ensure_icon(&cache_root, &game_id, &icon_url, &ReqwestIconFetcher)
    })
    .await
    .map_err(to_message)?
    .map_err(to_message)?;

    Ok(icon.map(|icon| {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&icon.bytes);
        format!("data:{};base64,{encoded}", icon.content_type)
    }))
}

/// 图标下载缓存的根目录：应用数据目录本身（[`gs_host::icon_cache::ensure_icon`]
/// 自己会在下面建 `icons/` 子目录）——与 `lib.rs::resolve_db_path` 解析的
/// 是同一个目录，数据库文件与图标缓存平级存放，不需要为图标缓存单独找
/// 一个位置。
fn resolve_icon_cache_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法解析应用数据目录: {err}"))?;
    std::fs::create_dir_all(&app_data_dir).map_err(|err| format!("创建应用数据目录失败: {err}"))?;
    Ok(app_data_dir)
}

/// `Mutex` 被毒化时的消息。毒化只可能发生在某个持有锁的命令 panic 之后，
/// 那时数据库连接的状态不可知，继续用它比报错更危险。
const POISONED: &str = "宿主运行时状态已损坏（此前有命令执行中崩溃），请重启应用";

/// 对已注册插件里声明了 `metadata`（`kind: "online"`）的记录做一次回填：
/// 反查 `itemIdSource: "displayName"` 场景下 `meta_state = 'pending'` 的
/// 记录，把 `extractRecord` 填进 `itemId` 的本地化物品名换成真正的物品
/// 标识，见 `gs_host::metadata_backfill` 模块文档。
///
/// **触发点为什么是独立命令，不挂在 `import_archive_via_picker` 之后做
/// best-effort**：字典下载是网络请求，把它塞进导入流程会让"导入"这个用户
/// 已经在等待的操作背负额外的、不可预测的网络延迟与失败模式；导入失败与
/// 回填失败的语义也不同（前者是"我的数据没进去"，后者是"部分记录暂时没有
/// 名字"，用户对两者的容忍度不一样）。做成独立、用户可见的命令后，
/// `MetadataBackfillReport` 能把"回填了多少、还剩多少"直接摆给用户——这正是
/// "不得静默吞掉失败"这条要求最直接的落点，比在导入日志里悄悄夹一行网络
/// 警告更清楚。
///
/// **失败处理**：单个插件、单个语言的字典下载/解析失败不会让整个命令报错
/// ——那个语言的记录计入 `skippedNoDictionary`，其余插件/语言继续处理，
/// 最终把完整报告返回给前端。只有"应用数据目录建不出来"这类真正的本地
/// 故障才会让命令整体返回 `Err`。
///
/// **最坏情况能做什么**：让宿主向"已注册插件在编译期声明好的固定 https
/// 地址模板 + 一个从封闭短码表里查出来的语言短码"发起若干次 GET 请求，
/// 下载不超过 8MB 的 JSON，写进应用数据目录下的元数据缓存子目录；对本地
/// 库的写入范围严格限定在"把已经存在、且仍处于 `pending` 状态的记录的
/// `item_id`/`meta_state` 两列更新，以及写入/覆盖 `item_catalog` 的对应行"
/// ——不接受任何路径/URL/凭据类参数，无参数，没有注入面。
#[tauri::command]
pub async fn backfill_pending_metadata(
    app: tauri::AppHandle,
    state: RuntimeState<'_>,
) -> Result<Vec<MetadataBackfillReport>, String> {
    let cache_root = resolve_metadata_cache_root(&app)?;
    run_metadata_backfill(&cache_root, state.inner()).await
}

/// [`backfill_pending_metadata`] 的核心逻辑，拆成独立函数是为了不依赖真实
/// 的 `AppHandle` 就能单测——`cache_root` 是拥有所有权的值，`host` 只要求
/// `&Mutex<HostRuntime>`，测试可以直接用 [`HostRuntime::bootstrap_in_memory`]
/// 构造，不需要启动一个真实的 Tauri App。
///
/// ⚠️ **严格分两个阶段，中间不得交叉**——这是本函数编排顺序唯一的硬约束：
///
/// 1. **Phase 0（同步）+ Phase 1（`await`，网络）**：先锁一次 `host` 读出
///    全部待处理插件的 pending 记录与需要下载的 `(plugin_id, lang, url)`，
///    释放锁；再把全部下载请求整体丢进一次
///    `tauri::async_runtime::spawn_blocking`，只搬运 `String`/`Vec<u8>`
///    这类 `Send + 'static` 的简单值。
/// 2. **Phase 2（纯同步，本函数体内再无任何 `.await`）**：构造
///    `PluginRuntime`、解析响应、落库。
///
/// 原因不是风格偏好，是编译约束：Tauri 要求 `#[tauri::command]` 的
/// `async fn` 返回的 `Future` 整体 `Send`（`tauri::ipc::command::
/// ResultFutureTag::future` 的签名要求），而 `PluginRuntime`
/// **不是** `Send`（QuickJS 的值带生命周期绑定，见 `gs-plugin-runtime`
/// 模块文档）。Rust 的 `async fn` 状态机只在"某个值跨越了一个 `.await`
/// 悬挂点"时才会把它编译进需要满足 `Send` 的状态里——因此 `plugin_runtime`
/// 只要不在任何 `.await` 之后还被用到，编译器就不会要求它 `Send`。
/// 最初的实现按"每个语言各自 取字节 → 解析 → 落库"的顺序交叉调用，
/// `plugin_runtime` 活过了取字节那个 `await`，`cargo build` 直接报
/// `future cannot be sent between threads safely`——这不是能靠调整代码
/// 风格绕开的警告，是没有约束就会必然出现的编译错误，因此把两个阶段的
/// 顺序钉在这里，不要图交叉调用"看起来更顺"而破坏它。
async fn run_metadata_backfill(
    cache_root: &std::path::Path,
    host: &Mutex<HostRuntime>,
) -> Result<Vec<MetadataBackfillReport>, String> {
    struct PluginWork {
        plugin_id: &'static str,
        pending_records: Vec<gs_core::GachaRecord>,
        skipped_no_lang: u32,
        /// 该插件涉及的每个语言 + 对应的请求 URL（`None` 表示这个语言在
        /// UIGF 短码表里查不到，不发起网络请求，直接计入
        /// `skippedNoDictionary`）。
        lang_urls: Vec<(String, Option<String>)>,
    }

    // ---- Phase 0（同步）：读出全部待处理插件的 pending 记录 + 需要的请求 URL ----
    let mut work_items: Vec<PluginWork> = Vec::new();
    {
        let runtime = host.lock().map_err(|_| POISONED.to_string())?;
        let repo = runtime.storage().repository();
        for plugin_id in gs_analysis::registered_plugin_ids() {
            let Some(request_template) = gs_analysis::online_metadata_request_for(plugin_id) else {
                continue;
            };
            let pending_records = repo
                .find_pending_records_by_plugin(plugin_id)
                .map_err(to_message)?;
            if pending_records.is_empty() {
                continue;
            }
            let skipped_no_lang =
                gs_host::metadata_backfill::count_records_without_lang(&pending_records);
            let lang_urls = gs_host::metadata_backfill::distinct_langs(&pending_records)
                .into_iter()
                .map(|lang| {
                    let url = gs_host::metadata_backfill::build_dictionary_request_url(
                        &request_template,
                        &lang,
                    );
                    (lang, url)
                })
                .collect();
            work_items.push(PluginWork {
                plugin_id,
                pending_records,
                skipped_no_lang,
                lang_urls,
            });
        }
        // `runtime`/`repo` 的借用在这个块结束时释放——绝不允许带着它们跨过
        // 下面 Phase 1 的 `.await`。
    }

    // ---- Phase 1（await，网络）：一次性拿到全部所需字典的原始字节 ----
    // 拼平成 (work_item 下标, lang, url) 三元组交给 spawn_blocking——只搬运
    // Send + 'static 的简单值，不携带 PluginRuntime/Repository。
    let fetch_plan: Vec<(usize, String, Option<String>)> = work_items
        .iter()
        .enumerate()
        .flat_map(|(idx, work)| {
            work.lang_urls
                .iter()
                .map(move |(lang, url)| (idx, lang.clone(), url.clone()))
        })
        .collect();
    let fetched: Vec<(usize, String, Option<Vec<u8>>)> =
        fetch_dictionaries_in_blocking_pool(fetch_plan).await?;

    // ---- Phase 2（纯同步，本函数体内此后不再有任何 .await）----
    let plugin_runtime = PluginRuntime::new().map_err(to_message)?;
    let data_ver = now_millis();
    let runtime = host.lock().map_err(|_| POISONED.to_string())?;
    let repo = runtime.storage().repository();

    let mut reports = Vec::with_capacity(work_items.len());
    for (idx, work) in work_items.iter().enumerate() {
        let mut per_lang_outcomes = Vec::with_capacity(work.lang_urls.len());
        for (lang, _) in &work.lang_urls {
            let fetched_bytes = fetched
                .iter()
                .find(|(fetched_idx, fetched_lang, _)| *fetched_idx == idx && fetched_lang == lang)
                .and_then(|(_, _, bytes)| bytes.clone());

            let dictionary = resolve_dictionary_from_bytes_or_cache(
                cache_root,
                work.plugin_id,
                lang,
                fetched_bytes,
                &plugin_runtime,
            );

            let outcome = match dictionary {
                Some(dictionary) => gs_host::metadata_backfill::apply_dictionary_to_records(
                    &repo,
                    work.plugin_id,
                    lang,
                    &dictionary,
                    &work.pending_records,
                    data_ver,
                )
                .map_err(to_message)?,
                None => {
                    let mut outcome = gs_host::metadata_backfill::BackfillOutcome::default();
                    gs_host::metadata_backfill::account_missing_dictionary(
                        &mut outcome,
                        lang,
                        &work.pending_records,
                    );
                    outcome
                }
            };
            per_lang_outcomes.push(outcome);
        }

        let total = gs_host::metadata_backfill::merge_outcomes(
            work.plugin_id,
            work.skipped_no_lang,
            &per_lang_outcomes,
        );
        reports.push(MetadataBackfillReport {
            plugin_id: total.plugin_id,
            resolved: i64::from(total.resolved),
            still_pending: i64::from(total.still_pending),
            skipped_no_lang: i64::from(total.skipped_no_lang),
            skipped_no_dictionary: i64::from(total.skipped_no_dictionary),
        });
    }

    Ok(reports)
}

/// Phase 2 的一步：给定"这个语言已经下载到的原始字节"（可能是 `None`——
/// 该语言在短码表里查不到，或网络请求失败），解析出字典；下载失败或解析
/// 失败都退回本地缓存；两者都没有则返回 `None`。纯同步函数，不含
/// `.await`，因此可以安全接受 `&PluginRuntime`。
fn resolve_dictionary_from_bytes_or_cache(
    cache_root: &std::path::Path,
    plugin_id: &str,
    lang: &str,
    fetched_bytes: Option<Vec<u8>>,
    plugin_runtime: &PluginRuntime,
) -> Option<std::collections::HashMap<String, String>> {
    if let Some(bytes) = fetched_bytes
        && let Some(dictionary) = gs_host::metadata_backfill::parse_dictionary_via_plugin(
            plugin_runtime,
            plugin_id,
            &bytes,
        )
    {
        // 缓存写入失败不应当让整次回填报错——缓存只是"下次故障时的兜底"，
        // 这一轮已经拿到了真实字典，写盘失败不影响本轮结果的正确性。
        let _ = gs_host::metadata_backfill::save_cached_dictionary(
            cache_root,
            plugin_id,
            lang,
            &dictionary,
        );
        return Some(dictionary);
    }
    gs_host::metadata_backfill::load_cached_dictionary(cache_root, plugin_id, lang)
}

/// Phase 1：批量取字节，`plan` 的每一项是 `(work_item 下标, lang, url)`——
/// `url` 为 `None`（该语言在 UIGF 短码表里查不到）时直接跳过，不发起请求。
///
/// 整批请求丢进**一次** `tauri::async_runtime::spawn_blocking`——理由与
/// [`download_icon_data_url`] 完全一致（`reqwest::blocking::Client` 在
/// Tauri 派发的 Tokio 运行时里构造/销毁会 panic），也是
/// [`gs_host::metadata_backfill`] 模块文档"为什么网络下载与解析响应分属
/// 两个不同的调用位置"一节说的"只有取字节这一步"。`plan` 与返回值只搬运
/// `String`/`Vec<u8>`/`usize` 这类 `Send + 'static` 的简单值，不携带
/// `PluginRuntime`/`Repository`。
///
/// 拆成独立函数是为了不依赖真实的 `AppHandle`/托管状态就能单测——回归测试
/// `backfill_pending_metadata_network_phase_survives_inside_tauri_async_runtime`
/// （本文件测试模块）复现的正是与图标下载同款的 panic 场景。
async fn fetch_dictionaries_in_blocking_pool(
    plan: Vec<(usize, String, Option<String>)>,
) -> Result<Vec<(usize, String, Option<Vec<u8>>)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plan.into_iter()
            .map(|(idx, lang, url)| {
                let bytes = url.and_then(|url| {
                    gs_host::metadata_backfill::fetch_dictionary_bytes(
                        &url,
                        &ReqwestDictionaryFetcher,
                        gs_host::metadata_backfill::DEFAULT_MAX_ATTEMPTS,
                    )
                });
                (idx, lang, bytes)
            })
            .collect()
    })
    .await
    .map_err(to_message)
}

/// 元数据字典缓存的根目录，与图标缓存共用同一个应用数据目录——
/// [`gs_host::metadata_backfill::save_cached_dictionary`] 自己会建
/// `metadata/` 子目录，与 [`resolve_icon_cache_root`] 建 `icons/` 子目录
/// 同一约定，不需要为回填缓存单独找一个位置。
fn resolve_metadata_cache_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    resolve_icon_cache_root(app)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归测试：复现并守住"图标一个都下载不出来"这个此前必现的 panic。
    ///
    /// # 为什么必须放在这里，而不是 `gs-host`
    ///
    /// panic 的触发条件不是"调用了 `reqwest::blocking`"本身，而是"在一个
    /// Tokio 运行时的执行上下文里"调用它——`gs-host` 至今不依赖任何异步
    /// 运行时（`icon_cache.rs` 的 19 个单测全部是同步的，从未在这个坑上
    /// 摔过跤，这正是这个 bug 能够存在了一整轮复核都没被发现的原因）。
    /// 要真实复现，测试本身必须运行在 Tauri 派发 async 命令所用的那同一个
    /// 运行时上——`tauri::async_runtime::block_on` 就是这个运行时的入口，
    /// 本 crate 已经依赖 `tauri`，不需要为了这一条测试额外引入 `tokio`
    /// dev-dependency（并且引入了也只是"很像"，不是"就是"那个运行时）。
    ///
    /// # 为什么用 `https://127.0.0.1:1/...` 而不是真实地址
    ///
    /// 这个 panic 发生在 `reqwest::blocking::Client` **构造/销毁**的时候，
    /// 与请求本身成功还是失败无关——1 号端口在绝大多数机器上都没有服务
    /// 监听，连接会立刻被拒绝（`ConnectionRefused`），不需要真实网络、不
    /// 依赖外部服务可用性，结果确定：`fetch` 必定返回 `Err`，
    /// `ensure_icon` 因此必定返回 `Ok(None)`。测试断言的正是这个"下载
    /// 失败但没有 panic"的结果，不是"下载成功"。
    #[test]
    fn ensure_game_icon_survives_download_failure_inside_tauri_async_runtime() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let cache_root = std::env::temp_dir().join(format!(
            "gacha-studio-icon-panic-regression-{}-{nanos}",
            std::process::id()
        ));

        // `download_icon_data_url` 是 async fn，必须在一个真实的 Tokio
        // 运行时上下文里被驱动到完成——`tauri::async_runtime::block_on`
        // 正是 Tauri 派发 `ensure_game_icon` 这个 async 命令时使用的那个
        // 运行时，用它驱动才是"在生产环境同一种执行上下文里跑一遍"，不是
        // 随便找一个 async 执行器凑数。
        let result = tauri::async_runtime::block_on(download_icon_data_url(
            cache_root.clone(),
            "genshin".to_string(),
            "https://127.0.0.1:1/unreachable.png".to_string(),
        ));

        assert_eq!(
            result,
            Ok(None),
            "下载失败应当得到 Ok(None)（图标缺席是正常路径），且这一整个过程\
             不应当 panic——旧实现会在这里因为在 async 上下文里构造/销毁\
             reqwest::blocking::Client 而必现 panic"
        );

        let _ = std::fs::remove_dir_all(&cache_root);
    }

    /// 回归测试：复现并守住与图标下载同款的"图标一个都下载不出来"式必现
    /// panic——`backfill_pending_metadata` 的网络阶段
    /// （[`fetch_dictionaries_in_blocking_pool`]）同样依赖
    /// `reqwest::blocking::Client`，同样必须经 `spawn_blocking` 调度。
    ///
    /// 用 `https://127.0.0.1:1/...` 而不是真实地址：理由与
    /// `ensure_game_icon_survives_download_failure_inside_tauri_async_runtime`
    /// 完全一致（1 号端口在绝大多数机器上都没有服务监听，连接立即被拒绝，
    /// 不需要真实网络、不依赖外部服务可用性）。
    #[test]
    fn backfill_pending_metadata_network_phase_survives_inside_tauri_async_runtime() {
        let plan = vec![(
            0usize,
            "zh-cn".to_string(),
            Some("https://127.0.0.1:1/unreachable.json".to_string()),
        )];
        let result = tauri::async_runtime::block_on(fetch_dictionaries_in_blocking_pool(plan));

        assert_eq!(
            result,
            Ok(vec![(0, "zh-cn".to_string(), None)]),
            "下载失败应当得到 None（字典缺席是正常路径，记录留在 pending），\
             且这一整个过程不应当 panic——旧实现会在这里因为在 async 上下文里\
             构造/销毁 reqwest::blocking::Client 而必现 panic"
        );
    }

    /// 没有任何插件存在待回填记录时，应当返回空报告，而不是报错或 panic
    /// ——不需要真实网络就能跑，验证的是"没有工作可做时的编排逻辑"这条
    /// 快速路径。
    #[test]
    fn run_metadata_backfill_returns_empty_report_when_nothing_is_pending() {
        let host =
            Mutex::new(HostRuntime::bootstrap_in_memory().expect("应当能启动内存宿主运行时"));
        let cache_root = std::env::temp_dir().join(format!(
            "gacha-studio-metadata-backfill-empty-{}",
            std::process::id()
        ));

        let result = tauri::async_runtime::block_on(run_metadata_backfill(&cache_root, &host));

        assert_eq!(
            result,
            Ok(Vec::new()),
            "没有待回填记录时应当返回空报告，不发起任何网络请求"
        );
        let _ = std::fs::remove_dir_all(&cache_root);
    }

    /// 某个插件即使有 `pending` 记录，只要它没有声明 `metadata` Provider
    /// （本轮范围裁定：starrail/wuwa/zzz 均未声明），就不应当出现在报告里
    /// ——记录原样留在 `pending`，不产生任何网络请求。用 `wuwa` 造一条
    /// pending 记录验证这条"跳过"路径，不需要真实网络。
    #[test]
    fn run_metadata_backfill_skips_plugins_that_have_not_declared_metadata_provider() {
        let host = HostRuntime::bootstrap_in_memory().expect("应当能启动内存宿主运行时");
        {
            let repo = host.storage().repository();
            let account_id = repo
                .create_account(&gs_storage::NewAccount {
                    plugin_id: "wuwa".to_string(),
                    game_uid: "300000001".to_string(),
                    region: "official".to_string(),
                    display_name: None,
                    retention_days: None,
                    created_at: 1_754_800_000_000,
                })
                .expect("创建账号应当成功");
            let record = gs_core::GachaRecord {
                id: 0,
                account_id,
                banner_key: "1".to_string(),
                pity_group: "characterChannel".to_string(),
                record_key: gs_core::RecordKey::new("rk-1".to_string()).unwrap(),
                lang: Some("zh-cn".to_string()),
                occurred_at: 1_754_800_000_000,
                occurred_raw: "2026-08-10 12:00:00".to_string(),
                tz_origin: gs_core::TzOrigin::Assumed,
                tz_offset_min: None,
                seq_in_batch: None,
                item_id: "resource-1".to_string(),
                item_type: None,
                rarity: None,
                qty: 1,
                meta_state: gs_core::MetaState::Pending,
                source: gs_core::RecordSource::Import,
                captured_at: 1_754_800_000_000,
                raw_ref: None,
                extra: None,
                stable_id: None,
                gacha_id: None,
            };
            repo.insert_records(&[record]).expect("写入应当成功");
        }
        let host = Mutex::new(host);
        let cache_root = std::env::temp_dir().join(format!(
            "gacha-studio-metadata-backfill-skip-{}",
            std::process::id()
        ));

        let result = tauri::async_runtime::block_on(run_metadata_backfill(&cache_root, &host));

        assert_eq!(
            result,
            Ok(Vec::new()),
            "wuwa 没有声明 metadata Provider，即使有 pending 记录也不应当出现在报告里，且不发起网络请求"
        );
        let _ = std::fs::remove_dir_all(&cache_root);
    }
}
