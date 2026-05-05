import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/operator-info/route";

vi.mock("@/lib/endpoints", () => ({
  getEndpoint: vi.fn(),
}));

const { getEndpoint } = await import("@/lib/endpoints");

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/operator-info", () => {
  it("returns nulls when no endpoint id in header", async () => {
    mockHeaders("");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ url: null, network: "Unknown", commitment: null });
  });

  it("returns endpoint data for a valid id", async () => {
    mockHeaders("testnet");
    vi.mocked(getEndpoint).mockReturnValue({
      id: "testnet",
      label: "Testnet",
      url: "https://guardian.example.com",
      network: "MidenTestnet",
      commitment: "0xabc123",
      privateKey: "secret",
    });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      url: "https://guardian.example.com",
      network: "MidenTestnet",
      commitment: "0xabc123",
    });
  });

  it("returns nulls for an unknown endpoint id", async () => {
    mockHeaders("unknown");
    vi.mocked(getEndpoint).mockReturnValue(undefined);
    const res = await GET();
    const body = await res.json();
    expect(body.url).toBeNull();
    expect(body.commitment).toBeNull();
  });
});
