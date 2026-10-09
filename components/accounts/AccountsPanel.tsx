"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Snowflake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardAccountSummary, PagedResult } from "@openzeppelin/guardian-operator-client";
import posthog from "posthog-js";
import { CopyableId } from "@/components/ui/CopyableId";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { AccountIdFilter } from "@/components/ui/AccountIdFilter";
import { FilterChip } from "@/components/ui/FilterChip";
import { stateBadge } from "@/components/accounts/StateBadge";
import { Button } from "@/components/ui/Button";
import { Timestamp } from "@/components/ui/Timestamp";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { TableControls, useTablePrefs, useSort, sortRows, usePaging, LoadMoreSentinel, type TableColumn } from "@/components/ui/TableControls";
import { StatStrip, refreshStatStrip, STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";
import { fetcher, downloadCsv } from "@/lib/utils";
import { isWalletAccount, matchesAccountId, looksLikeAccountId, accountState, accountsToCsv, formatCount } from "@/lib/format";

type AccountsPage = PagedResult<DashboardAccountSummary>;
type AccountKind = "all" | "wallet" | "other";
type AccountState = "all" | "active" | "frozen" | "released";
type SnapshotTarget = { accountId: string; updatedAt: string };
type SortKey = "status" | "signers" | "assets" | "created" | "updated";
type ColumnKey = "index" | "id" | "status" | "type" | "signers" | "pending" | "assets" | "created" | "updated";

// The row number and the account id are what make a row identifiable, so they
// are not offered for hiding. Everything else is.
const HIDEABLE: readonly ColumnKey[] = ["status", "type", "signers", "pending", "assets", "created", "updated"];

// Coalescing window for rows scrolling into view.
const SNAPSHOT_BATCH_MS = 150;

// The Guardian's documented maximum page size, verified against every reachable
// Guardian. A page costs one request whatever its size, so the 50-row default
// meant 29 round trips to scroll a 1,418-account Guardian instead of 3.
// Asset totals are still fetched per visible row, so a larger page pulls no
// extra snapshots.
const PAGE_SIZE = 500;
export const ACCOUNTS_KEY = `/api/accounts?limit=${PAGE_SIZE}`;

// Frozen-only is a server-side filter, unlike the chips and the search box
// which act on rows already paged in. That is the whole point: an operator
// arriving from the Overview count needs the frozen accounts wherever they sit
// in the inventory, not the ones that happen to be on screen.
const accountsKey = (frozenOnly: boolean) =>
  frozenOnly ? `${ACCOUNTS_KEY}&paused=true` : ACCOUNTS_KEY;

// null sorts last in both directions: a row whose asset total was never fetched
// is unknown, and ordering it as zero would read as an empty account.
function sortValue(a: DashboardAccountSummary, key: SortKey, assets: Record<string, number | null>): string | number | null {
  switch (key) {
    case "status": return accountState(a.stateStatus, a.pausedAt, a.releasedAt);
    case "signers": return a.authorizedSignerCount;
    case "assets": return assets[a.accountId] ?? null;
    case "created": return new Date(a.createdAt).getTime();
    case "updated": return new Date(a.updatedAt).getTime();
  }
}

export function AccountsPanel() {
  // The Overview lifecycle cards land here with the matching chip selected.
  // Frozen also asks the Guardian for its paused set, so the table holds every
  // frozen account wherever it sits in the list, not only the ones paged in.
  const stateParam = useSearchParams().get("state");
  const frozenOnly = stateParam === "frozen";
  const listKey = accountsKey(frozenOnly);
  const { data, error } = useSWR<AccountsPage>(listKey, fetcher, { refreshInterval: 30_000 });
  // Same key as StatStrip above the table, so SWR serves both from one request.
  const { data: stats } = useSWR<AccountStats>(STATS_KEY, fetcher);
  const router = useRouter();
  // A number is a dollar value, `null` a vault holding only tokens nothing
  // prices (see lib/prices.ts), absent means not fetched.
  const [perAccount, setPerAccount] = useState<Record<string, number | null>>({});
  // Which rows have a request out right now. One global "loading" flag put a
  // spinner on every row without a value, including rows that were never
  // requested and rows whose fetch had already failed.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const paging = usePaging(listKey, data, (cursor) => fetcher(`${listKey}&cursor=${encodeURIComponent(cursor)}`), (a) => a.accountId);
  const [kind, setKind] = useState<AccountKind>("all");
  const [state, setState] = useState<AccountState>(
    stateParam === "active" || stateParam === "frozen" || stateParam === "released" ? stateParam : "all",
  );
  // Leaving the frozen chip also leaves the server-side filter behind.
  const pickState = (next: AccountState) => {
    setState(next);
    if (frozenOnly && next !== "frozen") router.replace("/accounts");
  };
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { sort, toggleSort } = useSort<SortKey>();
  const { density, hidden, setDensity, toggleColumn } = useTablePrefs<ColumnKey>("accounts", HIDEABLE);

  const loaded = paging.items;
  const stateOf = (a: DashboardAccountSummary) => accountState(a.stateStatus, a.pausedAt, a.releasedAt);
  const filtered = loaded.filter(
    (a) =>
      (kind === "all" || isWalletAccount(a) === (kind === "wallet")) &&
      (state === "all" || stateOf(a) === state) &&
      matchesAccountId(query, a.accountId, a.accountIdBech32),
  );
  // The ids the table will actually mount. The row observer keys off this, so
  // it tracks the rendered set rather than a hand-kept list of the state that
  // affects it. Sort is deliberately not folded in: it reorders keyed rows
  // without unmounting any, so the observer keeps watching the same elements.
  const renderedKey = filtered.map((a) => a.accountId).join(",");

  // The Guardian has no batch read, so one row's asset total is one request to it.
  // Rows carry `updatedAt` so the server can skip accounts that provably have
  // not changed since it last looked.
  const fetchSnapshots = useCallback(async (rows: SnapshotTarget[], refresh = false) => {
    if (!rows.length) return;
    const ids = rows.map((r) => r.accountId);
    setInFlight((prev) => new Set([...prev, ...ids]));
    try {
      const query = rows.map((r) => encodeURIComponent(`${r.accountId}@${r.updatedAt}`)).join(",");
      const res = await fetch(`/api/accounts/snapshots?ids=${query}${refresh ? "&refresh=1" : ""}`);
      if (!res.ok) throw new Error(`snapshots ${res.status}`);
      const data: Record<string, number | null> = await res.json();
      setPerAccount((prev) => ({ ...prev, ...data }));
    } catch {
      // snapshots are best-effort — leave column as "—" on failure
    } finally {
      // Only this batch's rows: another batch may still be out.
      setInFlight((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }, []);

  const fetchSnapshotsRef = useRef(fetchSnapshots);
  useEffect(() => { fetchSnapshotsRef.current = fetchSnapshots; }, [fetchSnapshots]);

  // Asset totals are fetched for rows the user can actually see. Loading a
  // 100-row page used to cost 100 Guardian requests up front; a viewport holds
  // roughly 15. Rows are registered by the observer below and drained on a
  // short timer so a fast scroll coalesces into one request instead of many.
  const pendingRef = useRef(new Map<string, string>());
  const requestedRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which rows are on screen right now. Refresh reads this so it recomputes
  // what the user is looking at rather than every row they have ever scrolled
  // past, which on a long session is hundreds of requests.
  const visibleRef = useRef(new Set<string>());

  const queueSnapshot = useCallback((accountId: string, updatedAt: string) => {
    const key = `${accountId}@${updatedAt}`;
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    pendingRef.current.set(accountId, updatedAt);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const rows = [...pendingRef.current].map(([accountId, updatedAt]) => ({ accountId, updatedAt }));
      pendingRef.current.clear();
      fetchSnapshotsRef.current(rows);
    }, SNAPSHOT_BATCH_MS);
  }, []);

  useEffect(() => () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); }, []);

  // Refresh is scoped to the rows on screen plus the aggregates. A full
  // recompute cannot fit in one click: hundreds of accounts against a budget of
  // 60 requests a minute is minutes of paced fetching, and attempting it as a
  // burst is what earns the 429s that leave the page with no numbers at all.
  const refresh = async () => {
    setRefreshing(true);
    try {
      // The account list comes first and the rest waits for it: a row's
      // `updatedAt` is its cache key, so asking for totals before the new
      // versions land would just re-read what is already on screen. A failed
      // revalidation falls back to the rendered rows, which still works because
      // `refresh=1` re-reads them whatever their version says.
      // The paged-in tail is kept, unlike on Activity: a refresh here is scoped
      // to the rows on screen, and dropping the tail would pull them away.
      const page = await mutate<AccountsPage>(listKey);
      const fresh = new Map((page?.items ?? []).map((a) => [a.accountId, a]));
      const rows = loaded
        .filter((a) => visibleRef.current.has(a.accountId))
        .map((a) => fresh.get(a.accountId) ?? a)
        .map((a) => ({ accountId: a.accountId, updatedAt: a.updatedAt }));
      // Let the observer re-queue these once the new versions are rendered.
      for (const r of rows) requestedRef.current.delete(`${r.accountId}@${r.updatedAt}`);
      await Promise.all([refreshStatStrip(), fetchSnapshotsRef.current(rows, true)]);
    } finally {
      setRefreshing(false);
    }
  };

  // A row entering view queues its asset total. Rows stay observed rather than
  // being unobserved after first sight: the queue key includes `updatedAt`, so
  // an account that changes re-queues on its own the next time it is on screen.
  //
  // Rebuilt whenever the rendered row set changes, keyed off the rows
  // themselves. The dependency list used to name the state that affects them,
  // which meant the chip filter was covered and the search box was not: typing
  // in it swapped the mounted rows while the observer went on watching detached
  // ones, and totals never loaded for what was actually on screen.
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return; // jsdom, older browsers
    const root = tableRef.current;
    if (!root) return;
    visibleRef.current.clear(); // the rendered rows changed; the observer refills it
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const { accountId, updatedAt } = (entry.target as HTMLElement).dataset;
          if (!accountId) continue;
          if (!entry.isIntersecting) { visibleRef.current.delete(accountId); continue; }
          visibleRef.current.add(accountId);
          if (updatedAt) queueSnapshot(accountId, updatedAt);
        }
      },
      { rootMargin: "150px" }
    );
    root.querySelectorAll("tr[data-account-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [renderedKey, queueSnapshot]);

  // ponytail: sorts the rows already paged in, the same ceiling the filters above
  // carry. `ListAccountsOptions` is limit/cursor/paused with no ordering, so a
  // full-inventory sort would mean paging the whole Guardian first. Upgrade path is an
  // order parameter on the Guardian's list endpoints.
  const items = sortRows(filtered, sort, (a, key) => sortValue(a, key, perAccount));

  // What the Guardian holds, from the same aggregate that feeds the stat strip,
  // for the "showing N of M" note below the table. Under the frozen filter the
  // loaded rows *are* the whole set, because that filter is applied server-side.
  const total = stats?.total != null && !frozenOnly ? stats.total : loaded.length;

  // Exports exactly what the table shows: same filter, same sort, same rows.
  // ponytail: loaded rows only, so an export after scrolling three pages holds
  // three pages. The empty state and the column ceilings say the same thing;
  // a whole-inventory export needs the Guardian-side paging this panel avoids.
  // Upgrade path is a server-side export route that pages the Guardian itself.
  // Revisit when someone asks for an export that is not what they are looking
  // at, or when the row count makes scrolling to collect it absurd.
  function exportCsv() {
    posthog.capture("accounts_exported", { row_count: items.length, filter: kind, state, sorted: !!sort });
    downloadCsv(`guardian-accounts-${new Date().toISOString().slice(0, 10)}.csv`, accountsToCsv(items, perAccount));
  }

  function openAccount(a: DashboardAccountSummary) {
    posthog.capture("account_clicked", {
      account_id: a.accountId,
      account_status: a.stateStatus,
      has_pending_candidate: a.hasPendingCandidate,
    });
  }

  // One definition per column drives the colgroup, the header and the cells, so
  // hiding a column cannot leave the three lists out of step. Built here rather
  // than at module scope because the cells read the asset totals and the
  // in-flight set, which change as rows scroll into view.
  const columns: TableColumn<DashboardAccountSummary, ColumnKey, SortKey>[] = [
    {
      key: "index", label: "#", width: "w-12", align: "right",
      cellClass: "text-data text-muted-foreground tabular-nums",
      cell: (_a, i) => i + 1,
    },
    {
      key: "id", label: "Account ID", width: "w-52", cellClass: "text-data",
      cell: (a) => (
        <CopyableId
          id={a.accountIdBech32 ?? a.accountId}
          href={`/accounts/${a.accountId}`}
          onNavigate={() => openAccount(a)}
        />
      ),
    },
    {
      key: "status", label: "Status", width: "w-28", sortKey: "status", cellClass: "text-data",
      cell: (a) => stateBadge(a.stateStatus, a.pausedAt, a.releasedAt),
    },
    {
      key: "type", label: "Type", width: "w-24", cellClass: "text-data",
      cell: (a) => isWalletAccount(a) ? (
        <Badge variant="outline" className="text-muted-foreground" title="Inferred from auth shape (ECDSA, 2 signers)">
          wallet
        </Badge>
      ) : (
        // The word the Other chip filters on. A dash would say "unknown",
        // and this is known: a multisig the wallet did not create.
        <span className="text-muted-foreground text-xs">other</span>
      ),
    },
    {
      key: "signers", label: "Signers", width: "w-20", align: "right", sortKey: "signers",
      cellClass: "text-data tabular-nums text-muted-foreground",
      cell: (a) => a.authorizedSignerCount,
    },
    {
      key: "pending", label: "Submitted", width: "w-24", cellClass: "text-data",
      cell: (a) => a.hasPendingCandidate ? (
        <Badge variant="outline" className="border-state-pending text-state-pending">submitted</Badge>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      // The number a row exists to show, so it outranks everything beside it.
      // It used to be 12px and dimmed, which put it below the signer count and
      // level with its own column header.
      key: "assets", label: "Total assets", width: "w-32", align: "right", sortKey: "assets",
      cellClass: "text-figure",
      cell: (a) => typeof perAccount[a.accountId] === "number"
        ? <span className="tabular-nums text-foreground">${perAccount[a.accountId]!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        : perAccount[a.accountId] === null
        ? <span className="text-muted-foreground" title="Holds only tokens with no price: not on the verified token list, or the price feed is unreachable.">unpriced</span>
        : inFlight.has(a.accountId)
        ? <Skeleton className="ml-auto h-3 w-16" data-testid={`assets-loading-${a.accountId}`} />
        : <span className="text-muted-foreground" title="Not fetched yet. Totals load for rows as they scroll into view.">—</span>,
    },
    {
      key: "created", label: "Created", width: "w-40", sortKey: "created",
      cellClass: "text-data text-muted-foreground",
      cell: (a) => <Timestamp iso={a.createdAt} />,
    },
    {
      key: "updated", label: "Updated", width: "w-40", sortKey: "updated",
      cellClass: "text-data text-muted-foreground",
      cell: (a) => <Timestamp iso={a.updatedAt} />,
    },
  ];
  const shownColumns = columns.filter((c) => !hidden.has(c.key));

  // Keep showing cached rows on a failed revalidation — SWR retries in the background.
  // The toolbar stays up in every state, as it does on Activity: Refresh is the
  // way out of the error state, so it cannot leave with the rows.
  const loading = !data && !error;
  const unavailable = error && !data;

  return (
    <div className="flex flex-col gap-4">
      <StatStrip />
      {/* Search sits at the left edge, over the Account ID column it filters.
          Row-scoped controls stay on the left, table-scoped ones on the right. */}
      {/* A filtered table that does not say so is a table that lies. This is a
          server-side filter, so the chips and counts below describe the frozen
          subset rather than the Guardian. */}
      {frozenOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-state-frozen/40 bg-state-frozen/10 px-3 py-2 text-data">
          <Snowflake className="h-3.5 w-3.5 shrink-0 text-state-frozen" />
          <span className="text-state-frozen">Showing frozen accounts only</span>
          <Link href="/accounts" className="ml-auto text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Show all accounts
          </Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AccountIdFilter value={query} onChange={setQuery} />
        {/* One chip group per column it filters, named after the column. No
            counts: the Status group had none the aggregate could fill under
            every filter, and a row where one group counts and the other does
            not reads as two different controls. The "showing N of M" note
            below the table carries the total. */}
        {([
          ["all", "Any type"],
          ["wallet", "Wallet"],
          ["other", "Other"],
        ] as const).map(([value, label]) => (
          <FilterChip key={value} active={kind === value} onClick={() => setKind(value)}>
            {label}
          </FilterChip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {([
          ["all", "Any status", undefined],
          ["active", "Active", "Neither frozen nor released."],
          ["released", "Released", "Moved to another Guardian, which now acknowledges their transactions."],
          ["frozen", "Frozen", "Paused by the operator. No transaction is acknowledged until unfrozen."],
        ] as const).map(([value, label, title]) => (
          <FilterChip key={value} active={state === value} onClick={() => pickState(value)} title={title}>
            {label}
          </FilterChip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={exportCsv} disabled={!items.length} title="Download the rows currently shown as CSV" size="sm">
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
          <ErrorPanel error={error} onRetry={refresh} />
        </div>
      ) : !loaded.length ? (
        // An empty *filtered* list is not an empty Guardian. Saying "no accounts
        // registered" to someone who arrived from the frozen count would be flatly
        // untrue. The banner above carries the way back.
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-data text-muted-foreground">
          {frozenOnly ? "No accounts are frozen." : "No accounts registered on this Guardian yet."}
        </div>
      ) : (
        <Card>
          <CardContent ref={tableRef} className="p-0 overflow-x-auto">
            <DataTable
              columns={shownColumns}
              rows={items}
              rowKey={(a) => a.accountId}
              density={density}
              sort={sort}
              onSort={toggleSort}
              onRowClick={(a) => { openAccount(a); router.push(`/accounts/${a.accountId}`); }}
              rowProps={(a) => ({ "data-account-id": a.accountId, "data-updated-at": a.updatedAt })}
            />
            {!items.length && (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                <p>
                  {query
                    ? `No account matching "${query.trim()}" among the ${formatCount(loaded.length)} loaded so far`
                    : `No ${[state, kind].filter((f) => f !== "all").join(" ")} accounts among the ${formatCount(loaded.length)} loaded so far`}
                  {paging.hasMore ? ", more are loading." : "."}
                </p>
                {/* The filter can only see rows that have been paged in. A full ID
                    needs no search endpoint to open, so offer that directly. */}
                {looksLikeAccountId(query) && (
                  <Button onClick={() => router.push(`/accounts/${encodeURIComponent(query.trim())}`)} size="sm" className="mt-2">
                    Open this account directly
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {total > loaded.length && (
        <p
          className="text-center text-label text-muted-foreground"
          title="Filters, sort and export cover the rows loaded so far."
        >
          Showing {formatCount(loaded.length)} of {formatCount(total)}
        </p>
      )}
      <LoadMoreSentinel {...paging} />
    </div>
  );
}
