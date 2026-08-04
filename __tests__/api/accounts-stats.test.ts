import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetAccountCaches } from "@/lib/account-cache";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/stats/route";

const mockListAccounts = vi.fn();
const mockGetDashboardInfo = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({
    listAccounts: mockListAccounts,
    getDashboardInfo: mockGetDashboardInfo,
  })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const DAY = 24 * 60 * 60 * 1000;
const account = (id: string, ageDays: number, over: Record<string, unknown> = {}) => ({
  accountId: id,
  updatedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  authScheme: "falcon",
  authorizedSignerCount: 3,
  ...over,
});
const wallet = (id: string, ageDays: number) =>
  account(id, ageDays, { authScheme: "ecdsa", authorizedSignerCount: 2 });

beforeEach(() => {
  __resetAccountCaches();
  vi.clearAllMocks();
  mockHeaders("testnet");
});

describe("GET /api/accounts/stats", () => {
  // Counted from the inventory the route already walks, so they cost no extra
  // Guardian request. Uses `accountState`, so a released-and-paused account counts
  // once, as released, exactly as the table badges it.
  it("counts frozen and released accounts", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 5 });
    mockListAccounts.mockResolvedValue({
      items: [
        account("a", 1),
        account("b", 1, { pausedAt: "2026-07-01T00:00:00Z" }),
        account("c", 1, { pausedAt: "2026-07-01T00:00:00Z" }),
        account("d", 1, { releasedAt: "2026-07-02T00:00:00Z" }),
        account("e", 1, { pausedAt: "2026-07-01T00:00:00Z", releasedAt: "2026-07-02T00:00:00Z" }),
      ],
      nextCursor: null,
    });
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    const body = await res.json();
    expect(body.frozen).toBe(2);
    expect(body.released).toBe(2);
  });

  it("counts frozen without spending a request of its own", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 2 });
    mockListAccounts.mockResolvedValue({
      items: [account("a", 1), account("b", 1, { pausedAt: "2026-07-01T00:00:00Z" })],
      nextCursor: null,
    });
    await GET(new Request("http://localhost/api/accounts/stats"));
    // One walk, one page. A `paused: true` query would have made it two.
    expect(mockListAccounts).toHaveBeenCalledTimes(1);
    expect(mockListAccounts.mock.calls[0][0]).not.toHaveProperty("paused");
  });

  it("counts 7d/30d activity and takes total from dashboard info", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 42 });
    mockListAccounts.mockResolvedValue({
      items: [account("a", 1), account("b", 10), account("c", 40)],
      nextCursor: null,
    });
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    expect(await res.json()).toEqual({
      total: 42, count7d: 1, count30d: 2, counted: 3, wallet: 0, other: 3, frozen: 0, released: 0,
    });
  });

  // The 30-day stop was dropped here on purpose: the Accounts table labels its
  // filters from these counts, so a walk that stopped early would describe a
  // slice of the Guardian while the chip claimed to describe the Guardian.
  it("walks the whole list rather than stopping at the 30-day mark", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 3 });
    mockListAccounts
      .mockResolvedValueOnce({ items: [account("a", 1)], nextCursor: "page2" })
      .mockResolvedValueOnce({ items: [account("b", 45)], nextCursor: "page3" })
      .mockResolvedValueOnce({ items: [account("c", 90)], nextCursor: null });
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    expect(await res.json()).toEqual({
      total: 3, count7d: 1, count30d: 1, counted: 3, wallet: 0, other: 3, frozen: 0, released: 0,
    });
    expect(mockListAccounts).toHaveBeenCalledTimes(3);
  });

  it("splits wallet from other across every account, not just recent ones", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 4 });
    mockListAccounts.mockResolvedValue({
      items: [wallet("a", 1), wallet("b", 200), account("c", 2), account("d", 300)],
      nextCursor: null,
    });
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    const body = await res.json();
    expect(body).toMatchObject({ counted: 4, wallet: 2, other: 2 });
    // The chips must always sum to the row they sit next to.
    expect(body.wallet + body.other).toBe(body.counted);
  });

  it("returns total null when dashboard info is unavailable (older server)", async () => {
    mockGetDashboardInfo.mockRejectedValue(new Error("404"));
    mockListAccounts.mockResolvedValue({ items: [account("a", 1)], nextCursor: null });
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    expect(await res.json()).toEqual({
      total: null, count7d: 1, count30d: 1, counted: 1, wallet: 0, other: 1, frozen: 0, released: 0,
    });
  });

  it("returns 503 with the message when the account list fails", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 1 });
    mockListAccounts.mockRejectedValue(new Error("rate limited"));
    const res = await GET(new Request("http://localhost/api/accounts/stats"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
