import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { POST } from "@/app/api/accounts/[accountId]/pause/route";

const mockPauseAccount = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ pauseAccount: mockPauseAccount })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

function makeParams(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

function makeRequest(body: unknown) {
  return { json: () => Promise.resolve(body) } as Request;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/accounts/[accountId]/pause", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await POST(makeRequest({ reason: "test" }), makeParams("acc_1"));
    expect(res.status).toBe(400);
  });

  it("returns 422 when reason is missing", async () => {
    mockHeaders("testnet");
    const res = await POST(makeRequest({}), makeParams("acc_1"));
    expect(res.status).toBe(422);
  });

  it("returns 422 when reason is blank", async () => {
    mockHeaders("testnet");
    const res = await POST(makeRequest({ reason: "   " }), makeParams("acc_1"));
    expect(res.status).toBe(422);
  });

  it("returns paused account data on success", async () => {
    mockHeaders("testnet");
    const mockData = { accountId: "acc_1", pausedAt: "2026-01-01T00:00:00Z" };
    mockPauseAccount.mockResolvedValue(mockData);
    const res = await POST(makeRequest({ reason: "Suspicious activity" }), makeParams("acc_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
    expect(mockPauseAccount).toHaveBeenCalledWith("acc_1", "Suspicious activity");
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockPauseAccount.mockRejectedValue(new Error("forbidden"));
    const res = await POST(makeRequest({ reason: "test" }), makeParams("acc_1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("propagates non-Error thrown values as Unknown error", async () => {
    mockHeaders("testnet");
    mockPauseAccount.mockRejectedValue("string error");
    const res = await POST(makeRequest({ reason: "test" }), makeParams("acc_1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Unknown error");
  });
});
