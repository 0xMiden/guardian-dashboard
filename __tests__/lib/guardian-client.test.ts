import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  challenge: vi.fn(),
  verify: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@openzeppelin/guardian-operator-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openzeppelin/guardian-operator-client")>();
  return {
    ...actual,
    GuardianOperatorHttpClient: class {
      challenge = mocks.challenge;
      verify = mocks.verify;
      listAccounts = mocks.listAccounts;
    },
  };
});

vi.mock("@/lib/falcon", () => ({ signDigest: vi.fn(async () => "0xsig") }));

vi.mock("@/lib/endpoints", () => {
  const endpoint = (id: string) => ({
    id,
    label: "Test",
    url: "https://Guardian.test",
    network: "test",
    commitment: "0xcommitment",
    privateKey: "0xkey",
  });
  return {
    getEndpoint: vi.fn((id: string) => endpoint(id)),
    getEndpoints: vi.fn(() => [endpoint("test")]),
  };
});

import { getGuardianClient, __resetGuardianClients } from "@/lib/guardian-client";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";

const rateLimitError = () =>
  new GuardianOperatorHttpError(429, "Too Many Requests", "rate limited", {
    retryAfterSecs: 0,
  } as never);

const page = { items: [], nextCursor: null };

const TEST_PACE_MS = 20;

beforeEach(() => {
  vi.clearAllMocks();
  // Fresh client state per test, and a pacing interval short enough to assert
  // spacing without spending real seconds on it.
  __resetGuardianClients(TEST_PACE_MS);
  mocks.challenge.mockResolvedValue({ challenge: { signingDigest: "0xdigest" } });
  mocks.verify.mockResolvedValue({ success: true });
});

describe("guardian-client withRetry", () => {
  it("retries after a 429 and succeeds", async () => {
    mocks.listAccounts.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(page);
    const result = await getGuardianClient("retry-429").listAccounts();
    expect(result).toEqual(page);
    expect(mocks.listAccounts).toHaveBeenCalledTimes(2);
  });

  it("fails fast when the Guardian asks to retry after longer than the cap", async () => {
    mocks.listAccounts.mockRejectedValue(
      new GuardianOperatorHttpError(429, "Too Many Requests", "sustained limit", {
        retryAfterSecs: 60,
      } as never)
    );
    await expect(getGuardianClient("sustained-429").listAccounts()).rejects.toMatchObject({ status: 429 });
    // no futile retries — the caller keeps stale data and SWR retries later
    expect(mocks.listAccounts).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting 429 retries", async () => {
    mocks.listAccounts.mockRejectedValue(rateLimitError());
    await expect(getGuardianClient("exhaust-429").listAccounts()).rejects.toMatchObject({ status: 429 });
    // initial attempt + 2 retries
    expect(mocks.listAccounts).toHaveBeenCalledTimes(3);
  });

  it("re-authenticates once on 401", async () => {
    mocks.listAccounts
      .mockRejectedValueOnce(new GuardianOperatorHttpError(401, "Unauthorized", "", null))
      .mockResolvedValueOnce(page);
    const result = await getGuardianClient("reauth-401").listAccounts();
    expect(result).toEqual(page);
    expect(mocks.listAccounts).toHaveBeenCalledTimes(2);
    expect(mocks.challenge).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent auth handshakes", async () => {
    let releaseChallenge!: (v: { challenge: { signingDigest: string } }) => void;
    mocks.challenge.mockReturnValue(new Promise((resolve) => { releaseChallenge = resolve; }));
    mocks.listAccounts.mockResolvedValue(page);

    const client = getGuardianClient("single-flight");
    const calls = Promise.all([client.listAccounts(), client.listAccounts(), client.listAccounts()]);
    releaseChallenge({ challenge: { signingDigest: "0xdigest" } });
    await calls;

    expect(mocks.challenge).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.listAccounts).toHaveBeenCalledTimes(3);
  });
});

/**
 * A Guardian's limit follows the operator's profile: prod is 200/sec and
 * 5000/min, dev is 10/sec and 60/min. Measured 2026-08-03, two dev-profile
 * Guardians cut off at ~57 requests and returned `retry-after: 60`, locking out
 * every route for a minute, while paced at 50/min one served 100 of 100 with no
 * 429 at all. A prod-profile Guardian must not be slowed to dev speed, so pacing
 * stays off until a Guardian proves it needs it.
 */
describe("per-endpoint pacing", () => {
  it("does not pace a Guardian that has never limited us", async () => {
    mocks.listAccounts.mockResolvedValue(page);
    const client = getGuardianClient("unpaced");

    const started = Date.now();
    for (let i = 0; i < 8; i++) await client.listAccounts();
    const elapsed = Date.now() - started;

    expect(client.pacingIntervalMs()).toBe(0);
    // Eight sequential calls with no artificial delay between them.
    expect(elapsed).toBeLessThan(500);
  });

  it("engages pacing after one 429 and keeps it on", async () => {
    mocks.listAccounts
      .mockRejectedValueOnce(
        new GuardianOperatorHttpError(429, "Too Many Requests", "sustained", { retryAfterSecs: 60 } as never),
      )
      .mockResolvedValue(page);
    const client = getGuardianClient("engages");

    expect(client.pacingIntervalMs()).toBe(0);
    await expect(client.listAccounts()).rejects.toMatchObject({ status: 429 });

    // Even though that 429 was NOT retried (60s is past the fail-fast cap), the
    // Guardian still told us its capacity and every later route must respect it.
    expect(client.pacingIntervalMs()).toBeGreaterThan(0);
  });

  it("spaces requests once paced", async () => {
    mocks.listAccounts
      .mockRejectedValueOnce(
        new GuardianOperatorHttpError(429, "Too Many Requests", "sustained", { retryAfterSecs: 60 } as never),
      )
      .mockResolvedValue(page);
    const client = getGuardianClient("spaces");
    await expect(client.listAccounts()).rejects.toMatchObject({ status: 429 });

    const interval = client.pacingIntervalMs();
    const started = Date.now();
    await client.listAccounts();
    await client.listAccounts();
    const elapsed = Date.now() - started;

    // Two paced calls sit at least one interval apart. Generous lower bound so
    // this asserts the spacing exists rather than pinning the exact rate.
    expect(elapsed).toBeGreaterThanOrEqual(interval * 0.8);
  });

  it("charges the liveness ping against the budget without making it wait", async () => {
    mocks.listAccounts
      .mockRejectedValueOnce(
        new GuardianOperatorHttpError(429, "Too Many Requests", "sustained", { retryAfterSecs: 60 } as never),
      )
      .mockResolvedValue(page);
    const client = getGuardianClient("health-paced");
    await expect(client.listAccounts()).rejects.toMatchObject({ status: 429 });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as never));
    const started = Date.now();
    const health = await client.checkHealth();
    const elapsed = Date.now() - started;
    vi.unstubAllGlobals();

    expect(health.status).toBe("up");
    // A health check that queued behind a snapshot burst would report a healthy
    // Guardian as down, so it never waits, it only spends a slot.
    expect(elapsed).toBeLessThan(200);
  });
});
