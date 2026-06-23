import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEndpoint } from "@/lib/endpoints";
import { getPublicKey } from "@/lib/falcon";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  const ep = endpointId ? getEndpoint(endpointId) : null;
  let publicKey: string | null = null;
  if (ep?.privateKey) {
    try { publicKey = await getPublicKey(ep.privateKey); } catch { /* unsupported key format */ }
  }
  return NextResponse.json({
    url: ep?.url ?? null,
    network: ep?.network ?? "Unknown",
    publicKey,
  });
}
