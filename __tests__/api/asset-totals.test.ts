import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetAccountCaches } from "@/lib/account-cache";
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

beforeEach(() => {
  vi.clearAllMocks();
  __resetAccountCaches();
});

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
    const res = await GET(new Request("http://localhost/api/accounts/asset-totals"));
    const body = await res.json();
    expect(body.usd7d).toBe(100);
    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetAccountSnapshot).toHaveBeenCalledWith("0xa");
  });

  it("serves the cached result on a second call for the same endpoint", async () => {
    mockHeaders("ep-cache");
    mockListAccounts.mockResolvedValue({ items: [account("0xa", 1)], nextCursor: null });
    mockGetAccountSnapshot.mockResolvedValue(snapshot(50));
    await GET(new Request("http://localhost/api/accounts/asset-totals"));
    const res = await GET(new Request("http://localhost/api/accounts/asset-totals"));
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
    const res = await GET(new Request("http://localhost/api/accounts/asset-totals"));
    expect((await res.json()).usd7d).toBe(30);
  });

  // The card polls a warming answer every 20s and a settled one every 60s, so
  // the ceiling has to be the smaller of the two here or the walk would spend
  // 75 of the node's 60 requests a minute.
  it("caps a warm-up pass below the settled ceiling and reports its progress", async () => {
    mockHeaders("ep-warming");
    const items = Array.from({ length: 40 }, (_, i) => account(`0x${i}`, 1));
    mockListAccounts.mockResolvedValue({ items, nextCursor: null });
    mockGetAccountSnapshot.mockResolvedValue(snapshot(1));

    const body = await (await GET(new Request("http://localhost/api/accounts/asset-totals"))).json();

    expect(mockGetAccountSnapshot).toHaveBeenCalledTimes(12);
    expect(body).toMatchObject({ usd7d: null, warming: true, done: 12, total: 40 });
  });

  // Without this the count is a lie that never reaches its total, and the card
  // reads as stuck for exactly as long as it did before.
  it("advances the count on each pass until the total is published", async () => {
    mockHeaders("ep-progress");
    const items = Array.from({ length: 20 }, (_, i) => account(`0x${i}`, 1));
    mockListAccounts.mockResolvedValue({ items, nextCursor: null });
    mockGetAccountSnapshot.mockResolvedValue(snapshot(2));

    const first = await (await GET(new Request("http://localhost/api/accounts/asset-totals"))).json();
    expect(first).toMatchObject({ warming: true, done: 12, total: 20 });

    // Second pass, the plain poll the card makes: the 12 already read are cache
    // hits, so the remaining 8 fit inside the same ceiling.
    const second = await (await GET(new Request("http://localhost/api/accounts/asset-totals"))).json();
    expect(second.usd7d).toBe(40);
    expect(second.warming).toBeUndefined();
  });

  it("returns 503 with the message when the account list fails", async () => {
    mockHeaders("ep-error");
    mockListAccounts.mockRejectedValue(new Error("rate limited"));
    const res = await GET(new Request("http://localhost/api/accounts/asset-totals"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
