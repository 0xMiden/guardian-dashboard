import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "@/lib/guardian-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected", available: false }, { status: 400 });
  try {
    const info = await getGuardianClient(endpointId).getDashboardInfo();
    const byAuth = info.accountsByAuthMethod;
    return NextResponse.json({
      totalAccounts: info.totalAccountCount,
      falcon: byAuth["miden_falcon"] ?? 0,
      ecdsa: byAuth["miden_ecdsa"] ?? 0,
      evm: byAuth["evm"] ?? 0,
      deltaStatusCounts: info.deltaStatusCounts,
      inFlightProposalCount: info.inFlightProposalCount,
      serviceStatus: info.serviceStatus,
      environment: info.environment,
      build: info.build,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, available: false }, { status: 503 });
  }
}
