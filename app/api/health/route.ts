import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ status: "down", latencyMs: 0, checkedAt: new Date().toISOString() });
  const result = await getGuardianClient(endpointId).checkHealth();
  return NextResponse.json(result);
}
