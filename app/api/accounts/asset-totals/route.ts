import { guardianRoute } from "@/lib/guardian-route";
import { readStats } from "@/lib/dashboard-stats";
import { normalizeAmount } from "@/lib/token-registry";

export const dynamic = "force-dynamic";

const MS_7D = 7 * 24 * 60 * 60 * 1000;

/**
 * Vault totals across the accounts active in the last 7 days.
 *
 * This was the expensive one: a paged walk to find the active set, then one
 * snapshot request per account, bounded by a 45-second deadline and retried
 * across invocations until a pass happened to cover everything. The Guardian
 * now sums the vaults itself; `updatedSince` applies the same 7-day window
 * server-side.
 *
 * The route-level cache that used to sit here is gone with it. It existed to
 * avoid paying for the walk twice within 60 seconds, and the aggregate it
 * guarded is already a snapshot the server refreshes on its own cadence, so
 * holding a copy of it here would only add a second layer of staleness.
 */
export function GET() {
  return guardianRoute(async (client) => {
    const outcome = await readStats(client, { updatedSince: new Date(Date.now() - MS_7D) });
    if (outcome.kind !== "ok") return { [outcome.kind]: true };

    const { assets, asOf } = outcome.stats;

    // Publishing a partial sum would show a confidently wrong number, which is
    // the bug the old `complete` flag existed to prevent. The server now states
    // it directly, and names the accounts it could not decode in `skipped`.
    // `covered`/`eligible` keep the progress line in AssetsCard meaningful.
    if (!assets.complete) {
      return { usd7d: null, computedAt: null, warming: true, done: assets.covered, total: assets.eligible };
    }

    return {
      // Fungible only, as before. `nonFungible` is a count per faucet, not an
      // amount, so it has nothing to contribute to a total.
      usd7d: assets.fungible.reduce((sum, f) => sum + normalizeAmount(f.faucetId, f.totalAmount), 0),
      // The server's walk time, not ours. Reporting `new Date()` here claimed
      // the number was current when it was up to a refresh interval old.
      computedAt: asOf,
    };
  });
}
