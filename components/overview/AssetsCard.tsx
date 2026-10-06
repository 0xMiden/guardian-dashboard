"use client";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";

type AssetTotals = {
  usd7d?: number | null;
  computedAt?: string | null;
  /** The Guardian has not published its first aggregate since starting up. */
  warming?: boolean;
  /** The Guardian predates `GET /dashboard/stats`, which shipped in 0.18.0. */
  unsupported?: boolean;
  done?: number;
  total?: number;
};

export function AssetsCard() {
  // One request to the Guardian per poll, answered from an aggregate it
  // refreshes on its own cadence. This used to chase a walk, polling three
  // times faster while it was incomplete; there is no walk left to chase.
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
        ) : data?.unsupported ? (
          // Names the reason rather than showing the same dash a dead Guardian
          // would. Nothing here will change until this Guardian's operator
          // upgrades, so there is no progress to report.
          <p
            className="text-section text-muted-foreground"
            title="This Guardian computes no cross-account totals. The endpoint the dashboard reads them from arrived in Guardian 0.18.0."
          >
            Needs Guardian 0.18.0
          </p>
        ) : data?.warming ? (
          // A 0.18.0 Guardian that has not finished its first pass, or one whose
          // pass could not decode every vault. It says how far it got, and the
          // number climbing is the only evidence that waiting will end.
          <p
            className="text-section text-muted-foreground"
            title="The Guardian is still computing its first asset aggregate. This clears within one refresh interval."
          >
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
