"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronsUpDown, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { CopyableId } from "@/components/ui/CopyableId";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { AccountIdFilter } from "@/components/ui/AccountIdFilter";
import { FilterChip } from "@/components/ui/FilterChip";
import { Button } from "@/components/ui/Button";
import { Timestamp } from "@/components/ui/Timestamp";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { TableControls, useTablePrefs, CELL_PADDING, type TableColumn } from "@/components/ui/TableControls";
import { StatStrip, refreshStatStrip, STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";
import { fetcher } from "@/lib/utils";
import { isWalletAccount, matchesAccountId, looksLikeAccountId, accountState, accountsToCsv, formatCount } from "@/lib/format";

type AccountsPage = PagedResult<DashboardAccountSummary>;
type AccountKind = "all" | "wallet" | "other";
type SnapshotTarget = { accountId: string; updatedAt: string };
type SortKey = "status" | "signers" | "assets" | "created" | "updated";
type Sort = { key: SortKey; dir: "asc" | "desc" };
type ColumnKey = "index" | "id" | "status" | "type" | "signers" | "pending" | "assets" | "created" | "updated";

// The row number and the account id are what make a row identifiable, so they
// are not offered for hiding. Everything else is.
const HIDEABLE: readonly ColumnKey[] = ["status", "type", "signers", "pending", "assets", "created", "updated"];

// Coalescing window for rows scrolling into view.
const SNAPSHOT_BATCH_MS = 150;

// The node's documented maximum page size, the same figure the server-side
// inventory walk uses and verified there against every reachable node. A page
// costs one request whatever size it is, so leaving this to the node's 50-row
// default meant 29 round trips to scroll the 1,418-account node instead of 3.
// Asset totals are still fetched per visible row, so a larger page pulls no
// extra snapshots.
const PAGE_SIZE = 500;
export const ACCOUNTS_KEY = `/api/accounts?limit=${PAGE_SIZE}`;

// Frozen moved off orange: orange is the brand accent now, and a badge in it
// would read as something to click rather than a state the account is in.
const STATE_TONE: Record<string, string> = {
  released: "bg-state-released",
  frozen: "bg-state-frozen",
  active: "bg-state-active",
};

function statusBadge(status: string, pausedAt: string | null, releasedAt?: string | null) {
  const state = accountState(status, pausedAt, releasedAt);
  return <Badge className={`${STATE_TONE[state] ?? "bg-state-neutral"} text-white`}>{state}</Badge>;
}

// null sorts last in both directions: a row whose asset total was never fetched
// is unknown, and ordering it as zero would read as an empty account.
function sortValue(a: DashboardAccountSummary, key: SortKey, assets: Record<string, number>): string | number | null {
  switch (key) {
    case "status": return accountState(a.stateStatus, a.pausedAt, a.releasedAt);
    case "signers": return a.authorizedSignerCount;
    case "assets": return assets[a.accountId] ?? null;
    case "created": return new Date(a.createdAt).getTime();
    case "updated": return new Date(a.updatedAt).getTime();
  }
}

// ponytail: sorts the rows already paged in, the same ceiling the filters above
// carry. `ListAccountsOptions` is limit/cursor/paused with no ordering, so a
// full-inventory sort would mean paging the whole node first. Upgrade path is an
// order parameter on the node's list endpoints.
function sortAccounts(items: DashboardAccountSummary[], sort: Sort, assets: Record<string, number>) {
  return [...items].sort((a, b) => {
    const av = sortValue(a, sort.key, assets);
    const bv = sortValue(b, sort.key, assets);
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

function SortableHeader({
  label, sortKey, sort, onSort, align = "left", padding = "px-4 py-3",
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  padding?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={`${padding} text-label ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-lg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active
          ? (sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

type Column = TableColumn<DashboardAccountSummary, ColumnKey> & { sortKey?: SortKey };

export function AccountsPanel() {
  const { data, error, mutate: revalidate } = useSWR<AccountsPage>(ACCOUNTS_KEY, fetcher, { refreshInterval: 30_000 });
  // Same key StatStrip already polls, so SWR serves both from one request.
  const { data: stats } = useSWR<AccountStats>(STATS_KEY, fetcher);
  const router = useRouter();
  const [perAccount, setPerAccount] = useState<Record<string, number>>({});
  // Which rows have a request out right now. One global "loading" flag put a
  // spinner on every row without a value, including rows that were never
  // requested and rows whose fetch had already failed.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [extraItems, setExtraItems] = useState<DashboardAccountSummary[]>([]);
  // undefined = haven't paginated yet (fall through to initialCursor)
  // null      = last page loaded, no more pages
  // string    = cursor for the next page
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kind, setKind] = useState<AccountKind>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // null is the node's own order. Clicking a header cycles desc, asc, back to
  // null, so there is a way back to the order the rows arrived in.
  const [sort, setSort] = useState<Sort | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { density, hidden, setDensity, toggleColumn } = useTablePrefs<ColumnKey>("accounts", HIDEABLE);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  }, []);

  const initialCursor = data?.nextCursor ?? null;
  // undefined → haven't paginated yet, check initialCursor from SWR
  // null      → exhausted all pages
  // string    → more pages available
  const hasMore = nextCursor === undefined ? initialCursor !== null : nextCursor !== null;

  const loaded = [...(data?.items ?? []), ...extraItems];
  const walletCount = loaded.filter(isWalletAccount).length;
  const filtered = loaded.filter(
    (a) =>
      (kind === "all" || isWalletAccount(a) === (kind === "wallet")) &&
      matchesAccountId(query, a.accountId, a.accountIdBech32),
  );
  // The ids the table will actually mount. The row observer keys off this, so
  // it tracks the rendered set rather than a hand-kept list of the state that
  // affects it. Sort is deliberately not folded in: it reorders keyed rows
  // without unmounting any, so the observer keeps watching the same elements.
  const renderedKey = filtered.map((a) => a.accountId).join(",");

  // The node has no batch read, so one row's asset total is one request to it.
  // Rows carry `updatedAt` so the server can skip accounts that provably have
  // not changed since it last looked.
  const fetchSnapshots = useCallback(async (rows: SnapshotTarget[], refresh = false) => {
    if (!rows.length) return;
    const ids = rows.map((r) => r.accountId);
    setInFlight((prev) => new Set([...prev, ...ids]));
    try {
      const query = rows.map((r) => encodeURIComponent(`${r.accountId}@${r.updatedAt}`)).join(",");
      const res = await fetch(`/api/accounts/snapshots?ids=${query}${refresh ? "&refresh=1" : ""}`);
      if (!res.ok) throw new Error(`snapshots ${res.status}`);
      const data: Record<string, number> = await res.json();
      setPerAccount((prev) => ({ ...prev, ...data }));
    } catch {
      // snapshots are best-effort — leave column as "—" on failure
    } finally {
      // Only this batch's rows: another batch may still be out.
      setInFlight((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor !== undefined ? nextCursor : initialCursor;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`${ACCOUNTS_KEY}&cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) return; // keep cursor untouched so the next attempt can retry
      const page: AccountsPage = await res.json();
      const newItems = page.items ?? [];
      setExtraItems((prev) => [...prev, ...newItems]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      // network error — leave cursor untouched so the next attempt can retry
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, initialCursor]);

  const fetchSnapshotsRef = useRef(fetchSnapshots);
  useEffect(() => { fetchSnapshotsRef.current = fetchSnapshots; }, [fetchSnapshots]);

  // Asset totals are fetched for rows the user can actually see. Loading a
  // 100-row page used to cost 100 node requests up front; a viewport holds
  // roughly 15. Rows are registered by the observer below and drained on a
  // short timer so a fast scroll coalesces into one request instead of many.
  const pendingRef = useRef(new Map<string, string>());
  const requestedRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which rows are on screen right now. Refresh reads this so it recomputes
  // what the user is looking at rather than every row they have ever scrolled
  // past, which on a long session is hundreds of requests.
  const visibleRef = useRef(new Set<string>());

  const queueSnapshot = useCallback((accountId: string, updatedAt: string) => {
    const key = `${accountId}@${updatedAt}`;
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    pendingRef.current.set(accountId, updatedAt);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const rows = [...pendingRef.current].map(([accountId, updatedAt]) => ({ accountId, updatedAt }));
      pendingRef.current.clear();
      fetchSnapshotsRef.current(rows);
    }, SNAPSHOT_BATCH_MS);
  }, []);

  useEffect(() => () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); }, []);

  // Refresh is scoped to the rows on screen plus the aggregates. A full
  // recompute cannot fit in one click: ~470 active accounts against a budget of
  // 60 requests a minute is minutes of paced fetching, and attempting it as a
  // burst is what earns the 429s that leave the page with no numbers at all.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // The account list comes first and the rest waits for it: a row's
      // `updatedAt` is its cache key, so asking for totals before the new
      // versions land would just re-read what is already on screen. A failed
      // revalidation falls back to the rendered rows, which still works because
      // `refresh=1` re-reads them whatever their version says.
      const page = await mutate<AccountsPage>(ACCOUNTS_KEY);
      const rows = [...(page?.items ?? data?.items ?? []), ...extraItems]
        .filter((a) => visibleRef.current.has(a.accountId))
        .map((a) => ({ accountId: a.accountId, updatedAt: a.updatedAt }));
      // Let the observer re-queue these once the new versions are rendered.
      for (const r of rows) requestedRef.current.delete(`${r.accountId}@${r.updatedAt}`);
      await Promise.all([refreshStatStrip(), fetchSnapshotsRef.current(rows, true)]);
    } finally {
      setRefreshing(false);
    }
  }, [data, extraItems]);

  // Keep a stable ref to loadMore so the observer never needs to be rebuilt on cursor changes
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // Infinite scroll — rebuilt only when the sentinel appears/disappears (hasMore flips)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    let busy = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !busy) {
          busy = true;
          loadMoreRef.current().finally(() => { busy = false; });
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  // A row entering view queues its asset total. Rows stay observed rather than
  // being unobserved after first sight: the queue key includes `updatedAt`, so
  // an account that changes re-queues on its own the next time it is on screen.
  //
  // Rebuilt whenever the rendered row set changes, keyed off the rows
  // themselves. The dependency list used to name the state that affects them,
  // which meant the chip filter was covered and the search box was not: typing
  // in it swapped the mounted rows while the observer went on watching detached
  // ones, and totals never loaded for what was actually on screen.
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return; // jsdom, older browsers
    const root = tbodyRef.current;
    if (!root) return;
    visibleRef.current.clear(); // the rendered rows changed; the observer refills it
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const { accountId, updatedAt } = (entry.target as HTMLElement).dataset;
          if (!accountId) continue;
          if (!entry.isIntersecting) { visibleRef.current.delete(accountId); continue; }
          visibleRef.current.add(accountId);
          if (updatedAt) queueSnapshot(accountId, updatedAt);
        }
      },
      { rootMargin: "150px" }
    );
    root.querySelectorAll("tr[data-account-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [renderedKey, queueSnapshot]);

  if (!data && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  // Keep showing cached rows on a failed revalidation — SWR retries in the background
  if (error && !data) {
    return (
      <div className="rounded-lg border border-dashed">
        <ErrorPanel error={error} onRetry={() => revalidate()} />
      </div>
    );
  }

  const items = sort ? sortAccounts(filtered, sort, perAccount) : filtered;

  // The chips count what the node holds, from the same paged walk that feeds
  // the stat strip above, so they no longer read as a total while showing one
  // page. Until that answers, they fall back to the loaded rows, which is what
  // they always were. The filters themselves still act on loaded rows, hence
  // the "of" line beside them.
  const counts = stats?.counted != null
    ? { all: stats.counted, wallet: stats.wallet ?? 0, other: stats.other ?? 0 }
    : { all: loaded.length, wallet: walletCount, other: loaded.length - walletCount };

  // Exports exactly what the table shows: same filter, same sort, same rows.
  // ponytail: loaded rows only, so an export after scrolling three pages holds
  // three pages. The empty state and the column ceilings say the same thing;
  // a whole-inventory export needs the node-side paging this panel avoids.
  function exportCsv() {
    posthog.capture("accounts_exported", { row_count: items.length, filter: kind, sorted: !!sort });
    const url = URL.createObjectURL(
      new Blob([accountsToCsv(items, perAccount)], { type: "text/csv;charset=utf-8" }),
    );
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `guardian-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    // In the document and revoked on the next tick: Safari ignores a click on a
    // detached anchor, and revoking in the same tick can cancel the download
    // before the browser has read the blob.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function openAccount(a: DashboardAccountSummary) {
    posthog.capture("account_clicked", {
      account_id: a.accountId,
      account_status: a.stateStatus,
      has_pending_candidate: a.hasPendingCandidate,
    });
  }

  // One definition per column drives the colgroup, the header and the cells, so
  // hiding a column cannot leave the three lists out of step. Built here rather
  // than at module scope because the cells read the asset totals and the
  // in-flight set, which change as rows scroll into view.
  const columns: Column[] = [
    {
      key: "index", label: "#", width: "w-12", align: "right",
      cellClass: "text-data text-muted-foreground tabular-nums",
      cell: (_a, i) => i + 1,
    },
    {
      key: "id", label: "Account ID", width: "w-52", cellClass: "text-data",
      cell: (a) => (
        <CopyableId
          id={a.accountIdBech32 ?? a.accountId}
          href={`/accounts/${a.accountId}`}
          onNavigate={() => openAccount(a)}
        />
      ),
    },
    {
      key: "status", label: "Status", width: "w-28", sortKey: "status", cellClass: "text-data",
      cell: (a) => statusBadge(a.stateStatus, a.pausedAt, a.releasedAt),
    },
    {
      key: "type", label: "Type", width: "w-24", cellClass: "text-data",
      cell: (a) => isWalletAccount(a) ? (
        <Badge variant="outline" className="text-muted-foreground" title="Inferred from auth shape (ECDSA, 2 signers)">
          wallet
        </Badge>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      key: "signers", label: "Signers", width: "w-20", align: "right", sortKey: "signers",
      cellClass: "text-data tabular-nums text-muted-foreground",
      cell: (a) => a.authorizedSignerCount,
    },
    {
      key: "pending", label: "Pending", width: "w-24", cellClass: "text-data",
      cell: (a) => a.hasPendingCandidate ? (
        <Badge variant="outline" className="border-state-pending text-state-pending">pending</Badge>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      // The number a row exists to show, so it outranks everything beside it.
      // It used to be 12px and dimmed, which put it below the signer count and
      // level with its own column header.
      key: "assets", label: "Total Assets", width: "w-32", align: "right", sortKey: "assets",
      cellClass: "text-figure",
      cell: (a) => perAccount[a.accountId] !== undefined
        ? <span className="tabular-nums text-foreground">${perAccount[a.accountId].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        : inFlight.has(a.accountId)
        ? <Skeleton className="ml-auto h-3 w-16" data-testid={`assets-loading-${a.accountId}`} />
        : <span className="text-muted-foreground" title="Not fetched yet. Totals load for rows as they scroll into view.">—</span>,
    },
    {
      key: "created", label: "Created", width: "w-40", sortKey: "created",
      cellClass: "text-data text-muted-foreground",
      cell: (a) => <Timestamp iso={a.createdAt} />,
    },
    {
      key: "updated", label: "Updated", width: "w-40", sortKey: "updated",
      cellClass: "text-data text-muted-foreground",
      cell: (a) => <Timestamp iso={a.updatedAt} />,
    },
  ];
  const shownColumns = columns.filter((c) => !hidden.has(c.key));
  const pad = CELL_PADDING[density];

  if (!loaded.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No accounts registered on this Guardian node yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StatStrip />
      {/* Search sits at the left edge, over the Account ID column it filters.
          Row-scoped controls stay on the left, table-scoped ones on the right. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AccountIdFilter value={query} onChange={setQuery} />
        {([
          ["all", `All (${counts.all.toLocaleString()})`],
          ["wallet", `Wallet (${counts.wallet.toLocaleString()})`],
          ["other", `Other (${counts.other.toLocaleString()})`],
        ] as const).map(([value, label]) => (
          <FilterChip key={value} active={kind === value} onClick={() => setKind(value)}>
            {label}
          </FilterChip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={exportCsv} disabled={!items.length} title="Download the rows currently shown as CSV" size="sm">
            <Download className="h-3 w-3" />
            Export CSV
          </Button>
          <TableControls
            density={density}
            onDensityChange={setDensity}
            columns={columns.filter((c) => HIDEABLE.includes(c.key))}
            hidden={hidden}
            onToggleColumn={toggleColumn}
          />
          <RefreshButton onClick={refresh} busy={refreshing} />
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {/* table-fixed + colgroup so the columns keep their widths when a
              filter changes which rows are mounted. Auto layout re-measured the
              content on every switch, and the whole table jumped. Same pattern
              as the Activity table. */}
          <table className="w-full table-fixed">
            <colgroup>
              {shownColumns.map((c) => <col key={c.key} className={c.width} />)}
            </colgroup>
            <thead>
              <tr className="border-b text-muted-foreground">
                {shownColumns.map((c) => c.sortKey ? (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    sortKey={c.sortKey}
                    sort={sort}
                    onSort={toggleSort}
                    align={c.align}
                    padding={pad}
                  />
                ) : (
                  <th key={c.key} className={`${pad} text-label ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {items.map((a, i) => (
                <tr
                  key={a.accountId}
                  data-account-id={a.accountId}
                  data-updated-at={a.updatedAt}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => { openAccount(a); router.push(`/accounts/${a.accountId}`); }}
                >
                  {shownColumns.map((c) => (
                    <td key={c.key} className={`${pad} ${c.align === "right" ? "text-right" : ""} ${c.cellClass}`}>
                      {c.cell(a, i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              <p>
                {query
                  ? `No account matching "${query.trim()}" among the ${loaded.length} loaded so far`
                  : `No ${kind} accounts among the ${loaded.length} loaded so far`}
                {hasMore ? ", keep scrolling to load more." : "."}
              </p>
              {/* The filter can only see rows that have been paged in. A full ID
                  needs no search endpoint to open, so offer that directly. */}
              {looksLikeAccountId(query) && (
                <Button onClick={() => router.push(`/accounts/${encodeURIComponent(query.trim())}`)} size="sm" className="mt-2">
                  Open this account directly
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {counts.all > loaded.length && (
        <p
          className="text-center text-label text-muted-foreground"
          title="Filters, sort and export cover the rows loaded so far."
        >
          Showing {formatCount(loaded.length)} of {formatCount(counts.all)}
        </p>
      )}
      {hasMore && (
        <>
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
