import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import styles from "./SalariesPage.module.css";

type Rate = { position: string; monthlySalary: number; company?: string };

type RatesResponse = {
  rates: Rate[];
  month: string;
  initialized?: boolean;
  initializedFrom?: string | null;
};

export function SalariesPage() {
  const month = useAppStore((s) => s.month);
  const companyContext = useAppStore((s) => s.companyContext);
  const { path } = useCompanyScope();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newPos, setNewPos] = useState({ position: "", monthlySalary: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["position-rates", month, companyContext],
    queryFn: () => api<RatesResponse>(path("/position-rates", { month })),
  });

  const { data: raises } = useQuery({
    queryKey: ["payroll-adjustments-raises", month, companyContext],
    queryFn: () => api<{ adjustments: { employeeId: string; salaryRaise?: number }[] }>(path("/payroll-adjustments", { month })),
  });

  const saveRate = useMutation({
    mutationFn: (body: { position: string; monthlySalary: number; yearMonth: string }) =>
      api(path("/position-rates"), {
        method: "PUT",
        body: JSON.stringify({
          ...body,
          company: companyContext !== "hangup" ? companyContext : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["position-rates", month] });
      setEdits({});
    },
  });

  const copyFromPrevious = useMutation({
    mutationFn: () =>
      api(path("/position-rates/copy-from-previous"), {
        method: "POST",
        body: JSON.stringify({
          month,
          company: companyContext !== "hangup" ? companyContext : undefined,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["position-rates", month] }),
  });

  const deleteRate = useMutation({
    mutationFn: (position: string) =>
      api(path(`/position-rates/${encodeURIComponent(position)}`, { month }), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["position-rates", month] }),
  });

  const rates = data?.rates || [];
  const raiseRows = (raises?.adjustments || []).filter((a) => Number(a.salaryRaise) > 0);

  const getEdit = (pos: string, fallback: number) => edits[pos] ?? String(fallback);

  const initNote =
    data?.initialized && data.initializedFrom
      ? `Initialized ${rates.length} position rate(s) from ${data.initializedFrom === "global" ? "default catalog" : monthLabel(data.initializedFrom)}.`
      : null;

  return (
    <div>
      <SectionHeader
        title="Salaries"
        subtitle={`Position rates for ${monthLabel(month)} — changes apply to this month only`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (confirm(`Copy all position rates from the previous month into ${monthLabel(month)}?`)) {
                  copyFromPrevious.mutate();
                }
              }}
              disabled={copyFromPrevious.isPending}
            >
              Copy from previous month
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add position</Button>
          </>
        }
      />

      {initNote && <p className={styles.note}>{initNote}</p>}

      <Card>
        <h3 style={{ marginTop: 0 }}>Position rates</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Payroll uses the salary for each position in the selected month. Earlier months keep their own rates.
        </p>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Position</th><th>Monthly salary (EGP)</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.position}>
                  <td><strong>{r.position}</strong></td>
                  <td>
                    <input
                      type="number"
                      className={styles.input}
                      value={getEdit(r.position, r.monthlySalary)}
                      onChange={(e) => setEdits({ ...edits, [r.position]: e.target.value })}
                    />
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="sm"
                      onClick={() =>
                        saveRate.mutate({
                          position: r.position,
                          monthlySalary: Number(getEdit(r.position, r.monthlySalary)),
                          yearMonth: month,
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => {
                      if (confirm(`Delete rate for ${r.position} in ${monthLabel(month)}?`)) deleteRate.mutate(r.position);
                    }}>Delete</Button>
                  </td>
                </tr>
              ))}
              {!rates.length && !isLoading && <tr><td colSpan={3} className="muted">No position rates for this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Monthly raises (from payslip profiles)</h3>
        <p className="muted" style={{ marginTop: 0 }}>Per-employee raises on top of the position rate for this month.</p>
        <table className={styles.table}>
          <thead><tr><th>Employee ID</th><th>Raise (EGP)</th></tr></thead>
          <tbody>
            {raiseRows.map((r) => (
              <tr key={r.employeeId}><td>{r.employeeId}</td><td>{fmt(r.salaryRaise)}</td></tr>
            ))}
            {!raiseRows.length && <tr><td colSpan={2} className="muted">No raises this month.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add position rate"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                saveRate.mutate({
                  position: newPos.position,
                  monthlySalary: Number(newPos.monthlySalary),
                  yearMonth: month,
                });
                setAddOpen(false);
                setNewPos({ position: "", monthlySalary: "" });
              }}
              disabled={!newPos.position || !newPos.monthlySalary}
            >
              Add
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label="Position">
            <input value={newPos.position} onChange={(e) => setNewPos({ ...newPos, position: e.target.value })} />
          </FormField>
          <FormField label="Monthly salary">
            <input type="number" value={newPos.monthlySalary} onChange={(e) => setNewPos({ ...newPos, monthlySalary: e.target.value })} />
          </FormField>
        </FormGrid>
      </Dialog>
    </div>
  );
}
