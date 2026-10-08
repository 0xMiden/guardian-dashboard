"use client";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/utils";

export type AccountStats = {
  total?: number | null;
  count7d?: number;
  count30d?: number;
  // All from one `GET /dashboard/stats` request, so the Accounts table labels
  // its filters with what the Guardian holds rather than what it has paged in.
  counted?: number;
  wallet?: number;
  other?: number;
  // In the same aggregate, so Overview can answer "is anything frozen" without
  // a query of its own.
  active?: number;
  frozen?: number;
  released?: number;
  /** When the Guardian computed the aggregate these counts come from. */
  asOf?: string;
  /** The Guardian predates `GET /dashboard/stats`, which shipped in 0.18.0. */
  unsupported?: boolean;
  /** A 0.18.0 Guardian that has not published its first aggregate yet. */
  warming?: boolean;
};
type AssetTotals = { usd?: number | null; computedAt?: string | null };

export const STATS_KEY = "/api/accounts/stats";
const ASSETS_KEY = "/api/accounts/asset-totals";

/**
 * Re-read both aggregates.
 *
 * `?refresh=1` is gone with the walk it used to trigger: neither route holds an
 * answer of its own any more, so revalidating asks the Guardian directly. What
 * comes back is the Guardian's current published aggregate, which it refreshes
 * on its own cadence (`asOf` says when). Forcing an out-of-cycle server-side
 * walk is possible in 0.18.0 but needs the `stats:refresh` permission granted
 * per Guardian, which we do not hold.
 */
export async function refreshStatStrip(): Promise<void> {
  await Promise.all([mutate(STATS_KEY), mutate(ASSETS_KEY)]);
}

/**
 * Inventory summary for this Guardian. Shown above both the Accounts table
 * and the Activity feed: the same question ("how much is on this Guardian") comes up
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

  // Nothing to show, and two different reasons for it. Saying so beats an empty
  // row: on a 0.17.0 Guardian these numbers are not coming back until its
  // operator upgrades.
  if (stats.unsupported || stats.warming) {
    return (
      <p
        className="text-sm text-muted-foreground"
        title={
          stats.unsupported
            ? "This Guardian computes no cross-account aggregates. The endpoint the dashboard reads them from arrived in Guardian 0.18.0."
            : "The Guardian is still computing its first aggregate since starting up."
        }
      >
        {stats.unsupported ? "Needs Guardian 0.18.0" : "Calculating…"}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-8 text-sm">
      {stats.total != null && (
        <span className="text-muted-foreground">
          Accounts&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.total.toLocaleString()}</span>
        </span>
      )}
      {stats.count7d != null && (
        <span className="text-muted-foreground">
          Updated (last 7d)&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.count7d.toLocaleString()}</span>
        </span>
      )}
      {stats.count30d != null && (
        <span className="text-muted-foreground">
          Updated (last 30d)&nbsp;&nbsp;<span className="font-semibold text-foreground">{stats.count30d.toLocaleString()}</span>
        </span>
      )}
      {assets?.usd != null && (
        <span className="text-muted-foreground">
          Assets&nbsp;&nbsp;<span className="font-semibold text-foreground">${assets.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </span>
      )}
    </div>
  );
}
