import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/users/route";

const mockAuth = vi.fn();
const mockGetUser = vi.fn();
const mockGetUserList = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: () => mockGetUser(),
      getUserList: () => mockGetUserList(),
    },
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not admin", async () => {
    mockAuth.mockResolvedValue({ userId: "user_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { role: "viewer" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns user list for admin", async () => {
    mockAuth.mockResolvedValue({ userId: "admin_123" });
    mockGetUser.mockResolvedValue({ publicMetadata: { role: "admin" } });
    mockGetUserList.mockResolvedValue({
      data: [
        {
          id: "user_1",
          emailAddresses: [{ emailAddress: "a@b.com" }],
          firstName: "Alice",
          lastName: "Smith",
          publicMetadata: { role: "viewer", endpointIds: ["testnet"] },
        },
      ],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].email).toBe("a@b.com");
  });
});
