import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockGetUser = vi.fn();
const mockCapture = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: vi.fn().mockResolvedValue({
    users: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: vi.fn(() => ({ capture: mockCapture })),
}));

vi.mock("@/lib/endpoints", () => ({
  getPublicEndpoints: vi.fn(() => [
    { id: "testnet", label: "Guardian Testnet" },
    { id: "mainnet", label: "Guardian Mainnet" },
  ]),
  getEndpoint: vi.fn((id: string) =>
    id === "testnet"
      ? { id: "testnet", label: "Guardian Testnet", url: "https://g.example.com", network: "MidenTestnet", commitment: "0x", privateKey: "pk" }
      : undefined
  ),
}));

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/select-endpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

// Re-import after mocks are in place
const { GET, POST, DELETE } = await import("@/app/api/select-endpoint/route");

describe("GET /api/select-endpoint", () => {
  it("returns empty list when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET();
    const body = await res.json();
    expect(body.endpoints).toEqual([]);
  });

  it("returns endpoints filtered to user's allowed ids", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { endpointIds: ["testnet"] } });
    const res = await GET();
    const body = await res.json();
    expect(body.endpoints).toEqual([{ id: "testnet", label: "Guardian Testnet" }]);
  });
});

describe("POST /api/select-endpoint", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(makePostRequest({ endpointId: "testnet" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when endpoint not in user's allowed list", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { endpointIds: ["mainnet"] } });
    const res = await POST(makePostRequest({ endpointId: "testnet" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when endpoint not in GUARDIAN_ENDPOINTS config", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { endpointIds: ["unknown"] } });
    const res = await POST(makePostRequest({ endpointId: "unknown" }));
    expect(res.status).toBe(403);
  });

  it("sets cookie and fires PostHog event for valid endpoint", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { endpointIds: ["testnet"] } });
    const res = await POST(makePostRequest({ endpointId: "testnet" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("cockpit-endpoint=testnet");
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ event: "endpoint_selected", properties: { endpoint_id: "testnet" } })
    );
  });
});

describe("DELETE /api/select-endpoint", () => {
  it("clears the endpoint cookie", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    // Cookie is cleared (set with empty/expired value)
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("cockpit-endpoint");
  });
});
