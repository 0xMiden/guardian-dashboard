"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DashboardGlobalDeltaEntry,
  DashboardGlobalProposalEntry,
  DashboardDeltaStatus,
  PagedResult,
} from "@openzeppelin/guardian-operator-client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type GlobalDeltasPage = PagedResult<DashboardGlobalDeltaEntry> & { error?: string; available?: false };
type GlobalProposalsPage = PagedResult<DashboardGlobalProposalEntry> & { error?: string };

type FilterValue = "" | "pending" | DashboardDeltaStatus;

const FILTERS: Array<{ label: string; value: FilterValue }> = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Confirmed", value: "canonical" },
  { label: "In Progress", value: "candidate" },
  { label: "Discarded", value: "discarded" },
];

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
  accountId: string;
  label: string;
  statusNode: React.ReactNode;
  timestamp: string;
  isPending: boolean;
};

function toRows(
  deltas: DashboardGlobalDeltaEntry[],
  proposals: DashboardGlobalProposalEntry[],
  filter: FilterValue,
): ActivityRow[] {
  const rows: ActivityRow[] = [];

  if (filter === "" || filter === "pending") {
    for (const p of proposals) {
      rows.push({
        key: `proposal-${p.accountId}-${p.nonce}`,
        accountId: p.accountId,
        label: activityLabel(p.proposalType),
        statusNode: proposalStatusBadge(p.signaturesCollected, p.signaturesRequired),
        timestamp: p.originatingTimestamp,
        isPending: true,
      });
    }
  }

  if (filter !== "pending") {
    for (const d of deltas) {
      rows.push({
        key: `delta-${d.accountId}-${d.nonce}`,
        accountId: d.accountId,
        label: activityLabel(d.proposalType),
        statusNode: deltaStatusBadge(d.status),
        timestamp: d.statusTimestamp,
        isPending: false,
      });
    }
  }

  rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return rows;
}

export function TransactionsPanel() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterValue>("");
  const [extraDeltas, setExtraDeltas] = useState<DashboardGlobalDeltaEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const deltaStatus = filter === "" || filter === "pending" ? undefined : filter as DashboardDeltaStatus;
  const deltaUrl = filter === "pending"
    ? null  // skip deltas when showing pending-only
    : `/api/global-deltas${deltaStatus ? `?status=${deltaStatus}` : ""}`;

  const { data: deltasData, error: deltasError } = useSWR<GlobalDeltasPage>(deltaUrl, fetcher, { refreshInterval: 30_000 });
  const { data: proposalsData } = useSWR<GlobalProposalsPage>("/api/global-proposals", fetcher, { refreshInterval: 30_000 });

  const initialCursor = deltasData?.nextCursor ?? null;
  const hasMoreDeltas = nextCursor === undefined ? initialCursor !== null : nextCursor !== null;

  const loadMore = useCallback(async () => {
    const cursor = nextCursor !== undefined ? nextCursor : initialCursor;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor });
      if (deltaStatus) params.set("status", deltaStatus);
      const res = await fetch(`/api/global-deltas?${params}`);
      const page: GlobalDeltasPage = await res.json();
      setExtraDeltas((prev) => [...prev, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, initialCursor, deltaStatus]);

  const handleFilterChange = (value: FilterValue) => {
    setFilter(value);
    setExtraDeltas([]);
    setNextCursor(undefined);
  };

  const allDeltas = [...(deltasData?.items ?? []), ...extraDeltas];
  const allProposals = proposalsData?.items ?? [];
  const rows = toRows(allDeltas, allProposals, filter);

  const loading = (!deltasData && !deltasError && filter !== "pending") || (!proposalsData && (filter === "" || filter === "pending"));
  const unavailable = deltasError || deltasData?.available === false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === f.value
                ? "bg-foreground text-background border-foreground"
                : "border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : unavailable ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Guardian node unavailable
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No activity found.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Account</th>
                    <th className="px-4 py-3 text-left font-medium">Activity</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => router.push(`/accounts/${encodeURIComponent(row.accountId)}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{row.accountId}</td>
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
          {hasMoreDeltas && filter !== "pending" && (
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
