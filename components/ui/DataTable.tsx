"use client";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { Density, Sort, TableColumn } from "@/components/ui/TableControls";

/**
 * The one table markup, so the three tables cannot drift apart again. Fixed
 * layout with a colgroup: auto layout re-measured every column when a filter
 * swapped the mounted rows, and the whole table jumped sideways on each click.
 */
export function DataTable<T, K extends string, S extends string = string>({
  columns, rows, rowKey, density, sort, onSort, onRowClick, rowProps,
}: {
  columns: TableColumn<T, K, S>[];
  rows: T[];
  rowKey: (row: T) => string;
  density: Density;
  sort?: Sort<S> | null;
  onSort?: (key: S) => void;
  onRowClick: (row: T) => void;
  rowProps?: (row: T) => Record<`data-${string}`, string | undefined>;
}) {
  const pad = density === "compact" ? "px-3 py-1.5" : "px-4 py-3";
  return (
    <table className="w-full table-fixed">
      <colgroup>
        {columns.map((c) => <col key={c.key} className={c.width} />)}
      </colgroup>
      <thead>
        <tr className="border-b text-muted-foreground">
          {columns.map((c) => {
            const sortKey = onSort && c.sortKey;
            const dir = sortKey && sort?.key === sortKey ? sort.dir : null;
            return (
              <th
                key={c.key}
                className={`${pad} text-label ${c.align === "right" ? "text-right" : "text-left"}`}
                aria-sort={sortKey ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
              >
                {sortKey ? (
                  <button
                    onClick={() => onSort(sortKey)}
                    className={`inline-flex items-center gap-1 rounded-lg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dir ? "text-foreground" : ""}`}
                  >
                    {c.label}
                    {dir === "asc" ? <ChevronUp className="h-3 w-3" />
                      : dir === "desc" ? <ChevronDown className="h-3 w-3" />
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                ) : c.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          // Focusable, and Enter opens it: a row that only answers to a mouse
          // leaves the detail pages unreachable from the keyboard.
          <tr
            key={rowKey(row)}
            {...rowProps?.(row)}
            tabIndex={0}
            className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:bg-muted/40"
            onClick={() => onRowClick(row)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row); }}
          >
            {columns.map((c) => (
              <td key={c.key} className={`${pad} ${c.align === "right" ? "text-right" : ""} ${c.cellClass}`}>
                {c.cell(row, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
