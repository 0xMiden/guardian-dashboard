"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardGlobalProposalEntry, PagedResult } from "@openzeppelin/guardian-operator-client";
import { fetcher } from "@/lib/utils";

type GlobalProposalsPage = PagedResult<DashboardGlobalProposalEntry> & { error?: string; available?: false };

export function GlobalProposals() {
  const router = useRouter();
  const { data, error } = useSWR<GlobalProposalsPage>("/api/global-proposals", fetcher, {
    refreshInterval: 30_000,
  });
  const [extraItems, setExtraItems] = useState<DashboardGlobalProposalEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const initialCursor = data?.nextCursor ?? null;

  const loadMore = useCallback(async () => {
    const cursor = nextCursor ?? initialCursor;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/global-proposals?cursor=${encodeURIComponent(cursor)}`);
      const page: GlobalProposalsPage = await res.json();
      setExtraItems((prev) => [...prev, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, initialCursor]);

  const items = [...(data?.items ?? []), ...extraItems];
  const hasMore = (nextCursor ?? initialCursor) !== null;

  if (!data && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  // Keep showing cached rows on a failed revalidation — SWR retries in the background
  if ((error && !data) || data?.available === false) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {data?.error ?? "Guardian node unavailable"}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No in-flight proposals.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Account ID</th>
                <th className="px-4 py-3 text-left font-medium">Nonce</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Signatures</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr
                  key={`${p.accountId}-${p.nonce}-${i}`}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => router.push(`/accounts/${encodeURIComponent(p.accountId)}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs">{p.accountId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.nonce}</td>
                  <td className="px-4 py-3 text-xs">{p.proposalType ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-amber-500 text-amber-500 text-xs">
                      {p.signaturesCollected}/{p.signaturesRequired}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(p.originatingTimestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
