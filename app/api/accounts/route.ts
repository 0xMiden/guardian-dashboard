import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected", available: false }, { status: 400 });
  try {
    const data = await getGuardianClient(endpointId).listAccounts();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, available: false }, { status: 503 });
  }
}
