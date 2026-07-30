import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getSnapshotTotals } from "@/lib/account-cache";

export const dynamic = "force-dynamic";

/**
 * Vault totals for the requested rows.
 *
 * `ids` carries `accountId@updatedAt` pairs. The version half is what lets the
 * cache skip accounts that provably have not changed. A bare id (no `@`) still
 * works, and bypasses the cache entirely in both directions, because a value
 * with no version has no way to ever be invalidated.
 */

// One id is one request to a node that allows 60 a minute, and `ids` arrives
// from the browser. Capped so no single call can spend the whole budget: the
// caller asks for the rows on screen, and a viewport holds ~15 of them.
const MAX_IDS = 25;

export function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const raw = url.searchParams.get("ids") ?? "";

  const accounts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS)
    .map((entry) => {
      const at = entry.lastIndexOf("@");
      return at === -1
        ? { accountId: entry, updatedAt: "" }
        : { accountId: entry.slice(0, at), updatedAt: entry.slice(at + 1) };
    });

  return guardianRoute(async (client) => {
    const endpointId = (await headers()).get("x-guardian-endpoint-id") ?? "";
    return getSnapshotTotals(client, endpointId, accounts, { refresh });
  });
}
