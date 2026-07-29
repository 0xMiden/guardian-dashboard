import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getInventory, getSnapshotTotalsChecked, INVENTORY_TTL_MS } from "@/lib/account-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MS_7D = 7 * 24 * 60 * 60 * 1000;

// Per-invocation ceiling on snapshot fetches. The node allows 60 requests a
// minute across every route, and this one poll must not consume the whole
// budget and starve the pages the user is actually looking at. A cold instance
// therefore warms up over a few polls instead of in one burst.
const MAX_SNAPSHOTS_PER_PASS = 25;

type AssetTotals = { usd7d: number; computedAt: string };
// ponytail: per-serverless-instance cache — cold instances recompute; good
// enough while account counts stay small (upgrade path: KV / CDN caching)
const cache = new Map<string, AssetTotals>();

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  const cached = cache.get(endpointId);
  // TTL stays at 60s: it was cut from 5 min deliberately (566be23) because
  // users saw stale totals. The request saving comes from the snapshot cache,
  // not from holding this answer for longer.
  if (!refresh && cached && Date.now() - new Date(cached.computedAt).getTime() < INVENTORY_TTL_MS) {
    return NextResponse.json(cached);
  }

  return guardianRoute(async (client) => {
    const now = Date.now();
    const accounts = await getInventory(client, endpointId, MS_7D, now, { refresh });
    const active7d = accounts.filter((a) => now - new Date(a.updatedAt).getTime() <= MS_7D);

    const { totals, complete } = await getSnapshotTotalsChecked(client, endpointId, active7d, {
      refresh,
      maxFetches: refresh ? Infinity : MAX_SNAPSHOTS_PER_PASS,
    });

    // Publishing a partial sum would show a confidently wrong number. Until the
    // pass covers every active account, keep serving the last complete answer
    // (the card renders nothing when there isn't one yet).
    if (!complete) return cached ?? { usd7d: null, computedAt: null, warming: true };

    const usd7d = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const result = { usd7d, computedAt: new Date().toISOString() };
    cache.set(endpointId, result);
    return result;
  });
}
