"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { CopyableId } from "@/components/ui/CopyableId";
import { fetcher } from "@/lib/utils";

type AccountsPage = PagedResult<DashboardAccountSummary> & { error?: string; available?: false };
type AccountStats = { total: number | null; count7d: number; count30d: number; error?: string };
type AssetTotals = { usd7d?: number; computedAt?: string; error?: string };

function StatStrip() {
  const { data: stats } = useSWR<AccountStats>("/api/accounts/stats", fetcher);
  const { data: assets } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: 60_000,
  });
  if (!stats || stats.error) return null;

  return (
    <div className="flex flex-wrap gap-8 text-sm">
      {stats.total !== null && (
        <span className="text-muted-foreground">
          Total&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.total.toLocaleString()}</span>
        </span>
      )}
      <span className="text-muted-foreground">
        Updated (last 7d)&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.count7d.toLocaleString()}</span>
      </span>
      <span className="text-muted-foreground">
        Updated (last 30d)&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.count30d.toLocaleString()}</span>
      </span>
      {assets?.usd7d != null && !assets.error && (
        <span className="text-muted-foreground">
          Assets (7d)&nbsp;&nbsp;<span className="font-semibold text-foreground">${assets.usd7d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </span>
      )}
    </div>
  );
}

function statusBadge(status: string, pausedAt: string | null) {
  if (pausedAt) return <Badge className="bg-orange-500 text-white">paused</Badge>;
  if (status === "available") return <Badge className="bg-emerald-500 text-white">available</Badge>;
  return <Badge className="bg-zinc-500 text-white">{status}</Badge>;
}

export function AccountsPanel() {
  const { data, error } = useSWR<AccountsPage>("/api/accounts", fetcher, { refreshInterval: 30_000 });
  const router = useRouter();
  const [perAccount, setPerAccount] = useState<Record<string, number>>({});
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [extraItems, setExtraItems] = useState<DashboardAccountSummary[]>([]);
  // undefined = haven't paginated yet (fall through to initialCursor)
  // null      = last page loaded, no more pages
  // string    = cursor for the next page
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const initialCursor = data?.nextCursor ?? null;
  // undefined → haven't paginated yet, check initialCursor from SWR
  // null      → exhausted all pages
  // string    → more pages available
  const hasMore = nextCursor === undefined ? initialCursor !== null : nextCursor !== null;

  const fetchSnapshots = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setSnapshotsLoading(true);
    try {
      const res = await fetch(`/api/accounts/snapshots?ids=${ids.map(encodeURIComponent).join(",")}`);
      if (!res.ok) throw new Error(`snapshots ${res.status}`);
      const data: Record<string, number> = await res.json();
      setPerAccount((prev) => ({ ...prev, ...data }));
    } catch {
      // snapshots are best-effort — leave column as "—" on failure
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor !== undefined ? nextCursor : initialCursor;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/accounts?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(`accounts ${res.status}`);
      const page: AccountsPage = await res.json();
      const newItems = page.items ?? [];
      setExtraItems((prev) => [...prev, ...newItems]);
      setNextCursor(page.nextCursor ?? null);
      fetchSnapshots(newItems.map((a) => a.accountId));
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, initialCursor, fetchSnapshots]);

  // Fetch snapshots for the initial page once it arrives
  const fetchSnapshotsRef = useRef(fetchSnapshots);
  useEffect(() => { fetchSnapshotsRef.current = fetchSnapshots; }, [fetchSnapshots]);
  useEffect(() => {
    if (data?.items?.length) fetchSnapshotsRef.current(data.items.map((a) => a.accountId));
  }, [data]);

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

  if (!data && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (error || data?.available === false) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {data?.error ?? "Guardian node unavailable"}
      </div>
    );
  }

  const items = [...(data?.items ?? []), ...extraItems];

  if (!items.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No accounts registered on this Guardian node yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StatStrip />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Account ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Signers</th>
                <th className="px-4 py-3 text-left font-medium">Pending</th>
                <th className="px-4 py-3 text-left font-medium">Total Assets</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a, i) => (
                <tr
                  key={a.accountId}
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
                  <td className="px-4 py-3">{statusBadge(a.stateStatus, a.pausedAt)}</td>
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
                      : snapshotsLoading
                      ? <span className="text-muted-foreground">…</span>
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
