"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";

type AssetTotals = { usd7d?: number; computedAt?: string; warming?: boolean };

export function AssetsCard() {
  const { data, error } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: 60_000,
  });

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">Assets (7d active)</p>
        {!data && !error ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : data?.usd7d != null ? (
          <p className="text-stat text-foreground">
            ${data.usd7d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ) : data?.warming ? (
          // Says so rather than showing the same dash a dead node would. The
          // walk is paced against the node's rate limit, so on a cold start
          // this is minutes, not seconds.
          <p className="text-section text-muted-foreground" title="Walking the account inventory. This takes a few minutes after a restart.">
            Calculating…
          </p>
        ) : (
          <p
            className="text-stat text-muted-foreground"
            title={error ? "The guardian server did not answer." : "Not computed yet."}
          >
            —
          </p>
        )}
      </CardContent>
    </Card>
  );
}
