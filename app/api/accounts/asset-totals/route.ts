import { guardianRoute } from "@/lib/guardian-route";
import { readStats } from "@/lib/dashboard-stats";
import { priceBook } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Dollar value of every vault on this Guardian.
 *
 * This was the expensive one: a paged walk to find the active set, then one
 * snapshot request per account, bounded by a 45-second deadline and retried
 * across invocations until a pass happened to cover everything. The Guardian
 * now sums the vaults itself. No `updatedSince` window: the Overview reads all
 * time, like its other figures.
 *
 * The route-level cache that used to sit here is gone with it. It existed to
 * avoid paying for the walk twice within 60 seconds, and the aggregate it
 * guarded is already a snapshot the server refreshes on its own cadence, so
 * holding a copy of it here would only add a second layer of staleness.
 *
 * Pricing follows the Miden wallet (see lib/prices.ts): a faucet the verified
 * lists do not name has no dollar value, so it is counted in `unpriced` rather
 * than folded into the sum at some invented rate.
 */
export function GET() {
  return guardianRoute(async (client, endpoint) => {
    const outcome = await readStats(client);
    if (outcome.kind !== "ok") return { [outcome.kind]: true };

    const { assets, asOf } = outcome.stats;

    // Publishing a partial sum would show a confidently wrong number, which is
    // the bug the old `complete` flag existed to prevent. The server now states
    // it directly, and names the accounts it could not decode in `skipped`.
    // `covered`/`eligible` keep the progress line in AssetsCard meaningful.
    if (!assets.complete) {
      return { usd: null, computedAt: null, warming: true, done: assets.covered, total: assets.eligible };
    }

    const book = await priceBook(endpoint.network);
    let usd = 0;
    let priced = 0;
    let unpriced = 0;
    // Fungible only, as before. `nonFungible` is a count per faucet, not an
    // amount, so it has nothing to contribute to a total.
    for (const f of assets.fungible) {
      const value = book.usd(f.faucetId, f.totalAmount);
      if (value === undefined) unpriced++;
      else {
        priced++;
        usd += value;
      }
    }

    return {
      // Null when every held faucet is unpriced: a zero would claim the
      // Guardian holds nothing. An empty fleet is a genuine zero.
      usd: priced > 0 || unpriced === 0 ? usd : null,
      // The server's walk time, not ours. Reporting `new Date()` here claimed
      // the number was current when it was up to a refresh interval old.
      computedAt: asOf,
      priced,
      unpriced,
    };
  });
}
