import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/health/route";

const mockCheckHealth = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ checkHealth: mockCheckHealth })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/health", () => {
  it("returns down status when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.latencyMs).toBe(0);
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  it("returns guardian client health result", async () => {
    mockHeaders("testnet");
    mockCheckHealth.mockResolvedValue({ status: "up", latencyMs: 42, checkedAt: "2026-01-01T00:00:00Z" });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ status: "up", latencyMs: 42, checkedAt: "2026-01-01T00:00:00Z" });
  });
});
