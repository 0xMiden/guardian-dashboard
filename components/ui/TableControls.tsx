"use client";
import { useEffect, useRef, useState } from "react";
import type { PagedResult } from "@openzeppelin/guardian-operator-client";
import { Rows2, Rows3, Columns3, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";

export type Density = "compact" | "comfortable";

/**
 * One definition per column, driving the colgroup, the header and the cells.
 * Those were three positional lists that had to agree, which is workable until
 * a column can be hidden and all three have to stay in step.
 */
export type TableColumn<T, K extends string, S extends string = string> = {
  key: K;
  label: string;
  width: string;
  align?: "left" | "right";
  /** Present on a column the table can be sorted by. */
  sortKey?: S;
  /** Required: the cell's size role. Without it a column renders at the
   *  browser default, which is how a table ends up with no hierarchy. */
  cellClass: string;
  cell: (item: T, index: number) => React.ReactNode;
};

/**
 * Table preferences, remembered per table.
 *
 * Read during the first render rather than in an effect, so the table does not
 * paint at one density and then jump to another. `GuardianStatusCard` does the
 * same with its latency samples.
 */
export function useTablePrefs<K extends string>(tableId: string, hideable: readonly K[]) {
  const key = `guardian:table:${tableId}`;

  const [prefs, setPrefs] = useState<{ density: Density; hidden: K[] }>(() => {
    // localStorage is unavailable while rendering on the server.
    if (typeof window === "undefined") return { density: "comfortable", hidden: [] };
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
      return {
        density: raw.density === "compact" ? "compact" : "comfortable",
        // Filtered against the current column set: a stored key for a column
        // that has since been renamed or removed would otherwise hide nothing
        // while still counting towards "n hidden".
        hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((h: K) => hideable.includes(h)) : [],
      };
    } catch {
      return { density: "comfortable", hidden: [] };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      // Private browsing and full quotas both throw here. Losing the preference
      // is not worth taking the table down for.
    }
  }, [key, prefs]);

  return {
    density: prefs.density,
    hidden: new Set<K>(prefs.hidden),
    setDensity: (density: Density) => setPrefs((p) => ({ ...p, density })),
    toggleColumn: (col: K) =>
      setPrefs((p) => ({
        ...p,
        hidden: p.hidden.includes(col) ? p.hidden.filter((c) => c !== col) : [...p.hidden, col],
      })),
  };
}

export function TableControls<K extends string>({
  density,
  onDensityChange,
  columns,
  hidden,
  onToggleColumn,
}: {
  density: Density;
  onDensityChange: (d: Density) => void;
  columns: readonly { key: K; label: string }[];
  hidden: Set<K>;
  onToggleColumn: (col: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the two ways anyone expects to dismiss
  // a popover. Bound only while it is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const next: Density = density === "compact" ? "comfortable" : "compact";

  return (
    <>
      <Button
        onClick={() => onDensityChange(next)}
        title={`Switch to ${next} rows`}
        aria-label={`Switch to ${next} rows`}
        size="sm"
      >
        {density === "compact" ? <Rows3 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
      </Button>

      <div className="relative" ref={ref}>
        <Button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          title="Choose columns"
          size="sm"
        >
          <Columns3 className="h-3 w-3" />
          Columns
          {hidden.size > 0 && <span className="tabular-nums">({columns.length - hidden.size})</span>}
        </Button>
        {open && (
          <div className="absolute right-0 z-20 mt-1 flex w-48 flex-col rounded-lg border bg-background p-1 shadow-lg">
            {/* Rows inside the popover, not bordered controls. */}
            {columns.map((c) => (
              <button
                key={c.key}
                role="menuitemcheckbox"
                aria-checked={!hidden.has(c.key)}
                onClick={() => onToggleColumn(c.key)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-data transition-colors hover:bg-muted"
              >
                <Check className={`h-3 w-3 shrink-0 ${hidden.has(c.key) ? "opacity-0" : ""}`} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sorting, shared so every table cycles the same way.

export type Sort<S extends string> = { key: S; dir: "asc" | "desc" };

/**
 * null is the Guardian's own order. Clicking a header cycles desc, asc, back to
 * null, so there is a way back to the order the rows arrived in.
 */
export function useSort<S extends string>() {
  const [sort, setSort] = useState<Sort<S> | null>(null);
  const toggleSort = (key: S) =>
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  return { sort, toggleSort };
}

/**
 * Stable sort on one value per row. null sorts last in both directions: a
 * value that is unknown must not read as the smallest one.
 */
export function sortRows<T, S extends string>(
  rows: T[],
  sort: Sort<S> | null,
  value: (row: T, key: S) => string | number | null,
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = value(a, sort.key);
    const bv = value(b, sort.key);
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Paging, shared so every table loads the same way.

/**
 * Cursor paging past the first page SWR holds under `key`: every row loaded so
 * far, and whether there is another page. The pages fetched past the first
 * belong to that key; a new key (a filter change) starts over, as does
 * `reset` (a refresh, which refetches the first page under the same key), and
 * a page still in flight for the previous one is dropped when it lands.
 *
 * ponytail: SWR polls the first page every 30 s while the tail continues from
 * the cursor of the first page as it was. A row that moved between the two is
 * deduped by key; a row that fell off the first page is not shown. Upgrade
 * path is swr/infinite, which keys each page off the one before it.
 */
export function usePaging<T>(
  key: string | null,
  firstPage: PagedResult<T> | undefined,
  fetchPage: (cursor: string) => Promise<PagedResult<T>>,
  rowKey: (row: T) => string,
) {
  const [extra, setExtra] = useState<T[]>([]);
  // undefined = nothing paged yet, the first page's cursor applies; null = exhausted
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const clear = () => { setExtra([]); setNext(undefined); setLoadingMore(false); setFailed(false); };
  // Cleared from the key during render, the React way to follow a prop change.
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) { setForKey(key); clear(); }
  // What a landing page compares itself against: the key and reset count at the time it was asked for.
  const generation = useRef(0);
  const current = useRef(key);
  useEffect(() => { current.current = key; }, [key]);
  const reset = () => { generation.current++; clear(); };

  const cursor = next === undefined ? firstPage?.nextCursor ?? null : next;
  const seen = new Set<string>();
  const items = [...(firstPage?.items ?? []), ...extra].filter((row) => !seen.has(rowKey(row)) && !!seen.add(rowKey(row)));
  return {
    items,
    hasMore: cursor !== null,
    loadingMore,
    failed,
    reset,
    async loadMore() {
      if (!cursor) return;
      const mine = generation.current;
      const live = () => mine === generation.current && key === current.current;
      setLoadingMore(true);
      setFailed(false);
      try {
        const page = await fetchPage(cursor);
        if (!live()) return;
        setExtra((prev) => [...prev, ...page.items]);
        setNext(page.nextCursor);
      } catch {
        // The cursor is untouched, so a retry asks for the same page.
        if (live()) setFailed(true);
      } finally {
        if (live()) setLoadingMore(false);
      }
    },
  };
}

/**
 * The next page arrives as this scrolls into view. After a failed page it
 * stops asking and offers a retry instead: an observer rebuilt after every
 * failure would hammer a Guardian that is already refusing.
 */
export function LoadMoreSentinel({
  hasMore, loadingMore, failed, loadMore,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  failed: boolean;
  loadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Read through a ref so a caller's per-render function does not rebuild the observer every render.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // Rebuilt when a page lands as well as when hasMore flips: the observer only
  // fires on a visibility change, and a sentinel still on screen after a page
  // of rows that all fell to a client-side filter would otherwise never ask
  // for the next one. A browser also fires a fresh observer at once for an
  // element already in view, so none is built while a page is loading (the
  // same cursor would be fetched twice) or after one failed (see above).
  // ponytail: a search matching nothing pages through the whole feed, one
  // request per page, which is what "keep scrolling" says. Upgrade path is a
  // server-side account filter on the Guardian's feeds.
  useEffect(() => {
    const el = ref.current;
    if (!el || loadingMore || failed || typeof IntersectionObserver === "undefined") return; // jsdom, older browsers
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRef.current(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, failed]);

  if (!hasMore) return null;
  if (failed) {
    return (
      <Button onClick={loadMore} size="sm" className="self-center">
        Loading more failed. Try again
      </Button>
    );
  }
  return (
    <>
      <div ref={ref} className="h-1" />
      {loadingMore && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}
    </>
  );
}
