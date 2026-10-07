"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Rows2, Rows3, Columns3, Check, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
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
 * Row padding for the chosen density. One place, so the header and the body
 * cells cannot drift apart.
 */
export const CELL_PADDING: Record<Density, string> = {
  compact: "px-3 py-1.5",
  comfortable: "px-4 py-3",
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
  const toggleSort = useCallback((key: S) => {
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  }, []);
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

export function SortableHeader<S extends string>({
  label, sortKey, sort, onSort, align = "left", padding,
}: {
  label: string;
  sortKey: S;
  sort: Sort<S> | null;
  onSort: (key: S) => void;
  align?: "left" | "right";
  padding: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={`${padding} text-label ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-lg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active
          ? (sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Paging, shared so every table loads the same way: the next page arrives as
// this sentinel scrolls into view. Accounts had this and both Activity tables
// had a "Load more" button, which is two answers to one question.

export function LoadMoreSentinel({
  hasMore, loading, onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Stable ref so the observer never needs rebuilding on cursor changes.
  const loadMoreRef = useRef(onLoadMore);
  useEffect(() => { loadMoreRef.current = onLoadMore; }, [onLoadMore]);

  // Rebuilt only when the sentinel appears or disappears (hasMore flips).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return; // jsdom, older browsers
    let busy = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !busy) {
          busy = true;
          loadMoreRef.current().finally(() => { busy = false; });
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  if (!hasMore) return null;
  return (
    <>
      <div ref={ref} data-testid="load-more-sentinel" className="h-1" />
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}
    </>
  );
}
