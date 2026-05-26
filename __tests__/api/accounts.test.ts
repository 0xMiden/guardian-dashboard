import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/route";

const mockListAccounts = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ listAccounts: mockListAccounts })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

function makeRequest(url = "http://localhost/api/accounts") {
  return new Request(url);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/accounts", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns account list from guardian client", async () => {
    mockHeaders("testnet");
    const mockData = { items: [{ accountId: "acc_1" }], nextCursor: null };
    mockListAccounts.mockResolvedValue(mockData);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockRejectedValue(new Error("timeout"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("timeout");
  });

  it("passes cursor and limit query params to listAccounts", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({ items: [], nextCursor: null });
    await GET(makeRequest("http://localhost/api/accounts?cursor=abc&limit=10"));
    expect(mockListAccounts).toHaveBeenCalledWith({ cursor: "abc", limit: 10 });
  });
});
