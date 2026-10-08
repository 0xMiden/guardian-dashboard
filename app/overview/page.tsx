import { GuardianStatusCard } from "@/components/overview/GuardianStatusCard";
import { AttentionCards } from "@/components/overview/AttentionCards";
import { AccountsCard } from "@/components/overview/AccountsCard";
import { AssetsCard } from "@/components/overview/AssetsCard";
import { ActivityCard } from "@/components/overview/ActivityCard";

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Overview</h1>

      {/* Is the server itself all right? */}
      <GuardianStatusCard />

      {/* What is on it: the inventory, in the order of the navigation. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AccountsCard />
        <AssetsCard />
        <ActivityCard />
      </div>

      {/* How it stands: every account by lifecycle, and when it last moved. */}
      <AttentionCards />
    </div>
  );
}
