import { useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  OctagonAlert,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { GameIcon } from "@/components/game-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardTitleGroup } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/lib/app-state";
import { downloadAndVerifyIcon, isValidIconUrl } from "@/lib/game-icon";
import { accountsOf, MOCK_GAMES, type GameId, type MockGameMeta } from "@/lib/mock-data";
import { type ThemePreference, useTheme } from "@/lib/theme-provider";
import { cn } from "@/lib/utils";

/** 游戏目录：本地组件状态覆盖 mock 账号的初始值，模拟「更改目录」后的即时反馈。 */
interface DirOverride {
  path: string;
  valid: boolean;
}

/** 对应 ui-demo/settings.html。游戏目录、图标 URL + 重新下载、主题切换、导入导出入口。 */
export function Settings() {
  const { enabledGameIds } = useAppState();
  const games = MOCK_GAMES.filter((g) => enabledGameIds.has(g.id));
  const [dirOverrides, setDirOverrides] = useState<Partial<Record<GameId, DirOverride>>>({});
  const [dirDialogGameId, setDirDialogGameId] = useState<GameId | undefined>(undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col px-7 pt-4.5 pb-3.5">
        <h1 className="text-[19px] font-bold tracking-tight">设置</h1>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">管理游戏目录、通用偏好与版本信息</p>
      </header>

      <Tabs defaultValue="game" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="game">游戏</TabsTrigger>
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="about">关于</TabsTrigger>
        </TabsList>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <TabsContent value="game" className="px-7 py-5">
            <SectionLabel>游戏与目录</SectionLabel>
            <div className="flex flex-col gap-3">
              {games.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground">尚未启用任何游戏。</p>
              )}
              {games.map((game) => (
                <GameSettingsCard
                  key={game.id}
                  game={game}
                  dirOverride={dirOverrides[game.id]}
                  onChangeDirClick={() => setDirDialogGameId(game.id)}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="general" className="flex flex-col gap-6 px-7 py-5">
            <GeneralTab />
          </TabsContent>

          <TabsContent value="about" className="flex flex-col gap-6 px-7 py-5">
            <AboutTab />
          </TabsContent>
        </div>
      </Tabs>

      <GameDirDialog
        gameId={dirDialogGameId}
        onOpenChange={(open) => !open && setDirDialogGameId(undefined)}
        onConfirm={(gameId, override) => {
          setDirOverrides((prev) => ({ ...prev, [gameId]: override }));
          setDirDialogGameId(undefined);
        }}
      />
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

function GameSettingsCard({
  game,
  dirOverride,
  onChangeDirClick,
}: {
  game: MockGameMeta;
  dirOverride: DirOverride | undefined;
  onChangeDirClick: () => void;
}) {
  const primaryAccount = accountsOf(game.id)[0];
  const dirPath = dirOverride?.path ?? primaryAccount?.gameDirPath;
  const dirValid = dirOverride?.valid ?? primaryAccount?.gameDirValid ?? true;

  const [iconUrl, setIconUrl] = useState(game.iconUrl ?? "");
  const [iconState, setIconState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "success"; previewSrc: string } | { status: "error"; message: string }
  >({ status: "idle" });

  async function handleRedownload() {
    if (!isValidIconUrl(iconUrl)) {
      setIconState({ status: "error", message: "仅支持 https 地址" });
      return;
    }
    setIconState({ status: "loading" });
    const result = await downloadAndVerifyIcon(iconUrl);
    if (result.ok) {
      setIconState({ status: "success", previewSrc: result.objectUrl });
    } else {
      const reasonText: Record<typeof result.reason, string> = {
        invalidUrl: "仅支持 https 地址",
        networkError: "下载失败，请检查网络或地址是否可访问",
        notAnImage: "响应内容不是可识别的图片格式",
        contentTypeMismatch: "响应头 content-type 与实际图片格式不一致",
      };
      setIconState({ status: "error", message: reasonText[result.reason] });
    }
  }

  return (
    <Card className={cn(!dirValid && "border-destructive bg-destructive-bg")}>
      <CardHeader>
        <GameIcon
          displayName={game.displayName}
          colorVar={game.colorVar}
          iconSrc={iconState.status === "success" ? iconState.previewSrc : undefined}
        />
        <CardTitleGroup>
          <CardTitle>{game.displayName}</CardTitle>
        </CardTitleGroup>
        {!dirValid && (
          <Badge variant="destructive" className="ml-auto">
            <OctagonAlert />
            目录已失效
          </Badge>
        )}
      </CardHeader>

      <div>
        <span className="mb-1.5 block text-[11.5px] text-muted-foreground">游戏目录</span>
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "min-w-0 flex-1 overflow-hidden font-mono text-[12.5px] text-ellipsis whitespace-nowrap",
              !dirValid && "text-destructive",
            )}
          >
            {dirPath ?? "尚未配置"}
          </span>
          <Button variant="outline" size="sm" onClick={onChangeDirClick}>
            更改
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <span className="mb-1.5 block text-[11.5px] text-muted-foreground">游戏图标</span>
        <div className="flex items-center gap-2.5">
          <Input
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://…"
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={() => void handleRedownload()} disabled={iconState.status === "loading"}>
            <RefreshCw className={cn(iconState.status === "loading" && "animate-spin")} />
            重新下载
          </Button>
        </div>
        {iconState.status === "success" && (
          <p className="mt-1.5 text-[11px] text-primary">下载成功，已通过 content-type / magic bytes 校验</p>
        )}
        {iconState.status === "error" && <p className="mt-1.5 text-[11px] text-destructive">{iconState.message}</p>}
      </div>
    </Card>
  );
}

function GameDirDialog({
  gameId,
  onOpenChange,
  onConfirm,
}: {
  gameId: GameId | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (gameId: GameId, override: DirOverride) => void;
}) {
  const game = MOCK_GAMES.find((g) => g.id === gameId);
  const account = gameId ? accountsOf(gameId)[0] : undefined;
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [manualPath, setManualPath] = useState("");

  const candidates = account
    ? [
        { path: account.gameDirPath, source: "注册表", recommended: true },
        { path: `${account.gameDirPath}\\..\\Backup`, source: "常见安装位置", recommended: false },
      ]
    : [];

  const finalPath = manualPath.trim() || selectedPath || candidates[0]?.path;

  // Dialog 容器保持常驻挂载，只把内容按 game/account 是否就绪来决定渲染——
  // 这样 onOpenChange(false) 时 Radix 能正常跑完关闭动画，而不是父组件
  // 一把状态清空导致整棵子树连着动画一起被硬拔掉。
  return (
    <Dialog open={gameId !== undefined} onOpenChange={onOpenChange}>
      {game && account && (
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>选择游戏目录 · {game.displayName}</DialogTitle>
          <DialogDescription>
            Gacha Studio 需要读取游戏目录下的缓存文件来获取抽卡记录链接。目录不会被修改。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!account.gameDirValid && (
            <div className="mb-3.5 flex items-start gap-2.5 rounded-[var(--radius)] border border-destructive bg-destructive-bg px-3.5 py-2.5 text-destructive">
              <OctagonAlert className="mt-px size-4 shrink-0" />
              <div>
                <span className="mb-0.5 block text-[12.5px] font-semibold">当前记录的目录已失效</span>
                <span className="block font-mono text-xs opacity-85">{account.gameDirPath}</span>
              </div>
            </div>
          )}

          <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">
            自动检测结果
          </div>
          <div className="mb-4 flex flex-col gap-1.5">
            {candidates.map((candidate) => (
              <label
                key={candidate.path}
                className={cn(
                  "relative flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-3.5 py-2.25",
                  (selectedPath ?? candidates[0]?.path) === candidate.path &&
                    !manualPath &&
                    "border-primary bg-primary-tint",
                )}
              >
                <input
                  type="radio"
                  name="dir-candidate"
                  className="size-3.75 accent-primary"
                  checked={(selectedPath ?? candidates[0]?.path) === candidate.path && !manualPath}
                  onChange={() => {
                    setSelectedPath(candidate.path);
                    setManualPath("");
                  }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="overflow-hidden font-mono text-[12.5px] text-ellipsis whitespace-nowrap">
                    {candidate.path}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{candidate.source}</Badge>
                    <Badge variant="neutral">
                      <Check />
                      可用
                    </Badge>
                  </div>
                </div>
                {candidate.recommended && <Badge variant="primary">推荐</Badge>}
              </label>
            ))}
          </div>

          <div className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint-foreground uppercase">
            手动选择
          </div>
          <div className="mb-3.5 flex items-center gap-2.5">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="粘贴或输入游戏目录路径…"
              className="flex-1"
            />
            <Button variant="outline">
              <FolderOpen />
              浏览…
            </Button>
          </div>

          <p className="flex items-center gap-2 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-faint-foreground" />
            数据仅在本机读取，凭据不会离开你的电脑
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              if (!gameId || !finalPath) return;
              onConfirm(gameId, { path: finalPath, valid: true });
            }}
          >
            使用此目录
          </Button>
        </DialogFooter>
      </DialogContent>
      )}
    </Dialog>
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
      </section>

      <section>
        <SectionLabel>数据</SectionLabel>
        <Card>
          <SettingsRow label="数据库位置">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-muted-foreground">
                ~/AppData/Roaming/GachaStudio/data/gacha-studio.db
              </span>
              <Button variant="outline" size="sm">
                <FolderOpen />
                打开所在文件夹
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow label="备份">
            <div className="flex items-center gap-2.5">
              <span className="text-[11.5px] text-muted-foreground">上次备份：3 天前</span>
              <Button variant="outline" size="sm">
                <Save />
                立即备份
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow label="导入 / 导出">
            <div className="flex items-center gap-2.5">
              <Button variant="outline" size="sm">
                <Upload />
                导入
              </Button>
              <Button variant="outline" size="sm">
                <Download />
                导出
              </Button>
            </div>
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
            <div className="flex items-center gap-2.5">
              <span className="text-[11.5px] text-muted-foreground">上次检查：3 天前</span>
              <Button variant="outline" size="sm">
                <RefreshCw />
                检查更新
              </Button>
            </div>
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
