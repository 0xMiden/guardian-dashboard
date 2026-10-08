import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import { headers } from "next/headers";
import { GET } from "@/app/api/accounts/stats/route";

const mockGetDashboardStats = vi.fn();

vi.mock("@/lib/guardian-client", () => ({
  getGuardianClient: vi.fn(() => ({ getDashboardStats: mockGetDashboardStats })),
}));

function mockHeaders(endpointId: string) {
  vi.mocked(headers).mockResolvedValue({
    get: (key: string) => (key === "x-guardian-endpoint-id" ? endpointId : null),
  } as any);
}

/**
 * A `/dashboard/stats` payload, shaped like the live one from
 * openzeppelin_devnet (0.18.0) on 2026-10-06.
 */
const stats = (over: Record<string, unknown> = {}) => ({
  asOf: "2026-10-06T16:29:12.837967517+00:00",
  updatedSince: null,
  refreshIntervalSeconds: 300,
  version: 3225,
  accounts: {
    total: 270,
    byLifecycle: { active: 269, paused: 0, released: 1 },
    byAuthMethod: { miden_ecdsa: 238, miden_falcon: 32 },
    byAuthMethodAndSignerCount: [
      { authMethod: "miden_ecdsa", authorizedSignerCount: 1, count: 19 },
      { authMethod: "miden_ecdsa", authorizedSignerCount: 2, count: 218 },
      { authMethod: "miden_ecdsa", authorizedSignerCount: 3, count: 1 },
      { authMethod: "miden_falcon", authorizedSignerCount: 1, count: 4 },
      { authMethod: "miden_falcon", authorizedSignerCount: 2, count: 21 },
      { authMethod: "miden_falcon", authorizedSignerCount: 3, count: 7 },
    ],
    updatedWithin7d: 201,
    updatedWithin30d: 270,
    ...(over.accounts as object),
  },
  assets: { eligible: 270, covered: 270, skipped: {}, complete: true, fungible: [], nonFungible: [] },
});

const notFound = () => new GuardianOperatorHttpError(404, "Not Found", "", {} as never);
const dataUnavailable = () =>
  new GuardianOperatorHttpError(503, "Service Unavailable", "", {
    code: "data_unavailable",
    message: "Statistics are not yet available. Please try again shortly.",
    retryable: true,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders("testnet");
});

describe("GET /api/accounts/stats", () => {
  it("costs exactly one Guardian request", async () => {
    mockGetDashboardStats.mockResolvedValue(stats());
    await GET();
    expect(mockGetDashboardStats).toHaveBeenCalledTimes(1);
  });

  // The whole mapping in one assertion, against the numbers the live devnet
  // Guardian returned. temp/parity-stats.mjs proved these equal to what the
  // paged walk this route used to run produced for the same Guardian.
  it("maps the aggregate onto the fields the stat strip reads", async () => {
    mockGetDashboardStats.mockResolvedValue(stats());
    const body = await (await GET()).json();
    expect(body).toEqual({
      total: 270,
      counted: 270,
      count7d: 201,
      count30d: 270,
      wallet: 218,
      other: 52,
      active: 269,
      frozen: 0,
      released: 1,
      asOf: "2026-10-06T16:29:12.837967517+00:00",
    });
  });

  // A wallet is ECDSA with two signers. Neither a third signer nor a Falcon
  // account with two may be counted, or the table's filter labels stop matching
  // the rows the filter actually selects.
  it("counts only ECDSA accounts with two signers as wallets", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({
        accounts: {
          total: 10,
          byLifecycle: { active: 10, paused: 0, released: 0 },
          byAuthMethod: { miden_ecdsa: 7, miden_falcon: 3 },
          byAuthMethodAndSignerCount: [
            { authMethod: "miden_ecdsa", authorizedSignerCount: 2, count: 4 },
            { authMethod: "miden_ecdsa", authorizedSignerCount: 3, count: 3 },
            { authMethod: "miden_falcon", authorizedSignerCount: 2, count: 3 },
          ],
          updatedWithin7d: 10,
          updatedWithin30d: 10,
        },
      }),
    );
    const body = await (await GET()).json();
    expect(body.wallet).toBe(4);
    expect(body.other).toBe(6);
  });

  it("reports no wallets when the breakdown is empty rather than guessing", async () => {
    mockGetDashboardStats.mockResolvedValue(
      stats({
        accounts: {
          total: 5,
          byLifecycle: { active: 5, paused: 0, released: 0 },
          byAuthMethod: {},
          byAuthMethodAndSignerCount: [],
          updatedWithin7d: 5,
          updatedWithin30d: 5,
        },
      }),
    );
    const body = await (await GET()).json();
    expect(body.wallet).toBe(0);
    expect(body.other).toBe(5);
  });

  // openzeppelin (23,303 accounts) and koda were still on 0.17.0 on 2026-10-06.
  // A 404 here means the server predates the endpoint, which is a different
  // thing from the Guardian being unreachable, and must not render as one.
  it("says unsupported on a Guardian older than 0.18.0", async () => {
    mockGetDashboardStats.mockRejectedValue(notFound());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unsupported: true });
  });

  it("says warming while a 0.18.0 Guardian has published nothing yet", async () => {
    mockGetDashboardStats.mockRejectedValue(dataUnavailable());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ warming: true });
  });

  // Everything else is a real failure and keeps its status, so ErrorPanel can
  // name it instead of the page showing a blank strip.
  it("forwards a genuine Guardian error", async () => {
    mockGetDashboardStats.mockRejectedValue(
      new GuardianOperatorHttpError(403, "Forbidden", "", {
        code: "insufficient_operator_permission",
        message: "Missing permission.",
        missingPermissions: ["dashboard:read"],
      } as never),
    );
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).missingPermissions).toEqual(["dashboard:read"]);
  });

  it("returns 400 with no endpoint selected", async () => {
    mockHeaders("");
    expect((await GET()).status).toBe(400);
  });
});
