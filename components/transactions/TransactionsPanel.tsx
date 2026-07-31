"use client";
import { useState, useCallback } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { Timestamp } from "@/components/ui/Timestamp";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { TableControls, useTablePrefs, CELL_PADDING, type TableColumn } from "@/components/ui/TableControls";
import { AccountIdFilter } from "@/components/ui/AccountIdFilter";
import { StatStrip, refreshStatStrip } from "@/components/accounts/StatStrip";
import { fetcher } from "@/lib/utils";
import { matchesAccountId } from "@/lib/format";
import { activityLabel, deltaStatusBadge, proposalStatusBadge, AmountCell, CounterpartyCell } from "@/components/transactions/activity-cells";
import type {
  DashboardGlobalDeltaEntry,
  DashboardGlobalProposalEntry,
  DashboardDeltaStatus,
  DashboardDeltaEntry,
  PagedResult,
} from "@openzeppelin/guardian-operator-client";

type GlobalDeltasPage = PagedResult<DashboardGlobalDeltaEntry>;
type GlobalProposalsPage = PagedResult<DashboardGlobalProposalEntry>;

type FilterValue = "" | "awaiting" | "ready" | DashboardDeltaStatus;

type ColumnKey = "account" | "counterparty" | "activity" | "amount" | "status" | "date";
const HIDEABLE: readonly ColumnKey[] = ["counterparty", "activity", "amount", "status", "date"];

const FILTERS: Array<{ label: string; value: FilterValue }> = [
  { label: "All", value: "" },
  { label: "Awaiting Signatures", value: "awaiting" },
  { label: "Ready to Submit", value: "ready" },
  { label: "Submitted", value: "candidate" },
  { label: "Confirmed", value: "canonical" },
  { label: "Discarded", value: "discarded" },
];

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
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { density, hidden, setDensity, toggleColumn } = useTablePrefs<ColumnKey>("transactions", HIDEABLE);

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
      if (!res.ok) return; // keep cursor untouched so the next attempt can retry
      const page: GlobalDeltasPage = await res.json();
      setExtraDeltas((prev) => [...prev, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      // network error — leave cursor untouched so the next attempt can retry
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, initialCursor, deltaStatus]);

  const handleFilterChange = (value: FilterValue) => {
    setFilter(value);
    setExtraDeltas([]);
    setNextCursor(undefined);
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // Paged-in entries are dropped: the first page comes back with whatever is
    // newest, and keeping the old tail would list some entries twice.
    setExtraDeltas([]);
    setNextCursor(undefined);
    try {
      await Promise.all([
        deltaUrl ? mutate(deltaUrl) : Promise.resolve(),
        mutate("/api/global-proposals"),
        refreshStatStrip(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [deltaUrl]);

  const allDeltas = [...(deltasData?.items ?? []), ...extraDeltas];
  const allProposals = proposalsData?.items ?? [];
  const rows = toRows(allDeltas, allProposals, filter).filter((r) => matchesAccountId(query, r.accountId));

  const loading = (!deltasData && !deltasError && !proposalsOnly) || (!proposalsData && (filter === "" || proposalsOnly));
  // Keep showing cached rows on a failed revalidation — SWR retries in the background
  const unavailable = deltasError && !deltasData;

  // The account is what makes a row identifiable, so it is not offered for
  // hiding. Same arrangement as the accounts table.
  const columns: TableColumn<ActivityRow, ColumnKey>[] = [
    { key: "account", label: "Account", width: "w-36", cell: (r) => <CopyableId id={r.accountId} /> },
    { key: "counterparty", label: "To / From", width: "w-36", cell: (r) => <CounterpartyCell counterparty={r.counterparty} /> },
    { key: "activity", label: "Activity", width: "w-40", cellClass: "text-sm", cell: (r) => r.label },
    { key: "amount", label: "Amount", width: "w-32", cell: (r) => <AmountCell assets={r.assets} /> },
    { key: "status", label: "Status", width: "w-36", cell: (r) => r.statusNode },
    {
      key: "date", label: "Date", width: "w-40", cellClass: "text-muted-foreground text-xs",
      cell: (r) => <Timestamp iso={r.timestamp} />,
    },
  ];
  const shownColumns = columns.filter((c) => !hidden.has(c.key));
  const pad = CELL_PADDING[density];

  return (
    <div className="flex flex-col gap-4">
      <StatStrip />
      {/* Same toolbar order as Accounts: search over the Account column it
          filters, status chips next, refresh pinned right. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <AccountIdFilter value={query} onChange={setQuery} />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`px-3 py-1 rounded-full border transition-colors ${
              filter === f.value
                ? "bg-foreground text-background border-foreground"
                : "border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <TableControls
            density={density}
            onDensityChange={setDensity}
            columns={columns.filter((c) => HIDEABLE.includes(c.key))}
            hidden={hidden}
            onToggleColumn={toggleColumn}
          />
          <RefreshButton onClick={refresh} busy={refreshing} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : unavailable ? (
        <div className="rounded-lg border border-dashed">
          <ErrorPanel error={deltasError} onRetry={refresh} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
          {/* The filter sees the entries loaded so far. The node's activity feeds
              take a cursor and a status, so there is nothing to search with. */}
          {query
            ? `No activity for an account matching "${query.trim()}" in the entries loaded so far.`
            : "No activity found."}
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  {shownColumns.map((c) => <col key={c.key} className={c.width} />)}
                </colgroup>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {shownColumns.map((c) => (
                      <th key={c.key} className={`${pad} font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
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
                      {shownColumns.map((c) => (
                        <td key={c.key} className={`${pad} ${c.align === "right" ? "text-right" : ""} ${c.cellClass ?? ""}`}>
                          {c.cell(row, i)}
                        </td>
                      ))}
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
