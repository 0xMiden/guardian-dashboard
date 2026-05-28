"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AssetTotals = {
  usd7d?: number;
  computedAt?: string;
  inProgress?: boolean;
  cached?: { usd7d: number } | null;
  error?: string;
};

export function AssetsCard() {
  const { data } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: 15_000,
  });

  const value = data?.usd7d ?? data?.cached?.usd7d;
  const computing = data?.inProgress && value == null;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">
          Assets (7d active){data?.inProgress && value != null && <span className="ml-1 text-zinc-500">(updating…)</span>}
        </p>
        {!data || computing ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <p className="text-3xl font-bold leading-none text-foreground">
            {value?.toLocaleString() ?? "—"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
