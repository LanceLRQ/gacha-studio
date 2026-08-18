import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Save,
  Tags,
  Upload,
} from "lucide-react";

import { GameIconAuto } from "@/components/game-icon-auto";
import { ErrorState, LoadingState } from "@/components/async-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardTitleGroup } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/lib/app-state";
import { formatCount, formatDate, maskUid } from "@/lib/format";
import type { GameMeta } from "@/lib/games";
import {
  backfillPendingMetadata,
  exportRecordsViaPicker,
  getThemePreference,
  importArchiveViaPicker,
  listAccounts,
  setThemePreference,
} from "@/lib/ipc-client";
import type {
  AccountView,
  ExportFormat,
  ExportReport,
  ImportReport,
  MetadataBackfillReport,
} from "@/lib/ipc/generated";
import { useAsync } from "@/lib/use-async";
import { type ThemePreference, useTheme } from "@/lib/theme-provider";
import { cn } from "@/lib/utils";

/**
 * 提示文案：出现在所有"目前没有对应 IPC 命令"的按钮上——数据库位置/备份/
 * 检查更新/导出都是如此，本轮 IPC 面只提供了
 * `import_archive_via_picker` 这一条写入命令，其余维持禁用而不是假装可点。
 */
const NOT_WIRED_HINT = "该功能尚未接入 IPC 命令，本轮只接通了「导入存档」";

/**
 * 对应 ui-demo/settings.html。
 *
 * ⚠️ 与原始设计稿的偏差：原「游戏」tab 有一个完整的「选择游戏目录」对话框
 * （自动检测候选路径 + 手动浏览 + 校验可用性）。真实 IPC 面完全没有与
 * 「游戏目录」相关的命令（既不能列出候选路径，也不能设置/校验目录），这是
 * 采集链路本身尚未实现的一部分，不是这个页面的疏漏。继续渲染那个对话框
 * 等于给用户一个点了会"确认成功"但背后什么也没发生的假交互，因此整个
 * 对话框在这一轮被移除，游戏 tab 改为展示该游戏下的真实账号列表 +
 * 「导入存档」入口——这也是当前 IPC 面下唯一真实可用的"把数据弄进来"的
 * 方式。
 */
export function Settings() {
  const { games: allGames, enabledGameIds } = useAppState();
  const games = allGames.filter((g) => enabledGameIds.has(g.id));

  const accountsState = useAsync(() => listAccounts(), []);

  type ImportState =
    | { status: "idle" }
    | { status: "importing" }
    | { status: "success"; report: ImportReport }
    | { status: "error"; message: string };
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });

  async function handleImport() {
    setImportState({ status: "importing" });
    try {
      const report = await importArchiveViaPicker();
      if (report === null) {
        // 用户按了取消——不是失败，回到 idle，不弹红色提示。
        setImportState({ status: "idle" });
        return;
      }
      setImportState({ status: "success", report });
      accountsState.reload(); // 导入可能新建了账号/记录，立即刷新本页的账号列表
    } catch (err) {
      setImportState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  type MetadataBackfillState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "success"; reports: MetadataBackfillReport[] }
    | { status: "error"; message: string };
  const [backfillState, setBackfillState] = useState<MetadataBackfillState>({ status: "idle" });

  async function handleBackfillMetadata() {
    setBackfillState({ status: "running" });
    try {
      const reports = await backfillPendingMetadata();
      setBackfillState({ status: "success", reports });
    } catch (err) {
      setBackfillState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col px-7 pt-4.5 pb-3.5">
        <h1 className="text-[19px] font-bold tracking-tight">设置</h1>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">管理账号数据、通用偏好与版本信息</p>
      </header>

      <Tabs defaultValue="game" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="game">游戏</TabsTrigger>
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="about">关于</TabsTrigger>
        </TabsList>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <TabsContent value="game" className="px-7 py-5">
            <SectionLabel>导入数据</SectionLabel>
            <Card className="mb-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-muted-foreground">
                  从导出工具（UIGF / WWGacha 等存档格式）导入抽卡记录。存档里的账号在本地不存在时会新建，已存在则合并去重。
                </span>
                <Button size="sm" onClick={() => void handleImport()} disabled={importState.status === "importing"}>
                  <Upload className={cn(importState.status === "importing" && "animate-spin")} />
                  {importState.status === "importing" ? "导入中…" : "导入存档"}
                </Button>
              </div>
              {importState.status === "success" && <ImportSuccessSummary report={importState.report} />}
              {importState.status === "error" && (
                <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] text-destructive">{importState.message}</p>
              )}
            </Card>

            <SectionLabel>物品名补齐</SectionLabel>
            <Card className="mb-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-muted-foreground">
                  部分游戏（如原神）的官方接口不直接返回物品标识，记录会暂时停留在"待补全"状态。点击此按钮联网反查一次，仅对已声明该能力的游戏生效。
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleBackfillMetadata()}
                  disabled={backfillState.status === "running"}
                >
                  <Tags className={cn(backfillState.status === "running" && "animate-spin")} />
                  {backfillState.status === "running" ? "回填中…" : "补齐物品名"}
                </Button>
              </div>
              {backfillState.status === "success" && <MetadataBackfillSummary reports={backfillState.reports} />}
              {backfillState.status === "error" && (
                <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] text-destructive">
                  {backfillState.message}
                </p>
              )}
            </Card>

            <SectionLabel>游戏与账号</SectionLabel>
            {accountsState.status === "loading" && <LoadingState label="正在加载账号列表…" />}
            {accountsState.status === "error" && <ErrorState message={accountsState.message} onRetry={accountsState.reload} />}
            {accountsState.status === "ready" && (
              <div className="flex flex-col gap-3">
                {games.length === 0 && <p className="text-[12.5px] text-muted-foreground">尚未启用任何游戏。</p>}
                {games.map((game) => (
                  <GameSettingsCard
                    key={game.id}
                    game={game}
                    accounts={accountsState.data.filter((a) => a.pluginId === game.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="general" className="flex flex-col gap-6 px-7 py-5">
            <GeneralTab />
          </TabsContent>

          <TabsContent value="about" className="flex flex-col gap-6 px-7 py-5">
            <AboutTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function ImportSuccessSummary({ report }: { report: ImportReport }) {
  return (
    <div className="mt-2.5 border-t border-border pt-2.5 text-[11.5px]">
      <p className="text-primary">
        已按 <span className="font-semibold">{report.formatId}</span> 格式导入
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {report.accounts.map((acc) => (
          <li key={acc.accountId} className="text-muted-foreground">
            {acc.gameId} · UID {maskUid(acc.uid)}：识别 {formatCount(acc.recordsSeen)} 条，新增{" "}
            <span className="font-semibold text-foreground">{formatCount(acc.recordsInserted)}</span> 条
            {acc.recordsSkipped > 0 && (
              <>
                ，跳过 {formatCount(acc.recordsSkipped)} 条重复
                {acc.recordsSkipped === acc.recordsSeen && "（与已有数据完全重复，属正常现象，不是导入失败）"}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `backfillPendingMetadata` 的结果展示——按插件拆开，四个互斥桶都摆出来，
 * 不只报"成功了多少"：`stillPending`/`skippedNoLang`/`skippedNoDictionary`
 * 都是"这次没能处理"的记录，用户需要知道还剩多少、大致是什么原因，而不是
 * 被一个笼统的"完成"糊弄过去——这正是任务要求"不得静默吞掉失败"的界面落点。
 *
 * 空数组（没有任何插件声明在线元数据 Provider，或没有任何记录待处理）
 * 单独给一句提示，不是留白让用户猜"是不是没点中"。
 */
function MetadataBackfillSummary({ reports }: { reports: MetadataBackfillReport[] }) {
  if (reports.length === 0) {
    return (
      <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
        没有待补齐的记录——要么所有记录都已经有物品标识，要么当前启用的游戏都不需要这项能力。
      </p>
    );
  }
  return (
    <div className="mt-2.5 border-t border-border pt-2.5 text-[11.5px]">
      <ul className="flex flex-col gap-1">
        {reports.map((report) => (
          <li key={report.pluginId} className="text-muted-foreground">
            {report.pluginId}：新补齐{" "}
            <span className="font-semibold text-foreground">{formatCount(report.resolved)}</span> 条
            {(report.stillPending > 0 || report.skippedNoLang > 0 || report.skippedNoDictionary > 0) && (
              <>
                ，仍待处理 {formatCount(report.stillPending + report.skippedNoLang + report.skippedNoDictionary)} 条
                {report.skippedNoDictionary > 0 && "（含字典暂不可用，下次再试）"}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `exportRecordsViaPicker` 的结果展示——**必须**把 `excluded` 逐条列出来，
 * 不能只显示成功条数：一个「导出成功」却悄悄少了几个卡池的功能，与本项目
 * 反复栽跟头的「功能不产出结论」是同一类失败，见
 * `crates/gs-host/src/export.rs` 模块文档。CSV 格式恒不产出排除项，这里
 * 依然统一走同一个组件——`excluded` 为空数组时下方列表天然不渲染。
 */
function ExportResultSummary({ report }: { report: ExportReport }) {
  return (
    <div className="mt-2.5 border-t border-border pt-2.5 text-[11.5px]">
      <p className="text-primary">
        已按 <span className="font-semibold">{report.format === "csv" ? "CSV" : "UIGF v4"}</span> 格式导出
        {" "}
        <span className="font-semibold text-foreground">{formatCount(report.recordsExported)}</span> 条记录
        {report.accountsExported > 0 && `（覆盖 ${formatCount(report.accountsExported)} 个账号）`}
      </p>
      {report.excluded.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {report.excluded.map((bucket) => (
            <li key={bucket.reason} className="text-muted-foreground">
              <span className="font-semibold text-foreground">{formatCount(bucket.count)}</span> 条未导出：{bucket.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">
      {children}
    </div>
  );
}

// ============================================================
// 游戏 tab
// ============================================================

function GameSettingsCard({ game, accounts }: { game: GameMeta; accounts: AccountView[] }) {
  return (
    <Card>
      <CardHeader>
        <GameIconAuto game={game} />
        <CardTitleGroup>
          <CardTitle>{game.displayName}</CardTitle>
          <span className="text-[11.5px] text-muted-foreground">{accounts.length} 个账号</span>
        </CardTitleGroup>
      </CardHeader>

      {accounts.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">还没有本地账号，导入存档后会出现在这里。</p>
      ) : (
        <div className="flex flex-col">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 border-b border-border py-1.75 text-[12.5px] last:border-b-0"
            >
              <span className="font-mono tabular-nums">{maskUid(account.gameUid)}</span>
              <span className="text-muted-foreground">{account.region}</span>
              <span className="font-mono text-muted-foreground tabular-nums">{formatCount(account.recordCount)} 条</span>
              <span className="text-muted-foreground">
                {account.lastCollectedAt ? `${formatDate(account.lastCollectedAt)} 采集` : "从未采集"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// 通用 tab
// ============================================================

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

type ExportState =
  | { status: "idle" }
  | { status: "exporting"; format: ExportFormat }
  | { status: "success"; report: ExportReport }
  | { status: "error"; message: string };

function GeneralTab() {
  const { preference, setPreference } = useTheme();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });

  async function handleExport(format: ExportFormat) {
    setExportState({ status: "exporting", format });
    try {
      const report = await exportRecordsViaPicker(format);
      if (report === null) {
        // 用户按了取消——不是失败，回到 idle，不弹红色提示，与
        // handleImport 同一条纪律。
        setExportState({ status: "idle" });
        return;
      }
      setExportState({ status: "success", report });
    } catch (err) {
      setExportState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // 主题偏好现在有两处落点，真值来源与两者的关系必须说清楚，避免"两处都在
  // 写、谁赢不确定"：
  //
  // - `localStorage`（读写逻辑在 `lib/theme-provider.tsx`，本次改动未触碰）
  //   是应用启动那一帧唯一来得及同步读到的缓存——`ThemeProvider` 在整棵组件
  //   树挂载前用它决定要不要加 `dark` class，避免"先渲染浅色、IPC 回来才
  //   跳深色"的闪烁。这层缓存必须继续存在，不能被宿主持久化整体取代。
  // - 宿主 SQLite（`app_setting` 表，本次新增）才是**真值来源**：跨设备/
  //   跨 profile 的持久化、以及未来"设置导出/迁移"这类需求都只能靠它，
  //   `localStorage` 清空或换一个 webview profile 都不影响它。
  //
  // 两者的同步规则：
  //   写入：用户点击 → 先同步写 `localStorage`（经 `setPreference`，界面立即
  //         生效，不等 IPC 往返）→ 再异步写宿主。**写宿主失败必须把界面与
  //         localStorage 一并回滚到改动前的值**，理由见下。
  //   读取：本页挂载时向宿主对账一次——宿主有值且与本地缓存不同就以宿主为
  //         准（顺带把 localStorage 刷新一致，覆盖"换了个清空过 localStorage
  //         的 profile"这种情况）；宿主从未记录过（`null`）就用当前生效值
  //         反向回填，让下次启动就能从宿主读到。
  //
  // ⚠️ **为什么写失败必须回滚，而不是"只提示、保留已生效的界面"**（2026-08-18
  // 复核时修正，初版就是不回滚的）：`stored !== preference` 这个对账条件
  // **只可能**由两种情形触发，而代码没有任何办法区分它们——
  //   ① `localStorage` 被清空/换了 webview profile：本地退回默认值，
  //      宿主保留着用户真正的选择 → **该宿主赢**；
  //   ② 上一次写宿主失败：本地是用户刚选的新值，宿主还是旧值 → **该本地赢**。
  // 既然分不清就只能选一种，而"宿主赢"在情形 ② 下会把用户的选择**静默改回去**：
  // 用户选了深色 → 写宿主失败（只弹了个提示）→ 离开设置页再回来 → 对账把它
  // 改回浅色，而那条错误提示早已随组件卸载消失，用户只会觉得设置莫名其妙没保存。
  // 让写失败时立刻回滚，情形 ② 就根本不会产生分歧，"宿主赢"随之变成无歧义的
  // 正确规则。代价是主题会闪回原值一次——但那恰恰是诚实的：这次设置**确实**
  // 没有持久化成功，让用户当场看见，好过五分钟后自己发现。
  // 对账只发生在设置页这次挂载，不会在应用启动的第一帧触发——第一帧的主题
  // 只由 `localStorage` 同步决定，本次改动没有、也不能改这一点（那部分逻辑
  // 在 `theme-provider.tsx`/`main.tsx`，不在本次改动范围内），因此不会引入
  // "先浅色再跳深色"的新闪烁。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await getThemePreference();
        if (cancelled) return;
        if (stored === null) {
          await setThemePreference(preference);
        } else if (stored !== preference) {
          setPreference(stored);
        }
      } catch (err) {
        if (!cancelled) setSyncError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在设置页挂载时对账一次。`preference`/`setPreference` 之后的变化
    // （无论是用户点击 handleThemeChange，还是本 effect 自己触发的
    // setPreference(stored)）都不应该重新跑一遍对账——那会变成"对账 →
    // 状态变化 → 再次对账"的循环。空依赖数组是刻意的，不是漏写。
    // （本仓库没有 eslint，因此不写 eslint-disable 注释——那会让读者以为
    // 有一条 lint 规则正在被抑制，而实际上没有任何东西在检查这里。）
  }, []);

  async function handleThemeChange(next: typeof preference) {
    // 改动前的值，写宿主失败时用它回滚——理由见上方 useEffect 的说明。
    const previous = preference;
    setPreference(next); // 同步：localStorage + 界面状态立即生效，不等待 IPC 往返
    try {
      await setThemePreference(next);
      setSyncError(null);
    } catch (err) {
      // 回滚到改动前的值，让 localStorage 与宿主不产生分歧。`setPreference`
      // 同时写 localStorage 与界面状态，两者一起退回，不留半应用状态。
      setPreference(previous);
      setSyncError(
        `主题偏好未能保存到本地数据库，已恢复为改动前的设置：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return (
    <>
      <section>
        <SectionLabel>外观</SectionLabel>
        <Card>
          <SettingsRow label="主题">
            <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border-strong">
              {THEME_OPTIONS.map((option, idx) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleThemeChange(option.value)}
                  className={cn(
                    "px-3.5 py-1.5 text-[12.5px] text-muted-foreground",
                    idx > 0 && "border-l border-border-strong",
                    preference === option.value && "bg-primary-tint font-semibold text-primary",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow label="界面缩放">
            <Select defaultValue="100">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100%</SelectItem>
                <SelectItem value="110">110%</SelectItem>
                <SelectItem value="125">125%</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </Card>
        {syncError && (
          <p className="mt-2.5 text-[11.5px] text-destructive">
            主题偏好未能同步到本地数据库：{syncError}
            （不影响当前显示，仅表示这次选择可能不会被下次启动记住）
          </p>
        )}
      </section>

      <section>
        <SectionLabel>数据</SectionLabel>
        <Card>
          <SettingsRow label="数据库位置">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-muted-foreground">（暂无对应 IPC 命令可读取真实路径）</span>
              <Button variant="outline" size="sm" disabled title={NOT_WIRED_HINT}>
                <FolderOpen />
                打开所在文件夹
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow label="备份">
            <Button variant="outline" size="sm" disabled title={NOT_WIRED_HINT}>
              <Save />
              立即备份
            </Button>
          </SettingsRow>
          <SettingsRow label="导出">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport("csv")}
                disabled={exportState.status === "exporting"}
              >
                <Download className={cn(exportState.status === "exporting" && exportState.format === "csv" && "animate-spin")} />
                {exportState.status === "exporting" && exportState.format === "csv" ? "导出中…" : "导出 CSV（全量）"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport("uigfV4")}
                disabled={exportState.status === "exporting"}
              >
                <Download className={cn(exportState.status === "exporting" && exportState.format === "uigfV4" && "animate-spin")} />
                {exportState.status === "exporting" && exportState.format === "uigfV4" ? "导出中…" : "导出 UIGF v4"}
              </Button>
            </div>
          </SettingsRow>
          {exportState.status === "success" && <ExportResultSummary report={exportState.report} />}
          {exportState.status === "error" && (
            <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] text-destructive">{exportState.message}</p>
          )}
        </Card>
      </section>
    </>
  );
}

function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.75 first:pt-0 last:border-b-0 last:pb-0">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
    </div>
  );
}

// ============================================================
// 关于 tab
// ============================================================

const CREDITS = [
  { name: "Tauri", license: "MIT / Apache-2.0" },
  { name: "React", license: "MIT" },
  { name: "SQLite", license: "Public Domain" },
  { name: "lucide", license: "ISC" },
] as const;

function AboutTab() {
  return (
    <>
      <section>
        <Card>
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)*1.5)] bg-primary text-primary-foreground">
              <Check className="size-6" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="flex items-baseline gap-2 text-[17px] font-bold tracking-tight">
                Gacha Studio <span className="font-mono text-xs font-medium text-muted-foreground">v0.1.0</span>
              </span>
              <span className="text-[12.5px] text-muted-foreground">把多个游戏的抽卡记录，收拢到一处管理</span>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionLabel>更新</SectionLabel>
        <Card>
          <SettingsRow label="检查更新">
            <Button variant="outline" size="sm" disabled title={NOT_WIRED_HINT}>
              <RefreshCw />
              检查更新
            </Button>
          </SettingsRow>
        </Card>
      </section>

      <section>
        <SectionLabel>开源信息</SectionLabel>
        <Card>
          <SettingsRow label="开源协议">
            <span className="text-[13px]">MIT</span>
          </SettingsRow>
          <SettingsRow label="代码仓库">
            <a
              className="flex items-center gap-1.5 font-mono text-[12.5px] font-medium text-primary hover:underline"
              href="https://github.com/LanceLRQ/gacha-studio"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.25" />
              github.com/LanceLRQ/gacha-studio
            </a>
          </SettingsRow>
          <p className="mt-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            本工具为非官方工具，与米哈游、库洛游戏、腾讯等游戏厂商无关。所有游戏名称与商标归各自权利人所有。
          </p>
        </Card>
      </section>

      <section>
        <SectionLabel>第三方组件致谢</SectionLabel>
        <Card>
          <div className="flex flex-col">
            {CREDITS.map((credit) => (
              <div key={credit.name} className="flex items-center justify-between border-b border-border py-2.25 last:border-b-0">
                <span className="text-[13px] font-medium">{credit.name}</span>
                <Badge variant="neutral">{credit.license}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </>
  );
}
