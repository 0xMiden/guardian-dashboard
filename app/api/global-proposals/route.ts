import { guardianRoute, pageOptions } from "@/lib/guardian-route";
import { enrichProposals } from "@/lib/enrich";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guardianRoute(async (client, endpoint) => enrichProposals(await client.listGlobalProposals(pageOptions(req)), endpoint.network));
}
