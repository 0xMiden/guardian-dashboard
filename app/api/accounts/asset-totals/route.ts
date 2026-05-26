import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;
const CACHE_TTL = 5 * 60 * 1000;

type AssetTotals = {
  usd7d: number;
  usd30d: number;
  computedAt: string;
  perAccount: Record<string, number>;
};

// Module-level cache — persists across requests in the same Node.js process.
const cache = new Map<string, AssetTotals>();
const computing = new Set<string>();

async function computeTotals(endpointId: string): Promise<void> {
  try {
    const client = getGuardianClient(endpointId);
    const now = Date.now();

    // Collect accounts active in last 30d (newest-first sort allows early stop)
    const active30d: string[] = [];
    const active7d: string[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = await client.listAccounts({ limit: 100, cursor });
      if (!page.items.length) break;

      for (const item of page.items) {
        const age = now - new Date(item.updatedAt).getTime();
        if (age <= MS_30D) {
          active30d.push(item.accountId);
          if (age <= MS_7D) active7d.push(item.accountId);
        }
      }

      const oldestAge = now - new Date(page.items[page.items.length - 1].updatedAt).getTime();
      if (oldestAge > MS_30D || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    // Fetch snapshots for 30d-active accounts (7d is a subset)
    const CONCURRENCY = 10;
    const vaultTotals = new Map<string, number>();

    for (let i = 0; i < active30d.length; i += CONCURRENCY) {
      const batch = active30d.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((id) => client.getAccountSnapshot(id))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          const total = r.value.vault.fungible.reduce(
            (sum, a) => sum + Number(a.amount), 0
          );
          vaultTotals.set(active30d[i + j], total);
        }
      }
    }

    const usd30d = active30d.reduce((sum, id) => sum + (vaultTotals.get(id) ?? 0), 0);
    const usd7d  = active7d.reduce((sum, id)  => sum + (vaultTotals.get(id) ?? 0), 0);
    const perAccount = Object.fromEntries(vaultTotals);

    cache.set(endpointId, { usd7d, usd30d, computedAt: new Date().toISOString(), perAccount });
  } catch {
    // Leave any previous cached value intact; don't pollute with partial errors
  } finally {
    computing.delete(endpointId);
  }
}

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });

  const cached = cache.get(endpointId);
  if (cached && Date.now() - new Date(cached.computedAt).getTime() < CACHE_TTL) {
    return NextResponse.json(cached);
  }

  if (!computing.has(endpointId)) {
    computing.add(endpointId);
    computeTotals(endpointId); // fire-and-forget
  }

  return NextResponse.json({ inProgress: true, cached: cached ?? null });
}
