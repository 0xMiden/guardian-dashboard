"use client";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/utils";

type AccountStats = { total: number | null; count7d: number; count30d: number };
type AssetTotals = { usd7d?: number; computedAt?: string };

const STATS_KEY = "/api/accounts/stats";
const ASSETS_KEY = "/api/accounts/asset-totals";

/**
 * Recompute the strip from the node rather than from the route caches. Both
 * routes hold a 60s answer, so a plain revalidation would hand back the same
 * numbers; `refresh=1` re-walks the account list, which is what surfaces
 * accounts whose version moved.
 */
export async function refreshStatStrip(): Promise<void> {
  await Promise.all([
    fetch(`${STATS_KEY}?refresh=1`).then(() => mutate(STATS_KEY)),
    fetch(`${ASSETS_KEY}?refresh=1`).then(() => mutate(ASSETS_KEY)),
  ]);
}

/**
 * Inventory summary for this Guardian node. Shown above both the Accounts table
 * and the Activity feed: the same question ("how much is on this node") comes up
 * on either page, and both are already polling.
 *
 * The SWR keys are shared, so mounting this twice costs nothing extra.
 */
export function StatStrip() {
  const { data: stats } = useSWR<AccountStats>(STATS_KEY, fetcher);
  const { data: assets } = useSWR<AssetTotals>(ASSETS_KEY, fetcher, {
    refreshInterval: 60_000,
  });
  if (!stats) return null;

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
      {assets?.usd7d != null && (
        <span className="text-muted-foreground">
          Assets (7d)&nbsp;&nbsp;<span className="font-semibold text-foreground">${assets.usd7d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </span>
      )}
    </div>
  );
}
