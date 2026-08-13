import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { extractRows } from "@/api/extractRows";
import { trainingCols } from "@/api/columnMaps";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog } from "@/ui/Dialog";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";

const TRAINING_OPTIONS = ["waiting", "on hold", "started", "dropped", "postponed", "cancelled"];
type Row = Record<string, unknown>;

export function TrainingPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["training", companyContext],
    queryFn: () => api(path("/interview/interviews/training")),
    refetchInterval: 5000,
  });

  const rows = useMemo(() => {
    let list = extractRows<Row>(data);
    const q = search.toLowerCase();
    if (q) list = list.filter((r) => [r.name, r.trainer].some((v) => String(v || "").toLowerCase().includes(q)));
    if (statusFilter) list = list.filter((r) => String(r.trainingStatus || "").toLowerCase() === statusFilter);
    return list;
  }, [data, search, statusFilter]);

  const saveEdit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api(path(`/interview/interviews/${id}`), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training"] });
      setEditRow(null);
    },
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      ...trainingCols,
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }}>
            <Button size="sm" variant="secondary" onClick={() => openInspector(String(row.original.name), <InspectorDetail row={row.original} />)}>View</Button>
            <Button size="sm" onClick={() => {
              setEditRow(row.original);
              setEditForm({
                trainingStatus: String(row.original.trainingStatus || ""),
                trainer: String(row.original.trainer || ""),
                trainingStartDate: String(row.original.trainingStartDate || "").slice(0, 10),
              });
            }}>Edit</Button>
          </span>
        ),
      },
    ],
    [openInspector]
  );

  return (
    <div>
      <SectionHeader title="Training" subtitle={`${rows.length} trainees · synced ${new Date(dataUpdatedAt).toLocaleTimeString()}`} />
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {TRAINING_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Card>
        {isLoading ? <p className="muted">Loading…</p> : <DataGrid data={rows} columns={columns} virtualize={rows.length > 50} />}
      </Card>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)} title="Edit training" footer={
        <>
          <Button variant="secondary" onClick={() => setEditRow(null)}>Cancel</Button>
          <Button onClick={() => saveEdit.mutate({ id: String(editRow?.id), body: editForm })}>Save</Button>
        </>
      }>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            <span className="muted">Status</span>
            <select value={editForm.trainingStatus} onChange={(e) => setEditForm({ ...editForm, trainingStatus: e.target.value })} style={{ width: "100%" }}>
              {TRAINING_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            <span className="muted">Trainer</span>
            <input value={editForm.trainer} onChange={(e) => setEditForm({ ...editForm, trainer: e.target.value })} style={{ width: "100%" }} />
          </label>
          <label>
            <span className="muted">Start date</span>
            <input type="date" value={editForm.trainingStartDate} onChange={(e) => setEditForm({ ...editForm, trainingStartDate: e.target.value })} style={{ width: "100%" }} />
          </label>
        </div>
      </Dialog>
    </div>
  );
}
