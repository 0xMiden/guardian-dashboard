import { guardianRoute } from "@/lib/guardian-route";
import { readStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

/**
 * Inventory summary for the stat strip, the Overview lifecycle cards and the
 * Accounts "showing N of M" note, from the one aggregate the Guardian serves.
 * See lib/dashboard-stats.ts for what the server does when it cannot answer.
 */
export function GET() {
  return guardianRoute(async (client) => {
    const outcome = await readStats(client);
    if (outcome.kind !== "ok") return { [outcome.kind]: true };

    const { accounts } = outcome.stats;
    return {
      total: accounts.total,
      count7d: accounts.updatedWithin7d,
      count30d: accounts.updatedWithin30d,
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
