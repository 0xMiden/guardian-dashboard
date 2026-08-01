import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/route";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";

const mockListAccounts = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ listAccounts: mockListAccounts })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

function makeRequest(url = "http://localhost/api/accounts") {
  return new Request(url);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/accounts", () => {
  it("returns 400 when no endpoint header", async () => {
    mockHeaders("");
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns account list from guardian client", async () => {
    mockHeaders("testnet");
    const mockData = { items: [{ accountId: "acc_1" }], nextCursor: null };
    mockListAccounts.mockResolvedValue(mockData);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
  });

  it("returns 503 when guardian client throws", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockRejectedValue(new Error("timeout"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("timeout");
  });

  // Every failure used to collapse to a 503 carrying the client's diagnostic
  // Error text, so the UI could not tell a permission denial from a dead node.
  it("forwards the node's status and error envelope instead of flattening to 503", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockRejectedValue(
      new GuardianOperatorHttpError(403, "Forbidden", "{}", {
        code: "insufficient_operator_permission",
        message: "You don't have permission to do that",
        missingPermissions: ["accounts:pause"],
      } as any),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "You don't have permission to do that",
      code: "insufficient_operator_permission",
      missingPermissions: ["accounts:pause"],
    });
  });

  it("forwards the retry-after the node asked for on a rate limit", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockRejectedValue(
      new GuardianOperatorHttpError(429, "Too Many Requests", "{}", {
        code: "rate_limited", message: "Slow down", retryAfterSecs: 7,
      } as any),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect((await res.json()).retryAfterSecs).toBe(7);
  });

  // The node takes a tri-state pause filter and our wrapper used to type the
  // options as PaginationOptions, which dropped it. Without this there is no
  // way to ask "which accounts are frozen" short of paging the whole node.
  it("passes the paused filter through", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({ items: [], nextCursor: null });
    await GET(makeRequest("http://localhost/api/accounts?paused=true"));
    expect(mockListAccounts).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
  });

  // An absent param has to stay absent: coercing it to false would turn every
  // ordinary listing into an active-only one and hide frozen accounts.
  it("leaves paused undefined when the param is absent", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({ items: [], nextCursor: null });
    await GET(makeRequest());
    expect(mockListAccounts.mock.calls[0][0].paused).toBeUndefined();
  });

  it("passes cursor and limit query params to listAccounts", async () => {
    mockHeaders("testnet");
    mockListAccounts.mockResolvedValue({ items: [], nextCursor: null });
    await GET(makeRequest("http://localhost/api/accounts?cursor=abc&limit=10"));
    expect(mockListAccounts).toHaveBeenCalledWith({ cursor: "abc", limit: 10 });
  });
});
