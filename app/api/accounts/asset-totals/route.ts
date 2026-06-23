import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MS_7D = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL = 5 * 60 * 1000;
const CONCURRENCY = 10;

type AssetTotals = { usd7d: number; computedAt: string };
const cache = new Map<string, AssetTotals>();

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });

  const cached = cache.get(endpointId);
  if (cached && Date.now() - new Date(cached.computedAt).getTime() < CACHE_TTL) {
    return NextResponse.json(cached);
  }

  const client = getGuardianClient(endpointId);
  const now = Date.now();
  const active7d: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await client.listAccounts({ limit: 100, cursor });
    if (!page.items.length) break;

    let allOld = true;
    for (const item of page.items) {
      if (now - new Date(item.updatedAt).getTime() <= MS_7D) {
        active7d.push(item.accountId);
        allOld = false;
      }
    }
    if (allOld || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  let usd7d = 0;
  for (let i = 0; i < active7d.length; i += CONCURRENCY) {
    const batch = active7d.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((id) => client.getAccountSnapshot(id)));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        usd7d += r.value.vault.fungible.reduce((sum, a) => sum + Number(a.amount), 0);
      }
    }
  }

  const result = { usd7d, computedAt: new Date().toISOString() };
  cache.set(endpointId, result);
  return NextResponse.json(result);
}
