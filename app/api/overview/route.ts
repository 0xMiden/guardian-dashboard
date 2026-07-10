import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET() {
  return guardianRoute(async (client) => {
    const info = await client.getDashboardInfo();
    const byAuth = info.accountsByAuthMethod;
    return {
      totalAccounts: info.totalAccountCount,
      falcon: byAuth["miden_falcon"] ?? 0,
      ecdsa: byAuth["miden_ecdsa"] ?? 0,
      evm: byAuth["evm"] ?? 0,
      deltaStatusCounts: info.deltaStatusCounts,
      inFlightProposalCount: info.inFlightProposalCount,
      serviceStatus: info.serviceStatus,
      environment: info.environment,
      build: info.build,
    };
  });
}
