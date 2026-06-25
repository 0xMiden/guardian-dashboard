"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AssetTotals = { usd7d?: number; computedAt?: string; error?: string };

export function AssetsCard() {
  const { data } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: 60_000,
  });

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">Assets (7d active)</p>
        {!data ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <p className="text-3xl font-bold leading-none text-foreground">
            {data.usd7d != null ? `$${data.usd7d.toLocaleString()}` : "—"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
