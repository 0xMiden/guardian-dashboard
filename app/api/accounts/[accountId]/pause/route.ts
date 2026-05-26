import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });
  try {
    const { accountId } = await params;
    const { reason } = await req.json() as { reason: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Reason is required" }, { status: 422 });
    const data = await getGuardianClient(endpointId).pauseAccount(accountId, reason.trim());
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
