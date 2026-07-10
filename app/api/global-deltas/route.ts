import { guardianRoute, pageOptions } from "@/lib/guardian-route";
import type { DashboardGlobalDeltaStatusFilter } from "@openzeppelin/guardian-operator-client";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guardianRoute((client) => {
    const statusParam = new URL(req.url).searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as DashboardGlobalDeltaStatusFilter)
      : undefined;
    return client.listGlobalDeltas({ ...pageOptions(req), status });
  });
}
