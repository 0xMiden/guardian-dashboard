"use client";
import { SortableHeader, type Sort, type TableColumn } from "@/components/ui/TableControls";

/**
 * The one table markup, so the three tables cannot drift apart again.
 *
 * Fixed layout with a colgroup: auto layout re-measured every column when a
 * filter swapped the mounted rows, and the whole table jumped sideways on each
 * chip click. One definition per column drives the colgroup, the header and
 * the cells, so hiding a column cannot leave the three out of step.
 */
export function DataTable<T, K extends string, S extends string = string>({
  columns, rows, rowKey, padding, sort, onSort, onRowClick, clickable, rowProps,
}: {
  columns: TableColumn<T, K, S>[];
  rows: T[];
  rowKey: (row: T) => string;
  padding: string;
  sort?: Sort<S> | null;
  onSort?: (key: S) => void;
  onRowClick?: (row: T) => void;
  /** Which rows the click applies to; every row when absent. */
  clickable?: (row: T) => boolean;
  rowProps?: (row: T) => Record<`data-${string}`, string | undefined>;
}) {
  return (
    <table className="w-full table-fixed">
      <colgroup>
        {columns.map((c) => <col key={c.key} className={c.width} />)}
      </colgroup>
      <thead>
        <tr className="border-b text-muted-foreground">
          {columns.map((c) => c.sortKey && onSort ? (
            <SortableHeader key={c.key} label={c.label} sortKey={c.sortKey} sort={sort ?? null} onSort={onSort} align={c.align} padding={padding} />
          ) : (
            <th key={c.key} className={`${padding} text-label ${c.align === "right" ? "text-right" : "text-left"}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row)}
            {...rowProps?.(row)}
            className={`border-b last:border-0 transition-colors ${onRowClick && (clickable?.(row) ?? true) ? "cursor-pointer hover:bg-muted/40" : ""}`}
            onClick={onRowClick && (clickable?.(row) ?? true) ? () => onRowClick(row) : undefined}
          >
            {columns.map((c) => (
              <td key={c.key} className={`${padding} ${c.align === "right" ? "text-right" : ""} ${c.cellClass}`}>
                {c.cell(row, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
