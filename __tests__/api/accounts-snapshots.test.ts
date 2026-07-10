import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/snapshots/route";

const mockGetAccountSnapshot = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ getAccountSnapshot: mockGetAccountSnapshot })),
}));

vi.mock("@/lib/token-registry", () => ({
  normalizeAmount: (_faucetId: string, amount: string) => Number(amount),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const snapshot = (amounts: number[]) => ({
  vault: { fungible: amounts.map((a) => ({ faucetId: "0xf", amount: String(a) })) },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders("testnet");
});

describe("GET /api/accounts/snapshots", () => {
  it("returns per-account fungible totals", async () => {
    mockGetAccountSnapshot
      .mockResolvedValueOnce(snapshot([100, 20]))
      .mockResolvedValueOnce(snapshot([5]));
    const res = await GET(new Request("http://localhost/api/accounts/snapshots?ids=0xa,0xb"));
    expect(await res.json()).toEqual({ "0xa": 120, "0xb": 5 });
  });

  it("omits accounts whose snapshot failed instead of failing the request", async () => {
    mockGetAccountSnapshot
      .mockResolvedValueOnce(snapshot([7]))
      .mockRejectedValueOnce(new Error("boom"));
    const res = await GET(new Request("http://localhost/api/accounts/snapshots?ids=0xa,0xb"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "0xa": 7 });
  });

  it("returns an empty object for no ids", async () => {
    const res = await GET(new Request("http://localhost/api/accounts/snapshots"));
    expect(await res.json()).toEqual({});
    expect(mockGetAccountSnapshot).not.toHaveBeenCalled();
  });
});
