import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/overview/route";

const mockGetDashboardInfo = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ getDashboardInfo: mockGetDashboardInfo })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

const makeDashboardInfo = (overrides = {}) => ({
  serviceStatus: "healthy",
  environment: "testnet",
  build: { version: "1.0.0", gitCommit: "abc", profile: "release", startedAt: new Date().toISOString() },
  backend: { storage: "postgres", supportedAckSchemes: [], canonicalization: null },
  totalAccountCount: 0,
  accountsByAuthMethod: {},
  latestActivity: null,
  deltaStatusCounts: { candidate: 0, canonical: 0, discarded: 0 },
  inFlightProposalCount: 0,
  degradedAggregates: [],
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/overview", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("returns dashboard info stats correctly", async () => {
    mockHeaders("testnet");
    mockGetDashboardInfo.mockResolvedValue(makeDashboardInfo({
      totalAccountCount: 4,
      accountsByAuthMethod: { miden_falcon: 2, miden_ecdsa: 2 },
      deltaStatusCounts: { candidate: 1, canonical: 10, discarded: 0 },
      inFlightProposalCount: 3,
    }));
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      totalAccounts: 4,
      falcon: 2,
      ecdsa: 2,
      evm: 0,
      deltaStatusCounts: { candidate: 1, canonical: 10, discarded: 0 },
      inFlightProposalCount: 3,
      serviceStatus: "healthy",
      environment: "testnet",
      build: expect.objectContaining({ version: "1.0.0", gitCommit: "abc" }),
    }));
  });

  it("returns all zeros when no accounts", async () => {
    mockHeaders("testnet");
    mockGetDashboardInfo.mockResolvedValue(makeDashboardInfo());
    const res = await GET();
    const body = await res.json();
    expect(body.totalAccounts).toBe(0);
    expect(body.falcon).toBe(0);
    expect(body.ecdsa).toBe(0);
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockGetDashboardInfo.mockRejectedValue(new Error("Connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Connection refused");
  });
});
