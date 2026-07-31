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
import { StatStrip, refreshStatStrip, STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";
import { fetcher } from "@/lib/utils";
import { isWalletAccount, matchesAccountId, looksLikeAccountId, accountState, accountsToCsv } from "@/lib/format";

type AccountsPage = PagedResult<DashboardAccountSummary>;
type AccountKind = "all" | "wallet" | "other";
type SnapshotTarget = { accountId: string; updatedAt: string };
type SortKey = "status" | "signers" | "assets" | "created" | "updated";
type Sort = { key: SortKey; dir: "asc" | "desc" };

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

const STATE_TONE: Record<string, string> = {
  released: "bg-purple-500",
  frozen: "bg-orange-500",
  active: "bg-emerald-500",
};

function statusBadge(status: string, pausedAt: string | null, releasedAt?: string | null) {
  const state = accountState(status, pausedAt, releasedAt);
  return <Badge className={`${STATE_TONE[state] ?? "bg-zinc-500"} text-white`}>{state}</Badge>;
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
  label, sortKey, sort, onSort, align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={`px-4 py-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active
          ? (sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

export function AccountsPanel() {
  const { data, error } = useSWR<AccountsPage>(ACCOUNTS_KEY, fetcher, { refreshInterval: 30_000 });
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

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  }, []);

  const initialCursor = data?.nextCursor ?? null;
  // undefined → haven't paginated yet, check initialCursor from SWR
  // null      → exhausted all pages
  // string    → more pages available
  const hasMore = nextCursor === undefined ? initialCursor !== null : nextCursor !== null;

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
  // Rebuild the observer when the rendered row set changes: a new page, or a
  // filter that swaps which rows are mounted.
  const rowCount = (data?.items?.length ?? 0) + extraItems.length;
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
  }, [rowCount, kind, queueSnapshot]);

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
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {error.message || "Guardian node unavailable"}
      </div>
    );
  }

  const loaded = [...(data?.items ?? []), ...extraItems];
  const walletCount = loaded.filter(isWalletAccount).length;
  const filtered = loaded.filter(
    (a) =>
      (kind === "all" || isWalletAccount(a) === (kind === "wallet")) &&
      matchesAccountId(query, a.accountId, a.accountIdBech32),
  );
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
          <button
            key={value}
            onClick={() => setKind(value)}
            aria-pressed={kind === value}
            className={`rounded-full border px-3 py-1 transition-colors ${
              kind === value ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        {/* Without this the chips look like they disagree with the table: the
            counts describe the node, the rows are one page of it. */}
        {counts.all > loaded.length && (
          <span
            className="text-muted-foreground"
            title="Filters, sort and export cover the rows loaded so far. Scroll to load more."
          >
            {loaded.length.toLocaleString()} loaded
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!items.length}
            title="Download the rows currently shown as CSV"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1 text-muted-foreground transition-colors hover:text-foreground hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            Export CSV
          </button>
          <RefreshButton onClick={refresh} busy={refreshing} />
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {/* table-fixed + colgroup so the columns keep their widths when a
              filter changes which rows are mounted. Auto layout re-measured the
              content on every switch, and the whole table jumped. Same pattern
              as the Activity table. */}
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-12" />
              <col className="w-52" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-32" />
              <col className="w-40" />
              <col className="w-40" />
            </colgroup>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-3 text-right font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Account ID</th>
                <SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <SortableHeader label="Signers" sortKey="signers" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-4 py-3 text-left font-medium">Pending</th>
                <SortableHeader label="Total Assets" sortKey="assets" sort={sort} onSort={toggleSort} align="right" />
                <SortableHeader label="Created" sortKey="created" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Updated" sortKey="updated" sort={sort} onSort={toggleSort} />
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
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-4 py-3">
                    <CopyableId
                      id={a.accountIdBech32 ?? a.accountId}
                      href={`/accounts/${a.accountId}`}
                      onNavigate={() => openAccount(a)}
                    />
                  </td>
                  <td className="px-4 py-3">{statusBadge(a.stateStatus, a.pausedAt, a.releasedAt)}</td>
                  <td className="px-4 py-3">
                    {isWalletAccount(a) ? (
                      <Badge variant="outline" className="border-sky-500 text-sky-500 text-xs" title="Inferred from auth shape (ECDSA, 2 signers)">
                        wallet
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.authorizedSignerCount}</td>
                  <td className="px-4 py-3">
                    {a.hasPendingCandidate ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-500 text-xs">
                        pending
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {perAccount[a.accountId] !== undefined
                      ? <span className="font-mono tabular-nums">${perAccount[a.accountId].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      : inFlight.has(a.accountId)
                      ? <Skeleton className="ml-auto h-3 w-16" data-testid={`assets-loading-${a.accountId}`} />
                      : <span className="text-muted-foreground" title="Not fetched yet. Totals load for rows as they scroll into view.">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(a.updatedAt).toLocaleString()}
                  </td>
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
                <button
                  onClick={() => router.push(`/accounts/${encodeURIComponent(query.trim())}`)}
                  className="mt-2 rounded-lg border border-zinc-700 px-3 py-1 transition-colors hover:text-foreground hover:border-zinc-500"
                >
                  Open this account directly
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
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
