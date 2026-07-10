import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/asset-totals/route";

const mockListAccounts = vi.fn();
const mockGetAccountSnapshot = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({
    listAccounts: mockListAccounts,
    getAccountSnapshot: mockGetAccountSnapshot,
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
const account = (id: string, ageDays: number) => ({
  accountId: id,
  updatedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
});
const snapshot = (amount: number) => ({
  vault: { fungible: [{ faucetId: "0xf", amount: String(amount) }] },
});

beforeEach(() => vi.clearAllMocks());

// NOTE: the route keeps a module-level 60s cache per endpoint id — each test
// that must compute fresh uses its own endpoint id.
describe("GET /api/accounts/asset-totals", () => {
  it("sums snapshots of accounts active in the last 7 days only", async () => {
    mockHeaders("ep-sum");
    mockListAccounts.mockResolvedValue({
      items: [account("0xa", 1), account("0xb", 20)],
      nextCursor: null,
    });
    mockGetAccountSnapshot.mockResolvedValue(snapshot(100));
    const res = await GET();
    const body = await res.json();
    expect(body.usd7d).toBe(100);
    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetAccountSnapshot).toHaveBeenCalledWith("0xa");
  });

  it("serves the cached result on a second call for the same endpoint", async () => {
    mockHeaders("ep-cache");
    mockListAccounts.mockResolvedValue({ items: [account("0xa", 1)], nextCursor: null });
    mockGetAccountSnapshot.mockResolvedValue(snapshot(50));
    await GET();
    const res = await GET();
    expect((await res.json()).usd7d).toBe(50);
    expect(mockListAccounts).toHaveBeenCalledTimes(1);
  });

  it("ignores snapshot failures for individual accounts", async () => {
    mockHeaders("ep-partial");
    mockListAccounts.mockResolvedValue({
      items: [account("0xa", 1), account("0xb", 2)],
      nextCursor: null,
    });
    mockGetAccountSnapshot
      .mockResolvedValueOnce(snapshot(30))
      .mockRejectedValueOnce(new Error("boom"));
    const res = await GET();
    expect((await res.json()).usd7d).toBe(30);
  });

  it("returns 503 with the message when the account list fails", async () => {
    mockHeaders("ep-error");
    mockListAccounts.mockRejectedValue(new Error("rate limited"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
