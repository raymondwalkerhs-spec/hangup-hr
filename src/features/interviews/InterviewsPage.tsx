import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { extractRows } from "@/api/extractRows";
import { interviewCols } from "@/api/columnMaps";
import { InterviewEditDialog } from "./InterviewEditDialog";
import type { StaffOption } from "./interviewStaffOptions";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Select";
import { DataGrid } from "@/ui/DataGrid";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";

const STATUS_OPTIONS = ["pending", "on hold", "accepted", "rejected"];
type Row = Record<string, unknown>;

export function InterviewsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [search, setSearch] = useState("");
  const [firstStatus, setFirstStatus] = useState("");
  const [secondStatus, setSecondStatus] = useState("");
  const [editRow, setEditRow] = useState<Row | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["interview-meta", companyContext],
    queryFn: () =>
      api<{
        canEditInterview?: boolean;
        canDeleteInterview?: boolean;
        role?: string;
        interviewerOptions?: StaffOption[];
        trainerOptions?: StaffOption[];
      }>(path("/interview/interviews/meta")),
  });

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["interviews-table", companyContext],
    queryFn: () =>
      api<{
        interviewerOptions?: StaffOption[];
        trainerOptions?: StaffOption[];
      }>(path("/interview/interviews")),
    refetchInterval: 5000,
  });

  const interviewerOptions = data?.interviewerOptions || meta?.interviewerOptions || [];
  const trainerOptions = data?.trainerOptions || meta?.trainerOptions || [];

  const rows = useMemo(() => {
    let list = extractRows<Row>(data);
    const q = search.toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.name, r.phone, r.email, r.candidateName].some((v) => String(v || "").toLowerCase().includes(q))
      );
    }
    if (firstStatus) list = list.filter((r) => String(r.firstInterviewStatus || "").toLowerCase() === firstStatus);
    if (secondStatus) list = list.filter((r) => String(r.secondInterviewStatus || "").toLowerCase() === secondStatus);
    return list;
  }, [data, search, firstStatus, secondStatus]);

  const canEdit = meta?.canEditInterview === true || ["admin", "ceo", "hr", "quality"].includes(meta?.role || "");
  const canDelete = meta?.canDeleteInterview === true || ["admin", "ceo", "hr"].includes(meta?.role || "");

  const saveEdit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api(path(`/interview/interviews/${id}`), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interviews-table"] });
      setEditRow(null);
    },
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) => api(path(`/interview/interviews/${id}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["interviews-table"] }),
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      ...interviewCols,
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }}>
            <Button size="sm" variant="secondary" onClick={() => openInspector(String(row.original.name || row.original.id), <InspectorDetail row={row.original} />)}>View</Button>
            {canEdit && (
              <Button size="sm" onClick={() => setEditRow(row.original)}>Edit</Button>
            )}
            {canDelete && (
              <Button size="sm" variant="danger" onClick={() => {
                if (confirm("Delete this interview record?")) deleteRow.mutate(String(row.original.id));
              }}>Delete</Button>
            )}
          </span>
        ),
      },
    ],
    [canEdit, canDelete, deleteRow, openInspector]
  );

  return (
    <div>
      <SectionHeader title="Interviews" subtitle={`${rows.length} candidates · synced ${new Date(dataUpdatedAt).toLocaleTimeString()}`} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input type="search" placeholder="Search candidates…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select
          value={firstStatus}
          onChange={setFirstStatus}
          options={[{ value: "", label: "All 1st status" }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          value={secondStatus}
          onChange={setSecondStatus}
          options={[{ value: "", label: "All 2nd status" }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: s }))]}
        />
      </div>
      <Card>
        {isLoading ? <p className="muted">Loading…</p> : <DataGrid data={rows} columns={columns} virtualize={rows.length > 50} />}
      </Card>

      <InterviewEditDialog
        row={editRow}
        open={!!editRow}
        onOpenChange={(o) => !o && setEditRow(null)}
        onSave={(body) => saveEdit.mutate({ id: String(editRow?.id), body })}
        saving={saveEdit.isPending}
        interviewerOptions={interviewerOptions}
        trainerOptions={trainerOptions}
      />
    </div>
  );
}
