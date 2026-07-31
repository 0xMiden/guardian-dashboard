"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";

type AssetTotals = { usd7d?: number; computedAt?: string };

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
        ) : (
          // A dash where a figure belongs means one of two different things,
          // and an operator reading a total needs to know which. The card is
          // too small for a full ErrorPanel, so the distinction goes in the
          // tooltip rather than being dropped.
          <p
            className="text-stat text-muted-foreground"
            title={error ? "The guardian node did not answer." : "Not computed yet. Totals fill in as accounts are walked."}
          >
            —
          </p>
        )}
      </CardContent>
    </Card>
  );
}
