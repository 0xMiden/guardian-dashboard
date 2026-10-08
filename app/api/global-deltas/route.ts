import { guardianRoute, pageOptions } from "@/lib/guardian-route";
import { enrichDeltas } from "@/lib/enrich";
import type { DashboardGlobalDeltaStatusFilter } from "@openzeppelin/guardian-operator-client";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guardianRoute(async (client, endpoint) => {
    const statusParam = new URL(req.url).searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as DashboardGlobalDeltaStatusFilter)
      : undefined;
    return enrichDeltas(await client.listGlobalDeltas({ ...pageOptions(req), status }), endpoint.network);
  });
}
