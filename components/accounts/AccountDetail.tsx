"use client";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { Timestamp } from "@/components/ui/Timestamp";
import { ErrorPanel, describeError } from "@/components/ui/ErrorPanel";
import Link from "next/link";
import { ArrowLeft, Snowflake, Sun, ArrowLeftRight, ChevronDown, ChevronRight } from "lucide-react";
import type { DashboardAccountDetail } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { fetcher, FetchError } from "@/lib/utils";

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

type AccountResponse = DashboardAccountDetail;
type SnapshotResponse = AccountSnapshot;

const PAUSE_MODAL_COPY = {
  freeze: {
    endpoint: "pause",
    title: "Freeze Account",
    description: "The account will be frozen immediately. All pending operations will be blocked until it is unfrozen.",
    event: "account_frozen",
    failure: "Failed to freeze account",
    busy: "Freezing…",
    buttonClass: "bg-state-error hover:brightness-110",
  },
  unfreeze: {
    endpoint: "unpause",
    title: "Unfreeze Account",
    description: "The account will be reactivated and resume normal operations.",
    event: "account_unfrozen",
    failure: "Failed to unfreeze account",
    busy: "Unfreezing…",
    buttonClass: "bg-state-active hover:brightness-110",
  },
} as const;

function PauseModal({
  action,
  accountId,
  onSuccess,
  onClose,
}: {
  action: keyof typeof PAUSE_MODAL_COPY;
  accountId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const copy = PAUSE_MODAL_COPY[action];
  const needsReason = action === "freeze";
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit() {
    if (needsReason && !reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/${copy.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsReason ? { reason: reason.trim() } : {}),
      });
      const data = await res.json().catch(() => null);
      // A FetchError rather than a bare Error, so the node's error envelope
      // survives as far as the message the operator reads. This is the button
      // that produced "Guardian operator HTTP error 403: Forbidden - You don't
      // have permission to do that", which names neither the permission that is
      // missing nor who can grant it.
      if (!res.ok) throw new FetchError(data?.error ?? copy.failure, res.status, data ?? undefined);
      posthog.capture(copy.event, { account_id: accountId });
      onSuccess();
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const failure = error === null ? null : describeError(error);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border rounded-xl shadow-xl p-6 w-full max-w-md flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="text-xs text-muted-foreground mt-1">{copy.description}</p>
        </div>
        {needsReason && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              Reason <span className="text-state-error">*</span>
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
        )}
        {failure && (
          <div role="alert" className="rounded-md border border-state-error/30 bg-state-error/10 px-3 py-2">
            <p className="text-xs font-medium text-state-error">{failure.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{failure.detail}</p>
          </div>
        )}
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
            disabled={loading || (needsReason && !reason.trim())}
            className={`px-3 py-1.5 text-sm rounded-lg text-white transition-colors disabled:opacity-50 ${copy.buttonClass}`}
          >
            {loading ? copy.busy : copy.title}
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
    data ? `/api/accounts/${encoded}/snapshot` : null,
    fetcher
  );
  const router = useRouter();
  const [modal, setModal] = useState<"freeze" | "unfreeze" | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const isPaused = !!data?.pausedAt;

  return (
    <div className="flex flex-col gap-4">
      {modal && (
        <PauseModal
          action={modal}
          accountId={accountId}
          onSuccess={() => { setModal(null); mutate(); }}
          onClose={() => setModal(null)}
        />
      )}

      <div className="flex items-center justify-between gap-4">
        {/* A Link rather than router.back(): "Back to accounts" has to reach the
            accounts list. History said otherwise for anyone arriving on a shared
            URL, where back is whatever page they came from, including outside
            the app. */}
        <Link
          href="/accounts"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Back to accounts
        </Link>
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
          {data && (
            isPaused ? (
              <button
                onClick={() => {
                  posthog.capture("account_unfreeze_clicked", { account_id: accountId });
                  setModal("unfreeze");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-state-active text-state-active hover:bg-state-active/10 transition-colors"
              >
                <Sun className="h-3.5 w-3.5" />
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
      ) : error && !data ? (
        <div className="rounded-lg border border-dashed">
          <ErrorPanel error={error} onRetry={() => mutate()} />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-section text-muted-foreground">
                {data!.accountIdBech32
                  ? <CopyableId id={data!.accountIdBech32} prefixLen={20} suffixLen={8} />
                  : <CopyableId id={data!.accountId} />}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row
                label="Status"
                value={
                  data!.releasedAt
                    ? <Badge className="bg-state-released text-white">Released</Badge>
                    : data!.pausedAt
                    ? <Badge className="bg-state-frozen text-white">Frozen</Badge>
                    : <Badge className={data!.stateStatus === "available" ? "bg-state-active text-white" : "bg-state-neutral text-white"}>
                        {data!.stateStatus === "available" ? "Active" : data!.stateStatus}
                      </Badge>
                }
              />
              {data!.releasedAt && (
                <Row
                  label="Released"
                  value={
                    <span className="text-state-released text-xs">
                      Switched to another guardian <Timestamp iso={data!.releasedAt} />
                    </span>
                  }
                />
              )}
              {data!.pausedAt && (
                <Row
                  label="Frozen"
                  // Both, rather than the reason standing in for the time: an
                  // operator reviewing a freeze needs to know when as well as why.
                  value={
                    <span className="text-state-frozen text-xs">
                      <Timestamp iso={data!.pausedAt} />
                      {data!.pausedReason && <> · {data!.pausedReason}</>}
                    </span>
                  }
                />
              )}
              <Row label="Auth" value={data!.authScheme === "falcon" ? "Falcon (post-quantum)" : data!.authScheme.toUpperCase()} />
              <Row
                label="Pending update"
                value={data!.hasPendingCandidate
                  ? <Badge variant="outline" className="border-state-pending text-state-pending">Yes</Badge>
                  : "No"}
              />
              <Row label="Signers" value={data!.authorizedSignerIds.length} />
              <Row label="Created" value={<Timestamp iso={data!.createdAt} />} />
              <Row label="Last updated" value={<Timestamp iso={data!.updatedAt} />} />

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
                      <Timestamp iso={data!.stateCreatedAt} />
                    </div>
                  )}
                  {data!.stateUpdatedAt && (
                    <div className="flex items-start justify-between gap-4 text-xs">
                      <span className="text-muted-foreground">State updated</span>
                      <Timestamp iso={data!.stateUpdatedAt} />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {snapshot && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-section text-muted-foreground">Assets</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {snapshot.hasPendingCandidate && (
                  <p className="pb-2 text-xs text-state-pending">A state update is in progress — balances may be slightly out of date.</p>
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
