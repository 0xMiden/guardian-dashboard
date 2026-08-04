import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import {
  getInventory,
  getSnapshotTotals,
  getSnapshotTotalsChecked,
  countSnapshotMisses,
  __resetAccountCaches,
  INVENTORY_TTL_MS,
} from "@/lib/account-cache";

/** What a Guardian answers when it wants us to back off. lambda sends 60s. */
const rateLimit = () =>
  new GuardianOperatorHttpError(429, "Too Many Requests", "", {
    message: "Rate limit exceeded",
    retryAfterSecs: 60,
    retryable: true,
  });

vi.mock("@/lib/token-registry", () => ({
  normalizeAmount: (_faucetId: string, amount: string) => {
    const n = Number(amount);
    if (Number.isNaN(n)) throw new Error(`Invalid token amount: "${amount}"`);
    return n;
  },
}));

const MS_7D = 7 * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-29T12:00:00Z").getTime();

const account = (id: string, ageMs: number) => ({
  accountId: id,
  updatedAt: new Date(NOW - ageMs).toISOString(),
});

function lister(pages: { items: ReturnType<typeof account>[]; nextCursor: string | null }[]) {
  const listAccounts = vi.fn(async ({ cursor }: { cursor?: string } = {}) => {
    const index = cursor ? Number(cursor) : 0;
    return pages[index] ?? { items: [], nextCursor: null };
  });
  return { client: { listAccounts } as never, listAccounts };
}

const snapshot = (amount: number) => ({ vault: { fungible: [{ faucetId: "0xf", amount: String(amount) }] } });

beforeEach(() => {
  __resetAccountCaches();
  vi.clearAllMocks();
});

describe("inventory cache", () => {
  it("reuses one paged walk across callers", async () => {
    const { client, listAccounts } = lister([{ items: [account("0xa", 1000)], nextCursor: null }]);
    await getInventory(client, "ep", MS_30D, NOW);
    await getInventory(client, "ep", MS_30D, NOW);
    expect(listAccounts).toHaveBeenCalledTimes(1);
  });

  // A 7-day walk stops early, so serving it to a 30-day caller would silently
  // drop every account between the two windows.
  it("does not let a shallow walk satisfy a deeper request", async () => {
    const { client, listAccounts } = lister([
      { items: [account("0xa", 1000)], nextCursor: "1" },
      { items: [account("0xb", MS_7D + 5000)], nextCursor: null },
    ]);
    const shallow = await getInventory(client, "ep", MS_7D, NOW);
    expect(shallow.map((a) => a.accountId)).toEqual(["0xa", "0xb"]);

    listAccounts.mockClear();
    const deep = await getInventory(client, "ep", MS_30D, NOW);
    expect(listAccounts).toHaveBeenCalled(); // re-walked rather than reusing
    expect(deep.map((a) => a.accountId)).toEqual(["0xa", "0xb"]);
  });

  it("keeps the deeper entry when a shallow caller follows", async () => {
    const { client, listAccounts } = lister([
      { items: [account("0xa", 1000)], nextCursor: "1" },
      { items: [account("0xb", MS_7D + 5000)], nextCursor: null },
    ]);
    await getInventory(client, "ep", MS_30D, NOW);
    await getInventory(client, "ep", MS_7D, NOW);
    listAccounts.mockClear();
    await getInventory(client, "ep", MS_30D, NOW);
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("expires so data cannot go stale without bound", async () => {
    const { client, listAccounts } = lister([{ items: [account("0xa", 1000)], nextCursor: null }]);
    await getInventory(client, "ep", MS_30D, NOW);
    await getInventory(client, "ep", MS_30D, NOW + INVENTORY_TTL_MS + 1);
    expect(listAccounts).toHaveBeenCalledTimes(2);
  });

  it("refresh re-walks an entry the polls left behind", async () => {
    const { client, listAccounts } = lister([{ items: [account("0xa", 1000)], nextCursor: null }]);
    await getInventory(client, "ep", MS_30D, NOW);
    await getInventory(client, "ep", MS_30D, NOW + 30_000, { refresh: true });
    expect(listAccounts).toHaveBeenCalledTimes(2);
  });

  it("refresh reuses a walk from the same click instead of paying twice", async () => {
    // One Refresh click asks stats (30d) and asset-totals (7d) within
    // milliseconds. The second one must not re-walk the whole list.
    const { client, listAccounts } = lister([{ items: [account("0xa", 1000)], nextCursor: null }]);
    await getInventory(client, "ep", MS_30D, NOW, { refresh: true });
    listAccounts.mockClear();
    await getInventory(client, "ep", MS_7D, NOW + 50, { refresh: true });
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("keeps endpoints separate", async () => {
    const { client, listAccounts } = lister([{ items: [account("0xa", 1000)], nextCursor: null }]);
    await getInventory(client, "one", MS_30D, NOW);
    await getInventory(client, "two", MS_30D, NOW);
    expect(listAccounts).toHaveBeenCalledTimes(2);
  });
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

describe("per-pass fetch budget", () => {
  const reader = (impl?: (id: string) => unknown) => {
    const getAccountSnapshot = vi.fn(async (id: string) => (impl ? impl(id) : snapshot(10)));
    return { client: { getAccountSnapshot } as never, getAccountSnapshot };
  };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => account(`0x${i}`, 1000 + i));

  it("never exceeds the cap in one pass", async () => {
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", rows(50), { maxFetches: 10 });
    expect(getAccountSnapshot).toHaveBeenCalledTimes(10);
  });

  it("reports incomplete while accounts remain unread", async () => {
    const { client } = reader();
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(50), { maxFetches: 10 });
    expect(complete).toBe(false);
  });

  it("makes progress across passes and completes", async () => {
    const { client, getAccountSnapshot } = reader();
    const all = rows(25);
    let complete = false;
    let passes = 0;
    while (!complete && passes < 10) {
      ({ complete } = await getSnapshotTotalsChecked(client, "ep", all, { maxFetches: 10 }));
      passes++;
    }
    expect(complete).toBe(true);
    expect(passes).toBe(3);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(25); // each account fetched once
  });

  // An account the Guardian refuses must not block the aggregate forever. Only
  // accounts we chose not to read count as incomplete.
  it("counts a refused account as attempted, not skipped", async () => {
    const { client } = reader((id) => {
      if (id === "0x1") throw new Error("unsupported_for_network");
      return snapshot(10);
    });
    const { totals, complete } = await getSnapshotTotalsChecked(client, "ep", rows(3));
    expect(complete).toBe(true);
    expect(Object.keys(totals)).toEqual(["0x0", "0x2"]);
  });

  it("starts a cold endpoint at the initial ceiling", async () => {
    const { client, getAccountSnapshot } = reader();
    await getSnapshotTotals(client, "ep", rows(40));
    expect(getAccountSnapshot).toHaveBeenCalledTimes(25);
  });
});

// Operators set their own rate limits and they differ by more than an order of
// magnitude (measured 2026-08-03: OZ served 500 reads with no 429, lambda 429'd
// after 55). One constant sized for the tightest Guardian made the largest one take
// ~28 minutes to publish a total, so the ceiling is discovered per endpoint.
describe("learned per-endpoint ceiling", () => {
  const reader = (impl?: (id: string) => unknown) => {
    const getAccountSnapshot = vi.fn(async (id: string) => (impl ? impl(id) : snapshot(10)));
    return { client: { getAccountSnapshot } as never, getAccountSnapshot };
  };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => account(`0x${i}`, 1000 + i));

  it("doubles the ceiling after a pass that filled it", async () => {
    const { client, getAccountSnapshot } = reader();
    const all = rows(400);

    await getSnapshotTotals(client, "ep", all);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(25);

    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", all);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(50);

    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", all);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(100);
  });

  // The ramp is what makes a large Guardian usable; without it the walk never
  // outruns the 20s poll and the card reads as stuck.
  it("reaches a 995-account Guardian in far fewer passes than a fixed 12", async () => {
    const { client } = reader();
    const all = rows(995);
    let complete = false;
    let passes = 0;
    while (!complete && passes < 50) {
      ({ complete } = await getSnapshotTotalsChecked(client, "ep", all));
      passes++;
    }
    expect(complete).toBe(true);
    expect(passes).toBe(6); // 25, 50, 100, 200, 400, remainder
  });

  it("halves the ceiling when the Guardian answers 429", async () => {
    let limitAfter = Infinity;
    let served = 0;
    const { client, getAccountSnapshot } = reader(() => {
      if (served++ >= limitAfter) throw rateLimit();
      return snapshot(10);
    });
    const all = rows(400);

    // Two clean passes take the ceiling to 100.
    await getSnapshotTotals(client, "ep", all);
    await getSnapshotTotals(client, "ep", all);

    // Third pass: the Guardian cuts us off partway through.
    served = 0;
    limitAfter = 30;
    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", all);

    // Fourth pass runs against the halved ceiling rather than 100 again.
    served = 0;
    limitAfter = Infinity;
    getAccountSnapshot.mockClear();
    await getSnapshotTotals(client, "ep", all);
    expect(getAccountSnapshot).toHaveBeenCalledTimes(50);
  });

  // A 429 means the account went unread. Counting it as attempted let a
  // rate-limited Guardian publish a sum that was quietly missing accounts.
  it("reports incomplete when a 429 cost it accounts", async () => {
    const { client } = reader((id) => {
      if (id === "0x3") throw rateLimit();
      return snapshot(10);
    });
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(5));
    expect(complete).toBe(false);
  });

  it("stops the pass at the first 429 instead of collecting more", async () => {
    const { client, getAccountSnapshot } = reader((id) => {
      if (id === "0x3") throw rateLimit();
      return snapshot(10);
    });
    await getSnapshotTotals(client, "ep", rows(25));
    // Concurrency is 5, so the batch holding 0x3 finishes and no further batch
    // starts: 5 attempts, not all 25.
    expect(getAccountSnapshot).toHaveBeenCalledTimes(5);
  });

  it("retries a rate-limited account on the next pass rather than caching it", async () => {
    let limited = true;
    const { client } = reader((id) => {
      if (id === "0x3" && limited) throw rateLimit();
      return snapshot(10);
    });
    const all = rows(5);

    await getSnapshotTotals(client, "ep", all);
    limited = false;
    const { totals, complete } = await getSnapshotTotalsChecked(client, "ep", all);

    expect(complete).toBe(true);
    expect(totals["0x3"]).toBe(10);
  });
});
