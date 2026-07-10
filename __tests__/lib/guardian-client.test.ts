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
    url: "https://node.test",
    network: "test",
    commitment: "0xcommitment",
    privateKey: "0xkey",
  });
  return {
    getEndpoint: vi.fn((id: string) => endpoint(id)),
    getEndpoints: vi.fn(() => [endpoint("test")]),
  };
});

import { getGuardianClient } from "@/lib/guardian-client";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";

const rateLimitError = () =>
  new GuardianOperatorHttpError(429, "Too Many Requests", "rate limited", {
    retryAfterSecs: 0,
  } as never);

const page = { items: [], nextCursor: null };

beforeEach(() => {
  vi.clearAllMocks();
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

  it("fails fast when the node asks to retry after longer than the cap", async () => {
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
