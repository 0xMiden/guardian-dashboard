"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import posthog from "posthog-js";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyableId } from "@/components/ui/CopyableId";
import { Timestamp } from "@/components/ui/Timestamp";
import { Button } from "@/components/ui/Button";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { DataTable } from "@/components/ui/DataTable";
import { TableControls, useTablePrefs, useSort, sortRows, usePaging, LoadMoreSentinel, type TableColumn } from "@/components/ui/TableControls";
import { AccountIdFilter } from "@/components/ui/AccountIdFilter";
import { FilterChip } from "@/components/ui/FilterChip";
import { StatStrip, refreshStatStrip } from "@/components/accounts/StatStrip";
import { fetcher, downloadCsv } from "@/lib/utils";
import { matchesAccountId, activityToCsv, formatCount } from "@/lib/format";
import {
  activityLabel, deltaStatusBadge, deltaStatusLabel, proposalStatusBadge, proposalStatusLabel, AmountCell, CounterpartyCell,
} from "@/components/transactions/activity-cells";
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
type SortKey = "activity" | "status" | "date";
const HIDEABLE: readonly ColumnKey[] = ["counterparty", "activity", "amount", "status", "date"];

const FILTERS: Array<{ label: string; value: FilterValue }> = [
  // Named as the Accounts chips are: "Any" for the reset, sentence case.
  { label: "Any status", value: "" },
  { label: "Awaiting signatures", value: "awaiting" },
  { label: "Ready to submit", value: "ready" },
  { label: "Submitted", value: "candidate" },
  { label: "Confirmed", value: "canonical" },
  // Guardian 0.16.1 (issue #345). Findable, or six retained deltas on the OZ
  // Guardian are invisible unless you happen to scroll past one.
  { label: "Recovering", value: "retained" },
  { label: "Discarded", value: "discarded" },
];

type ActivityRow = {
  key: string;
  accountId: string;
  label: string;
  status: string;
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
        status: proposalStatusLabel(p.signaturesCollected, p.signaturesRequired),
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
        status: deltaStatusLabel(d.status),
        statusNode: deltaStatusBadge(d.status, d.statusReason),
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

// ponytail: sorts the entries paged in, like Accounts. The feeds take a cursor
// and a status and nothing else, so a whole-feed sort would page the whole
// Guardian first.
function sortValue(r: ActivityRow, key: SortKey): string | number {
  switch (key) {
    case "activity": return r.label;
    case "status": return r.status;
    case "date": return new Date(r.timestamp).getTime();
  }
}

export function TransactionsPanel() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterValue>("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { density, hidden, setDensity, toggleColumn } = useTablePrefs<ColumnKey>("transactions", HIDEABLE);
  const { sort, toggleSort } = useSort<SortKey>();

  const proposalsOnly = PROPOSALS_ONLY.includes(filter);
  const deltaStatus = (filter === "" || proposalsOnly) ? undefined : filter as DashboardDeltaStatus;
  const deltaUrl = proposalsOnly
    ? null
    : `/api/global-deltas${deltaStatus ? `?status=${deltaStatus}` : ""}`;

  const { data: deltasData, error: deltasError } = useSWR<GlobalDeltasPage>(deltaUrl, fetcher, { refreshInterval: 30_000 });
  const { data: proposalsData, error: proposalsError } = useSWR<GlobalProposalsPage>("/api/global-proposals", fetcher, { refreshInterval: 30_000 });

  const paging = usePaging(
    deltaUrl,
    deltasData,
    (cursor) => fetcher(`/api/global-deltas?${new URLSearchParams(deltaStatus ? { cursor, status: deltaStatus } : { cursor })}`),
    (d) => `${d.accountId}-${d.nonce}`,
  );

  const refresh = async () => {
    setRefreshing(true);
    paging.reset();
    try {
      await Promise.all([
        deltaUrl ? mutate(deltaUrl) : Promise.resolve(),
        mutate("/api/global-proposals"),
        refreshStatStrip(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const allDeltas = paging.items;
  const allProposals = proposalsData?.items ?? [];
  const loaded = toRows(allDeltas, allProposals, filter);
  const rows = sortRows(loaded.filter((r) => matchesAccountId(query, r.accountId)), sort, sortValue);

  // A feed that failed has settled, so it must not hold the skeleton up: the
  // proposals feed failing used to leave the page on skeletons for good.
  const loading =
    (!deltasData && !deltasError && !proposalsOnly) ||
    (!proposalsData && !proposalsError && (filter === "" || proposalsOnly));
  // Keep showing cached rows on a failed revalidation — SWR retries in the background
  const unavailable = proposalsOnly ? proposalsError && !proposalsData : deltasError && !deltasData;

  // Exports exactly what the table shows: same filter, same sort, same rows.
  // ponytail: loaded rows only, the same ceiling as on Accounts.
  function exportCsv() {
    posthog.capture("activity_exported", { row_count: rows.length, filter, sorted: !!sort });
    downloadCsv(`guardian-activity-${new Date().toISOString().slice(0, 10)}.csv`, activityToCsv(rows));
  }

  // The account is what makes a row identifiable, so it is not offered for
  // hiding. Same arrangement as the accounts table.
  const columns: TableColumn<ActivityRow, ColumnKey, SortKey>[] = [
    { key: "account", label: "Account ID", width: "w-36", cellClass: "text-data", cell: (r) => <CopyableId id={r.accountId} /> },
    { key: "counterparty", label: "To / From", width: "w-36", cellClass: "text-data", cell: (r) => <CounterpartyCell counterparty={r.counterparty} /> },
    { key: "activity", label: "Activity", width: "w-40", sortKey: "activity", cellClass: "text-data", cell: (r) => r.label },
    // The figure the row exists to show, same rank as Total assets on accounts.
    { key: "amount", label: "Amount", width: "w-32", align: "right", cellClass: "text-figure", cell: (r) => <AmountCell assets={r.assets} /> },
    { key: "status", label: "Status", width: "w-36", sortKey: "status", cellClass: "text-data", cell: (r) => r.statusNode },
    {
      key: "date", label: "Date", width: "w-40", sortKey: "date", cellClass: "text-data text-muted-foreground",
      cell: (r) => <Timestamp iso={r.timestamp} />,
    },
  ];
  const shownColumns = columns.filter((c) => !hidden.has(c.key));
  // Not while the skeletons are up: the deltas may have landed before the proposals.
  const more = paging.hasMore && !loading;

  return (
    <div className="flex flex-col gap-4">
      <StatStrip />
      {/* Same toolbar order as Accounts: search over the Account column it
          filters, status chips next, refresh pinned right. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <AccountIdFilter value={query} onChange={setQuery} />
        {FILTERS.map((f) => (
          <FilterChip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </FilterChip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={exportCsv} disabled={!rows.length} title="Download the rows currently shown as CSV" size="sm">
            <Download className="h-3 w-3" />
            Export CSV
          </Button>
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
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : unavailable ? (
        <div className="rounded-lg border border-dashed">
          <ErrorPanel error={proposalsOnly ? proposalsError : deltasError} onRetry={refresh} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed px-4 text-center text-data text-muted-foreground">
          {/* The search sees the entries loaded so far: the Guardian's activity
              feeds take a cursor and a status, so there is nothing to search with. */}
          {query
            ? `No activity for an account matching "${query.trim()}" among the ${formatCount(loaded.length)} loaded so far${more ? ", more are loading." : "."}`
            : "No activity found."}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <DataTable
              columns={shownColumns}
              rows={rows}
              rowKey={(r) => r.key}
              density={density}
              sort={sort}
              onSort={toggleSort}
              onRowClick={(row) => router.push(
                `/accounts/${encodeURIComponent(row.accountId)}${row.isPending ? "" : `/transactions/${row.nonce}`}`,
              )}
            />
          </CardContent>
        </Card>
      )}
      {/* The feeds carry no total, so the note says how deep the table goes. */}
      {more && rows.length > 0 && (
        <p
          className="text-center text-label text-muted-foreground"
          title="Filters, sort and export cover the entries loaded so far."
        >
          Showing the latest {formatCount(loaded.length)}
        </p>
      )}
      <LoadMoreSentinel {...paging} hasMore={more} />
    </div>
  );
}
