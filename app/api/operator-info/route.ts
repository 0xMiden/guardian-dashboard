import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEndpoint } from "@/lib/endpoints";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  const ep = endpointId ? getEndpoint(endpointId) : null;
  return NextResponse.json({
    url: ep?.url ?? null,
    network: ep?.network ?? "Unknown",
    commitment: ep?.commitment ?? null,
  });
}
