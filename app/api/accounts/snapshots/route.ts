import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";
import { normalizeAmount } from "@/lib/token-registry";

export const dynamic = "force-dynamic";

const CONCURRENCY = 10;

export async function GET(req: Request) {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return NextResponse.json({});

  try {
    const client = getGuardianClient(endpointId);
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

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
