import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import { __resetAccountCaches } from "@/lib/account-cache";
import { headers } from "next/headers";
import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as statsGET } from "@/app/api/accounts/stats/route";
import { GET as assetTotalsGET } from "@/app/api/accounts/asset-totals/route";
import { GET as snapshotsGET } from "@/app/api/accounts/snapshots/route";

/**
 * One Refresh click used to ask asset-totals to refetch every active account's
 * snapshot, which on the OZ Guardian is ~470 requests in one go.
 *
 * This is the guard for that click. It counts every call the four routes make
 * to the Guardian. What it can no longer do is assert one universal cap: measured
 * 2026-08-03, the OpenZeppelin Guardian served 500 snapshot reads in 12.6s without
 * a 429 while lambdaclass 429'd after 55, so a single number is either far too
 * slow for one Guardian or too fast for the other. The per-pass ceiling is learned
 * per endpoint instead (see lib/account-cache.ts).
 *
 * So what is guarded here is the shape rather than a magic number: a click costs
 * a bounded amount that does NOT scale with how many accounts the Guardian holds,
 * the ramp converges instead of running away, and a Guardian that pushes back pulls
 * it straight back down.
 */

/** The tightest limit measured across the reachable Guardians (lambda: 55, then 60s). */
const TIGHTEST_NODE_BURST = 55;

let calls = 0;
let inventory: Account[] = [];

type Account = { accountId: string; updatedAt: string };

// Pages the seeded inventory the way the Guardian does, honouring the requested
// page size so the test counts the same number of requests production would.
const mockListAccounts = vi.fn(async ({ cursor, limit = 50 }: { cursor?: string; limit?: number } = {}) => {
  calls++;
  const start = cursor ? Number(cursor) : 0;
  const items = inventory.slice(start, start + limit);
  const end = start + items.length;
  return { items, nextCursor: end < inventory.length ? String(end) : null };
});
const mockGetAccountSnapshot = vi.fn(async () => {
  calls++;
  return { vault: { fungible: [{ faucetId: "0xf", amount: "10" }] } };
});
const mockGetDashboardInfo = vi.fn(async () => {
  calls++;
  return { totalAccountCount: 1500 };
});

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({
    listAccounts: mockListAccounts,
    getAccountSnapshot: mockGetAccountSnapshot,
    getDashboardInfo: mockGetDashboardInfo,
  })),
}));

vi.mock("@/lib/token-registry", () => ({
  normalizeAmount: (_faucetId: string, amount: string) => Number(amount),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const DAY = 24 * 60 * 60 * 1000;

/** A Guardian the size of the OZ one: 1,500 accounts, 470 of them active in 7d. */
function seedLargeNode(): Account[] {
  inventory = Array.from({ length: 1500 }, (_, i) => ({
    // Newest-updated first, which is the order the Guardian returns.
    accountId: `0x${i}`,
    updatedAt: new Date(Date.now() - (i < 470 ? 1 : 20) * DAY).toISOString(),
  }));
  return inventory;
}

/** Everything one Refresh click asks the routes for. */
async function refreshClick(visible: Account[]) {
  await accountsGET(new Request("http://localhost/api/accounts"));
  await statsGET(new Request("http://localhost/api/accounts/stats?refresh=1"));
  await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals?refresh=1"));
  const ids = visible.map((a) => encodeURIComponent(`${a.accountId}@${a.updatedAt}`)).join(",");
  await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}&refresh=1`));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAccountCaches();
  calls = 0;
});

describe("one Refresh click against a 1,500-account Guardian", () => {
  it("costs a bounded amount on a cold instance", async () => {
    mockHeaders("ep-cold");
    const accounts = seedLargeNode();

    await refreshClick(accounts.slice(0, 20));

    // 1 accounts page + 1 dashboard info + 3 inventory pages + 25 snapshots +
    // 20 on-screen rows. Asserted exactly so a regression shows up as a number
    // rather than as a still-passing inequality.
    expect(calls).toBe(50);
    // The point of the ceiling: 470 accounts are active, and the click reads a
    // fixed slice of them rather than all 470.
    expect(calls).toBeLessThan(470);
  });

  it("costs less on a warm instance, and skips rows it already holds", async () => {
    mockHeaders("ep-warm");
    const accounts = seedLargeNode();

    // Warm the caches the way the normal polls do.
    await statsGET(new Request("http://localhost/api/accounts/stats"));
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));
    calls = 0;
    mockGetAccountSnapshot.mockClear();

    await refreshClick(accounts.slice(0, 20));

    // No inventory walk: the polls paid for it and a refresh reuses a walk this
    // recent. What is left is the accounts page, the dashboard total, one more
    // (now doubled) snapshot pass, and the 20 on-screen rows — those are read
    // again even though they are cached, because a Refresh deliberately
    // bypasses the cache in both directions and must never be the stale answer.
    expect(calls).toBe(1 + 1 + 50 + 20);
    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(50 + 20);
  });

  // The click is the spike; warm-up is the sustained load underneath it, paced
  // by the card's 20s poll. The ramp is the whole fix: a fixed 12 a pass took
  // ~28 minutes to cover the OZ Guardian, so passes have to get bigger while the
  // Guardian stays quiet.
  it("accelerates while the Guardian stays quiet", async () => {
    mockHeaders("ep-sustained");
    seedLargeNode();

    const perPass: number[] = [];
    for (let i = 0; i < 3; i++) {
      mockGetAccountSnapshot.mockClear();
      await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));
      perPass.push(mockGetAccountSnapshot.mock.calls.length);
    }

    expect(perPass).toEqual([25, 50, 100]);
    // One inventory page on top, paid once and cached: the 7-day walk stops at
    // the first page because its oldest entry is already outside the window.
    expect(calls).toBe(1 + 25 + 50 + 100);
  });

  // The counterweight to the ramp. A Guardian that limits has to pull it back down,
  // or the dashboard would keep hammering a Guardian that already said no.
  it("backs off as soon as the Guardian answers 429", async () => {
    mockHeaders("ep-limited");
    seedLargeNode();

    // Two quiet passes take the ceiling to 100.
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));

    // The Guardian cuts us off partway through the third.
    let served = 0;
    mockGetAccountSnapshot.mockImplementation(async () => {
      calls++;
      if (served++ >= TIGHTEST_NODE_BURST) {
        throw new GuardianOperatorHttpError(429, "Too Many Requests", "", {
          message: "Rate limit exceeded",
          retryAfterSecs: 60,
          retryable: true,
        });
      }
      return { vault: { fungible: [{ faucetId: "0xf", amount: "10" }] } };
    });
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));

    // Fourth pass runs against a halved ceiling instead of climbing to 200.
    mockGetAccountSnapshot.mockClear();
    mockGetAccountSnapshot.mockImplementation(async () => {
      calls++;
      return { vault: { fungible: [{ faucetId: "0xf", amount: "10" }] } };
    });
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));

    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(50);
    expect(mockGetAccountSnapshot.mock.calls.length).toBeLessThan(TIGHTEST_NODE_BURST);
  });

  it("does not re-walk the account list twice for one click", async () => {
    mockHeaders("ep-walk");
    const accounts = seedLargeNode();

    await refreshClick(accounts.slice(0, 20));

    // stats walks to 30 days, asset-totals only needs 7. The second caller must
    // reuse the walk the first one just paid for.
    // 3 pages of 500 for 1,500 accounts, plus the one /api/accounts page.
    expect(mockListAccounts.mock.calls.length).toBe(4);
  });

  // `ids` arrives from the browser, so this is a trust boundary: 1,500 ids in a
  // query string must not become 1,500 requests to the Guardian.
  it("caps how many snapshots one snapshots call can ask for", async () => {
    mockHeaders("ep-cap");
    const accounts = seedLargeNode();
    const ids = accounts.map((a) => `${a.accountId}@${a.updatedAt}`).join(",");

    await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}`));

    expect(mockGetAccountSnapshot.mock.calls.length).toBeLessThan(TIGHTEST_NODE_BURST);
  });
});
