import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/[accountId]/route";

const mockGetAccount = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ getAccount: mockGetAccount })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

function makeParams(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/accounts/[accountId]", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET({} as Request, makeParams("acc_1"));
    expect(res.status).toBe(400);
  });

  it("returns account data for a valid id", async () => {
    mockHeaders("testnet");
    const mockData = { account: { accountId: "acc_1", stateStatus: "available" } };
    mockGetAccount.mockResolvedValue(mockData);
    const res = await GET({} as Request, makeParams("acc_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockGetAccount.mockRejectedValue(new Error("not found"));
    const res = await GET({} as Request, makeParams("acc_1"));
    expect(res.status).toBe(503);
  });
});
