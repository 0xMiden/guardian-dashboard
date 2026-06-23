import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEndpoint } from "@/lib/endpoints";
import { getPublicKey } from "@/lib/falcon";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  const ep = endpointId ? getEndpoint(endpointId) : null;
  const publicKey = ep?.privateKey ? await getPublicKey(ep.privateKey) : null;
  return NextResponse.json({
    url: ep?.url ?? null,
    network: ep?.network ?? "Unknown",
    publicKey,
  });
}
