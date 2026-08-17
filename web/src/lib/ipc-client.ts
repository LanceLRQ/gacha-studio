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
  GameView,
  ImportReport,
  OverviewStatsView,
  RecordPage,
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
