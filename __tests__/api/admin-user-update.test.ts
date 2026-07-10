import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/users/[userId]/route";

const mockAuth = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockCapture = vi.fn();

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(), // needs a Next request scope, absent in unit tests
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: () => mockGetUser(),
      updateUser: (_id: string, data: unknown) => mockUpdateUser(_id, data),
    },
  }),
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: vi.fn(() => ({ capture: mockCapture })),
}));

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/admin/users/user_target", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/admin/users/[userId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await PATCH(makeRequest({ role: "viewer" }), {
      params: Promise.resolve({ userId: "user_target" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not admin", async () => {
    mockAuth.mockResolvedValue({ userId: "caller_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { role: "viewer" } });
    const res = await PATCH(makeRequest({ role: "viewer" }), {
      params: Promise.resolve({ userId: "user_target" }),
    });
    expect(res.status).toBe(403);
  });

  it("updates user and fires PostHog event when admin", async () => {
    mockAuth.mockResolvedValue({ userId: "admin_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { role: "admin" } });
    mockUpdateUser.mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ role: "viewer", endpointIds: ["testnet"] }),
      { params: Promise.resolve({ userId: "user_target" }) }
    );

    expect(res.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith("user_target", {
      publicMetadata: { endpointIds: ["testnet"], role: "viewer" },
    });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "admin_123",
        event: "user_access_updated",
        properties: expect.objectContaining({ target_user_id: "user_target", role: "viewer" }),
      })
    );
  });
});
