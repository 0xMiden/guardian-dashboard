import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/overview/route";

const mockListAccounts = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ listAccounts: mockListAccounts })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const makeAccount = (overrides = {}) => ({
  accountId: "acc_1",
  stateStatus: "available",
  authScheme: "falcon",
  hasPendingCandidate: false,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/overview", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("counts account stats correctly", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({
      totalCount: 4,
      accounts: [
        makeAccount({ stateStatus: "available", authScheme: "falcon" }),
        makeAccount({ stateStatus: "available", authScheme: "ecdsa", hasPendingCandidate: true }),
        makeAccount({ stateStatus: "frozen", authScheme: "falcon" }),
        makeAccount({ stateStatus: "frozen", authScheme: "ecdsa" }),
      ],
    });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      totalAccounts: 4,
      available: 2,
      unavailable: 2,
      falcon: 2,
      ecdsa: 2,
      pendingCandidates: 1,
    });
  });

  it("returns all zeros for empty accounts", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({ totalCount: 0, accounts: [] });
    const res = await GET();
    const body = await res.json();
    expect(body.available).toBe(0);
    expect(body.unavailable).toBe(0);
    expect(body.pendingCandidates).toBe(0);
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockRejectedValue(new Error("Connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Connection refused");
  });
});
