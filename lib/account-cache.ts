import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import { normalizeAmount } from "@/lib/token-registry";

/**
 * Request-reduction layer shared by the account routes.
 *
 * The node rate-limits per client IP at 60 requests/minute across all routes,
 * and it has no batch read: one snapshot is one HTTP request. Rendering the
 * accounts page used to cost ~576 requests against that budget, because
 * `stats` and `asset-totals` each paged the whole inventory and then fetched a
 * snapshot per active account, every time.
 *
 * Two caches fix that WITHOUT trading freshness away, which matters because
 * the asset TTL was deliberately cut from 5 min to 60s (566be23) after users
 * saw stale numbers:
 *
 *   - inventory: one paged walk of the account list, reused by both routes
 *     within the same TTL that already governed asset totals.
 *   - snapshots: keyed by `accountId@updatedAt`. An account whose `updated_at`
 *     has not moved cannot have changed its vault, so its cached value is
 *     exact rather than merely recent. A changed account misses the cache and
 *     is refetched immediately, so this is *fresher* than a plain TTL.
 *
 * Both are per-serverless-instance. A cold instance recomputes from scratch,
 * which is the pre-existing behaviour.
 *
 * // ponytail: in-process Maps with a size cap, no new infrastructure. Known
 * // ceiling: Vercel runs many instances and each cold one pays full price, so
 * // the cache hit rate is worse than it looks in local testing. Upgrade path
 * // is a shared store (Vercel KV) keyed identically, which is a drop-in
 * // replacement for these two functions.
 */

export const INVENTORY_TTL_MS = 60 * 1000;

// A Refresh click hits stats and asset-totals within milliseconds of each
// other, and both need the account list. `refresh` therefore means "a much
// shorter TTL" rather than "no cache": the click still gets a walk the node
// answered moments ago, and pays for it once instead of twice.
const REFRESH_TTL_MS = 2 * 1000;

// The node's documented maximum page size. Every page is one request against
// the same 60/minute budget, so the walk costs 4 requests on the 1,573-account
// OZ node instead of 16. Verified against all four reachable nodes: they return
// a full 500 items (OZ in ~750ms).
const PAGE_SIZE = 500;

// Bounded so a long-lived instance cannot grow without limit. Oldest-first
// eviction; entries are cheap (a number keyed by a short string).
const MAX_SNAPSHOT_ENTRIES = 20_000;

// `maxAgeMs` is recorded because callers walk to different depths: asset
// totals only needs 7 days, stats needs 30. A shallower walk MUST NOT satisfy
// a deeper request, or the 30-day count silently loses every account between
// the two windows.
type Inventory = { accounts: DashboardAccountSummary[]; computedAt: number; maxAgeMs: number };

const inventoryCache = new Map<string, Inventory>();
const snapshotCache = new Map<string, number>();

/** Cache key for one account's vault value at a specific version. */
export function snapshotKey(endpointId: string, accountId: string, updatedAt: string): string {
  return `${endpointId}|${accountId}@${updatedAt}`;
}

function rememberSnapshot(key: string, value: number): void {
  if (snapshotCache.size >= MAX_SNAPSHOT_ENTRIES) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = snapshotCache.keys().next();
    if (!oldest.done) snapshotCache.delete(oldest.value);
  }
  snapshotCache.set(key, value);
}

/** Test seam. Not used by application code. */
export function __resetAccountCaches(): void {
  inventoryCache.clear();
  snapshotCache.clear();
}

export type AccountLister = {
  listAccounts(options?: { limit?: number; cursor?: string }): Promise<PagedResult<DashboardAccountSummary>>;
};

export type SnapshotReader = {
  getAccountSnapshot(accountId: string): Promise<{ vault: { fungible: { faucetId: string; amount: string }[] } }>;
};

/**
 * Page the account list once and share it. `maxAgeMs` bounds how far back the
 * walk goes: entries are ordered newest-updated first, so the walk stops as
 * soon as it passes the window both callers care about.
 */
export async function getInventory(
  client: AccountLister,
  endpointId: string,
  maxAgeMs: number,
  now: number,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<DashboardAccountSummary[]> {
  const ttl = refresh ? REFRESH_TTL_MS : INVENTORY_TTL_MS;
  const cached = inventoryCache.get(endpointId);
  if (cached && now - cached.computedAt < ttl && cached.maxAgeMs >= maxAgeMs) {
    return cached.accounts;
  }

  const accounts: DashboardAccountSummary[] = [];
  let cursor: string | undefined;
  while (true) {
    const page: PagedResult<DashboardAccountSummary> = await client.listAccounts({ limit: PAGE_SIZE, cursor });
    if (!page.items.length) break;
    accounts.push(...page.items);

    const oldest = new Date(page.items[page.items.length - 1].updatedAt).getTime();
    if (now - oldest > maxAgeMs || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // Keep the deeper of the two walks so a 7-day caller cannot shrink the
  // entry a 30-day caller is relying on.
  const previous = inventoryCache.get(endpointId);
  const keepDeeper = previous && previous.maxAgeMs > maxAgeMs && now - previous.computedAt < ttl;
  if (!keepDeeper) inventoryCache.set(endpointId, { accounts, computedAt: now, maxAgeMs });
  return accounts;
}

/**
 * Vault totals for the given accounts, fetching only those whose `updatedAt`
 * differs from what we already hold.
 *
 * A snapshot that fails is omitted from the result rather than cached as zero:
 * a wrong number is worse than a missing one, and the caller renders an
 * explicit placeholder. `normalizeAmount` still throws on malformed amounts
 * (c7f5133) rather than silently corrupting a total.
 */
export async function getSnapshotTotals(
  client: SnapshotReader,
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
  options: { concurrency?: number; refresh?: boolean; maxFetches?: number } = {},
): Promise<Record<string, number>> {
  return (await collectSnapshotTotals(client, endpointId, accounts, options)).totals;
}

async function collectSnapshotTotals(
  client: SnapshotReader,
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
  {
    concurrency = 5,
    refresh = false,
    maxFetches = Infinity,
  }: { concurrency?: number; refresh?: boolean; maxFetches?: number } = {},
): Promise<{ totals: Record<string, number>; skipped: number }> {
  const result: Record<string, number> = {};
  const misses: { accountId: string; key: string | null }[] = [];

  for (const a of accounts) {
    // No version means no way to know when the value goes stale, so such a
    // row is neither read from nor written to the cache. `key: null` marks it.
    const key = a.updatedAt ? snapshotKey(endpointId, a.accountId, a.updatedAt) : null;
    const hit = key && !refresh ? snapshotCache.get(key) : undefined;
    if (hit !== undefined) result[a.accountId] = hit;
    else misses.push({ accountId: a.accountId, key });
  }

  // A cold instance would otherwise fetch every miss in one burst, which on a
  // large node is thousands of requests against a 60/minute budget. Capping
  // the pass keeps each invocation inside the budget; the caller checks
  // `complete` on the result and declines to publish a partial aggregate.
  const budgeted = misses.slice(0, maxFetches);

  for (let i = 0; i < budgeted.length; i += concurrency) {
    const batch = budgeted.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((m) => client.getAccountSnapshot(m.accountId)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status !== "fulfilled") continue;
      const total = r.value.vault.fungible.reduce(
        (sum, asset) => sum + normalizeAmount(asset.faucetId, asset.amount),
        0,
      );
      result[batch[j].accountId] = total;
      const key = batch[j].key;
      if (key) rememberSnapshot(key, total);
    }
  }

  return { totals: result, skipped: misses.length - budgeted.length };
}

/**
 * Same as {@link getSnapshotTotals}, but reports whether every account was
 * *attempted*. Callers computing an aggregate must not publish a sum when
 * `complete` is false, because accounts were deliberately left unread and the
 * total would be confidently wrong.
 *
 * An account the node refused (unavailable state, EVM account with no Miden
 * vault) counts as attempted. Treating those as incomplete would let one
 * permanently failing account block the aggregate forever, which is worse than
 * the pre-existing behaviour of omitting it.
 */
export async function getSnapshotTotalsChecked(
  client: SnapshotReader,
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
  options: { concurrency?: number; refresh?: boolean; maxFetches?: number } = {},
): Promise<{ totals: Record<string, number>; complete: boolean }> {
  const { totals, skipped } = await collectSnapshotTotals(client, endpointId, accounts, options);
  return { totals, complete: skipped === 0 };
}

/** How many of these accounts would hit the node right now. Used by tests and the request-count harness. */
export function countSnapshotMisses(
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
): number {
  return accounts.filter(
    (a) => !a.updatedAt || !snapshotCache.has(snapshotKey(endpointId, a.accountId, a.updatedAt)),
  ).length;
}
