"use client";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ComingSoonModal } from "@/components/ui/ComingSoon";
import { ArrowLeft, Snowflake, ArrowLeftRight } from "lucide-react";
import type { DashboardAccountDetail } from "@openzeppelin/guardian-operator-client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  accountId: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

type ComingSoonFeature = "freeze" | "transactions" | null;

const COMING_SOON_COPY: Record<NonNullable<ComingSoonFeature>, string> = {
  freeze: "Account freeze controls will be available in a future release.",
  transactions: "Transaction history will be available in a future release.",
};

export function AccountDetail({ accountId }: Props) {
  const { data, error } = useSWR<{ account: DashboardAccountDetail; error?: string }>(
    `/api/accounts/${encodeURIComponent(accountId)}`,
    fetcher
  );
  const router = useRouter();
  const [comingSoon, setComingSoon] = useState<ComingSoonFeature>(null);

  return (
    <div className="flex flex-col gap-4">
      {comingSoon && (
        <ComingSoonModal
          description={COMING_SOON_COPY[comingSoon]}
          onClose={() => setComingSoon(null)}
        />
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Back to accounts
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setComingSoon("transactions")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            See Transactions
          </button>
          <button
            onClick={() => setComingSoon("freeze")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
          >
            <Snowflake className="h-3.5 w-3.5" />
            Freeze Account
          </button>
        </div>
      </div>

      {!data && !error ? (
        <Card><CardContent className="pt-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</CardContent></Card>
      ) : error || data?.error ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {data?.error ?? "Failed to load account"}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground font-mono truncate">
              {data!.account.accountId}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row
              label="Status"
              value={
                <Badge className={data!.account.stateStatus === "available" ? "bg-emerald-500 text-white" : "bg-zinc-500 text-white"}>
                  {data!.account.stateStatus}
                </Badge>
              }
            />
            <Row label="Auth scheme" value={data!.account.authScheme} />
            <Row
              label="Pending candidate"
              value={data!.account.hasPendingCandidate
                ? <Badge variant="outline" className="border-amber-500 text-amber-500">yes</Badge>
                : "no"}
            />
            <Row
              label="Commitment"
              value={<span className="font-mono text-xs">{data!.account.currentCommitment ?? "—"}</span>}
            />
            <Row label="Created" value={new Date(data!.account.createdAt).toLocaleString()} />
            <Row label="Updated" value={new Date(data!.account.updatedAt).toLocaleString()} />
            {data!.account.stateCreatedAt && (
              <Row label="State created" value={new Date(data!.account.stateCreatedAt).toLocaleString()} />
            )}
            {data!.account.stateUpdatedAt && (
              <Row label="State updated" value={new Date(data!.account.stateUpdatedAt).toLocaleString()} />
            )}
            <div className="py-2">
              <p className="text-sm text-muted-foreground mb-2">
                Authorized signers ({data!.account.authorizedSignerIds.length})
              </p>
              <div className="flex flex-col gap-1">
                {data!.account.authorizedSignerIds.map((id) => (
                  <span key={id} className="font-mono text-xs bg-muted rounded px-2 py-1 break-all">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
