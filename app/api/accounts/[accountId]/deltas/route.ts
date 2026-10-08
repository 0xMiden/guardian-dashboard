import { guardianRoute, pageOptions } from "@/lib/guardian-route";
import { enrichDeltas } from "@/lib/enrich";

export const dynamic = "force-dynamic";

export function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client, endpoint) =>
    enrichDeltas(await client.listAccountDeltas((await params).accountId, pageOptions(req)), endpoint.network)
  );
}
