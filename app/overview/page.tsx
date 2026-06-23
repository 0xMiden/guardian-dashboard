import { GuardianStatusCard } from "@/components/overview/GuardianStatusCard";
import { AccountsCard } from "@/components/overview/AccountsCard";
import { AssetsCard } from "@/components/overview/AssetsCard";
import { ActivityCard } from "@/components/overview/ActivityCard";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Overview</h1>
      <GuardianStatusCard />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AccountsCard />
        <AssetsCard />
        <ActivityCard />
      </div>
    </div>
  );
}
