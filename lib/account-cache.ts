import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import { normalizeAmount } from "@/lib/token-registry";

/**
 * Request-reduction layer shared by the account routes.
 *
 * Guardians rate-limit per operator commitment and have no batch read: one snapshot
 * is one HTTP request. Rendering the accounts page used to cost ~576 requests,
 * because `stats` and `asset-totals` each paged the whole inventory and then
 * fetched a snapshot per active account, every time.
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
// shorter TTL" rather than "no cache": the click still gets a walk the Guardian
// answered moments ago, and pays for it once instead of twice.
const REFRESH_TTL_MS = 2 * 1000;

// The Guardian's documented maximum page size. Every page is one request against
// the same budget, so the walk costs 4 requests on the 1,573-account OZ Guardian
// instead of 16. Verified against all four reachable Guardians: they return a full
// 500 items (OZ in ~750ms).
const PAGE_SIZE = 500;

// Bounded so a long-lived instance cannot grow without limit. Oldest-first
// eviction; entries are cheap (a number keyed by a short string).
const MAX_SNAPSHOT_ENTRIES = 20_000;

/**
 * How long one pass may spend reading snapshots.
 *
 * A pass used to be bounded by a *count* that ramped 25, 50, 100, 200, 400 as
 * the Guardian stayed quiet. That needed six consecutive passes on the same
 * serverless instance to cover the OZ Guardian, and the caches below are
 * per-instance module state, so a poll landing elsewhere restarted at 25 with
 * nothing cached. It could take many minutes to converge, or not converge.
 *
 * A deadline is both simpler and faster, because the whole walk fits in one
 * invocation. Measured 2026-08-04 against the OZ Guardian at concurrency 10:
 *
 *   inventory   3 pages, 1,073 accounts active in 7d, 1.0s
 *   snapshots   1,073 ok, zero 429s, 18.0s (60/sec)
 *   total       19.1s, 1,076 requests against a 5000/min budget
 *
 * 45s leaves ~2x headroom over that and stays well inside the route's
 * `maxDuration = 120`. On a rate-limited Guardian the pacer in
 * lib/guardian-client.ts spaces requests out, so the same deadline simply
 * yields fewer reads and the caller keeps serving the last complete answer.
 */
const PASS_DEADLINE_MS = 45_000;

// Measured 60/sec with zero 429s on a prod-profile Guardian. A paced Guardian is
// serialised by `reserveSlot` regardless, so this only speeds up the ones that
// can take it.
const WALK_CONCURRENCY = 10;

/**
 * Did this account go unread, or did the Guardian refuse it for good?
 *
 * The Guardian mostly answers this itself, through `meta.retryable` on the
 * error envelope. A 429 carries it, and so does `account_data_unavailable`:
 * "This account's data is temporarily unavailable. Please try again." Measured
 * on the gateway.fm Guardian 2026-08-05, that 503 accounted for 32 of 60 reads
 * at concurrency 10. Counting those as attempted would publish an asset total
 * silently missing half the accounts, which is the same class of bug the 429
 * handling already exists to prevent.
 *
 * The flag cannot be relied on alone: the client types it as "absent for every
 * other code", so the status is the fallback. 5xx is the Guardian failing to
 * answer, 4xx is the Guardian declining to. A refusal counts as attempted, or
 * one permanently broken account (unavailable state, EVM account with no Miden
 * vault) would block the aggregate forever.
 */
function isUnread(err: unknown): boolean {
  // No HTTP answer at all: a network or decode failure. We did not read it.
  if (!(err instanceof GuardianOperatorHttpError)) return true;
  if (err.data?.retryable === true) return true;
  if (err.data?.retryable === false) return false;
  return err.status === 429 || err.status >= 500;
}

/**
 * Only a rate limit ends the pass. A single account being temporarily
 * unavailable says nothing about the next one, and on the Guardian above most
 * of the batch still succeeded.
 */
function isRateLimited(err: unknown): boolean {
  return err instanceof GuardianOperatorHttpError && err.status === 429;
}

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
  /** Present on the real client; 0 or absent when the Guardian is not being paced. */
  pacingIntervalMs?(): number;
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
  options: { concurrency?: number; refresh?: boolean; maxFetches?: number; deadlineMs?: number } = {},
): Promise<Record<string, number>> {
  return (await collectSnapshotTotals(client, endpointId, accounts, options)).totals;
}

async function collectSnapshotTotals(
  client: SnapshotReader,
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
  {
    concurrency,
    refresh = false,
    maxFetches,
    deadlineMs = PASS_DEADLINE_MS,
  }: { concurrency?: number; refresh?: boolean; maxFetches?: number; deadlineMs?: number } = {},
): Promise<{ totals: Record<string, number>; skipped: number }> {
  // A paced Guardian has its requests serialised by `reserveSlot`, so asking for
  // ten at once only queues ten slot reservations. On a Guardian mid-lockout
  // that means spending ~13s to collect ten 429s instead of one, which delays
  // the recovery it is supposed to protect.
  const batchSize = concurrency ?? (client.pacingIntervalMs?.() ? 1 : WALK_CONCURRENCY);
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

  // Read everything outstanding. The pass ends early only on the deadline or on
  // a 429; the caller checks `complete` and declines to publish a partial
  // aggregate. `maxFetches` stays available for callers with their own budget.
  const budgeted = maxFetches === undefined ? misses : misses.slice(0, maxFetches);

  // Accounts a 429 or the deadline cost us. They were not refused, so they must
  // not count as attempted, or the caller publishes a sum quietly missing them.
  let unread = 0;
  let rateLimited = false;
  let outOfTime = false;
  const startedAt = Date.now();

  for (let i = 0; i < budgeted.length && !rateLimited && !outOfTime; i += batchSize) {
    const batch = budgeted.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((m) => client.getAccountSnapshot(m.accountId)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status !== "fulfilled") {
        if (isUnread(r.reason)) unread++;
        if (isRateLimited(r.reason)) rateLimited = true;
        continue;
      }
      const total = r.value.vault.fungible.reduce(
        (sum, asset) => sum + normalizeAmount(asset.faucetId, asset.amount),
        0,
      );
      result[batch[j].accountId] = total;
      const key = batch[j].key;
      if (key) rememberSnapshot(key, total);
    }
    // Once the Guardian is limiting, the rest of this pass would only collect
    // more 429s. Out of time, the invocation has to end. Either way the
    // remainder is unread and the next pass resumes from the snapshot cache.
    if (!rateLimited && Date.now() - startedAt >= deadlineMs) outOfTime = true;
    if (rateLimited || outOfTime) unread += budgeted.length - (i + batch.length);
  }

  return { totals: result, skipped: misses.length - budgeted.length + unread };
}

/**
 * Same as {@link getSnapshotTotals}, but reports whether every account was
 * *attempted*. Callers computing an aggregate must not publish a sum when
 * `complete` is false, because accounts were deliberately left unread and the
 * total would be confidently wrong.
 *
 * An account the Guardian refused (unavailable state, EVM account with no Miden
 * vault) counts as attempted. Treating those as incomplete would let one
 * permanently failing account block the aggregate forever, which is worse than
 * the pre-existing behaviour of omitting it.
 *
 * A 429 is the exception: it is the Guardian asking us to slow down, not refusing
 * the account, so it reports incomplete and the pass is retried later. Counting
 * it as attempted let a rate-limited Guardian publish a sum that was silently
 * missing accounts.
 */
export async function getSnapshotTotalsChecked(
  client: SnapshotReader,
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
  options: { concurrency?: number; refresh?: boolean; maxFetches?: number; deadlineMs?: number } = {},
): Promise<{ totals: Record<string, number>; complete: boolean }> {
  const { totals, skipped } = await collectSnapshotTotals(client, endpointId, accounts, options);
  return { totals, complete: skipped === 0 };
}

/** How many of these accounts would hit the Guardian right now. Used by tests and the request-count harness. */
export function countSnapshotMisses(
  endpointId: string,
  accounts: { accountId: string; updatedAt: string }[],
): number {
  return accounts.filter(
    (a) => !a.updatedAt || !snapshotCache.has(snapshotKey(endpointId, a.accountId, a.updatedAt)),
  ).length;
}
