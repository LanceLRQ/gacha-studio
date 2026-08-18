import { useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Save,
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
import { importArchiveViaPicker, listAccounts } from "@/lib/ipc-client";
import type { AccountView, ImportReport } from "@/lib/ipc/generated";
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

function GeneralTab() {
  const { preference, setPreference } = useTheme();

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
                  onClick={() => setPreference(option.value)}
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
        {/* TODO：主题偏好目前只落 localStorage，没有走宿主持久化——设置项持久化
            需要新的 kv 表 + Rust 迁移，本轮 IPC 面未提供，超出本次改动范围。 */}
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
            <Button variant="outline" size="sm" disabled title={NOT_WIRED_HINT}>
              <Download />
              导出
            </Button>
          </SettingsRow>
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
