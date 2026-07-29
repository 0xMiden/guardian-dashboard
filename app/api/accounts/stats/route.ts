import { headers } from "next/headers";
import { guardianRoute } from "@/lib/guardian-route";
import { getInventory } from "@/lib/account-cache";

export const dynamic = "force-dynamic";

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

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
    // Accounts are ordered newest-updated first, so the walk stops at 30 days.
    const accounts = await getInventory(client, endpointId, MS_30D, now, { refresh });

    let count7d = 0;
    let count30d = 0;
    for (const item of accounts) {
      const age = now - new Date(item.updatedAt).getTime();
      if (age <= MS_7D)  count7d++;
      if (age <= MS_30D) count30d++;
    }

    return { total, count7d, count30d };
  });
}
