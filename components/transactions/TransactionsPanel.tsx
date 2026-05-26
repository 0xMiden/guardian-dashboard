"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { formatAmount } from "@/lib/format";
import type {
  DashboardGlobalDeltaEntry,
  DashboardGlobalProposalEntry,
  DashboardDeltaStatus,
  DashboardDeltaEntry,
  PagedResult,
} from "@openzeppelin/guardian-operator-client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type GlobalDeltasPage = PagedResult<DashboardGlobalDeltaEntry> & { error?: string; available?: false };
type GlobalProposalsPage = PagedResult<DashboardGlobalProposalEntry> & { error?: string };

type FilterValue = "" | "awaiting" | "ready" | DashboardDeltaStatus;

const FILTERS: Array<{ label: string; value: FilterValue }> = [
  { label: "All", value: "" },
  { label: "Awaiting Signatures", value: "awaiting" },
  { label: "Ready to Submit", value: "ready" },
  { label: "Submitted", value: "candidate" },
  { label: "Confirmed", value: "canonical" },
  { label: "Discarded", value: "discarded" },
];

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
  accountId: string;
  label: string;
  statusNode: React.ReactNode;
  assets: DashboardDeltaEntry["assets"];
  counterparty: DashboardDeltaEntry["counterparty"];
  timestamp: string;
  isPending: boolean;
  nonce: number;
};

const PROPOSALS_ONLY: FilterValue[] = ["awaiting", "ready"];

function toRows(
  deltas: DashboardGlobalDeltaEntry[],
  proposals: DashboardGlobalProposalEntry[],
  filter: FilterValue,
): ActivityRow[] {
  const rows: ActivityRow[] = [];

  if (filter === "" || PROPOSALS_ONLY.includes(filter)) {
    for (const p of proposals) {
      const isReady = p.signaturesCollected >= p.signaturesRequired;
      if (filter === "awaiting" && isReady) continue;
      if (filter === "ready" && !isReady) continue;
      rows.push({
        key: `proposal-${p.accountId}-${p.nonce}`,
        accountId: p.accountId,
        label: activityLabel(undefined, p.proposalType),
        statusNode: proposalStatusBadge(p.signaturesCollected, p.signaturesRequired),
        assets: undefined,
        counterparty: undefined,
        timestamp: p.originatingTimestamp,
        isPending: true,
        nonce: p.nonce,
      });
    }
  }

  if (!PROPOSALS_ONLY.includes(filter)) {
    for (const d of deltas) {
      rows.push({
        key: `delta-${d.accountId}-${d.nonce}`,
        accountId: d.accountId,
        label: activityLabel(d.category, d.proposalType),
        statusNode: deltaStatusBadge(d.status),
        assets: d.assets,
        counterparty: d.counterparty,
        timestamp: d.statusTimestamp,
        isPending: false,
        nonce: d.nonce,
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

  const proposalsOnly = PROPOSALS_ONLY.includes(filter);
  const deltaStatus = (filter === "" || proposalsOnly) ? undefined : filter as DashboardDeltaStatus;
  const deltaUrl = proposalsOnly
    ? null
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

  const loading = (!deltasData && !deltasError && !proposalsOnly) || (!proposalsData && (filter === "" || proposalsOnly));
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
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-36" />
                  <col className="w-36" />
                  <col className="w-40" />
                  <col className="w-32" />
                  <col className="w-36" />
                  <col className="w-40" />
                </colgroup>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Account</th>
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
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => {
                        if (!row.isPending) {
                          router.push(`/accounts/${encodeURIComponent(row.accountId)}/transactions/${row.nonce}`);
                        } else {
                          router.push(`/accounts/${encodeURIComponent(row.accountId)}`);
                        }
                      }}
                    >
                      <td className="px-4 py-3">
                        <CopyableId id={row.accountId} />
                      </td>
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
          {hasMoreDeltas && !proposalsOnly && (
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
