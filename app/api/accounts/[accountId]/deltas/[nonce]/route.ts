import { NextResponse } from "next/server";
import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; nonce: string }> }
) {
  return guardianRoute(async (client) => {
    const { accountId, nonce: nonceStr } = await params;
    const nonce = parseInt(nonceStr, 10);
    if (Number.isNaN(nonce)) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
    return client.getAccountDeltaDetail(accountId, nonce);
  });
}
