import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

export function GET() {
  return guardianRoute(async (client) => {
    const now = Date.now();

    let total: number | null = null;
    try {
      const info = await client.getDashboardInfo();
      total = info.totalAccountCount;
    } catch {
      // older server without /dashboard/info — total stays null
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

    return { total, count7d, count30d };
  });
}
