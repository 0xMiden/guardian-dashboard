import { NextResponse } from "next/server";
import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client) => {
    const { accountId } = await params;
    const { reason } = await req.json().catch(() => ({})) as { reason?: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Reason is required" }, { status: 422 });
    return client.pauseAccount(accountId, reason.trim());
  });
}
