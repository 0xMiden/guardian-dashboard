"use client";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { CELL_PADDING, type Density, type Sort, type TableColumn } from "@/components/ui/TableControls";

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
  const pad = CELL_PADDING[density];
  return (
    <table className="w-full table-fixed">
      <colgroup>
        {columns.map((c) => <col key={c.key} className={c.width} />)}
      </colgroup>
      <thead>
        <tr className="border-b text-muted-foreground">
          {columns.map((c) => {
            const active = !!c.sortKey && sort?.key === c.sortKey;
            return (
              <th
                key={c.key}
                className={`${pad} text-label ${c.align === "right" ? "text-right" : "text-left"}`}
                aria-sort={c.sortKey && onSort ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
              >
                {c.sortKey && onSort ? (
                  <button
                    onClick={() => onSort(c.sortKey!)}
                    className={`inline-flex items-center gap-1 rounded-lg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : ""}`}
                  >
                    {c.label}
                    {active
                      ? (sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
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
          <tr
            key={rowKey(row)}
            {...rowProps?.(row)}
            className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => onRowClick(row)}
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
