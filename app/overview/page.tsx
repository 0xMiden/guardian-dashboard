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

      {/* Is anything in a state that wants attention? This band is the reason
          the page exists; the inventory below is context, not the answer. */}
      <AttentionCards />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AccountsCard />
        <AssetsCard />
        <ActivityCard />
      </div>
    </div>
  );
}
