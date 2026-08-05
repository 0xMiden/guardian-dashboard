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

/** The Guardian declining an account for good: no Miden vault to read. */
const refusal = () =>
  new GuardianOperatorHttpError(422, "Unprocessable Entity", "", {
    message: "unsupported_for_network",
    retryable: false,
  });

/**
 * `account_data_unavailable`, verbatim from the gateway.fm Guardian under
 * concurrent load. The Guardian says `retryable: true`, so the account is
 * unread rather than refused.
 */
const temporarilyUnavailable = () =>
  new GuardianOperatorHttpError(503, "Service Unavailable", "", {
    message: "This account's data is temporarily unavailable. Please try again.",
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
      if (id === "0x1") throw refusal();
      return snapshot(10);
    });
    const { totals, complete } = await getSnapshotTotalsChecked(client, "ep", rows(3));
    expect(complete).toBe(true);
    expect(Object.keys(totals)).toEqual(["0x0", "0x2"]);
  });

  // The Guardian marks this one retryable, so it is unread. Publishing a sum
  // without it would be the 429 bug again wearing a different status code.
  it("treats a retryable failure as unread rather than attempted", async () => {
    const { client } = reader((id) => {
      if (id === "0x1") throw temporarilyUnavailable();
      return snapshot(10);
    });
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(3));
    expect(complete).toBe(false);
  });

  // Unlike a 429, one unavailable account says nothing about the next.
  it("keeps reading the rest of the pass after a retryable failure", async () => {
    const { client, getAccountSnapshot } = reader((id) => {
      if (id === "0x1") throw temporarilyUnavailable();
      return snapshot(10);
    });
    const { totals } = await getSnapshotTotalsChecked(client, "ep", rows(60));
    expect(getAccountSnapshot).toHaveBeenCalledTimes(60);
    expect(Object.keys(totals)).toHaveLength(59);
  });

  // No HTTP answer at all. We did not read it, so it cannot count as attempted.
  it("treats a network failure as unread", async () => {
    const { client } = reader((id) => {
      if (id === "0x1") throw new Error("socket hang up");
      return snapshot(10);
    });
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(3));
    expect(complete).toBe(false);
  });

  // The whole point of dropping the ramp: a Guardian that can take it gets read
  // in one pass, so the total lands from the mount fetch alone rather than
  // needing six consecutive polls to reach the same serverless instance.
  it("reads every outstanding account in one pass by default", async () => {
    const { client, getAccountSnapshot } = reader();
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(1073));
    expect(getAccountSnapshot).toHaveBeenCalledTimes(1073);
    expect(complete).toBe(true);
  });
});

// A 429 means the account went unread. Counting it as attempted let a
// rate-limited Guardian publish a sum that was quietly missing accounts.
describe("a Guardian that pushes back", () => {
  const reader = (impl?: (id: string) => unknown) => {
    const getAccountSnapshot = vi.fn(async (id: string) => (impl ? impl(id) : snapshot(10)));
    return { client: { getAccountSnapshot } as never, getAccountSnapshot };
  };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => account(`0x${i}`, 1000 + i));

  it("reports incomplete when a 429 cost it accounts", async () => {
    const { client } = reader((id) => {
      if (id === "0x3") throw rateLimit();
      return snapshot(10);
    });
    const { complete } = await getSnapshotTotalsChecked(client, "ep", rows(50));
    expect(complete).toBe(false);
  });

  it("stops the pass at the first 429 instead of collecting more", async () => {
    const { client, getAccountSnapshot } = reader((id) => {
      if (id === "0x3") throw rateLimit();
      return snapshot(10);
    });
    await getSnapshotTotals(client, "ep", rows(500));
    // Concurrency is 10, so the batch holding 0x3 finishes and no further batch
    // starts. Nothing like all 500.
    expect(getAccountSnapshot).toHaveBeenCalledTimes(10);
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

  // A pass has to end inside the serverless invocation. On a paced Guardian each
  // read costs real wall-clock time, so this is what bounds it now that there is
  // no count-based ceiling.
  it("stops at the deadline and reports incomplete", async () => {
    const { getAccountSnapshot } = reader(() => snapshot(10));
    const slow = {
      getAccountSnapshot: async (id: string) => {
        await new Promise((r) => setTimeout(r, 5));
        return getAccountSnapshot(id);
      },
    } as never;

    const { complete } = await getSnapshotTotalsChecked(slow, "ep-deadline", rows(500), {
      deadlineMs: 20,
    });

    expect(complete).toBe(false);
    expect(getAccountSnapshot.mock.calls.length).toBeLessThan(500);
  });

  it("resumes from the snapshot cache on the pass after a deadline", async () => {
    const { client, getAccountSnapshot } = reader();
    const all = rows(200);

    const first = await getSnapshotTotalsChecked(client, "ep-resume", all, { deadlineMs: 0 });
    const readFirst = getAccountSnapshot.mock.calls.length;
    expect(first.complete).toBe(false);
    expect(readFirst).toBeGreaterThan(0);

    getAccountSnapshot.mockClear();
    const second = await getSnapshotTotalsChecked(client, "ep-resume", all);
    // The accounts read before the deadline are cache hits, so the second pass
    // only pays for the remainder.
    expect(getAccountSnapshot.mock.calls.length).toBe(200 - readFirst);
    expect(second.complete).toBe(true);
  });
});

