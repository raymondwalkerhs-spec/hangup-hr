import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmt } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { PageToolbar, SearchField } from "@/ui/PageToolbar";
import { StatusPill } from "@/ui/StatusPill";

type Loan = Record<string, unknown>;

export function LoansPage() {
  const qc = useQueryClient();
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: "", totalAmount: "", installmentAmount: "", installmentsCount: "", skipCurrentMonth: false, notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["loans", companyContext],
    queryFn: () => api<{ loans?: Loan[] }>(path("/loans")),
  });

  const { data: emps } = useQuery({
    queryKey: ["employees-loans", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string }[] }>(path("/employees")),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.loans || []).filter((l) => !q || [l.employeeId, l.id, l.notes].join(" ").toLowerCase().includes(q));
  }, [data?.loans, search]);

  const create = useMutation({
    mutationFn: () =>
      api(path("/loans"), {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          totalAmount: Number(form.totalAmount),
          installmentAmount: form.installmentAmount ? Number(form.installmentAmount) : undefined,
          installmentsCount: form.installmentsCount ? Number(form.installmentsCount) : undefined,
          skipCurrentMonth: form.skipCurrentMonth,
          notes: form.notes,
          createdYearMonth: month,
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["loans"] }); setAddOpen(false); },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(path(`/loans/${encodeURIComponent(id)}/cancel`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loans"] }),
  });

  const recordPayments = useMutation({
    mutationFn: () => api(path("/payroll/record-loan-payments"), { method: "POST", body: JSON.stringify({ month }) }),
    onSuccess: (res) => alert(`Recorded ${(res as { count?: number }).count ?? 0} loan payment(s) for ${month}`),
  });

  return (
    <div>
      <SectionHeader
        title="Loans"
        subtitle={`${rows.length} loans`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { if (confirm(`Record loan payments for ${month}?`)) recordPayments.mutate(); }}>Record payments</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>+ Add loan</Button>
          </>
        }
      />
      <PageToolbar><SearchField value={search} onChange={setSearch} placeholder="Search employee or loan ID…" /></PageToolbar>
      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        <div className="table-wrap">
          <table style={{ width: "100%", fontSize: "0.85rem" }}>
            <thead><tr><th align="left">Employee</th><th align="right">Total</th><th align="right">Installment</th><th>Status</th><th align="right">Actions</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={String(l.id)}>
                  <td><code>{String(l.employeeId)}</code></td>
                  <td align="right">{fmt(l.totalAmount as number)}</td>
                  <td align="right">{fmt(l.installmentAmount as number)}</td>
                  <td><StatusPill variant={l.status === "active" ? "ok" : "muted"}>{String(l.status || "—")}</StatusPill></td>
                  <td align="right">
                    {l.status === "active" && (
                      <Button size="sm" variant="danger" onClick={() => { if (confirm("Cancel this loan?")) cancel.mutate(String(l.id)); }}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && !isLoading && <tr><td colSpan={5} className="muted">No loans</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add loan" wide footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={!form.employeeId || !form.totalAmount}>Create</Button></>}>
        <FormGrid wide>
          <FormField label="Employee">
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">—</option>
              {(emps?.employees || []).map((e) => <option key={e.id} value={e.id}>{e.id} — {e.american_name}</option>)}
            </select>
          </FormField>
          <FormField label="Total amount"><input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} /></FormField>
          <FormField label="Installment"><input type="number" value={form.installmentAmount} onChange={(e) => setForm({ ...form, installmentAmount: e.target.value })} /></FormField>
          <FormField label="# installments"><input type="number" value={form.installmentsCount} onChange={(e) => setForm({ ...form, installmentsCount: e.target.value })} /></FormField>
          <FormField label="Skip current month"><label><input type="checkbox" checked={form.skipCurrentMonth} onChange={(e) => setForm({ ...form, skipCurrentMonth: e.target.checked })} /> Yes</label></FormField>
          <FormField label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
        </FormGrid>
      </Dialog>
    </div>
  );
}
