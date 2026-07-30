"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { CopyableId } from "@/components/ui/CopyableId";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { AccountIdFilter } from "@/components/ui/AccountIdFilter";
import { StatStrip, refreshStatStrip } from "@/components/accounts/StatStrip";
import { fetcher } from "@/lib/utils";
import { isWalletAccount, matchesAccountId, looksLikeAccountId } from "@/lib/format";

type AccountsPage = PagedResult<DashboardAccountSummary>;
type AccountKind = "all" | "wallet" | "other";
type SnapshotTarget = { accountId: string; updatedAt: string };

// Coalescing window for rows scrolling into view.
const SNAPSHOT_BATCH_MS = 150;

// Released wins over paused: an account that moved to another guardian is
// terminal for this node, so an operator unpause can never bring it back.
function statusBadge(status: string, pausedAt: string | null, releasedAt?: string | null) {
  if (releasedAt) return <Badge className="bg-purple-500 text-white">released</Badge>;
  if (pausedAt) return <Badge className="bg-orange-500 text-white">paused</Badge>;
  if (status === "available") return <Badge className="bg-emerald-500 text-white">available</Badge>;
  return <Badge className="bg-zinc-500 text-white">{status}</Badge>;
}

export function AccountsPanel() {
  const { data, error } = useSWR<AccountsPage>("/api/accounts", fetcher, { refreshInterval: 30_000 });
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
  const sentinelRef = useRef<HTMLDivElement>(null);

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
      const res = await fetch(`/api/accounts?cursor=${encodeURIComponent(cursor)}`);
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
      const page = await mutate<AccountsPage>("/api/accounts");
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
  const items = loaded.filter(
    (a) =>
      (kind === "all" || isWalletAccount(a) === (kind === "wallet")) &&
      matchesAccountId(query, a.accountId, a.accountIdBech32),
  );

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
      {/* ponytail: filters the rows already loaded, so the counts track
          infinite scroll rather than the node's full inventory. The node has no
          filter parameter for this; upgrade path is a server-side one, which
          needs the client-attribution field proposed upstream. */}
      <div className="flex items-center gap-2 text-xs">
        {([
          ["all", `All (${loaded.length})`],
          ["wallet", `Wallet (${walletCount})`],
          ["other", `Other (${loaded.length - walletCount})`],
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
        <div className="ml-auto flex items-center gap-2">
          <AccountIdFilter value={query} onChange={setQuery} />
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
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Account ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Signers</th>
                <th className="px-4 py-3 text-left font-medium">Pending</th>
                <th className="px-4 py-3 text-left font-medium">Total Assets</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {items.map((a, i) => (
                <tr
                  key={a.accountId}
                  data-account-id={a.accountId}
                  data-updated-at={a.updatedAt}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    posthog.capture("account_clicked", {
                      account_id: a.accountId,
                      account_status: a.stateStatus,
                      has_pending_candidate: a.hasPendingCandidate,
                    });
                    router.push(`/accounts/${a.accountId}`);
                  }}
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-3">
                    <CopyableId id={a.accountIdBech32 ?? a.accountId} />
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
                  <td className="px-4 py-3">{a.authorizedSignerCount}</td>
                  <td className="px-4 py-3">
                    {a.hasPendingCandidate ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-500 text-xs">
                        pending
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {perAccount[a.accountId] !== undefined
                      ? <span className="font-mono">${perAccount[a.accountId].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      : inFlight.has(a.accountId)
                      ? <Skeleton className="h-3 w-16" data-testid={`assets-loading-${a.accountId}`} />
                      : <span className="text-muted-foreground">—</span>}
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
