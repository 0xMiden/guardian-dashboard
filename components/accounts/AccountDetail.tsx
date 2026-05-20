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

type AccountSnapshot = {
  commitment: string;
  updatedAt: string;
  hasPendingCandidate: boolean;
  vault: {
    fungible: { faucetId: string; amount: string }[];
    nonFungible: { faucetId: string; vaultKey: string }[];
  };
};
import posthog from "posthog-js";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  accountId: string;
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

type AccountResponse = DashboardAccountDetail & { error?: string; available?: false };
type SnapshotResponse = AccountSnapshot & { error?: string; available?: false };

export function AccountDetail({ accountId }: Props) {
  const { data, error } = useSWR<AccountResponse>(
    `/api/accounts/${encodeURIComponent(accountId)}`,
    fetcher
  );
  const { data: snapshot } = useSWR<SnapshotResponse>(
    data && !data.error ? `/api/accounts/${encodeURIComponent(accountId)}/snapshot` : null,
    fetcher
  );
  const router = useRouter();
  const [showFreezeModal, setShowFreezeModal] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {showFreezeModal && (
        <ComingSoonModal
          description="Account freeze controls will be available in a future release."
          onClose={() => setShowFreezeModal(false)}
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
            onClick={() => {
              posthog.capture("account_transactions_clicked", { account_id: accountId });
              router.push(`/accounts/${encodeURIComponent(accountId)}/transactions`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            See Transactions
          </button>
          <button
            onClick={() => {
              posthog.capture("account_freeze_clicked", { account_id: accountId });
              setShowFreezeModal(true);
            }}
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
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground font-mono truncate">
                {data!.accountId}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row
                label="Status"
                value={
                  <Badge className={data!.stateStatus === "available" ? "bg-emerald-500 text-white" : "bg-zinc-500 text-white"}>
                    {data!.stateStatus}
                  </Badge>
                }
              />
              <Row label="Auth scheme" value={data!.authScheme} />
              <Row
                label="Pending candidate"
                value={data!.hasPendingCandidate
                  ? <Badge variant="outline" className="border-amber-500 text-amber-500">yes</Badge>
                  : "no"}
              />
              <Row
                label="Commitment"
                value={<span className="font-mono text-xs">{data!.currentCommitment ?? "—"}</span>}
              />
              <Row label="Created" value={new Date(data!.createdAt).toLocaleString()} />
              <Row label="Updated" value={new Date(data!.updatedAt).toLocaleString()} />
              {data!.stateCreatedAt && (
                <Row label="State created" value={new Date(data!.stateCreatedAt).toLocaleString()} />
              )}
              {data!.stateUpdatedAt && (
                <Row label="State updated" value={new Date(data!.stateUpdatedAt).toLocaleString()} />
              )}
              <div className="py-2">
                <p className="text-sm text-muted-foreground mb-2">
                  Authorized signers ({data!.authorizedSignerIds.length})
                </p>
                <div className="flex flex-col gap-1">
                  {data!.authorizedSignerIds.map((id) => (
                    <span key={id} className="font-mono text-xs bg-muted rounded px-2 py-1 break-all">
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {snapshot && !snapshot.error && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Assets</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {snapshot.hasPendingCandidate && (
                  <p className="pb-2 text-xs text-amber-400">Pending candidate in flight — snapshot may be stale.</p>
                )}
                {snapshot.vault.fungible.length === 0 && snapshot.vault.nonFungible.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">Vault is empty.</p>
                ) : (
                  <>
                    {snapshot.vault.fungible.map((asset) => {
                      const usd = Number(asset.amount);
                      return (
                        <div key={asset.faucetId} className="flex items-start justify-between gap-4 py-2 text-sm">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-mono text-xs text-muted-foreground truncate">{asset.faucetId}</span>
                            <span className="text-xs text-muted-foreground">{Number(asset.amount).toLocaleString()} tokens</span>
                          </div>
                          <span className="font-medium shrink-0">${usd.toLocaleString()}</span>
                        </div>
                      );
                    })}
                    {snapshot.vault.nonFungible.length > 0 && (
                      <div className="flex items-center justify-between gap-4 py-2 text-sm">
                        <span className="text-muted-foreground">Non-fungible assets</span>
                        <span className="font-medium">{snapshot.vault.nonFungible.length}</span>
                      </div>
                    )}
                    {snapshot.vault.fungible.length > 0 && (
                      <div className="flex items-center justify-between gap-4 py-2 text-sm font-semibold">
                        <span>Total value</span>
                        <span>${snapshot.vault.fungible.reduce((sum, a) => sum + Number(a.amount), 0).toLocaleString()}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
