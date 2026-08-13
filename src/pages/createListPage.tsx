import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { extractRows } from "@/api/extractRows";
import { scopedPath } from "@/lib/apiQuery";
import { SectionHeader } from "@/ui/SectionHeader";
import { DataGrid } from "@/ui/DataGrid";
import { Card } from "@/ui/Card";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";
import { useAppStore } from "@/stores/theme-store";

export function createListPage<T extends Record<string, unknown>>({
  title,
  subtitle,
  queryKey: baseQueryKey,
  fetchPath,
  columns,
  inspectorTitle,
  selectRows,
  useMonth = false,
  companyScoped = true,
  actions,
}: {
  title: string;
  subtitle?: string | ((month: string) => string);
  queryKey: string[];
  fetchPath: string | ((month: string) => string);
  columns: ColumnDef<T, unknown>[];
  inspectorTitle?: (row: T) => string;
  selectRows?: (data: unknown) => T[];
  useMonth?: boolean;
  companyScoped?: boolean;
  actions?: ReactNode;
}) {
  return function ListPage() {
    const month = useAppStore((s) => s.month);
    const companyContext = useAppStore((s) => s.companyContext);
    const openInspector = useInspectorStore((s) => s.openInspector);
    const rawPath = typeof fetchPath === "function" ? fetchPath(month) : fetchPath;
    const path = companyScoped ? scopedPath(rawPath, undefined, companyContext) : rawPath;
    const qk = [
      ...baseQueryKey,
      ...(useMonth ? [month] : []),
      ...(companyScoped ? [companyContext] : []),
    ];
    const sub = typeof subtitle === "function" ? subtitle(month) : subtitle;

    const { data, isLoading, error } = useQuery({
      queryKey: qk,
      queryFn: () => api(path),
    });

    const rows = extractRows<T>(data, selectRows);

    return (
      <div>
        <SectionHeader title={title} subtitle={sub} actions={actions} />
        <Card>
          {isLoading && <p className="muted">Loading…</p>}
          {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
          {!isLoading && !error && (
            <DataGrid
              data={rows}
              columns={columns}
              onRowClick={
                inspectorTitle
                  ? (row) =>
                      openInspector(
                        inspectorTitle(row),
                        <InspectorDetail row={row as Record<string, unknown>} />
                      )
                  : undefined
              }
            />
          )}
        </Card>
      </div>
    );
  };
}

// Re-export col from columnMaps for backward compat
export { col } from "@/api/columnMaps";
