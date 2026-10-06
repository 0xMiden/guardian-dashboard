import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetAccountCaches } from "@/lib/account-cache";
import { headers } from "next/headers";
import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as statsGET } from "@/app/api/accounts/stats/route";
import { GET as assetTotalsGET } from "@/app/api/accounts/asset-totals/route";
import { GET as snapshotsGET } from "@/app/api/accounts/snapshots/route";

/**
 * What one Refresh click costs the Guardian.
 *
 * This used to guard a walk: the stat strip and the assets card each paged the
 * whole account list and then read one vault snapshot per 7-day-active account.
 * Measured on openzeppelin_devnet 2026-10-06, 270 accounts, that was **202
 * requests in 251.6 seconds**. The same numbers now come from
 * `GET /dashboard/stats` in **2 requests and 292 ms**, and on the OZ testnet
 * Guardian the walk had 23,303 accounts to get through.
 *
 * So the budget is no longer a function of inventory size, and the thing worth
 * asserting changed with it. What is left is that the aggregates stay O(1) and
 * that the one input which still scales with something the browser controls,
 * the `ids` list, stays capped.
 */

let calls = 0;

type Account = { accountId: string; updatedAt: string };
let inventory: Account[] = [];

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
const mockGetDashboardStats = vi.fn(async () => {
  calls++;
  return {
    asOf: "2026-10-06T16:29:12Z",
    updatedSince: null,
    refreshIntervalSeconds: 300,
    version: 1,
    accounts: {
      total: 1500,
      byLifecycle: { active: 1500, paused: 0, released: 0 },
      byAuthMethod: { miden_ecdsa: 1500 },
      byAuthMethodAndSignerCount: [{ authMethod: "miden_ecdsa", authorizedSignerCount: 2, count: 1500 }],
      updatedWithin7d: 470,
      updatedWithin30d: 1500,
    },
    assets: {
      eligible: 470,
      covered: 470,
      skipped: {},
      complete: true,
      fungible: [{ faucetId: "0xf", totalAmount: "4700" }],
      nonFungible: [],
    },
  };
});

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({
    listAccounts: mockListAccounts,
    getAccountSnapshot: mockGetAccountSnapshot,
    getDashboardStats: mockGetDashboardStats,
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

/** A Guardian the size of the OZ one was: 1,500 accounts, 470 active in 7d. */
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
  await statsGET();
  await assetTotalsGET();
  const ids = visible.map((a) => encodeURIComponent(`${a.accountId}@${a.updatedAt}`)).join(",");
  await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}&refresh=1`));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAccountCaches();
  calls = 0;
});

describe("one Refresh click against a 1,500-account Guardian", () => {
  it("costs the same on a cold instance as on a warm one", async () => {
    mockHeaders("ep-cold");
    const accounts = seedLargeNode();

    await refreshClick(accounts.slice(0, 20));

    // 1 accounts page + 1 stats + 1 asset-totals + 20 on-screen rows. Asserted
    // exactly so a regression shows up as a number rather than as a
    // still-passing inequality. There is no cold-start penalty left to pay:
    // this was 1 + 1 + 3 + 470 + 20 when the aggregates were walked here.
    expect(calls).toBe(1 + 1 + 1 + 20);
  });

  it("does not grow when the Guardian does", async () => {
    mockHeaders("ep-huge");
    inventory = Array.from({ length: 50_000 }, (_, i) => ({
      accountId: `0x${i}`,
      updatedAt: new Date(Date.now() - DAY).toISOString(),
    }));

    await statsGET();
    await assetTotalsGET();

    // One request each, whether the Guardian holds 270 accounts or 50,000.
    expect(mockGetDashboardStats).toHaveBeenCalledTimes(2);
    expect(mockListAccounts).not.toHaveBeenCalled();
    expect(mockGetAccountSnapshot).not.toHaveBeenCalled();
  });

  it("re-reads the on-screen rows, which a Refresh must never serve stale", async () => {
    mockHeaders("ep-warm");
    const accounts = seedLargeNode();

    // Warm the snapshot cache the way scrolling does.
    const ids = accounts.slice(0, 20).map((a) => `${a.accountId}@${a.updatedAt}`).join(",");
    await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}`));
    mockGetAccountSnapshot.mockClear();
    calls = 0;

    await refreshClick(accounts.slice(0, 20));

    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(20);
  });

  // `ids` arrives from the browser, so this is a trust boundary: 1,500 ids in a
  // query string must not become 1,500 requests to the Guardian.
  it("caps how many snapshots one snapshots call can ask for", async () => {
    mockHeaders("ep-cap");
    const accounts = seedLargeNode();
    const ids = accounts.map((a) => `${a.accountId}@${a.updatedAt}`).join(",");

    await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}`));

    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(25);
  });
});
