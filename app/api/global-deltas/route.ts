import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";
import type { DashboardGlobalDeltaStatusFilter } from "@openzeppelin/guardian-operator-client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected", available: false }, { status: 400 });
  try {
    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const statusParam = searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as DashboardGlobalDeltaStatusFilter)
      : undefined;
    const data = await getGuardianClient(endpointId).listGlobalDeltas({ cursor, limit, status });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, available: false }, { status: 503 });
  }
}
