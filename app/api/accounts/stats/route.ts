import { guardianRoute } from "@/lib/guardian-route";
import { readStats, walletCount } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

/**
 * Inventory summary for the Accounts table and the stat strip.
 *
 * Every count here used to come out of a full paged walk of the account list,
 * tallied in this route. The Guardian now maintains the same aggregates itself
 * and serves them in one request, so the walk is gone: see lib/dashboard-stats.ts
 * for what the server does when it cannot answer.
 *
 * `total` and `counted` are now the same number. They were different because
 * `total` came from `/dashboard/info` while `counted` was what our walk actually
 * paged in, and on a large Guardian the two could disagree. One aggregate
 * produces both, so they cannot.
 */
export function GET() {
  return guardianRoute(async (client) => {
    const outcome = await readStats(client);
    if (outcome.kind !== "ok") return { [outcome.kind]: true };

    const { accounts } = outcome.stats;
    const wallet = walletCount(outcome.stats);
    return {
      total: accounts.total,
      counted: accounts.total,
      count7d: accounts.updatedWithin7d,
      count30d: accounts.updatedWithin30d,
      wallet,
      other: accounts.total - wallet,
      // Mutually exclusive server-side, in the same order `accountState`
      // resolves them: released wins over paused.
      active: accounts.byLifecycle.active,
      frozen: accounts.byLifecycle.paused,
      released: accounts.byLifecycle.released,
      // When the server's walk ran. The aggregate is refreshed on a cadence, so
      // these numbers are minutes old by design rather than read live.
      asOf: outcome.stats.asOf,
    };
  });
}
