import { priceBook, type PriceBook } from "@/lib/prices";

/**
 * Vault totals for the account rows on screen, with a cache that is exact
 * rather than merely recent.
 *
 * Guardians have no batch read: one snapshot is one HTTP request, against a
 * budget that follows the operator's profile. The accounts table shows an asset
 * column, and `app/api/accounts/snapshots/route.ts` asks for the ~15 rows in
 * the viewport, 25 at most.
 *
 * Entries are keyed by `accountId@updatedAt`. An account whose `updated_at` has
 * not moved cannot have changed its vault, so a hit is a value the Guardian
 * itself says is still correct, not one that is merely young. A changed account
 * misses and is refetched immediately, which makes this fresher than a TTL
 * would be.
 *
 * What is cached is the vault itself, not its dollar value: the value moves
 * with the price feed every few minutes while the key stands still, so a
 * cached figure would freeze a price for as long as the account was quiet.
 * Pricing happens at read time through lib/prices.ts.
 *
 * This file used to also hold the aggregate machinery behind the stat strip and
 * the assets card: a paged walk of the whole inventory, a snapshot per 7-day
 * active account, a 45-second pass deadline, rate-limit detection and a
 * `complete` flag so a partial sum was never published. All of it existed
 * because the Guardian had no cross-account aggregate. `GET /dashboard/stats`
 * shipped in 0.18.0 and does it in one request, so that half is gone; see
 * lib/dashboard-stats.ts. What remains is per-account and has no server-side
 * equivalent.
 *
 * // ponytail: an in-process Map with a size cap, no new infrastructure. Known
 * // ceiling: Vercel runs many instances and each cold one starts empty, so the
 * // hit rate is worse than local testing suggests. Upgrade path is a shared
 * // store (Vercel KV) keyed identically, a drop-in replacement for the two
 * // functions below. Less pressing now that nothing here runs over the whole
 * // inventory.
 */

// Bounded so a long-lived instance cannot grow without limit. Oldest-first
// eviction; entries are cheap (a short list of faucet/amount pairs).
const MAX_SNAPSHOT_ENTRIES = 20_000;

// Measured 60/sec with zero 429s on a prod-profile Guardian. A paced Guardian is
// serialised by `reserveSlot` regardless, so this only speeds up the ones that
// can take it.
const WALK_CONCURRENCY = 10;

type Fungible = { faucetId: string; amount: string }[];

const snapshotCache = new Map<string, Fungible>();

/** Cache key for one account's vault value at a specific version. */
function snapshotKey(endpointId: string, accountId: string, updatedAt: string): string {
  return `${endpointId}|${accountId}@${updatedAt}`;
}

function rememberSnapshot(key: string, value: Fungible): void {
  if (snapshotCache.size >= MAX_SNAPSHOT_ENTRIES) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = snapshotCache.keys().next();
    if (!oldest.done) snapshotCache.delete(oldest.value);
  }
  snapshotCache.set(key, value);
}

/** Test seam. Not used by application code. */
export function __resetAccountCaches(): void {
  snapshotCache.clear();
}

export type SnapshotReader = {
  getAccountSnapshot(accountId: string): Promise<{ vault: { fungible: Fungible } }>;
  /** Present on the real client; 0 or absent when the Guardian is not being paced. */
  pacingIntervalMs?(): number;
};

/**
 * The dollar value of a vault: the sum of its priced holdings, 0 for an empty
 * vault, `null` for one holding only tokens nothing prices. The two are
 * different claims and the table shows them differently.
 */
function vaultValue(book: PriceBook, fungible: Fungible): number | null {
  let total = 0;
  let priced = false;
  for (const asset of fungible) {
    const value = book.usd(asset.faucetId, asset.amount);
    if (value === undefined) continue;
    total += value;
    priced = true;
  }
  return priced || fungible.length === 0 ? total : null;
}

/**
 * Vault values for the given accounts, fetching only those whose `updatedAt`
 * differs from what we already hold.
 *
 * A snapshot that fails is omitted from the result rather than cached as zero:
 * a wrong number is worse than a missing one, and the table renders an explicit
 * placeholder for a row it has no value for. `normalizeAmount` still throws on
 * a malformed amount (c7f5133) rather than silently corrupting a total.
 */
export async function getSnapshotTotals(
  client: SnapshotReader,
  endpointId: string,
  network: string,
  accounts: { accountId: string; updatedAt: string }[],
  { concurrency, refresh = false }: { concurrency?: number; refresh?: boolean } = {},
): Promise<Record<string, number | null>> {
  // A paced Guardian has its requests serialised by `reserveSlot`, so asking for
  // ten at once only queues ten slot reservations. On a Guardian mid-lockout
  // that means spending ~13s to collect ten 429s instead of one, which delays
  // the recovery it is supposed to protect.
  const batchSize = concurrency ?? (client.pacingIntervalMs?.() ? 1 : WALK_CONCURRENCY);
  const book = await priceBook(network);
  const result: Record<string, number | null> = {};
  const misses: { accountId: string; key: string | null }[] = [];

  for (const a of accounts) {
    // No version means no way to know when the value goes stale, so such a
    // row is neither read from nor written to the cache. `key: null` marks it.
    const key = a.updatedAt ? snapshotKey(endpointId, a.accountId, a.updatedAt) : null;
    const hit = key && !refresh ? snapshotCache.get(key) : undefined;
    if (hit !== undefined) result[a.accountId] = vaultValue(book, hit);
    else misses.push({ accountId: a.accountId, key });
  }

  for (let i = 0; i < misses.length; i += batchSize) {
    const batch = misses.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((m) => client.getAccountSnapshot(m.accountId)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status !== "fulfilled") continue;
      const { fungible } = r.value.vault;
      result[batch[j].accountId] = vaultValue(book, fungible);
      const key = batch[j].key;
      if (key) rememberSnapshot(key, fungible);
    }
  }

  return result;
}

/** How many of these accounts would hit the Guardian right now. Used by tests. */
export function countSnapshotMisses(
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
): number {
  return accounts.filter(
    (a) => !a.updatedAt || !snapshotCache.has(snapshotKey(endpointId, a.accountId, a.updatedAt)),
  ).length;
}
