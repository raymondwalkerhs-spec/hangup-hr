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
import { Select } from "@/ui/Select";
import { PageToolbar, SearchField } from "@/ui/PageToolbar";
import { StatusPill } from "@/ui/StatusPill";

type ScheduleLine = {
  id?: string;
  seq?: number;
  yearMonth?: string;
  dueAmount?: number;
  status?: string;
  skipReason?: string;
  locked?: boolean;
};

type Loan = Record<string, unknown> & {
  id?: string;
  employeeId?: string;
  totalAmount?: number;
  installmentAmount?: number;
  remainingBalance?: number;
  paidTotal?: number;
  estimatedInstallmentsLeft?: number;
  startYearMonth?: string;
  paymentOverrides?: { yearMonth: string; amount: number; note?: string }[];
  scheduleLines?: ScheduleLine[];
  status?: string;
  notes?: string;
};

export function LoansPage() {
  const qc = useQueryClient();
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [adjustLoan, setAdjustLoan] = useState<Loan | null>(null);
  const [adjustForm, setAdjustForm] = useState({ yearMonth: month, amount: "", note: "" });
  const [scheduleLoan, setScheduleLoan] = useState<Loan | null>(null);
  const [startMonth, setStartMonth] = useState("");
  const [skipForm, setSkipForm] = useState({ yearMonth: month, reason: "" });
  const [form, setForm] = useState({
    employeeId: "",
    totalAmount: "",
    installmentAmount: "",
    installmentsCount: "",
    skipCurrentMonth: false,
    notes: "",
  });

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
    return (data?.loans || []).filter(
      (l) => !q || [l.employeeId, l.id, l.notes].join(" ").toLowerCase().includes(q)
    );
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      setAddOpen(false);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api(path(`/loans/${encodeURIComponent(id)}/cancel`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loans"] }),
  });

  const recordPayments = useMutation({
    mutationFn: () =>
      api(path("/payroll/record-loan-payments"), { method: "POST", body: JSON.stringify({ month }) }),
    onSuccess: (res) =>
      alert(`Recorded ${(res as { count?: number }).count ?? 0} loan payment(s) for ${month}`),
  });

  const saveAdjust = useMutation({
    mutationFn: () =>
      api(path(`/loans/${encodeURIComponent(String(adjustLoan?.id))}/payment-override`), {
        method: "PUT",
        body: JSON.stringify({
          yearMonth: adjustForm.yearMonth,
          amount: Number(adjustForm.amount),
          note: adjustForm.note,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      setAdjustLoan(null);
    },
    onError: (err: Error) => alert(err.message || "Failed to save adjustment"),
  });

  const clearOverride = useMutation({
    mutationFn: ({ id, yearMonth }: { id: string; yearMonth: string }) =>
      api(path(`/loans/${encodeURIComponent(id)}/payment-override/${encodeURIComponent(yearMonth)}`), {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loans"] }),
  });

  const skipMonth = useMutation({
    mutationFn: () =>
      api(path(`/loans/${encodeURIComponent(String(scheduleLoan?.id))}/schedule/skip`), {
        method: "POST",
        body: JSON.stringify({ yearMonth: skipForm.yearMonth, reason: skipForm.reason }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      const loan = (res as { loan?: Loan }).loan;
      if (loan) setScheduleLoan(loan);
      setSkipForm({ yearMonth: month, reason: "" });
    },
    onError: (err: Error) => alert(err.message || "Failed to skip month"),
  });

  const setStart = useMutation({
    mutationFn: () =>
      api(path(`/loans/${encodeURIComponent(String(scheduleLoan?.id))}/schedule/start-month`), {
        method: "PUT",
        body: JSON.stringify({ startYearMonth: startMonth }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      const loan = (res as { loan?: Loan }).loan;
      if (loan) {
        setScheduleLoan(loan);
        setStartMonth(String(loan.startYearMonth || startMonth));
      }
    },
    onError: (err: Error) => alert(err.message || "Failed to set start month"),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      api(path(`/loans/${encodeURIComponent(String(scheduleLoan?.id))}/schedule/regenerate`), {
        method: "POST",
        body: JSON.stringify({ startYearMonth: startMonth || scheduleLoan?.startYearMonth }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["loans"] });
      const loan = (res as { loan?: Loan }).loan;
      if (loan) setScheduleLoan(loan);
    },
    onError: (err: Error) => alert(err.message || "Failed to regenerate schedule"),
  });

  function openAdjust(loan: Loan) {
    const defaultAmt = Number(loan.installmentAmount) || 0;
    setAdjustLoan(loan);
    setAdjustForm({
      yearMonth: month,
      amount: String(defaultAmt),
      note: "",
    });
  }

  function openSchedule(loan: Loan) {
    setScheduleLoan(loan);
    setStartMonth(String(loan.startYearMonth || month));
    setSkipForm({ yearMonth: month, reason: "" });
  }

  const scheduleLines = scheduleLoan?.scheduleLines || [];

  return (
    <div>
      <SectionHeader
        title="Loans"
        subtitle={`${rows.length} loans — remaining balance tracks actual payments; schedule supports skip/defer; adjust a month for extra or reduced salary deduction`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (confirm(`Record loan payments for ${month}?`)) recordPayments.mutate();
              }}
            >
              Record payments
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add loan
            </Button>
          </>
        }
      />
      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search employee or loan ID…" />
      </PageToolbar>
      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        <div className="table-wrap">
          <table style={{ width: "100%", fontSize: "0.85rem" }}>
            <thead>
              <tr>
                <th align="left">Employee</th>
                <th align="right">Total</th>
                <th align="right">Installment</th>
                <th align="right">Remaining</th>
                <th>Start</th>
                <th>Status</th>
                <th align="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={String(l.id)}>
                  <td>
                    <code>{String(l.employeeId)}</code>
                    {(l.paymentOverrides?.length || 0) > 0 && (
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        Adjusted:{" "}
                        {l.paymentOverrides!.map((o) => `${o.yearMonth}=${fmt(o.amount)}`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td align="right">{fmt(l.totalAmount as number)}</td>
                  <td align="right">{fmt(l.installmentAmount as number)}</td>
                  <td align="right">{fmt((l.remainingBalance as number) ?? 0)}</td>
                  <td>{String(l.startYearMonth || "—")}</td>
                  <td>
                    <StatusPill variant={l.status === "active" ? "ok" : "muted"}>
                      {String(l.status || "—")}
                    </StatusPill>
                  </td>
                  <td align="right" style={{ whiteSpace: "nowrap" }}>
                    {l.status === "active" && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => openSchedule(l)}>
                          Schedule
                        </Button>{" "}
                        <Button size="sm" variant="secondary" onClick={() => openAdjust(l)}>
                          Adjust payment
                        </Button>{" "}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            if (confirm("Cancel this loan?")) cancel.mutate(String(l.id));
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && !isLoading && (
                <tr>
                  <td colSpan={7} className="muted">
                    No loans
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add loan"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!form.employeeId || !form.totalAmount}
            >
              Create
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
                  label: `${e.id} — ${e.american_name}`,
                })),
              ]}
            />
          </FormField>
          <FormField label="Total amount">
            <input
              type="number"
              value={form.totalAmount}
              onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
            />
          </FormField>
          <FormField label="Installment">
            <input
              type="number"
              value={form.installmentAmount}
              onChange={(e) => setForm({ ...form, installmentAmount: e.target.value })}
            />
          </FormField>
          <FormField label="# installments">
            <input
              type="number"
              value={form.installmentsCount}
              onChange={(e) => setForm({ ...form, installmentsCount: e.target.value })}
            />
          </FormField>
          <FormField label="Skip current month">
            <label>
              <input
                type="checkbox"
                checked={form.skipCurrentMonth}
                onChange={(e) => setForm({ ...form, skipCurrentMonth: e.target.checked })}
              />{" "}
              Yes
            </label>
          </FormField>
          <FormField label="Notes">
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FormField>
        </FormGrid>
      </Dialog>

      <Dialog
        open={!!adjustLoan}
        onOpenChange={(open) => {
          if (!open) setAdjustLoan(null);
        }}
        title="Adjust loan payment for a salary month"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustLoan(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveAdjust.mutate()}
              disabled={!adjustForm.yearMonth || !adjustForm.amount || saveAdjust.isPending}
            >
              Save for payroll
            </Button>
          </>
        }
      >
        {adjustLoan && (
          <FormGrid wide>
            <p className="muted" style={{ gridColumn: "1 / -1" }}>
              Employee <code>{String(adjustLoan.employeeId)}</code> — default installment{" "}
              {fmt(adjustLoan.installmentAmount as number)}, remaining{" "}
              {fmt(adjustLoan.remainingBalance as number)}. Enter a higher amount for an extra
              payment, or lower to reduce that month&apos;s salary deduction. Remaining balance
              stays tracked for later months.
            </p>
            <FormField label="Deduct from salary month (YYYY-MM)">
              <input
                type="month"
                value={adjustForm.yearMonth}
                onChange={(e) => setAdjustForm({ ...adjustForm, yearMonth: e.target.value })}
              />
            </FormField>
            <FormField label="Amount for that month">
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={adjustForm.amount}
                onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
              />
            </FormField>
            <FormField label="Note">
              <input
                value={adjustForm.note}
                onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                placeholder="e.g. Extra payment / reduced this month"
              />
            </FormField>
            {(adjustLoan.paymentOverrides?.length || 0) > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <p className="muted">Existing adjustments</p>
                <ul>
                  {adjustLoan.paymentOverrides!.map((o) => (
                    <li key={o.yearMonth}>
                      {o.yearMonth}: {fmt(o.amount)}
                      {o.note ? ` — ${o.note}` : ""}{" "}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Clear override for ${o.yearMonth}?`)) {
                            clearOverride.mutate({ id: String(adjustLoan.id), yearMonth: o.yearMonth });
                          }
                        }}
                      >
                        Clear
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </FormGrid>
        )}
      </Dialog>

      <Dialog
        open={!!scheduleLoan}
        onOpenChange={(open) => {
          if (!open) setScheduleLoan(null);
        }}
        title="Loan repayment schedule"
        wide
        footer={
          <Button variant="secondary" onClick={() => setScheduleLoan(null)}>
            Close
          </Button>
        }
      >
        {scheduleLoan && (
          <div>
            <p className="muted">
              Employee <code>{String(scheduleLoan.employeeId)}</code> — remaining{" "}
              {fmt(scheduleLoan.remainingBalance as number)}. Skip defers an installment to the
              next free month. Start month regenerates unlocked future lines.
            </p>
            <FormGrid wide>
              <FormField label="Start month">
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                />
              </FormField>
              <FormField label=" ">
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setStart.mutate()}
                    disabled={!startMonth || setStart.isPending}
                  >
                    Set start month
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (confirm("Regenerate unlocked schedule lines from remaining balance?")) {
                        regenerate.mutate();
                      }
                    }}
                    disabled={regenerate.isPending}
                  >
                    Regenerate
                  </Button>
                </div>
              </FormField>
              <FormField label="Skip month">
                <input
                  type="month"
                  value={skipForm.yearMonth}
                  onChange={(e) => setSkipForm({ ...skipForm, yearMonth: e.target.value })}
                />
              </FormField>
              <FormField label="Skip reason">
                <input
                  value={skipForm.reason}
                  onChange={(e) => setSkipForm({ ...skipForm, reason: e.target.value })}
                  placeholder="Optional"
                />
              </FormField>
              <FormField label=" ">
                <Button
                  size="sm"
                  onClick={() => {
                    if (confirm(`Skip ${skipForm.yearMonth} and defer installment?`)) {
                      skipMonth.mutate();
                    }
                  }}
                  disabled={!skipForm.yearMonth || skipMonth.isPending}
                >
                  Skip & defer
                </Button>
              </FormField>
            </FormGrid>

            <div className="table-wrap" style={{ marginTop: "1rem" }}>
              <table style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th align="left">#</th>
                    <th align="left">Month</th>
                    <th align="right">Due</th>
                    <th>Status</th>
                    <th align="left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleLines.map((line) => (
                    <tr key={String(line.id)}>
                      <td>{line.seq}</td>
                      <td>{line.yearMonth}</td>
                      <td align="right">{fmt(line.dueAmount as number)}</td>
                      <td>
                        <StatusPill
                          variant={
                            line.status === "paid"
                              ? "ok"
                              : line.status === "skipped"
                                ? "warn"
                                : "muted"
                          }
                        >
                          {String(line.status || "—")}
                        </StatusPill>
                      </td>
                      <td className="muted">{line.skipReason || ""}</td>
                    </tr>
                  ))}
                  {!scheduleLines.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No schedule lines yet — use Regenerate or wait for backfill.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
