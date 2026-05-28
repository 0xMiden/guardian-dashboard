"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { formatAmount } from "@/lib/format";
import type { DashboardDeltaEntry, DashboardProposalEntry, PagedResult } from "@openzeppelin/guardian-operator-client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type DeltasPage = PagedResult<DashboardDeltaEntry> & { error?: string; available?: false };
type ProposalsPage = PagedResult<DashboardProposalEntry> & { error?: string };

const CATEGORY_LABELS: Record<string, string> = {
  asset_transfer: "Asset Transfer",
  note_consumption: "Note Consumed",
  note_creation: "Note Created",
  account_storage_change: "Account Changed",
  guardian_switch: "Switch Guardian",
  custom: "Custom",
};

function activityLabel(category?: string, proposalType?: string): string {
  if (category) return CATEGORY_LABELS[category] ?? category;
  switch (proposalType) {
    case "p2id": return "Asset Transfer";
    case "consume_notes": return "Note Consumed";
    case "add_signer": return "Signer Added";
    case "remove_signer": return "Signer Removed";
    case "change_threshold": return "Threshold Changed";
    case "update_procedure_threshold": return "Threshold Changed";
    case "switch_guardian": return "Switch Guardian";
    default: return "State Change";
  }
}

function deltaStatusBadge(status: string) {
  if (status === "canonical") return <Badge className="bg-emerald-500 text-white text-xs">Confirmed</Badge>;
  if (status === "candidate") return <Badge className="bg-amber-500 text-white text-xs">Submitted</Badge>;
  return <Badge className="bg-zinc-500 text-white text-xs capitalize">{status}</Badge>;
}

function proposalStatusBadge(collected: number, required: number) {
  const full = collected >= required;
  return (
    <Badge
      variant="outline"
      className={`text-xs ${full ? "border-emerald-500 text-emerald-500" : "border-amber-500 text-amber-500"}`}
    >
      {collected}/{required} signed
    </Badge>
  );
}

function AmountCell({ assets }: { assets?: DashboardDeltaEntry["assets"] }) {
  if (!assets || assets.length === 0) return <span className="text-muted-foreground">—</span>;
  const first = assets[0];
  if (!first.amount) return <span className="text-muted-foreground">—</span>;
  const positive = !first.amount.startsWith("-");
  const formatted = formatAmount(first.amount);
  const display = positive && !formatted.startsWith("+") ? "+" + formatted : formatted;
  const more = assets.length > 1 ? <span className="text-muted-foreground"> +{assets.length - 1}</span> : null;
  return (
    <span className={`text-xs font-mono ${positive ? "text-emerald-400" : "text-red-400"}`}>
      {display}{more}
    </span>
  );
}

function CounterpartyCell({ counterparty }: { counterparty?: DashboardDeltaEntry["counterparty"] }) {
  if (!counterparty) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{counterparty.direction === "in" ? "←" : "→"}</span>
      <CopyableId id={counterparty.accountId} prefixLen={8} suffixLen={4} />
    </span>
  );
}

type ActivityRow = {
  key: string;
  seq: number | string;
  label: string;
  statusNode: React.ReactNode;
  assets: DashboardDeltaEntry["assets"];
  counterparty: DashboardDeltaEntry["counterparty"];
  timestamp: string;
  isDelta: boolean;
  nonce: number;
};

interface Props {
  accountId: string;
}

export function AccountTransactions({ accountId }: Props) {
  const router = useRouter();
  const encoded = encodeURIComponent(accountId);

  const { data: deltasData, error: deltasError } = useSWR<DeltasPage>(
    `/api/accounts/${encoded}/deltas`,
    fetcher,
    { refreshInterval: 30_000 }
  );
  const { data: proposalsData } = useSWR<ProposalsPage>(
    `/api/accounts/${encoded}/proposals`,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const [extraDeltas, setExtraDeltas] = useState<DashboardDeltaEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const initialCursor = deltasData?.nextCursor ?? null;
  const hasMore = nextCursor === undefined ? initialCursor !== null : nextCursor !== null;

  const loadMore = useCallback(async () => {
    const cursor = nextCursor !== undefined ? nextCursor : initialCursor;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/accounts/${encoded}/deltas?cursor=${encodeURIComponent(cursor)}`);
      const page: DeltasPage = await res.json();
      setExtraDeltas((prev) => [...prev, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [encoded, nextCursor, initialCursor]);

  const allDeltas = [...(deltasData?.items ?? []), ...extraDeltas];
  const allProposals = proposalsData?.items ?? [];

  const rows: ActivityRow[] = [
    ...allProposals.map((p) => ({
      key: `proposal-${p.nonce}`,
      seq: p.nonce,
      label: activityLabel(undefined, p.proposalType),
      statusNode: proposalStatusBadge(p.signaturesCollected, p.signaturesRequired),
      assets: undefined,
      counterparty: undefined,
      timestamp: p.originatingTimestamp,
      isDelta: false,
      nonce: p.nonce,
    })),
    ...allDeltas.map((d) => ({
      key: `delta-${d.nonce}`,
      seq: d.nonce,
      label: activityLabel(d.category, d.proposalType),
      statusNode: deltaStatusBadge(d.status),
      assets: d.assets,
      counterparty: d.counterparty,
      timestamp: d.statusTimestamp,
      isDelta: true,
      nonce: d.nonce,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const loading = (!deltasData && !deltasError) || !proposalsData;

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to account
      </button>

      <p className="text-xs text-muted-foreground font-mono truncate">{accountId}</p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : deltasError || deltasData?.available === false ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {deltasData?.error ?? "Guardian node unavailable"}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No activity recorded for this account yet.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">#</th>
                    <th className="px-4 py-3 text-left font-medium">To / From</th>
                    <th className="px-4 py-3 text-left font-medium">Activity</th>
                    <th className="px-4 py-3 text-left font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className={`border-b last:border-0 transition-colors ${
                        row.isDelta ? "cursor-pointer hover:bg-muted/40" : ""
                      }`}
                      onClick={() => {
                        if (row.isDelta) {
                          router.push(`/accounts/${encoded}/transactions/${row.nonce}`);
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.seq}</td>
                      <td className="px-4 py-3"><CounterpartyCell counterparty={row.counterparty} /></td>
                      <td className="px-4 py-3 text-sm">{row.label}</td>
                      <td className="px-4 py-3"><AmountCell assets={row.assets} /></td>
                      <td className="px-4 py-3">{row.statusNode}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(row.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
