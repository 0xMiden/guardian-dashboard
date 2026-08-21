import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getInventory } from "@/lib/account-cache";
import { isWalletAccount, accountState } from "@/lib/format";

export const dynamic = "force-dynamic";

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

// The walk runs to the end of the list rather than stopping at 30 days, because
// the Accounts table's kind counts have to describe the Guardian instead of
// whichever page the user has scrolled to. It costs pages the 30-day stop used
// to skip, though fewer of them than it used to: measured 2026-08-21, 15
// requests instead of 13 on the OZ Guardian, which holds 7,198 accounts of
// which 6,054 were created inside the last 30 days. Once per cache TTL.
// `asset-totals` is unaffected, since it filters its own 7-day window out of
// whatever inventory it is handed, and a deeper walk satisfies its shallower
// one from the same cache entry.
const FULL_WALK = Number.POSITIVE_INFINITY;

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";

  return guardianRoute(async (client) => {
    const now = Date.now();

    let total: number | null = null;
    try {
      const info = await client.getDashboardInfo();
      total = info.totalAccountCount;
    } catch {
      // older server without /dashboard/info — total stays null
    }

    // Shares the paged walk with asset-totals rather than running its own.
    const accounts = await getInventory(client, endpointId, FULL_WALK, now, { refresh });

    let count7d = 0;
    let count30d = 0;
    let wallet = 0;
    // Free: the walk above already holds every account, so the states cost a
    // comparison each rather than a `paused: true` query of their own. Reuses
    // `accountState` so these counts and the table's badges cannot disagree.
    let frozen = 0;
    let released = 0;
    for (const item of accounts) {
      const age = now - new Date(item.updatedAt).getTime();
      if (age <= MS_7D)  count7d++;
      if (age <= MS_30D) count30d++;
      if (isWalletAccount(item)) wallet++;
      const state = accountState(item.stateStatus, item.pausedAt, item.releasedAt);
      if (state === "frozen") frozen++;
      else if (state === "released") released++;
    }

    // `counted` is what the walk actually saw. The table's chips read it rather
    // than `total`, so the three of them always sum, even on a Guardian whose
    // reported total disagrees with what the list endpoint hands back.
    return { total, count7d, count30d, counted: accounts.length, wallet, other: accounts.length - wallet, frozen, released };
  });
}
