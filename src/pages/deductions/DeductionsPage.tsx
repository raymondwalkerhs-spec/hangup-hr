import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { deductionCols } from "@/api/columnMaps";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";

type Row = Record<string, unknown>;

export function DeductionsPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: "", type: "", amount: "", date: "", reason: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["deductions", month, companyContext],
    queryFn: () => api<{ deductions: Row[]; types: string[] }>(path("/deductions", { month })),
  });

  const { data: emps } = useQuery({
    queryKey: ["employees-deduction", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
  });

  const add = useMutation({
    mutationFn: () =>
      api(path("/deductions"), {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          type: form.type || "Other Deductions",
          amount: Number(form.amount),
          date: form.date || `${month}-01`,
          reason: form.reason,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deductions", month] });
      setAddOpen(false);
      setForm({ employeeId: "", type: "", amount: "", date: "", reason: "" });
    },
  });

  const rows = data?.deductions || [];
  const columns = useMemo<ColumnDef<Row>[]>(() => deductionCols, []);

  return (
    <div>
      <SectionHeader
        title="Deductions"
        subtitle={monthLabel(month)}
        actions={<Button onClick={() => setAddOpen(true)}>Add deduction</Button>}
      />
      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <DataGrid
            data={rows}
            columns={columns}
            onRowClick={(row) => openInspector(`Deduction — ${row.employeeId}`, <InspectorDetail row={row} />)}
          />
        )}
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add deduction"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !form.employeeId || !form.amount}>Save</Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Employee">
            <Select
              value={form.employeeId}
              onChange={(employeeId) => setForm({ ...form, employeeId })}
              options={[
                { value: "", label: "—" },
                ...(emps?.employees || []).map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || ""}` })),
              ]}
            />
          </FormField>
          <FormField label="Type">
            <Select
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={[{ value: "", label: "—" }, ...(data?.types || []).map((t) => ({ value: t, label: t }))]}
            />
          </FormField>
          <FormField label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></FormField>
          <FormField label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField>
          <FormField label="Reason" span="full"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>
        </FormGrid>
        {add.isError && <p style={{ color: "var(--err)" }}>{(add.error as Error).message}</p>}
      </Dialog>
    </div>
  );
}
