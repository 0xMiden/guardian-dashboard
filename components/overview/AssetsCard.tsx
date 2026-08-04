"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";

type AssetTotals = { usd7d?: number; computedAt?: string; warming?: boolean; done?: number; total?: number };

const SETTLED_POLL_MS = 60_000;
// A cold server publishes no total until it has walked every active account,
// and it only walks while someone asks. Polling a warming answer on the same
// 60s cadence as a settled one therefore stalls the walk at one pass a minute,
// which read as "Calculating…" forever: the card only ever finished because
// leaving the tab and coming back remounts it and forces an extra pass. How
// much each pass covers is the server's call, and it grows that per endpoint
// until the Guardian pushes back, so asking more often genuinely finishes sooner.
const WARMING_POLL_MS = 20_000;

export function AssetsCard() {
  const { data, error } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: (latest) => (latest?.warming ? WARMING_POLL_MS : SETTLED_POLL_MS),
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
          // Says so rather than showing the same dash a dead Guardian would. The
          // walk is paced against the Guardian's rate limit, so on a cold start
          // this is minutes, not seconds, which is why it counts out loud.
          <p className="text-section text-muted-foreground" title="Walking the account inventory. This takes a few minutes after a restart.">
            Calculating…
            {data.done != null && data.total != null && (
              <span className="ml-1 text-data">
                {data.done.toLocaleString()} of {data.total.toLocaleString()}
              </span>
            )}
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
