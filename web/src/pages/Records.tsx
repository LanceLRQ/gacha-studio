import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChartColumn, Download, Search } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppState } from "@/lib/app-state";
import { formatCount, formatDateTime } from "@/lib/format";
import { localizedText, rarityTiers, tierLabel, type GameMeta } from "@/lib/games";
import { accountAnalysis, listAccounts, listRecords } from "@/lib/ipc-client";
import type { AccountView, PityPullView } from "@/lib/ipc/generated";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";
import type { GachaRecord } from "gs-plugin-kit/types";

type RarityFilter = "all" | string;
type TimeFilter = "all" | "30d" | "180d" | "thisYear";

const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const DAY = 86_400_000;
/** 搜索输入防抖：避免每敲一个字就发一次 IPC 调用（服务端筛选是真实查询，
 * 不是本地内存 filter，敲字过程中连续发起 SQL LIKE 查询没有意义）。 */
const SEARCH_DEBOUNCE_MS = 300;

function timeFilterRange(filter: TimeFilter): { occurredFrom?: number; occurredTo?: number } {
  const now = Date.now();
  switch (filter) {
    case "30d":
      return { occurredFrom: now - 30 * DAY };
    case "180d":
      return { occurredFrom: now - 180 * DAY };
    case "thisYear":
      return { occurredFrom: new Date(new Date(now).getFullYear(), 0, 1).getTime() };
    default:
      return {};
  }
}

/**
 * 记录明细页——对应 ui-demo/records.html。**服务端分页 + 服务端筛选**：
 * 每次翻页/改筛选条件都会重新发起 `list_records` 调用，不是把全量记录
 * 拉进内存后本地 filter/slice——星铁真实存档实测 5372 条，全量拉取既慢
 * 又违反 `list_records` 分页窄口本身的设计理由（见
 * `src-tauri/src/commands.rs` 顶部注释）。
 *
 * "保底内第几抽"列的数据来自 `account_analysis` 的 `pityProgress[].pulls`，
 * 按 `recordId` 关联——只覆盖声明了共享保底的卡池，其余记录该列显示"—"，
 * 如实反映"没有保底数据"而不是硬凑一个数字。
 *
 * ⚠️ min-height:0 落点：根节点、表格外层 scroll-area 均需要显式声明，
 * 且本页比其他页多一层结构——filter-row 与 pager 都是 shrink-0，
 * 中间的表格滚动区域是唯一的 flex-1 min-h-0。
 */
export function Records() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const { games, enabledGameIds } = useAppState();
  const game = games.find((g) => g.id === gameId);

  const accountsState = useAsync(() => listAccounts(), []);
  const accountIdParam = searchParams.get("account");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [bannerFilter, setBannerFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(100);
  const [page, setPage] = useState(0); // 0-based，与 Rust 侧 RecordPage.page 同一口径

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const accounts: AccountView[] =
    accountsState.status === "ready" && game ? accountsState.data.filter((a) => a.pluginId === game.id) : [];
  const account = accounts.find((a) => String(a.id) === accountIdParam) ?? accounts[0];

  const { occurredFrom, occurredTo } = timeFilterRange(timeFilter);
  const recordsState = useAsync(
    async () => {
      if (!account) return undefined;
      return listRecords({
        accountId: account.id,
        bannerKey: bannerFilter === "all" ? undefined : bannerFilter,
        rarities: rarityFilter === "all" ? undefined : [rarityFilter],
        occurredFrom,
        occurredTo,
        itemSearch: search.trim() || undefined,
        page,
        pageSize,
      });
    },
    [account?.id, bannerFilter, rarityFilter, timeFilter, search, page, pageSize],
  );

  const analysisState = useAsync(async () => (account ? accountAnalysis(account.id) : undefined), [account?.id]);
  const analysisData = analysisState.status === "ready" ? analysisState.data : undefined;
  const pityByRecordId = useMemo(() => {
    const map = new Map<number, PityPullView>();
    if (analysisData) {
      for (const group of analysisData.pityProgress) {
        for (const pull of group.pulls) map.set(pull.recordId, pull);
      }
    }
    return map;
  }, [analysisData]);

  if (!game || !enabledGameIds.has(game.id)) {
    return <Navigate to="/" replace />;
  }

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  const tiers = rarityTiers(game.rarity);
  const rarityOptions = [tiers.top, ...(tiers.second ? [tiers.second] : []), ...tiers.rest];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-7 pt-4.5 pb-3.5">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">抽卡记录</h1>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {game.displayName}
            {account && (
              <>
                {" "}
                · UID <span className="font-mono tabular-nums">{account.gameUid}</span> · 共{" "}
                <span className="font-mono tabular-nums">{formatCount(account.recordCount)}</span> 条
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled title="导出功能尚未接入 IPC">
            <Download />
            导出
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/game/${game.id}`}>
              <ChartColumn />
              返回分析
            </Link>
          </Button>
        </div>
      </header>

      {accountsState.status === "loading" && <LoadingState label="正在加载账号列表…" />}
      {accountsState.status === "error" && <ErrorState message={accountsState.message} onRetry={accountsState.reload} />}
      {accountsState.status === "ready" && !account && (
        <EmptyState
          title="该游戏下还没有本地账号"
          description="前往设置页导入一份抽卡存档后，这里会展示记录明细。"
          action={
            <Button asChild size="sm">
              <Link to="/settings">前往设置页导入</Link>
            </Button>
          }
        />
      )}

      {account && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-card px-7 py-2.25">
            <div className="relative inline-flex items-center">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(0);
                }}
                placeholder="搜索物品名称"
                className="w-[220px] pl-7.5"
              />
            </div>

            {game.banners.length > 1 && (
              <Select value={bannerFilter} onValueChange={resetToFirstPage(setBannerFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部卡池</SelectItem>
                  {game.banners.map((banner) => (
                    <SelectItem key={banner.id} value={banner.id}>
                      {localizedText(banner.displayName, banner.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={rarityFilter} onValueChange={resetToFirstPage(setRarityFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部稀有度</SelectItem>
                {rarityOptions.map((code) => (
                  <SelectItem key={code} value={code}>
                    仅{tierLabel(game.tierLabels, code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={timeFilter} onValueChange={(v) => resetToFirstPage(setTimeFilter)(v as TimeFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部时间</SelectItem>
                <SelectItem value="30d">最近 30 天</SelectItem>
                <SelectItem value="180d">最近半年</SelectItem>
                <SelectItem value="thisYear">今年</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex-1" />
            <div className="text-[11.5px] whitespace-nowrap text-muted-foreground">
              共 <span className="font-mono font-semibold tabular-nums">{formatCount(account.recordCount)}</span> 条 · 已筛选{" "}
              <span className="font-mono font-semibold tabular-nums">
                {recordsState.status === "ready" && recordsState.data ? formatCount(recordsState.data.total) : "…"}
              </span>{" "}
              条
            </div>
          </div>

          <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-7">
            {recordsState.status === "loading" && <LoadingState label="正在查询记录…" />}
            {recordsState.status === "error" && <ErrorState message={recordsState.message} onRetry={recordsState.reload} />}
            {recordsState.status === "ready" && recordsState.data && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>物品</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>稀有度</TableHead>
                      <TableHead>卡池</TableHead>
                      <TableHead>保底内第几抽</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsState.data.records.map((record) => (
                      <RecordTableRow
                        key={record.id}
                        record={record}
                        game={game}
                        pity={pityByRecordId.get(record.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
                {recordsState.data.records.length === 0 && (
                  <p className="py-10 text-center text-[12.5px] text-muted-foreground">没有匹配当前筛选条件的记录</p>
                )}
              </>
            )}
          </div>

          {recordsState.status === "ready" && recordsState.data && (
            <RecordsPager
              page={page}
              total={recordsState.data.total}
              pageSize={recordsState.data.pageSize}
              onPageChange={setPage}
              pageSizeOption={pageSize}
              onPageSizeChange={resetToFirstPage(setPageSize)}
            />
          )}
        </>
      )}
    </div>
  );
}

function RecordsPager({
  page,
  total,
  pageSize,
  onPageChange,
  pageSizeOption,
  onPageSizeChange,
}: {
  page: number;
  /** 服务端返回的总数——分页器必须用它算总页数，不能用调用方自己传出去的 pageSize。 */
  total: number;
  /** 服务端实际采用的 pageSize（可能被夹到上限），不是调用方传入的那个值。 */
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOption: (typeof PAGE_SIZE_OPTIONS)[number];
  onPageSizeChange: (size: (typeof PAGE_SIZE_OPTIONS)[number]) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const currentPage = Math.min(page, totalPages - 1);

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-7 py-2.25">
      <div className="text-xs text-muted-foreground">
        第 <span className="font-mono tabular-nums">{currentPage + 1}</span> /{" "}
        <span className="font-mono tabular-nums">{totalPages}</span> 页
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" disabled={currentPage <= 0} onClick={() => onPageChange(0)}>
          <ChevronsLeft />
        </Button>
        <Button variant="ghost" size="icon" disabled={currentPage <= 0} onClick={() => onPageChange(currentPage - 1)}>
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={currentPage >= totalPages - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={currentPage >= totalPages - 1}
          onClick={() => onPageChange(totalPages - 1)}
        >
          <ChevronsRight />
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
        每页显示
        <Select value={String(pageSizeOption)} onValueChange={(v) => onPageSizeChange(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        条
      </div>
    </div>
  );
}

function RecordTableRow({
  record,
  game,
  pity,
}: {
  record: GachaRecord;
  game: GameMeta;
  pity: PityPullView | undefined;
}) {
  const tiers = rarityTiers(game.rarity);
  const badgeVariant = record.rarity === tiers.top ? "r5" : record.rarity === tiers.second ? "r4" : "r3";
  const bannerName = (() => {
    const banner = game.banners.find((b) => b.id === record.bannerKey);
    return banner ? localizedText(banner.displayName, banner.id) : record.bannerKey;
  })();

  return (
    <TableRow className={cn(record.rarity === tiers.top && "bg-rarity-5/8 hover:bg-rarity-5/14")}>
      <TableCell className="font-mono tabular-nums">{formatDateTime(record.occurredAt)}</TableCell>
      <TableCell>{record.itemId}</TableCell>
      <TableCell>{record.itemType ?? "—"}</TableCell>
      <TableCell>
        {record.rarity ? (
          <Badge variant={badgeVariant}>{tierLabel(game.tierLabels, record.rarity)}</Badge>
        ) : (
          <Badge variant="neutral">未知</Badge>
        )}
      </TableCell>
      <TableCell>{bannerName}</TableCell>
      <TableCell className="font-mono tabular-nums">{pity ? pity.pullsSinceLastHit : "—"}</TableCell>
    </TableRow>
  );
}
