"use client";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { formatAmount, storageSlotLabel } from "@/lib/format";
import { fetcher } from "@/lib/utils";
import type {
  DashboardDeltaDetail,
  DashboardDeltaVaultChange,
  DashboardDeltaDecodedNote,
} from "@openzeppelin/guardian-operator-client";

type DetailResponse = DashboardDeltaDetail;

const CATEGORY_LABELS: Record<string, string> = {
  asset_transfer: "Asset Transfer",
  note_consumption: "Note Consumed",
  note_creation: "Note Created",
  account_storage_change: "Account Changed",
  guardian_switch: "Switch Guardian",
  custom: "Custom",
};

const NOTE_TAG_LABELS: Record<string, string> = {
  p2id: "P2ID (standard payment)",
  p2ide: "P2ID with expiry",
  pswap: "Partial swap",
  mint: "Mint",
  burn: "Burn",
  custom: "Custom script",
};

function statusBadge(status: string) {
  if (status === "canonical") return <Badge className="bg-emerald-500 text-white text-xs">Confirmed</Badge>;
  if (status === "candidate") return <Badge className="bg-amber-500 text-white text-xs">Submitted</Badge>;
  return <Badge className="bg-zinc-500 text-white text-xs capitalize">{status}</Badge>;
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

function VaultChangeRow({ change }: { change: DashboardDeltaVaultChange }) {
  if (change.kind === "fungible") {
    const positive = !change.change.startsWith("-");
    const formatted = formatAmount(change.change);
    const display = positive && !formatted.startsWith("+") ? "+" + formatted : formatted;
    return (
      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <CopyableId id={change.assetId} prefixLen={10} suffixLen={6} className="text-muted-foreground" />
        <span className={`font-medium shrink-0 ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {display}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <CopyableId id={change.assetId} prefixLen={10} suffixLen={6} className="text-muted-foreground" />
      <div className="text-right text-xs">
        {change.added.length > 0 && <div className="text-emerald-400">+{change.added.length} received</div>}
        {change.removed.length > 0 && <div className="text-red-400">−{change.removed.length} sent</div>}
      </div>
    </div>
  );
}

function NoteCard({ note, direction }: { note: DashboardDeltaDecodedNote; direction: "in" | "out" }) {
  const tagLabel = NOTE_TAG_LABELS[note.tag] ?? note.tag;
  return (
    <div className="border rounded-lg p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <CopyableId id={note.noteId} prefixLen={10} suffixLen={6} className="text-muted-foreground" />
        <Badge variant="outline" className="text-xs shrink-0">{tagLabel}</Badge>
      </div>
      {note.sender && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">From</span>
          <CopyableId id={note.sender} prefixLen={10} suffixLen={6} />
        </div>
      )}
      {note.recipient && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0">To</span>
          <CopyableId id={note.recipient} prefixLen={10} suffixLen={6} />
        </div>
      )}
      {note.assets.map((a, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <CopyableId id={a.assetId} prefixLen={8} suffixLen={4} className="text-muted-foreground" />
          {a.amount && (
            <span className={direction === "in" ? "text-emerald-400" : "text-red-400"}>
              {direction === "in" ? "+" : "−"}{formatAmount(a.amount)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  accountId: string;
  nonce: number;
}

export function AccountDeltaDetail({ accountId, nonce }: Props) {
  const router = useRouter();
  const encoded = encodeURIComponent(accountId);
  const [showTechnical, setShowTechnical] = useState(false);

  const { data, error } = useSWR<DetailResponse>(
    `/api/accounts/${encoded}/deltas/${nonce}`,
    fetcher
  );

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to activity
      </button>

      {!data && !error ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : error && !data ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {error.message || "Failed to load transaction detail"}
        </div>
      ) : (
        <>
          {data!.decodeWarnings && data!.decodeWarnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                Some data could not be decoded: {data!.decodeWarnings.map((w) => w.section).join(", ")}
              </div>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Transaction #{nonce}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row label="Status" value={statusBadge(data!.status)} />
              {data!.category && (
                <Row label="Type" value={CATEGORY_LABELS[data!.category] ?? data!.category} />
              )}
              {data!.proposal?.proposalType && (
                <Row label="Action" value={data!.proposal.proposalType.replace(/_/g, " ")} />
              )}
              <Row label="Date" value={new Date(data!.statusTimestamp).toLocaleString()} />
              {data!.retryCount !== undefined && data!.retryCount > 0 && (
                <Row label="Retries" value={data!.retryCount} />
              )}
            </CardContent>
          </Card>

          {data!.vaultChanges.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Balance Changes</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {data!.vaultChanges.map((c, i) => <VaultChangeRow key={i} change={c} />)}
              </CardContent>
            </Card>
          )}

          {(data!.inputNotes.length > 0 || data!.outputNotes.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data!.inputNotes.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Consumed ({data!.inputNotes.length})</p>
                    <div className="space-y-2">
                      {data!.inputNotes.map((n) => <NoteCard key={n.noteId} note={n} direction="in" />)}
                    </div>
                  </div>
                )}
                {data!.outputNotes.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Created ({data!.outputNotes.length})</p>
                    <div className="space-y-2">
                      {data!.outputNotes.map((n) => <NoteCard key={n.noteId} note={n} direction="out" />)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {data!.storageChanges.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Account State Changes</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {data!.storageChanges.map((s, i) => (
                  <div key={i} className="py-2 text-xs space-y-1">
                    <div className="font-medium">{storageSlotLabel(s.slotName)}</div>
                    {s.after === null
                      ? <div className="text-red-400">Cleared</div>
                      : <div className="text-muted-foreground font-mono truncate">{s.after}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data!.proposal && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Details</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {data!.proposal.recipientId && (
                  <Row
                    label="Recipient"
                    value={<CopyableId id={data!.proposal.recipientId} prefixLen={12} suffixLen={8} />}
                  />
                )}
                {data!.proposal.faucetId && (
                  <Row
                    label="Asset"
                    value={<CopyableId id={data!.proposal.faucetId} prefixLen={12} suffixLen={8} />}
                  />
                )}
                {data!.proposal.amount && (
                  <Row label="Amount" value={formatAmount(data!.proposal.amount)} />
                )}
                {data!.proposal.requiredSignatures !== undefined && (
                  <Row label="Signatures required" value={data!.proposal.requiredSignatures} />
                )}
                {data!.proposal.targetThreshold !== undefined && (
                  <Row label="New threshold" value={data!.proposal.targetThreshold} />
                )}
                {data!.proposal.signerCommitments && data!.proposal.signerCommitments.length > 0 && (
                  <div className="py-2">
                    <p className="text-sm text-muted-foreground mb-2">
                      Signers ({data!.proposal.signerCommitments.length})
                    </p>
                    <div className="flex flex-col gap-1">
                      {data!.proposal.signerCommitments.map((s) => (
                        <div key={s} className="bg-muted rounded px-2 py-1">
                          <CopyableId id={s} prefixLen={14} suffixLen={8} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <button
            onClick={() => setShowTechnical((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showTechnical ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Technical details
          </button>
          {showTechnical && (
            <Card>
              <CardContent className="pt-4 divide-y">
                <Row label="Nonce" value={<span className="font-mono">{data!.nonce}</span>} />
                <Row
                  label="Previous state"
                  value={<CopyableId id={data!.prevCommitment} prefixLen={12} suffixLen={8} />}
                />
                <Row
                  label="New state"
                  value={data!.newCommitment
                    ? <CopyableId id={data!.newCommitment} prefixLen={12} suffixLen={8} />
                    : "—"}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
