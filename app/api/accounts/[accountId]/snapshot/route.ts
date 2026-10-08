import { guardianRoute } from "@/lib/guardian-route";
import { enrichSnapshot } from "@/lib/enrich";

export const dynamic = "force-dynamic";

export function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client, endpoint) => enrichSnapshot(await client.getAccountSnapshot((await params).accountId), endpoint.network));
}
