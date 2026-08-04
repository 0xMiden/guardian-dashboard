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
 * This counts every call the four routes make to the Guardian. What it cannot
 * assert is one universal cap, because the allowance follows the operator's
 * profile: prod is 5000/min, dev is 60/min, and either can be overridden per
 * deployment. A single number would be far too slow for one Guardian or far too
 * fast for the other.
 *
 * A cold click now reads every active account in one pass deliberately. The
 * count-based ramp it replaced needed six consecutive passes on the same
 * serverless instance, which the per-instance caches cannot guarantee, so the
 * total could take many minutes to appear or never appear at all. Measured
 * 2026-08-04, the full OZ walk is 1,076 requests in 19.1s against 5000/min.
 *
 * So what is guarded here is the shape: a cold click pays for the walk once and
 * a warm one is nearly free, and a Guardian that pushes back stops the pass
 * rather than being hammered through it.
 */

const DEV_PROFILE_PER_MIN = 55;

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
  it("pays for the whole walk once on a cold instance", async () => {
    mockHeaders("ep-cold");
    const accounts = seedLargeNode();

    await refreshClick(accounts.slice(0, 20));

    // 1 accounts page + 1 dashboard info + 3 inventory pages + 470 active
    // accounts + 20 on-screen rows. Asserted exactly so a regression shows up as
    // a number rather than as a still-passing inequality.
    expect(calls).toBe(1 + 1 + 3 + 470 + 20);
  });

  it("costs almost nothing on a warm instance", async () => {
    mockHeaders("ep-warm");
    const accounts = seedLargeNode();

    // Warm the caches the way the normal polls do.
    await statsGET(new Request("http://localhost/api/accounts/stats"));
    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));
    calls = 0;
    mockGetAccountSnapshot.mockClear();

    await refreshClick(accounts.slice(0, 20));

    // No inventory walk and no snapshot re-reads: every active account is held
    // at its current version. What is left is the accounts page, the dashboard
    // total, and the 20 on-screen rows, which a Refresh deliberately re-reads
    // because it must never be the stale answer.
    expect(calls).toBe(1 + 1 + 20);
    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(20);
  });

  // The walk is only unbounded on a Guardian that lets it be. One that pushes
  // back has to stop the pass, or the dashboard hammers a Guardian that said no.
  it("stops the pass as soon as the Guardian answers 429", async () => {
    mockHeaders("ep-limited");
    seedLargeNode();

    let served = 0;
    mockGetAccountSnapshot.mockImplementation(async () => {
      calls++;
      if (served++ >= DEV_PROFILE_PER_MIN) {
        throw new GuardianOperatorHttpError(429, "Too Many Requests", "", {
          message: "Rate limit exceeded",
          retryAfterSecs: 60,
          retryable: true,
        });
      }
      return { vault: { fungible: [{ faucetId: "0xf", amount: "10" }] } };
    });

    await assetTotalsGET(new Request("http://localhost/api/accounts/asset-totals"));

    // Nothing like the 470 active accounts: it gives up within a batch of the
    // Guardian's limit rather than grinding through the whole set.
    expect(mockGetAccountSnapshot.mock.calls.length).toBeLessThan(DEV_PROFILE_PER_MIN + 20);
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

    expect(mockGetAccountSnapshot.mock.calls.length).toBeLessThan(DEV_PROFILE_PER_MIN);
  });
});
