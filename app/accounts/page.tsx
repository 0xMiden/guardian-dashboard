import { Suspense } from "react";
import { AccountsPanel } from "@/components/accounts/AccountsPanel";
import { Skeleton } from "@/components/ui/skeleton";

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Accounts</h1>
      {/* The panel reads `?paused=true`, and useSearchParams on a prerendered
          route client-renders everything up to the nearest boundary. Without
          this the whole page would opt out of prerendering. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <AccountsPanel />
      </Suspense>
    </div>
  );
}
