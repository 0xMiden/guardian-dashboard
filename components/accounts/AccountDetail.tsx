"use client";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { ArrowLeft, Snowflake, ArrowLeftRight, ChevronDown, ChevronRight } from "lucide-react";
import type { DashboardAccountDetail } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { fetcher } from "@/lib/utils";

type AccountSnapshot = {
  commitment: string;
  updatedAt: string;
  hasPendingCandidate: boolean;
  vault: {
    fungible: { faucetId: string; amount: string }[];
    nonFungible: { faucetId: string; vaultKey: string }[];
  };
};

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

function FreezeModal({
  accountId,
  onSuccess,
  onClose,
}: {
  accountId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to freeze account");
      posthog.capture("account_frozen", { account_id: accountId });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to freeze account");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border rounded-xl shadow-xl p-6 w-full max-w-md flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Freeze Account</h2>
          <p className="text-xs text-muted-foreground mt-1">
            The account will be paused immediately. All pending operations will be blocked until unfrozen.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            className="w-full rounded-md border bg-muted px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            placeholder="e.g. Suspicious activity detected"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !reason.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {loading ? "Freezing…" : "Freeze Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnfreezeModal({
  accountId,
  onSuccess,
  onClose,
}: {
  accountId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/unpause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to unfreeze account");
      posthog.capture("account_unfrozen", { account_id: accountId });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unfreeze account");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border rounded-xl shadow-xl p-6 w-full max-w-md flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Unfreeze Account</h2>
          <p className="text-xs text-muted-foreground mt-1">
            The account will be reactivated and resume normal operations.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            {loading ? "Unfreezing…" : "Unfreeze Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountDetail({ accountId }: Props) {
  const encoded = encodeURIComponent(accountId);
  const { data, error, mutate } = useSWR<AccountResponse>(
    `/api/accounts/${encoded}`,
    fetcher
  );
  const { data: snapshot } = useSWR<SnapshotResponse>(
    data && !data.error ? `/api/accounts/${encoded}/snapshot` : null,
    fetcher
  );
  const router = useRouter();
  const [modal, setModal] = useState<"freeze" | "unfreeze" | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const isPaused = !!data?.pausedAt;

  return (
    <div className="flex flex-col gap-4">
      {modal === "freeze" && (
        <FreezeModal
          accountId={accountId}
          onSuccess={() => { setModal(null); mutate(); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "unfreeze" && (
        <UnfreezeModal
          accountId={accountId}
          onSuccess={() => { setModal(null); mutate(); }}
          onClose={() => setModal(null)}
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
              router.push(`/accounts/${encoded}/transactions`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Activity
          </button>
          {data && !data.error && (
            isPaused ? (
              <button
                onClick={() => {
                  posthog.capture("account_unfreeze_clicked", { account_id: accountId });
                  setModal("unfreeze");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-emerald-600 text-emerald-500 hover:bg-emerald-500/10 transition-colors"
              >
                <Snowflake className="h-3.5 w-3.5" />
                Unfreeze Account
              </button>
            ) : (
              <button
                onClick={() => {
                  posthog.capture("account_freeze_clicked", { account_id: accountId });
                  setModal("freeze");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors"
              >
                <Snowflake className="h-3.5 w-3.5" />
                Freeze Account
              </button>
            )
          )}
        </div>
      </div>

      {!data && !error ? (
        <Card><CardContent className="pt-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</CardContent></Card>
      ) : (error && !data) || data?.error ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {data?.error ?? "Failed to load account"}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {data!.accountIdBech32
                  ? <CopyableId id={data!.accountIdBech32} prefixLen={20} suffixLen={8} />
                  : <CopyableId id={data!.accountId} />}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row
                label="Status"
                value={
                  data!.pausedAt
                    ? <Badge className="bg-orange-500 text-white">Paused</Badge>
                    : <Badge className={data!.stateStatus === "available" ? "bg-emerald-500 text-white" : "bg-zinc-500 text-white"}>
                        {data!.stateStatus === "available" ? "Active" : data!.stateStatus}
                      </Badge>
                }
              />
              {data!.pausedAt && (
                <Row
                  label="Paused"
                  value={<span className="text-orange-400 text-xs">{data!.pausedReason ?? new Date(data!.pausedAt).toLocaleString()}</span>}
                />
              )}
              <Row label="Auth" value={data!.authScheme === "falcon" ? "Falcon (post-quantum)" : data!.authScheme.toUpperCase()} />
              <Row
                label="Pending update"
                value={data!.hasPendingCandidate
                  ? <Badge variant="outline" className="border-amber-500 text-amber-500">Yes</Badge>
                  : "No"}
              />
              <Row label="Signers" value={data!.authorizedSignerIds.length} />
              <Row label="Created" value={new Date(data!.createdAt).toLocaleString()} />
              <Row label="Last updated" value={new Date(data!.updatedAt).toLocaleString()} />

              {data!.authorizedSignerIds.length > 0 && (
                <div className="py-2">
                  <p className="text-sm text-muted-foreground mb-2">
                    Authorized signers
                  </p>
                  <div className="flex flex-col gap-1">
                    {data!.authorizedSignerIds.map((id) => (
                      <div key={id} className="bg-muted rounded px-2 py-1">
                        <CopyableId id={id} prefixLen={16} suffixLen={8} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowTechnical((v) => !v)}
                className="flex items-center gap-1 w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTechnical ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Technical details
              </button>
              {showTechnical && (
                <div className="pt-1 pb-2 space-y-2">
                  <div className="flex items-start justify-between gap-4 text-xs">
                    <span className="text-muted-foreground shrink-0">Commitment</span>
                    <CopyableId id={data!.currentCommitment ?? "—"} prefixLen={12} suffixLen={8} />
                  </div>
                  {data!.stateCreatedAt && (
                    <div className="flex items-start justify-between gap-4 text-xs">
                      <span className="text-muted-foreground">State created</span>
                      <span>{new Date(data!.stateCreatedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {data!.stateUpdatedAt && (
                    <div className="flex items-start justify-between gap-4 text-xs">
                      <span className="text-muted-foreground">State updated</span>
                      <span>{new Date(data!.stateUpdatedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {snapshot && !snapshot.error && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Assets</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {snapshot.hasPendingCandidate && (
                  <p className="pb-2 text-xs text-amber-400">A state update is in progress — balances may be slightly out of date.</p>
                )}
                {snapshot.vault.fungible.length === 0 && snapshot.vault.nonFungible.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No assets in vault.</p>
                ) : (
                  <>
                    {snapshot.vault.fungible.map((asset) => (
                      <div key={asset.faucetId} className="flex items-start justify-between gap-4 py-2 text-sm">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <CopyableId id={asset.faucetId} prefixLen={10} suffixLen={6} className="text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{BigInt(asset.amount).toLocaleString()} units</span>
                        </div>
                      </div>
                    ))}
                    {snapshot.vault.nonFungible.length > 0 && (
                      <div className="flex items-center justify-between gap-4 py-2 text-sm">
                        <span className="text-muted-foreground">Non-fungible assets</span>
                        <span className="font-medium">{snapshot.vault.nonFungible.length}</span>
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
