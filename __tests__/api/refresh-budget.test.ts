import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetAccountCaches } from "@/lib/account-cache";
import { headers } from "next/headers";
import { GET as accountsGET } from "@/app/api/accounts/route";
import { GET as statsGET } from "@/app/api/accounts/stats/route";
import { GET as assetTotalsGET } from "@/app/api/accounts/asset-totals/route";
import { GET as snapshotsGET } from "@/app/api/accounts/snapshots/route";

/**
 * The node allows 60 requests a minute per client IP across every route. One
 * Refresh click used to blow that on its own: it asked asset-totals to refetch
 * every active account's snapshot, which on the OZ node is ~470 requests.
 *
 * This is the budget guard for that click. It counts every call the four routes
 * make to the node and holds the whole sequence under the cap.
 */

const PER_MINUTE_BUDGET = 60;

let calls = 0;
let inventory: Account[] = [];

type Account = { accountId: string; updatedAt: string };

// Pages the seeded inventory the way the node does, honouring the requested
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

/** A node the size of the OZ one: 1,500 accounts, 470 of them active in 7d. */
function seedLargeNode(): Account[] {
  inventory = Array.from({ length: 1500 }, (_, i) => ({
    // Newest-updated first, which is the order the node returns.
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

describe("one Refresh click against a 1,500-account node", () => {
  it("stays inside the per-minute budget on a cold instance", async () => {
    mockHeaders("ep-cold");
    const accounts = seedLargeNode();

    await refreshClick(accounts.slice(0, 20));

    // 1 accounts page + 1 dashboard info + 3 inventory pages + 25 warming
    // snapshots + 20 on-screen rows. Asserted exactly so a regression shows up
    // as a number rather than as a still-passing inequality.
    expect(calls).toBe(50);
    expect(calls).toBeLessThan(PER_MINUTE_BUDGET);
  });

  it("stays inside the budget on a warm instance", async () => {
    mockHeaders("ep-warm");
    const accounts = seedLargeNode();

    // Warm the caches the way the normal polls do.
    await statsGET(new Request("http://localhost/api/accounts/stats"));
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));
    calls = 0;

    await refreshClick(accounts.slice(0, 20));

    // No inventory walk: the polls paid for it and a refresh reuses a walk this
    // recent. What remains is the dashboard total, one more warming pass, and
    // the on-screen rows.
    expect(calls).toBe(47);
    expect(calls).toBeLessThan(PER_MINUTE_BUDGET);
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

  it("caps how many snapshots one snapshots call can ask for", async () => {
    mockHeaders("ep-cap");
    const accounts = seedLargeNode();
    const ids = accounts.map((a) => `${a.accountId}@${a.updatedAt}`).join(",");

    await snapshotsGET(new Request(`http://localhost/api/accounts/snapshots?ids=${ids}`));

    expect(mockGetAccountSnapshot.mock.calls.length).toBeLessThan(PER_MINUTE_BUDGET);
  });
});
