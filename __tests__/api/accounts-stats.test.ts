import { describe, it, expect, vi, beforeEach } from "vitest";
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
const account = (id: string, ageDays: number) => ({
  accountId: id,
  updatedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders("testnet");
});

describe("GET /api/accounts/stats", () => {
  it("counts 7d/30d activity and takes total from dashboard info", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 42 });
    mockListAccounts.mockResolvedValue({
      items: [account("a", 1), account("b", 10), account("c", 40)],
      nextCursor: null,
    });
    const res = await GET();
    expect(await res.json()).toEqual({ total: 42, count7d: 1, count30d: 2 });
  });

  it("stops paginating once a page is older than 30 days", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 400 });
    mockListAccounts
      .mockResolvedValueOnce({ items: [account("a", 1)], nextCursor: "page2" })
      .mockResolvedValueOnce({ items: [account("b", 45)], nextCursor: "page3" });
    const res = await GET();
    expect(await res.json()).toEqual({ total: 400, count7d: 1, count30d: 1 });
    expect(mockListAccounts).toHaveBeenCalledTimes(2);
  });

  it("returns total null when dashboard info is unavailable (older server)", async () => {
    mockGetDashboardInfo.mockRejectedValue(new Error("404"));
    mockListAccounts.mockResolvedValue({ items: [account("a", 1)], nextCursor: null });
    const res = await GET();
    expect(await res.json()).toEqual({ total: null, count7d: 1, count30d: 1 });
  });

  it("returns 503 with the message when the account list fails", async () => {
    mockGetDashboardInfo.mockResolvedValue({ totalAccountCount: 1 });
    mockListAccounts.mockRejectedValue(new Error("rate limited"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
