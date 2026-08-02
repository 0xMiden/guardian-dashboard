import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getInventory, getSnapshotTotalsChecked, INVENTORY_TTL_MS } from "@/lib/account-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MS_7D = 7 * 24 * 60 * 60 * 1000;

// Per-invocation ceiling on snapshot fetches, and it holds on a manual refresh
// too. The node allows 60 requests a minute across every route, so this figure
// must not starve the rows the user is actually looking at.
const MAX_SNAPSHOTS_PER_PASS = 25;

// Warm-up is the cold-instance case, where no total has ever been published and
// the card is showing "Calculating…". There the client polls every 20s instead
// of every 60s (see AssetsCard), so the per-pass ceiling has to come down or
// three passes a minute would spend 75 of the node's 60. Twelve a pass is
// 36/minute: still faster overall than the old 25/minute, and it moves the
// progress count three times a minute instead of once, which is the difference
// between "working" and "stuck".
const WARMING_SNAPSHOTS_PER_PASS = 12;

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

    // `refresh` is deliberately NOT forwarded here, and the ceiling holds on a
    // refresh too. Snapshots are keyed by `accountId@updatedAt`, so a cache hit
    // is a value the node itself says cannot have changed: re-reading it buys
    // nothing and costs one request out of 60. What a refresh does buy is the
    // re-walked inventory above, which surfaces the accounts whose version
    // moved, and those miss the cache and are refetched on their own.
    const { totals, complete } = await getSnapshotTotalsChecked(client, endpointId, active7d, {
      maxFetches: cached ? MAX_SNAPSHOTS_PER_PASS : WARMING_SNAPSHOTS_PER_PASS,
    });

    // Publishing a partial sum would show a confidently wrong number. Until the
    // pass covers every active account, keep serving the last complete answer.
    // With no such answer yet, say how far along the walk is: the counts are
    // already in hand, and a number that climbs is the only evidence the user
    // has that waiting will end.
    if (!complete) {
      return cached ?? {
        usd7d: null,
        computedAt: null,
        warming: true,
        done: Object.keys(totals).length,
        total: active7d.length,
      };
    }

    const usd7d = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const result = { usd7d, computedAt: new Date().toISOString() };
    cache.set(endpointId, result);
    return result;
  });
}
