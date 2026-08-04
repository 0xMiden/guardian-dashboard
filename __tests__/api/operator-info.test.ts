import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/operator-info/route";

vi.mock("@/lib/endpoints", () => ({
  getEndpoint: vi.fn(),
}));

vi.mock("@/lib/falcon", () => ({
  getPublicKey: vi.fn(),
}));

const { getEndpoint } = await import("@/lib/endpoints");
const { getPublicKey } = await import("@/lib/falcon");

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
    expect(body).toEqual({ url: null, network: "Unknown", publicKey: null });
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
    vi.mocked(getPublicKey).mockResolvedValue("0xpubkey123");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      url: "https://guardian.example.com",
      network: "MidenTestnet",
      publicKey: "0xpubkey123",
    });
  });

  // A key the SDK cannot deserialize used to reject out of the route, which 500s
  // it and blanks the whole Guardian Status card. The endpoint's url and network
  // are known without the key, so they are still worth returning.
  it("still returns endpoint data when the private key format is unsupported", async () => {
    mockHeaders("testnet");
    vi.mocked(getEndpoint).mockReturnValue({
      id: "testnet",
      label: "Testnet",
      url: "https://guardian.example.com",
      network: "MidenTestnet",
      commitment: "0xabc123",
      privateKey: "0xnotafalconkey",
    });
    vi.mocked(getPublicKey).mockRejectedValue(new Error("unsupported key format"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://guardian.example.com",
      network: "MidenTestnet",
      publicKey: null,
    });
  });

  it("returns nulls for an unknown endpoint id", async () => {
    mockHeaders("unknown");
    vi.mocked(getEndpoint).mockReturnValue(undefined);
    const res = await GET();
    const body = await res.json();
    expect(body.url).toBeNull();
    expect(body.publicKey).toBeNull();
  });
});
