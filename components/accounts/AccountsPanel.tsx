"use client";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAccountSummary } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AccountsData {
  totalCount: number;
  accounts: DashboardAccountSummary[];
  error?: string;
  available?: false;
}

function statusBadge(status: string) {
  if (status === "available") return <Badge className="bg-emerald-500 text-white">available</Badge>;
  if (status === "frozen") return <Badge className="bg-orange-500 text-white">frozen</Badge>;
  return <Badge className="bg-zinc-500 text-white">{status}</Badge>;
}

export function AccountsPanel() {
  const { data, error } = useSWR<AccountsData>("/api/accounts", fetcher, { refreshInterval: 30_000 });
  const router = useRouter();

  if (!data && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (error || data?.available === false) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {data?.error ?? "Guardian node unavailable"}
      </div>
    );
  }

  if (!data?.accounts?.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No accounts registered on this Guardian node yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        {data.totalCount} account{data.totalCount !== 1 ? "s" : ""} registered
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Account ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Auth</th>
                <th className="px-4 py-3 text-left font-medium">Signers</th>
                <th className="px-4 py-3 text-left font-medium">Pending</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr
                  key={a.accountId}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    posthog.capture("account_clicked", {
                      account_id: a.accountId,
                      account_status: a.stateStatus,
                      has_pending_candidate: a.hasPendingCandidate,
                    });
                    router.push(`/accounts/${a.accountId}`);
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs">{a.accountId}</td>
                  <td className="px-4 py-3">{statusBadge(a.stateStatus)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.authScheme}</td>
                  <td className="px-4 py-3">{a.authorizedSignerCount}</td>
                  <td className="px-4 py-3">
                    {a.hasPendingCandidate ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-500 text-xs">
                        pending
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(a.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
