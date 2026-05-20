import { HeartbeatCard } from "@/components/overview/HeartbeatCard";
import { AccountSummaryCard } from "@/components/overview/AccountSummaryCard";
import { OperatorCard } from "@/components/overview/OperatorCard";
import { AssetTotalsPrefetch } from "@/components/overview/AssetTotalsPrefetch";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <AssetTotalsPrefetch />
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HeartbeatCard />
        <AccountSummaryCard />
        <OperatorCard />
      </div>
    </div>
  );
}
