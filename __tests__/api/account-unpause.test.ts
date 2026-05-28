import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { POST } from "@/app/api/accounts/[accountId]/unpause/route";

const mockUnpauseAccount = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ unpauseAccount: mockUnpauseAccount })),
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

describe("POST /api/accounts/[accountId]/unpause", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await POST(makeRequest({}), makeParams("acc_1"));
    expect(res.status).toBe(400);
  });

  it("returns unpaused account data on success without reason", async () => {
    mockHeaders("testnet");
    const mockData = { accountId: "acc_1", pausedAt: null };
    mockUnpauseAccount.mockResolvedValue(mockData);
    const res = await POST(makeRequest({}), makeParams("acc_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
    expect(mockUnpauseAccount).toHaveBeenCalledWith("acc_1", undefined);
  });

  it("passes reason when provided", async () => {
    mockHeaders("testnet");
    mockUnpauseAccount.mockResolvedValue({});
    const res = await POST(makeRequest({ reason: "Cleared" }), makeParams("acc_1"));
    expect(res.status).toBe(200);
    expect(mockUnpauseAccount).toHaveBeenCalledWith("acc_1", "Cleared");
  });

  it("treats blank reason as undefined", async () => {
    mockHeaders("testnet");
    mockUnpauseAccount.mockResolvedValue({});
    await POST(makeRequest({ reason: "   " }), makeParams("acc_1"));
    expect(mockUnpauseAccount).toHaveBeenCalledWith("acc_1", undefined);
  });

  it("propagates non-Error thrown values as Unknown error", async () => {
    mockHeaders("testnet");
    mockUnpauseAccount.mockRejectedValue("string error");
    const res = await POST(makeRequest({}), makeParams("acc_1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Unknown error");
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockUnpauseAccount.mockRejectedValue(new Error("not found"));
    const res = await POST(makeRequest({}), makeParams("acc_1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not found");
  });
});
