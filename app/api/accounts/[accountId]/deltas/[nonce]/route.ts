import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string; nonce: string }> }
) {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected", available: false }, { status: 400 });
  try {
    const { accountId, nonce: nonceStr } = await params;
    const nonce = parseInt(nonceStr, 10);
    if (isNaN(nonce)) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
    const data = await getGuardianClient(endpointId).getAccountDeltaDetail(accountId, nonce);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, available: false }, { status: 503 });
  }
}
