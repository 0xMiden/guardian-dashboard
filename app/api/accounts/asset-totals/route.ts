import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getInventory, getSnapshotTotalsChecked, INVENTORY_TTL_MS } from "@/lib/account-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MS_7D = 7 * 24 * 60 * 60 * 1000;

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

    // How many snapshots one pass may fetch is the cache layer's business, not
    // this route's: Guardians differ by more than an order of magnitude in what they
    // tolerate, so the ceiling is learned per endpoint rather than guessed here.
    //
    // `refresh` is deliberately NOT forwarded. Snapshots are keyed by
    // `accountId@updatedAt`, so a cache hit is a value the Guardian itself says
    // cannot have changed: re-reading it buys nothing and spends a request. What
    // a refresh does buy is the re-walked inventory above, which surfaces the
    // accounts whose version moved, and those miss the cache on their own.
    const { totals, complete } = await getSnapshotTotalsChecked(client, endpointId, active7d);

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
