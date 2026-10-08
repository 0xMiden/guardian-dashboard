import { NextResponse } from "next/server";
import { guardianRoute } from "@/lib/guardian-route";
import { enrichDeltaDetail } from "@/lib/enrich";

export const dynamic = "force-dynamic";

export function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; nonce: string }> }
) {
  return guardianRoute(async (client, endpoint) => {
    const { accountId, nonce: nonceStr } = await params;
    const nonce = parseInt(nonceStr, 10);
    if (Number.isNaN(nonce)) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
    return enrichDeltaDetail(await client.getAccountDeltaDetail(accountId, nonce), endpoint.network);
  });
}
