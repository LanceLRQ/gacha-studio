/**
 * IPC 客户端——前端唯一允许调用 `invoke` 的地方，页面不直接依赖
 * `@tauri-apps/api`。集中在这里做两件事：把 Rust 侧的 `snake_case`
 * 命令参数收敛成 TS 惯用的 `camelCase` 调用签名，以及统一错误形态。
 *
 * ⚠️ 故意放在 `lib/` 下而不是 `lib/ipc/` 里：`lib/ipc/` 目录被
 * `scripts/gs-check/checks/codegen-diff.mjs` 的 HC-3 门当作"生成产物必须
 * 已提交"的监视范围（`git status --porcelain -- web/src/lib/ipc/`），本文件
 * 是手写代码、不是 codegen 产物，混进那个目录会被该门当成"未提交的生成物"
 * 误报——实测踩过这个坑，因此拆成 `ipc-client.ts`（手写）+
 * `ipc/generated.ts`（生成，禁止手改）两处，职责边界与 gs:check 的监视范围
 * 保持一致。
 *
 * ⚠️ 命令参数大小写：`src-tauri/src/commands.rs` 里的命令都没有标注
 * `#[tauri::command(rename_all = ...)]`，用的是 Tauri 的默认行为——前端传
 * `camelCase` 键，框架自动映射到 Rust 侧的 `snake_case` 形参（如
 * `accountId` → `account_id`）。这里的调用参数因此保持 camelCase，不要
 * 改成 snake_case。
 *
 * 错误处理：Rust 侧命令返回 `Result<T, String>`，失败时 `invoke` 直接用
 * 那个字符串 reject——它已经是 `gs-host` 拼好的完整中文说明（"发生了什么 +
 * 怎么办"，见 `commands.rs` 里 `to_message` 的注释），这里只包成 `Error`
 * 实例方便 `catch` 分支统一用 `.message`，不额外拼接"操作失败："这类前缀，
 * 那只会把真正有用的信息往后推。
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  AccountAnalysisView,
  AccountView,
  ExportFormat,
  ExportReport,
  GameView,
  ImportReport,
  MetadataBackfillReport,
  MonthlyActivityView,
  OverviewStatsView,
  RecordPage,
  ThemePreference,
} from "./ipc/generated";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    // Tauri 在命令返回 Err 时，reject 的值就是 Err 里的字符串本身（不是
    // Error 实例）；也可能是运行时/序列化层面的其它异常。统一成 Error，
    // 不改写内容。
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** 骨架探针：验证宿主运行时能否独立完成初始化。 */
export function hostRuntimeReady(): Promise<boolean> {
  return call<boolean>("host_runtime_ready");
}

/** 列出全部已注册插件（游戏）的展示元数据。 */
export function listGames(): Promise<GameView[]> {
  return call<GameView[]>("list_games");
}

/** 列出本地全部账号。 */
export function listAccounts(): Promise<AccountView[]> {
  return call<AccountView[]>("list_accounts");
}

export interface ListRecordsParams {
  accountId: number;
  bannerKey?: string;
  rarities?: string[];
  occurredFrom?: number;
  occurredTo?: number;
  itemSearch?: string;
  /** 页码，从 0 开始（与 Rust 侧 `RecordPage.page` 同一口径）。 */
  page?: number;
  pageSize?: number;
}

/**
 * 分页读取某个账号的抽卡记录。
 *
 * ⚠️ `pageSize` 会被宿主夹到 200 的上限——返回值里的 `RecordPage.pageSize`
 * 才是宿主实际采用的值，调用方（页面）算总页数时必须用返回值，不能用自己
 * 传出去的这个参数，见 `commands.rs::MAX_PAGE_SIZE` 的注释。
 */
export function listRecords(params: ListRecordsParams): Promise<RecordPage> {
  const { accountId, bannerKey, rarities, occurredFrom, occurredTo, itemSearch, page, pageSize } = params;
  return call<RecordPage>("list_records", {
    accountId,
    bannerKey,
    rarities,
    occurredFrom,
    occurredTo,
    itemSearch,
    page,
    pageSize,
  });
}

/** 单个账号的保底进度 + 稀有度分布。 */
export function accountAnalysis(accountId: number): Promise<AccountAnalysisView> {
  return call<AccountAnalysisView>("account_analysis", { accountId });
}

/**
 * 按账号统计月度抽卡活动（自然月 → 抽数 + 顶级保底命中数），游戏详情页
 * "抽卡时间线（按月）"的数据来源。聚合下沉到 SQL，不是拉全量记录再在
 * 前端手动分组——见 `commands.rs::monthly_activity` 的文档。
 */
export function monthlyActivity(accountId: number): Promise<MonthlyActivityView[]> {
  return call<MonthlyActivityView[]>("monthly_activity", { accountId });
}

/** 跨账号概览统计。 */
export function overviewStats(): Promise<OverviewStatsView> {
  return call<OverviewStatsView>("overview_stats");
}

/**
 * 弹出文件选择框，导入抽卡存档。
 *
 * 返回 `null` 表示用户取消了选择——**不是错误**，调用方不应该把它当成
 * 失败展示红色提示，见 `commands.rs` 里同一条命令的文档。
 */
export function importArchiveViaPicker(): Promise<ImportReport | null> {
  return call<ImportReport | null>("import_archive_via_picker");
}

/**
 * 弹出保存对话框，把本地库的抽卡记录导出成 CSV 或 UIGF v4 文件。
 *
 * `accountId` 省略或传 `undefined` 表示导出全部账号；传具体账号 id 只导出
 * 该账号。返回 `null` 表示用户取消了保存——**不是错误**，与
 * `importArchiveViaPicker` 同一条区分"取消"与"失败"的纪律，调用方不应该把
 * 它当成失败展示红色提示。
 *
 * 返回的 `ExportReport.excluded` 是 UIGF 格式下"这些记录为什么没能导出"的
 * 逐类计数（CSV 格式恒为空数组）——调用方应当把它渲染出来，不要只显示
 * "导出成功"而丢掉这部分信息，见 `crates/gs-host/src/export.rs` 模块文档。
 */
export function exportRecordsViaPicker(format: ExportFormat, accountId?: number): Promise<ExportReport | null> {
  return call<ExportReport | null>("export_records_via_picker", { format, accountId });
}

/**
 * 确保某个游戏的图标已下载并缓存到本地，返回可直接塞给 `<img src>` 的
 * base64 data URL（形如 `"data:image/png;base64,..."`）。下载、校验
 * （content-type + magic bytes）、落盘缓存全部是宿主职责，前端只传一个
 * `gameId`——`PluginManifest.iconUrl` 从不经 IPC 出现在前端，避免插件
 * 图标地址被当成一个可以从前端发起任意请求的窄口。
 *
 * 返回 `null` 表示这个游戏没有可用图标（manifest 未声明 iconUrl、下载失败、
 * 或校验未通过）——**不是错误**，调用方应当把它当成正常的"没有图标"状态，
 * 交给 `GameIcon` 走 fallback，不重试、不报错。
 */
export function ensureGameIcon(gameId: string): Promise<string | null> {
  return call<string | null>("ensure_game_icon", { gameId });
}

/**
 * 读取宿主持久化的主题偏好。返回 `null` 表示宿主从未记录过（新装应用，或
 * 本次是这项持久化上线后第一次打开设置页）——**不是错误**，调用方
 * （`pages/Settings.tsx`）据此决定用当前本地值反向回填一次，而不是当成
 * 请求失败处理。
 */
export function getThemePreference(): Promise<ThemePreference | null> {
  return call<ThemePreference | null>("get_theme_preference");
}

/** 把主题偏好写入宿主持久化存储（`app_setting` 表）。 */
export function setThemePreference(preference: ThemePreference): Promise<void> {
  return call<void>("set_theme_preference", { preference });
}

/**
 * 对已注册插件里声明了在线元数据 Provider 的记录做一次回填——反查
 * `itemIdSource: "displayName"` 场景下停在 `pending` 的记录，把本地化物品名
 * 换成真正的物品标识。无参数：由宿主自己判断哪些插件、哪些语言需要处理，
 * 前端不传任何路径/URL/凭据类参数。
 *
 * 返回值是按插件维度拆开的报告列表——没有任何插件存在待回填记录，或没有
 * 任何插件声明了在线元数据 Provider（当前只有原神），都会得到空数组，
 * **不是错误**。单个语言下载/解析失败不会让整个调用失败，会体现在对应
 * 报告的 `skippedNoDictionary` 计数里。
 */
export function backfillPendingMetadata(): Promise<MetadataBackfillReport[]> {
  return call<MetadataBackfillReport[]>("backfill_pending_metadata");
}
