import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSnapshotTotals, countSnapshotMisses, __resetAccountCaches } from "@/lib/account-cache";

/**
 * What is left of this module after Guardian 0.18.0.
 *
 * The inventory walk, the per-pass fetch budget and the rate-limit/deadline
 * handling are gone, and so are their tests: `GET /dashboard/stats` computes
 * those aggregates server-side now, and the two route suites cover the mapping.
 * The cases below are the per-account half, which the accounts table still
 * needs because the stats aggregate has no per-row equivalent.
 */

// A book that prices faucet "0xf" at $1 per base unit and nothing else, so the
// numbers below read as themselves and "0xu" stands for an unpriced token.
let rate = 1;
vi.mock("@/lib/prices", () => ({
  priceBook: async () => ({
    usd: (faucetId: string, amount: string) => {
      const n = Number(amount);
      if (Number.isNaN(n)) throw new Error(`Invalid token amount: "${amount}"`);
      return faucetId === "0xf" ? n * rate : undefined;
    },
  }),
}));

const NOW = new Date("2026-07-29T12:00:00Z").getTime();

const account = (id: string, ageMs: number) => ({
  accountId: id,
  updatedAt: new Date(NOW - ageMs).toISOString(),
});

const snapshot = (amount: number) => ({ vault: { fungible: [{ faucetId: "0xf", amount: String(amount) }] } });

beforeEach(() => {
  __resetAccountCaches();
  vi.clearAllMocks();
  rate = 1;
});

describe("snapshot cache", () => {
  const reader = (impl?: (id: string) => unknown) => {
    const getAccountSnapshot = vi.fn(async (id: string) => (impl ? impl(id) : snapshot(10)));
    return { client: { getAccountSnapshot } as never, getAccountSnapshot };
  };

  it("skips accounts whose version has not moved", async () => {
    const rows = [account("0xa", 1000), account("0xb", 2000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);

    getAccountSnapshot.mockClear();
    const second = await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    expect(getAccountSnapshot).not.toHaveBeenCalled();
    expect(second).toEqual({ "0xa": 10, "0xb": 10 });
  });

  // The freshness guarantee: a changed account must never serve a cached value.
  it("refetches an account whose updatedAt moved", async () => {
    const before = account("0xa", 5000);
    const { client, getAccountSnapshot } = reader(() => snapshot(10));
    await getSnapshotTotals(client, "ep", "MidenTestnet", [before]);

    getAccountSnapshot.mockClear();
    getAccountSnapshot.mockResolvedValue(snapshot(99));
    const after = await getSnapshotTotals(client, "ep", "MidenTestnet", [account("0xa", 1000)]);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(after).toEqual({ "0xa": 99 });
  });

  it("never caches a row with no version, in either direction", async () => {
    const rows = [{ accountId: "0xa", updatedAt: "" }];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);
    expect(countSnapshotMisses("ep", rows)).toBe(1);
  });

  it("refresh bypasses a warm entry", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", "MidenTestnet", rows, { refresh: true });
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1);
  });

  // Regression guard for 23062a3 / c7f5133: a failure must not be cached as a
  // number, and must not silently become zero.
  it("omits a failed snapshot and does not cache the failure", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader(() => { throw new Error("boom"); });
    const first = await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    expect(first).toEqual({});

    getAccountSnapshot.mockClear();
    getAccountSnapshot.mockResolvedValue(snapshot(4));
    const second = await getSnapshotTotals(client, "ep", "MidenTestnet", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1); // retried, not cached as 0
    expect(second).toEqual({ "0xa": 4 });
  });

  it("still throws on a malformed amount rather than corrupting the total", async () => {
    const { client } = reader(() => ({ vault: { fungible: [{ faucetId: "0xf", amount: "not-a-number" }] } }));
    await expect(getSnapshotTotals(client, "ep", "MidenTestnet", [account("0xa", 1000)])).rejects.toThrow(/Invalid token amount/);
  });

  // The cache holds the vault, not its dollar value: a price that moved must
  // show on a row whose version has not, without another Guardian request.
  it("re-prices a cached vault when the feed moves", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader(() => snapshot(10));
    expect(await getSnapshotTotals(client, "ep", "MidenTestnet", rows)).toEqual({ "0xa": 10 });

    rate = 2;
    getAccountSnapshot.mockClear();
    expect(await getSnapshotTotals(client, "ep", "MidenTestnet", rows)).toEqual({ "0xa": 20 });
    expect(getAccountSnapshot).not.toHaveBeenCalled();
  });

  // Three different claims, three different answers: an empty vault is $0, a
  // vault of unpriced tokens is `null`, and only the priced part of a mixed
  // vault is summed.
  it("tells an empty vault from one nothing prices", async () => {
    const vaults: Record<string, { faucetId: string; amount: string }[]> = {
      "0xa": [],
      "0xb": [{ faucetId: "0xu", amount: "500" }],
      "0xc": [{ faucetId: "0xu", amount: "500" }, { faucetId: "0xf", amount: "7" }],
    };
    const { client } = reader((id) => ({ vault: { fungible: vaults[id] } }));
    const rows = [account("0xa", 1000), account("0xb", 1000), account("0xc", 1000)];
    expect(await getSnapshotTotals(client, "ep", "MidenTestnet", rows)).toEqual({ "0xa": 0, "0xb": null, "0xc": 7 });
  });

  it("keeps endpoints separate", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "one", "MidenTestnet", rows);
    await getSnapshotTotals(client, "two", "MidenTestnet", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);
  });
});
