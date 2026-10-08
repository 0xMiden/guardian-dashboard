import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/asset-totals/route";

const mockGetDashboardStats = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ getDashboardStats: mockGetDashboardStats })),
}));

// Every faucet priced at $1 per million base units (six decimals at par), so
// the sums below read as whole units; "0xu…" faucets are unpriced.
vi.mock("@/lib/prices", () => ({
  priceBook: async () => ({
    usd: (faucetId: string, amount: string) =>
      faucetId.startsWith("0xu") ? undefined : Number(BigInt(amount) / BigInt(1000000)),
  }),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const ASOF = "2026-10-06T16:29:12.837967517+00:00";

const stats = (assets: Record<string, unknown>) => ({
  asOf: ASOF,
  updatedSince: "2026-09-29T16:29:12Z",
  refreshIntervalSeconds: 300,
  version: 3225,
  accounts: {
    total: 270,
    byLifecycle: { active: 269, paused: 0, released: 1 },
    byAuthMethod: {},
    byAuthMethodAndSignerCount: [],
    updatedWithin7d: 201,
    updatedWithin30d: 270,
  },
  assets: { eligible: 270, covered: 270, skipped: {}, complete: true, nonFungible: [], ...assets },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders("testnet");
});

describe("GET /api/accounts/asset-totals", () => {
  it("sums the per-faucet totals and reports the server's walk time", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({
        fungible: [
          { faucetId: "0xa", totalAmount: "100000000000" },
          { faucetId: "0xb", totalAmount: "50000000000" },
        ],
      }),
    );
    const body = await (await GET()).json();
    expect(body).toEqual({ usd: 150_000, computedAt: ASOF, priced: 2, unpriced: 0 });
  });

  // The fleet on 2026-10-07: devnet's hundred test mints and the reset testnet's
  // one unknown faucet. No list prices any of them, and a zero would claim the
  // Guardian holds nothing.
  it("publishes no sum when nothing held has a price", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({ fungible: [{ faucetId: "0xu1", totalAmount: "100000000000" }, { faucetId: "0xu2", totalAmount: "5" }] }),
    );
    const body = await (await GET()).json();
    expect(body).toEqual({ usd: null, computedAt: ASOF, priced: 0, unpriced: 2 });
  });

  it("sums only the priced faucets of a mixed fleet and counts the rest", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({ fungible: [{ faucetId: "0xa", totalAmount: "2000000" }, { faucetId: "0xu", totalAmount: "999000000" }] }),
    );
    const body = await (await GET()).json();
    expect(body).toEqual({ usd: 2, computedAt: ASOF, priced: 1, unpriced: 1 });
  });

  // All time, like every other Overview figure: a window would total the
  // active accounts and leave the rest of the fleet out of the number.
  it("asks the Guardian for every account, with no window", async () => {
    mockGetDashboardStats.mockResolvedValue(stats({ fungible: [] }));
    await GET();
    expect(mockGetDashboardStats.mock.calls[0][0]?.updatedSince).toBeUndefined();
  });

  it("costs exactly one Guardian request", async () => {
    mockGetDashboardStats.mockResolvedValue(stats({ fungible: [] }));
    await GET();
    expect(mockGetDashboardStats).toHaveBeenCalledTimes(1);
  });

  it("totals zero when no account holds anything", async () => {
    mockGetDashboardStats.mockResolvedValue(stats({ fungible: [], eligible: 0, covered: 0 }));
    expect((await (await GET()).json()).usd).toBe(0);
  });

  // The guard that matters: a sum missing accounts is a confidently wrong
  // number, which is worse than no number. The server states its own coverage,
  // so the route no longer has to infer it from failed reads.
  it("refuses to publish a sum the Guardian says is incomplete", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({
        complete: false,
        covered: 180,
        eligible: 270,
        skipped: { state_unavailable: 90 },
        fungible: [{ faucetId: "0xa", totalAmount: "100000000000" }],
      }),
    );
    const body = await (await GET()).json();
    expect(body.usd).toBeNull();
    expect(body.warming).toBe(true);
    // Feeds the progress line, so an operator can see the coverage climbing.
    expect(body.done).toBe(180);
    expect(body.total).toBe(270);
  });

  it("says unsupported on a Guardian older than 0.18.0", async () => {
    mockGetDashboardStats.mockRejectedValue(new GuardianOperatorHttpError(404, "Not Found", "", {} as never));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unsupported: true });
  });

  it("says warming while a 0.18.0 Guardian has published nothing yet", async () => {
    mockGetDashboardStats.mockRejectedValue(
      new GuardianOperatorHttpError(503, "Service Unavailable", "", {
        code: "data_unavailable",
        message: "Statistics are not yet available. Please try again shortly.",
        retryable: true,
      } as never),
    );
    expect(await (await GET()).json()).toEqual({ warming: true });
  });

  it("forwards a genuine Guardian error", async () => {
    mockGetDashboardStats.mockRejectedValue(
      new GuardianOperatorHttpError(429, "Too Many Requests", "", {
        code: "rate_limit_exceeded",
        message: "Too many requests.",
        retryAfterSecs: 60,
        retryable: true,
      } as never),
    );
    const res = await GET();
    expect(res.status).toBe(429);
    expect((await res.json()).retryAfterSecs).toBe(60);
  });

  it("returns 400 with no endpoint selected", async () => {
    mockHeaders("");
    expect((await GET()).status).toBe(400);
  });
});
