import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChartColumn, Download, Search } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppState } from "@/lib/app-state";
import { formatCount, formatDateTime } from "@/lib/format";
import { MOCK_GAMES, accountsOf, getMockRecordRows, type MockRecordRow, type MockTierLabels } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type RarityFilter = "all" | "top" | "second" | "other";
type TimeFilter = "all" | "30d" | "180d" | "thisYear";

const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const DAY = 86_400_000;

/**
 * 记录明细页——对应 ui-demo/records.html。可筛选、可分页的完整流水表，
 * 是一等公民而非附属功能（§4.2）——三胞胎工具「只有聚合无明细」是明确短板。
 *
 * ⚠️ min-height:0 落点：根节点、表格外层 scroll-area 均需要显式声明，
 * 且本页比其他页多一层结构——filter-row 与 pager 都是 shrink-0，
 * 中间的表格滚动区域是唯一的 flex-1 min-h-0。
 */
export function Records() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const { enabledGameIds } = useAppState();
  const game = MOCK_GAMES.find((g) => g.id === gameId);

  const accounts = game ? accountsOf(game.id) : [];
  const accountIdParam = searchParams.get("account");
  const account =
    accounts.find((a) => String(a.id) === accountIdParam) ?? accounts[0];

  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [bannerFilter, setBannerFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(100);
  const [page, setPage] = useState(1);

  const allRows = useMemo(() => (account ? getMockRecordRows(account) : []), [account]);

  const banners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of allRows) seen.set(row.record.bannerKey, row.bannerDisplayName);
    return Array.from(seen.entries());
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const now = Date.now();
    const trimmedSearch = search.trim();
    return allRows.filter((row) => {
      if (trimmedSearch && !row.record.itemId.includes(trimmedSearch)) return false;
      if (bannerFilter !== "all" && row.record.bannerKey !== bannerFilter) return false;
      if (rarityFilter === "top" && row.record.rarity !== "5") return false;
      if (rarityFilter === "second" && row.record.rarity !== "4") return false;
      if (rarityFilter === "other" && (row.record.rarity === "5" || row.record.rarity === "4")) return false;
      if (timeFilter === "30d" && now - row.record.occurredAt > 30 * DAY) return false;
      if (timeFilter === "180d" && now - row.record.occurredAt > 180 * DAY) return false;
      if (timeFilter === "thisYear" && new Date(row.record.occurredAt).getFullYear() !== new Date(now).getFullYear()) {
        return false;
      }
      return true;
    });
  }, [allRows, search, bannerFilter, rarityFilter, timeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  if (!game || !enabledGameIds.has(game.id) || !account) {
    return <Navigate to="/" replace />;
  }

  const tierLabels = game.tierLabels;

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-7 pt-4.5 pb-3.5">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">抽卡记录</h1>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {game.displayName} · UID <span className="font-mono tabular-nums">{account.uid}</span> · 共{" "}
            <span className="font-mono tabular-nums">{formatCount(allRows.length)}</span> 条
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">
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

      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-card px-7 py-2.25">
        <div className="relative inline-flex items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint-foreground" />
          <Input
            value={search}
            onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
            placeholder="搜索物品名称"
            className="w-[220px] pl-7.5"
          />
        </div>

        {banners.length > 1 && (
          <Select value={bannerFilter} onValueChange={resetToFirstPage(setBannerFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部卡池</SelectItem>
              {banners.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={rarityFilter} onValueChange={(v) => resetToFirstPage(setRarityFilter)(v as RarityFilter)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部稀有度</SelectItem>
            <SelectItem value="top">仅{tierLabels.top}</SelectItem>
            <SelectItem value="second">仅{tierLabels.second}</SelectItem>
            <SelectItem value="other">仅{tierLabels.third}</SelectItem>
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
          共 <span className="font-mono font-semibold tabular-nums">{formatCount(allRows.length)}</span> 条 · 已筛选{" "}
          <span className="font-mono font-semibold tabular-nums">{formatCount(filteredRows.length)}</span> 条
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-7">
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
            {pageRows.map((row) => (
              <RecordTableRow key={row.record.recordKey} row={row} tierLabels={tierLabels} />
            ))}
          </TableBody>
        </Table>
        {filteredRows.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-muted-foreground">没有匹配当前筛选条件的记录</p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-7 py-2.25">
        <div className="text-xs text-muted-foreground">
          第 <span className="font-mono tabular-nums">{clampedPage}</span> /{" "}
          <span className="font-mono tabular-nums">{totalPages}</span> 页
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={clampedPage <= 1} onClick={() => setPage(1)}>
            <ChevronsLeft />
          </Button>
          <Button variant="ghost" size="icon" disabled={clampedPage <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={clampedPage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="icon" disabled={clampedPage >= totalPages} onClick={() => setPage(totalPages)}>
            <ChevronsRight />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
          每页显示
          <Select value={String(pageSize)} onValueChange={(v) => resetToFirstPage(setPageSize)(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number])}>
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
    </div>
  );
}

function RecordTableRow({
  row,
  tierLabels,
}: {
  row: MockRecordRow;
  tierLabels: MockTierLabels;
}) {
  const { record } = row;
  const badgeVariant = record.rarity === "5" ? "r5" : record.rarity === "4" ? "r4" : "r3";
  const badgeLabel = record.rarity === "5" ? tierLabels.top : record.rarity === "4" ? tierLabels.second : tierLabels.third;

  return (
    <TableRow className={cn(record.rarity === "5" && "bg-rarity-5/8 hover:bg-rarity-5/14")}>
      <TableCell className="font-mono tabular-nums">{formatDateTime(record.occurredAt)}</TableCell>
      <TableCell>{record.itemId}</TableCell>
      <TableCell>{record.itemType}</TableCell>
      <TableCell>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </TableCell>
      <TableCell>{row.bannerDisplayName}</TableCell>
      <TableCell className="font-mono tabular-nums">{row.pityDisplay}</TableCell>
    </TableRow>
  );
}
