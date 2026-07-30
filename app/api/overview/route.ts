import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET() {
  return guardianRoute(async (client) => {
    const info = await client.getDashboardInfo();
    // Above a per-node account threshold the server stops computing this
    // breakdown: it returns `accountsByAuthMethod: {}` and names the aggregate
    // in `degradedAggregates`. `?? 0` reported that as zero Falcon and zero
    // ECDSA accounts, which on the OZ node (1,573 accounts) is a wrong number
    // rather than a missing one. `null` means unavailable, and the card says so.
    const degraded = info.degradedAggregates?.includes("accounts_by_auth_method") ?? false;
    const count = (method: string) => (degraded ? null : info.accountsByAuthMethod[method] ?? 0);
    return {
      totalAccounts: info.totalAccountCount,
      falcon: count("miden_falcon"),
      ecdsa: count("miden_ecdsa"),
      evm: count("evm"),
      deltaStatusCounts: info.deltaStatusCounts,
      inFlightProposalCount: info.inFlightProposalCount,
      serviceStatus: info.serviceStatus,
      environment: info.environment,
      build: info.build,
    };
  });
}
