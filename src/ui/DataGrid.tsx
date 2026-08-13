import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import styles from "./DataGrid.module.css";

export function DataGrid<T>({
  data,
  columns,
  onRowClick,
  emptyMessage = "No data",
  footer,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRowClick?: (row: T) => void;
  virtualize?: boolean;
  rowHeight?: number;
  emptyMessage?: string;
  footer?: ReactNode;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;

  if (!data.length) {
    return <p className="muted" style={{ padding: "2rem", textAlign: "center" }}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className={(h.column.columnDef.meta as { className?: string } | undefined)?.className}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={onRowClick ? styles.clickable : undefined}
              onClick={() => onRowClick?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={(cell.column.columnDef.meta as { className?: string } | undefined)?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
