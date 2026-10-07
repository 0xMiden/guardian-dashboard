"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/Timestamp";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { DataTable } from "@/components/ui/DataTable";
import { TableControls, useTablePrefs, usePaging, LoadMoreSentinel, type TableColumn } from "@/components/ui/TableControls";
import { fetcher } from "@/lib/utils";
import { activityLabel, deltaStatusBadge, proposalStatusBadge, AmountCell, CounterpartyCell } from "@/components/transactions/activity-cells";
import type { DashboardDeltaEntry, DashboardProposalEntry, PagedResult } from "@openzeppelin/guardian-operator-client";

type DeltasPage = PagedResult<DashboardDeltaEntry>;
type ProposalsPage = PagedResult<DashboardProposalEntry>;

type ActivityRow = {
  key: string;
  label: string;
  statusNode: React.ReactNode;
  assets: DashboardDeltaEntry["assets"];
  counterparty: DashboardDeltaEntry["counterparty"];
  timestamp: string;
  isDelta: boolean;
  nonce: number;
};

type ColumnKey = "nonce" | "counterparty" | "activity" | "amount" | "status" | "date";
// Everything but the nonce, which is what identifies a row.
const HIDEABLE: readonly ColumnKey[] = ["counterparty", "activity", "amount", "status", "date"];

interface Props {
  accountId: string;
}

/**
 * One account's activity, on the same table, controls and paging as the global
 * Activity table. No chips, sort or export, since those act on the loaded rows
 * and one account's feed is read top to bottom; the nonce column stands in for
 * the account column.
 */
export function AccountTransactions({ accountId }: Props) {
  const router = useRouter();
  const encoded = encodeURIComponent(accountId);
  const deltasKey = `/api/accounts/${encoded}/deltas`;
  const proposalsKey = `/api/accounts/${encoded}/proposals`;

  const { data: deltasData, error: deltasError } = useSWR<DeltasPage>(deltasKey, fetcher, { refreshInterval: 30_000 });
  const { data: proposalsData, error: proposalsError } = useSWR<ProposalsPage>(proposalsKey, fetcher, { refreshInterval: 30_000 });

  const { extra: extraDeltas, hasMore, loadingMore, loadMore, reset } = usePaging(deltasData, (cursor) =>
    fetcher(`${deltasKey}?cursor=${encodeURIComponent(cursor)}`));
  const [refreshing, setRefreshing] = useState(false);
  const { density, hidden, setDensity, toggleColumn } = useTablePrefs<ColumnKey>("account-activity", HIDEABLE);

  const refresh = async () => {
    setRefreshing(true);
    reset();
    try {
      await Promise.all([mutate(deltasKey), mutate(proposalsKey)]);
    } finally {
      setRefreshing(false);
    }
  };

  const allDeltas = [...(deltasData?.items ?? []), ...extraDeltas];
  const allProposals = proposalsData?.items ?? [];

  const rows: ActivityRow[] = [
    ...allProposals.map((p) => ({
      key: `proposal-${p.nonce}`,
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
      label: activityLabel(d.category, d.proposalType),
      statusNode: deltaStatusBadge(d.status, d.statusReason),
      assets: d.assets,
      counterparty: d.counterparty,
      timestamp: d.statusTimestamp,
      isDelta: true,
      nonce: d.nonce,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // A feed that failed has settled, so it must not hold the skeleton up.
  const loading = (!deltasData && !deltasError) || (!proposalsData && !proposalsError);
  // Keep showing cached rows on a failed revalidation — SWR retries in the background
  const unavailable = deltasError && !deltasData;

  const columns: TableColumn<ActivityRow, ColumnKey>[] = [
    { key: "nonce", label: "Nonce", width: "w-20", align: "right", cellClass: "text-data text-muted-foreground tabular-nums", cell: (r) => r.nonce },
    { key: "counterparty", label: "To / From", width: "w-36", cellClass: "text-data", cell: (r) => <CounterpartyCell counterparty={r.counterparty} /> },
    { key: "activity", label: "Activity", width: "w-40", cellClass: "text-data", cell: (r) => r.label },
    { key: "amount", label: "Amount", width: "w-32", align: "right", cellClass: "text-figure", cell: (r) => <AmountCell assets={r.assets} /> },
    { key: "status", label: "Status", width: "w-36", cellClass: "text-data", cell: (r) => r.statusNode },
    { key: "date", label: "Date", width: "w-40", cellClass: "text-data text-muted-foreground", cell: (r) => <Timestamp iso={r.timestamp} /> },
  ];
  const shownColumns = columns.filter((c) => !hidden.has(c.key));

  return (
    <div className="flex flex-col gap-4">
      {/* A link rather than history.back(): this URL gets shared, and for a
          reader who arrived from elsewhere "back" is not the account. */}
      <Link
        href={`/accounts/${encoded}`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to account
      </Link>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <p className="text-muted-foreground font-mono truncate">{accountId}</p>
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
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : unavailable ? (
        <div className="rounded-lg border border-dashed">
          <ErrorPanel error={deltasError} onRetry={refresh} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed px-4 text-center text-data text-muted-foreground">
          No activity recorded for this account yet.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <DataTable
              columns={shownColumns}
              rows={rows}
              rowKey={(r) => r.key}
              density={density}
              // A proposal has no delta page yet; its row opens the account, as on Activity.
              onRowClick={(r) => router.push(`/accounts/${encoded}${r.isDelta ? `/transactions/${r.nonce}` : ""}`)}
            />
          </CardContent>
        </Card>
      )}
      <LoadMoreSentinel hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
