import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAuth } from "@/app/AuthProvider";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { useInspectorStore } from "@/stores/cross-filter-store";

type Row = Record<string, unknown>;

type DeductionForm = {
  employeeId: string;
  type: string;
  amount: string;
  date: string;
  reason: string;
};

function emptyForm(month: string): DeductionForm {
  return { employeeId: "", type: "", amount: "", date: `${month}-01`, reason: "" };
}

function canManageDeductions(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  if (user.canManageEmployees === true) return true;
  return ["admin", "ceo", "hr"].includes(String(user.role || "").toLowerCase());
}

function rowToForm(row: Row): DeductionForm {
  return {
    employeeId: String(row.employeeId || ""),
    type: String(row.type || ""),
    amount: row.amount != null ? String(row.amount) : "",
    date: String(row.date || "").slice(0, 10),
    reason: String(row.reason || ""),
  };
}

export function DeductionsPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const { user } = useAuth();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [form, setForm] = useState<DeductionForm>(() => emptyForm(month));
  const canManage = canManageDeductions(user);

  const { data, isLoading, error } = useQuery({
    queryKey: ["deductions", month, companyContext],
    queryFn: () => api<{ deductions: Row[]; types: string[] }>(path("/deductions", { month })),
  });

  const { data: emps } = useQuery({
    queryKey: ["employees-deduction", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["deductions", month] });
    qc.invalidateQueries({ queryKey: ["payslip-bundle"] });
    qc.invalidateQueries({ queryKey: ["payroll-full"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeId: form.employeeId,
        type: form.type || "Other Deductions",
        amount: Number(form.amount),
        date: form.date || `${month}-01`,
        reason: form.reason,
        ...(companyContext === "hs2" ? { company: "hs2" } : {}),
      };
      if (editing) {
        return api(path("/deductions"), {
          method: "PATCH",
          body: JSON.stringify({
            originalEmployeeId: String(editing.employeeId || ""),
            originalDate: String(editing.date || "").slice(0, 10),
            originalType: String(editing.type || ""),
            ...body,
          }),
        });
      }
      return api(path("/deductions"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm(month));
    },
  });

  const remove = useMutation({
    mutationFn: (row: Row) =>
      api(path("/deductions"), {
        method: "DELETE",
        body: JSON.stringify({
          employeeId: String(row.employeeId || ""),
          date: String(row.date || "").slice(0, 10),
          type: String(row.type || ""),
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate();
      setDeleteRow(null);
    },
  });

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(month));
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm(rowToForm(row));
    setDialogOpen(true);
  };

  const rows = data?.deductions || [];
  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        accessorKey: "date",
        header: "Date",
        cell: (c) => String(c.getValue() || "").slice(0, 10) || "—",
      },
      {
        accessorKey: "employeeId",
        header: "ID",
        cell: (c) => String(c.getValue() || "—"),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: (c) => String(c.getValue() || "—"),
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: (c) => fmt(c.getValue() as number),
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: (c) => String(c.getValue() || "—"),
      },
    ];
    if (canManage) {
      cols.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span style={{ display: "flex", gap: "0.25rem" }} onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openEdit(row.original)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setDeleteRow(row.original)}
            >
              Delete
            </Button>
          </span>
        ),
      });
    }
    return cols;
  }, [canManage, month]);

  return (
    <div>
      <SectionHeader
        title="Deductions"
        subtitle={monthLabel(month)}
        actions={canManage ? <Button onClick={openAdd}>Add deduction</Button> : undefined}
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
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        title={editing ? "Edit deduction" : "Add deduction"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.employeeId || !form.amount}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
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
                ...(emps?.employees || []).map((e) => ({
                  value: e.id,
                  label: `${e.id} — ${e.american_name || ""}`,
                })),
              ]}
            />
          </FormField>
          <FormField label="Type">
            <Select
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={[
                { value: "", label: "—" },
                ...(data?.types || []).map((t) => ({ value: t, label: t })),
              ]}
            />
          </FormField>
          <FormField label="Amount">
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </FormField>
          <FormField label="Reason" span="full">
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </FormField>
        </FormGrid>
        {save.isError && <p style={{ color: "var(--err)" }}>{(save.error as Error).message}</p>}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteRow)}
        onOpenChange={(o) => !o && setDeleteRow(null)}
        title="Delete deduction?"
        message={
          deleteRow
            ? `Remove ${String(deleteRow.type || "deduction")} (${fmt(Number(deleteRow.amount) || 0)} EGP) for ${String(deleteRow.employeeId)} on ${String(deleteRow.date || "").slice(0, 10)}?`
            : ""
        }
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        onConfirm={() => {
          if (deleteRow && !remove.isPending) remove.mutate(deleteRow);
        }}
      />
    </div>
  );
}
