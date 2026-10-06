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

vi.mock("@/lib/token-registry", () => ({
  normalizeAmount: (_faucetId: string, amount: string) => {
    const n = Number(amount);
    if (Number.isNaN(n)) throw new Error(`Invalid token amount: "${amount}"`);
    return n;
  },
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
});

describe("snapshot cache", () => {
  const reader = (impl?: (id: string) => unknown) => {
    const getAccountSnapshot = vi.fn(async (id: string) => (impl ? impl(id) : snapshot(10)));
    return { client: { getAccountSnapshot } as never, getAccountSnapshot };
  };

  it("skips accounts whose version has not moved", async () => {
    const rows = [account("0xa", 1000), account("0xb", 2000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);

    getAccountSnapshot.mockClear();
    const second = await getSnapshotTotals(client, "ep", rows);
    expect(getAccountSnapshot).not.toHaveBeenCalled();
    expect(second).toEqual({ "0xa": 10, "0xb": 10 });
  });

  // The freshness guarantee: a changed account must never serve a cached value.
  it("refetches an account whose updatedAt moved", async () => {
    const before = account("0xa", 5000);
    const { client, getAccountSnapshot } = reader(() => snapshot(10));
    await getSnapshotTotals(client, "ep", [before]);

    getAccountSnapshot.mockClear();
    getAccountSnapshot.mockResolvedValue(snapshot(99));
    const after = await getSnapshotTotals(client, "ep", [account("0xa", 1000)]);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1);
    expect(after).toEqual({ "0xa": 99 });
  });

  it("never caches a row with no version, in either direction", async () => {
    const rows = [{ accountId: "0xa", updatedAt: "" }];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", rows);
    await getSnapshotTotals(client, "ep", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);
    expect(countSnapshotMisses("ep", rows)).toBe(1);
  });

  it("refresh bypasses a warm entry", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", rows);
    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", rows, { refresh: true });
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1);
  });

  // Regression guard for 23062a3 / c7f5133: a failure must not be cached as a
  // number, and must not silently become zero.
  it("omits a failed snapshot and does not cache the failure", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader(() => { throw new Error("boom"); });
    const first = await getSnapshotTotals(client, "ep", rows);
    expect(first).toEqual({});

    getAccountSnapshot.mockClear();
    getAccountSnapshot.mockResolvedValue(snapshot(4));
    const second = await getSnapshotTotals(client, "ep", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1); // retried, not cached as 0
    expect(second).toEqual({ "0xa": 4 });
  });

  it("still throws on a malformed amount rather than corrupting the total", async () => {
    const { client } = reader(() => ({ vault: { fungible: [{ faucetId: "0xf", amount: "not-a-number" }] } }));
    await expect(getSnapshotTotals(client, "ep", [account("0xa", 1000)])).rejects.toThrow(/Invalid token amount/);
  });

  it("keeps endpoints separate", async () => {
    const rows = [account("0xa", 1000)];
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "one", rows);
    await getSnapshotTotals(client, "two", rows);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(2);
  });
});
