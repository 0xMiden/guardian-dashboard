import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });

  try {
    const client = getGuardianClient(endpointId);
    const now = Date.now();

    let total: number | null = null;
    try {
      const info = await client.getDashboardInfo();
      total = info.totalAccountCount;
    } catch {
      // older server — total comes from first page below
    }

    let count7d = 0;
    let count30d = 0;
    let cursor: string | undefined = undefined;

    // Accounts are sorted newest-first by updated_at — stop as soon as we
    // hit an account older than 30 days.
    while (true) {
      const page = await client.listAccounts({ limit: 100, cursor });
      if (!page.items.length) break;

      for (const item of page.items) {
        const age = now - new Date(item.updatedAt).getTime();
        if (age <= MS_7D)  count7d++;
        if (age <= MS_30D) count30d++;
      }

      const oldestOnPage = new Date(page.items[page.items.length - 1].updatedAt).getTime();
      if (now - oldestOnPage > MS_30D || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    return NextResponse.json({ total, count7d, count30d });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
