"use client";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";

export type AccountStats = {
  total?: number | null;
  count7d?: number;
  count30d?: number;
  // Mutually exclusive lifecycle counts, for the Overview cards.
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
type AssetTotals = { usd?: number | null };

export const STATS_KEY = "/api/accounts/stats";
const ASSETS_KEY = "/api/accounts/asset-totals";

/**
 * Re-read both aggregates. What comes back is the Guardian's current published
 * aggregate, which it refreshes on its own cadence (`asOf` says when). Forcing
 * an out-of-cycle refresh needs the `stats:refresh` permission granted per
 * Guardian, which we do not hold.
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

  const figures: [string, string | null][] = [
    ["Accounts", stats.total != null ? formatCount(stats.total) : null],
    ["Updated (last 7d)", stats.count7d != null ? formatCount(stats.count7d) : null],
    ["Updated (last 30d)", stats.count30d != null ? formatCount(stats.count30d) : null],
    ["Assets", assets?.usd != null ? `$${assets.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null],
  ];
  return (
    <div className="flex flex-wrap gap-8 text-sm">
      {figures.map(([label, value]) => value !== null && (
        <span key={label} className="text-muted-foreground">
          {label}&nbsp;&nbsp;<span className="font-semibold text-foreground">{value}</span>
        </span>
      ))}
    </div>
  );
}
