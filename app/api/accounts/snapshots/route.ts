import { guardianRoute } from "@/lib/guardian-route";
import { normalizeAmount } from "@/lib/token-registry";

export const dynamic = "force-dynamic";

const CONCURRENCY = 10;

export function GET(req: Request) {
  return guardianRoute(async (client) => {
    const raw = new URL(req.url).searchParams.get("ids") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const result: Record<string, number> = {};

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((id) => client.getAccountSnapshot(id))
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled") {
          result[batch[j]] = r.value.vault.fungible.reduce(
            (sum, a) => sum + normalizeAmount(a.faucetId, a.amount), 0
          );
        }
      }
    }

    return result;
  });
}
