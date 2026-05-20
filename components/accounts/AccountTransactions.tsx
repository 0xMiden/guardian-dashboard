"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardDeltaEntry, DashboardProposalEntry, PagedResult } from "@openzeppelin/guardian-operator-client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type DeltasPage = PagedResult<DashboardDeltaEntry> & { error?: string; available?: false };
type ProposalsPage = PagedResult<DashboardProposalEntry> & { error?: string };

function activityLabel(proposalType?: string): string {
  switch (proposalType) {
    case "p2id": return "Create P2ID note";
    case "consume_notes": return "Consume note";
    case "add_signer": return "Add Signer";
    case "remove_signer": return "Remove Signer";
    case "change_threshold": return "Change Threshold";
    case "update_procedure_threshold": return "Update Procedure Threshold";
    case "switch_guardian": return "Switch Guardian";
    default: return "Account Update";
  }
}

function deltaStatusBadge(status: string) {
  if (status === "canonical") return <Badge className="bg-emerald-500 text-white text-xs">confirmed</Badge>;
  if (status === "candidate") return <Badge className="bg-amber-500 text-white text-xs">in progress</Badge>;
  return <Badge className="bg-zinc-500 text-white text-xs">{status}</Badge>;
}

function proposalStatusBadge(collected: number, required: number) {
  const full = collected >= required;
  return (
    <Badge
      variant="outline"
      className={`text-xs ${full ? "border-emerald-500 text-emerald-500" : "border-amber-500 text-amber-500"}`}
    >
      pending {collected}/{required}
    </Badge>
  );
}

type ActivityRow = {
  key: string;
  seq: number | string;
  label: string;
  statusNode: React.ReactNode;
  timestamp: string;
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
      label: activityLabel(p.proposalType),
      statusNode: proposalStatusBadge(p.signaturesCollected, p.signaturesRequired),
      timestamp: p.originatingTimestamp,
    })),
    ...allDeltas.map((d) => ({
      key: `delta-${d.nonce}`,
      seq: d.nonce,
      label: activityLabel(d.proposalType),
      statusNode: deltaStatusBadge(d.status),
      timestamp: d.statusTimestamp,
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
                    <th className="px-4 py-3 text-left font-medium">Activity</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.seq}</td>
                      <td className="px-4 py-3 text-sm">{row.label}</td>
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
