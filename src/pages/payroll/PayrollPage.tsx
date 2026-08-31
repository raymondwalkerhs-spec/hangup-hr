import { useEffect, useMemo, useState } from "react";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";

import type { ColumnDef } from "@tanstack/react-table";

import { api, fmt, monthLabel, getSessionId } from "@/api/client";

import { useAppStore } from "@/stores/theme-store";

import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";

import { filterPayrollRows } from "@/lib/employeeSearch";
import { isPayrollSettled, payrollEarnedNet, settledLabel, isTrainingDeferredRow, trainingDeferredLabel } from "@/lib/payrollSettled";

import { PAYMENT_METHOD_FILTER_OPTIONS, paymentMethodLabel } from "@/lib/paymentMethods";

import { payrollRowMetrics, sumPayrollRowMetrics } from "@/lib/payrollRowMetrics";

import { PayslipDialog } from "@/features/payroll/PayslipDialog";

import { CommissionTiersCard } from "@/features/payroll/CommissionTiersCard";

import { SectionHeader } from "@/ui/SectionHeader";

import { Card, StatTile } from "@/ui/Card";

import { Button } from "@/ui/Button";

import { DataGrid } from "@/ui/DataGrid";

import gridStyles from "@/ui/DataGrid.module.css";

import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";

import { downloadApiFile } from "@/lib/files";

import { buildApiQuery, scopedPath } from "@/lib/apiQuery";

import styles from "./PayrollPage.module.css";
import { LIVE_REFETCH_MS } from "@/lib/liveRefresh";

type Row = Record<string, unknown>;

type PayrollData = {
  payroll?: Row[];
  views?: {
    agent?: { rows?: Row[]; totals?: Record<string, number> };
    training?: { rows?: Row[]; totals?: Record<string, number> };
    totalPaid?: { rows?: Row[]; totals?: Record<string, number> };
  };
  totals?: Record<string, number>;
  units?: string[];
  teams?: string[];
  payrollStatuses?: string[];
  paymentMethodFilters?: { value: string; label: string }[];
  workingDays?: number;
  monthLock?: { locked?: boolean };
  trainingEnrichWarnings?: string[];
};

function payrollKindLabel(kind: unknown) {
  if (kind === "dual") return "Training + Agent";
  if (kind === "training") return "Training";
  if (kind === "training_deferred_month") return "Deferred";
  return "";
}

function moneyCell(value: number, negative = false) {
  if (!value) return "—";
  return negative ? `-${fmt(value)}` : fmt(value);
}

export function PayrollPage() {

  const month = useAppStore((s) => s.month);

  const qc = useQueryClient();

  const { path, companyContext } = useCompanyScope();

  const [payslipEmp, setPayslipEmp] = useState<{ id: string; name: string } | null>(null);

  const [search, setSearch] = useState("");

  const [position, setPosition] = useState("");

  const [team, setTeam] = useState("");

  const [unit, setUnit] = useState("");

  const [status, setStatus] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("");

  const [hideZeroNet, setHideZeroNet] = useState(false);

  const { status: appStatus } = useAppStatus();

  const [hideOut, setHideOut] = useState(true);
  const [hideAllOut, setHideAllOut] = useState(false);
  const showLegacyEmployees = appStatus?.showLegacyEmployees === true;



  useEffect(() => {

    if (appStatus?.hideOutEmployees !== undefined) setHideOut(appStatus.hideOutEmployees !== false);

  }, [appStatus?.hideOutEmployees]);

  const role = String((appStatus?.user as { role?: string })?.role || "").toLowerCase();
  const canHideAllOut = ["tl", "hr", "rtm", "quality", "admin", "op", "ceo"].includes(role);



  const { data, isLoading, isFetching, error } = useQuery({

    queryKey: ["payroll-full", month, companyContext, hideOut, hideAllOut],

    queryFn: () =>
      api<PayrollData>(
        path("/payroll", {
          month,
          ...(hideAllOut
            ? { hideAllOut: "true", showOut: "true" }
            : hideOut
              ? { hideOut: "true" }
              : { showOut: "true" }),
        })
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,

  });



  const canManage = (appStatus?.user as { canManageEmployees?: boolean; role?: string })?.canManageEmployees === true || ["admin", "ceo", "hr"].includes(String((appStatus?.user as { role?: string })?.role || ""));



  const initMonth = useMutation({

    mutationFn: () => api(path("/payroll-adjustments/init-month"), { method: "POST", body: JSON.stringify({ month }) }),

    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-full"] }),

  });



  const recordLoans = useMutation({

    mutationFn: () => api(path("/payroll/record-loan-payments"), { method: "POST", body: JSON.stringify({ month }) }),

    onSuccess: (res) => alert(`Recorded ${(res as { count?: number }).count ?? 0} loan payment(s)`),

  });



  const toggleLock = useMutation({

    mutationFn: (locked: boolean) => api(path(`/hrms/payroll-lock/${encodeURIComponent(month)}`), { method: "PUT", body: JSON.stringify({ locked }) }),

    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-full"] }),

  });



  async function bulkExportPayslips() {

    const hrDesktop = (window as { hrDesktop?: { pickFolder?: () => Promise<string>; writeFileBuffer?: (p: string, b: ArrayBuffer) => Promise<void> } }).hrDesktop;

    if (!hrDesktop?.pickFolder) {

      alert("Bulk payslip export requires the Hangup Portal desktop app.");

      return;

    }

    const folder = await hrDesktop.pickFolder();

    if (!folder) return;

    const subfolder = `${folder}\\payroll-${month}`;

    const sessionId = getSessionId();

    let ok = 0;

    for (const row of rows) {

      const empId = String(row.employeeId || row.id);

      const res = await fetch(`/api/payslip/${encodeURIComponent(empId)}/pdf?month=${encodeURIComponent(month)}`, {

        headers: sessionId ? { "x-session-id": sessionId } : {},

      });

      if (!res.ok) continue;

      const buf = await res.arrayBuffer();

      const safeName = String(row.name || empId).replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-");

      await hrDesktop.writeFileBuffer?.(`${subfolder}\\payslip-${empId}-${safeName}.pdf`, buf);

      ok++;

    }

    alert(`Exported ${ok} payslip PDF(s) to:\n${subfolder}`);

  }



  // Unified payroll list (agents + trainees + dual) — same source as Export PDF/XLS.
  const agentSourceRows = useMemo(() => {
    if (data?.payroll?.length) return data.payroll as Row[];
    if (data?.views?.agent?.rows) return data.views.agent.rows as Row[];
    return [] as Row[];
  }, [data?.payroll, data?.views?.agent?.rows]);

  const rows = useMemo(
    () =>
      filterPayrollRows(agentSourceRows, {
        search,
        position,
        team,
        unit,
        status,
        paymentMethod,
        month,
        hideOut,
        hideZeroNet,
        showLegacyEmployees,
      }),
    [agentSourceRows, search, position, team, unit, status, paymentMethod, month, hideOut, hideZeroNet, showLegacyEmployees]
  );

  const totals = useMemo(() => sumPayrollRowMetrics(rows), [rows]);

  const filtersActive = Boolean(
    search || position || team || unit || status || paymentMethod || hideZeroNet
  );

  function payrollExportQuery() {
    const params: Record<string, string | boolean | undefined> = {
      month,
      scope: "agent",
      ...(hideOut ? { hideOut: true } : { showOut: true }),
    };
    if (filtersActive) {
      const ids = rows
        .map((r) => String(r.employeeId || ""))
        .filter(Boolean);
      params.employeeIds = ids.length ? ids.join(",") : "__none__";
    }
    return buildApiQuery(params, companyContext);
  }



  const positions = useMemo(
    () =>
      [...new Set((data?.payroll || []).map((r) => String(r.position || (r.adj as Row)?.position || "")).filter(Boolean))].sort(),
    [data?.payroll]
  );



  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Employee",
        cell: (c) => {
          const r = c.row.original;
          const name = String(c.getValue() || r.employeeName || r.employeeId || "—");
          const flags: string[] = [];
          const kind = payrollKindLabel(r.payrollKind);
          if (kind) flags.push(kind);
          if (r.trainingPayrollPaid) flags.push("training paid");
          if (r.monthlySalaryOverrideActive) flags.push("sal");
          if (r.netSalaryOverrideActive) flags.push("net");
          return (
            <span>
              {name}
              {flags.length > 0 && (
                <span className="muted" style={{ display: "block", fontSize: "0.7rem" }} title="Payroll type / overrides">
                  {flags.join(" · ")}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "paymentMethod",
        header: "Payment",
        cell: (c) => {
          const label = paymentMethodLabel(c.row.original.paymentMethod || c.row.original.payment_method);
          return label === "—" ? <span className="muted">—</span> : label;
        },
      },
      {
        id: "workingDays",
        header: "Working days",
        cell: (c) => String(payrollRowMetrics(c.row.original).workingDays || "—"),
        meta: { className: gridStyles.num },
      },
      {
        id: "salesCount",
        header: "Sales",
        cell: (c) => String(payrollRowMetrics(c.row.original).salesCount || "—"),
        meta: { className: gridStyles.num },
      },
      {
        id: "commission",
        header: "Commission",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).commission),
        meta: { className: gridStyles.num },
      },
      {
        id: "basicSalary",
        header: "Basic salary",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).basicSalary),
        meta: { className: gridStyles.num },
      },
      {
        id: "loan",
        header: "Loans",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).loan, true),
        meta: { className: gridStyles.num },
      },
      {
        id: "transport",
        header: "Transportation",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).transport),
        meta: { className: gridStyles.num },
      },
      {
        id: "bonus",
        header: "Bonus",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).otherBonuses),
        meta: { className: gridStyles.num },
      },
      {
        id: "deductions",
        header: "Deductions",
        cell: (c) => moneyCell(payrollRowMetrics(c.row.original).deductions, true),
        meta: { className: gridStyles.num },
      },
      {
        id: "netSalary",
        header: "Net salary",
        cell: (c) => {
          const r = c.row.original;
          const m = payrollRowMetrics(r);
          const settled = isPayrollSettled(r);
          const deferred = isTrainingDeferredRow(r);
          const earned = settled || deferred ? payrollEarnedNet(r) : 0;
          const balance = r.hasSplits ? Number(r.remainingBalance ?? r.netSalary) : null;
          const displayNet = m.netSalary;
          return (
            <span>
              <strong>{deferred && earned > 0 ? "—" : fmt(displayNet)}</strong>
              {deferred && earned > 0 && (
                <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                  accrual {fmt(earned)} — {trainingDeferredLabel(r)}
                </span>
              )}
              {settled && earned > 0 && (
                <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                  {fmt(earned)} — {settledLabel(r) || "Done"}
                </span>
              )}
              {r.payrollKind === "dual" && (
                <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>open payslip for split</span>
              )}
              {balance != null && balance !== m.netSalary && (
                <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>balance {fmt(balance)}</span>
              )}
            </span>
          );
        },
        meta: { className: gridStyles.num },
      },
    ],
    []
  );



  const footer = rows.length > 0 ? (
    <tr>
      <td><strong>Totals ({totals.employees})</strong></td>
      <td />
      <td className={gridStyles.num}>{totals.totalWorkingDays || "—"}</td>
      <td className={gridStyles.num}>{totals.totalSales || "—"}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalCommission)}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalBasic)}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalLoan, true)}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalTransport)}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalOtherBonuses)}</td>
      <td className={gridStyles.num}>{moneyCell(totals.totalDeductions, true)}</td>
      <td className={gridStyles.num}>
        <strong>{fmt(totals.totalNet)}</strong>
        {(totals.totalPaidNet || 0) > 0 && (
          <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
            paid {fmt(totals.totalPaidNet)} · all {fmt(totals.totalAllNet || totals.totalNet)}
          </span>
        )}
      </td>
    </tr>
  ) : null;



  return (

    <div>

      <SectionHeader

        title="Payroll"

        subtitle={`${rows.length} employees · ${monthLabel(month)}${data?.monthLock?.locked ? " · Locked" : ""} · ${data?.workingDays || "—"} working days in month`}

        actions={

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>

            {canManage && (

              <>

                <Button size="sm" variant="secondary" onClick={async () => {

                  try {

                    const report = await api<{ current?: { totalNet?: number }; previous?: { totalNet?: number }; deltaNet?: number; anomalies?: string[] }>(

                      scopedPath("/hrms/reports/payroll-compare", { month }, companyContext)

                    );

                    alert(

                      `Net pay ${monthLabel(month)}: ${fmt(report.current?.totalNet)} EGP\nPrior month: ${fmt(report.previous?.totalNet)} EGP\nDelta: ${fmt(report.deltaNet)} EGP${report.anomalies?.length ? `\n\n${report.anomalies.join("\n")}` : ""}`

                    );

                  } catch (err) {

                    alert((err as Error).message);

                  }

                }}>MoM compare</Button>

                <Button size="sm" variant="secondary" onClick={() => { if (confirm(`Initialize payroll profiles for ${monthLabel(month)}?`)) initMonth.mutate(); }}>Init month</Button>

                <Button size="sm" variant="secondary" onClick={() => { if (confirm(`Record loan payments for ${month}?`)) recordLoans.mutate(); }}>Record loans</Button>

                <Button size="sm" variant="secondary" onClick={() => toggleLock.mutate(!data?.monthLock?.locked)}>{data?.monthLock?.locked ? "Unlock month" : "Lock month"}</Button>

                <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/hrms/exports/finance-handoff?month=${encodeURIComponent(month)}`, `finance-handoff-${month}.zip`)}>Finance handoff</Button>

                <Button size="sm" variant="secondary" onClick={() => bulkExportPayslips()}>Bulk payslips</Button>

              </>

            )}

            <Button size="sm" variant="secondary" onClick={() => {
              downloadApiFile(`/payroll/pdf${payrollExportQuery()}`, `payroll-${month}.pdf`);
            }}>Export PDF</Button>

            <Button size="sm" variant="secondary" onClick={() => {
              downloadApiFile(`/payroll/xlsx${payrollExportQuery()}`, `payroll-${month}.xlsx`);
            }}>Export XLS</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "cash", format: "csv" }, companyContext)}`, `cash-${month}.csv`)}>Cash CSV</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "bank", format: "csv" }, companyContext)}`, `bank-${month}.csv`)}>Bank CSV</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "insta", format: "csv" }, companyContext)}`, `instapay-${month}.csv`)}>Instapay CSV</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "cash", format: "pdf" }, companyContext)}`, `cash-${month}.pdf`)}>Cash PDF</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "bank", format: "pdf" }, companyContext)}`, `bank-${month}.pdf`)}>Bank PDF</Button>

            <Button size="sm" variant="secondary" onClick={() => downloadApiFile(`/exports/payments${buildApiQuery({ month, method: "insta", format: "pdf" }, companyContext)}`, `instapay-${month}.pdf`)}>Instapay PDF</Button>

          </div>

        }

      />

      <PageToolbar>

        <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />

        <FilterSelect label="Position" value={position} onChange={setPosition} options={positions} />

        <FilterSelect label="Team" value={team} onChange={setTeam} options={data?.teams || []} />

        <FilterSelect label="Unit" value={unit} onChange={setUnit} options={data?.units || []} />

        <FilterSelect label="Status" value={status} onChange={setStatus} options={data?.payrollStatuses || []} />

        <FilterSelect label="Payment" value={paymentMethod} onChange={setPaymentMethod} options={data?.paymentMethodFilters || PAYMENT_METHOD_FILTER_OPTIONS} allLabel="All payment methods" />

        <label className={styles.toggle}>

          <input

            type="checkbox"

            checked={hideOut && !hideAllOut}

            disabled={hideAllOut}

            onChange={(e) => {

              const next = e.target.checked;

              setHideOut(next);

              if (canManage) {

                api("/settings/hide-out", { method: "PUT", body: JSON.stringify({ hide: next }) }).catch(() => {});

              }

            }}

          />

          Hide OUT (left previous month only)

        </label>

        {canHideAllOut && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hideAllOut}
              onChange={(e) => {
                const on = e.target.checked;
                setHideAllOut(on);
                if (on) setHideOut(true);
              }}
            />
            Hide all OUT (incl. worked this month)
          </label>
        )}

        <label className={styles.toggle}>

          <input type="checkbox" checked={hideZeroNet} onChange={(e) => setHideZeroNet(e.target.checked)} />

          Hide zero net pay

        </label>

      </PageToolbar>

      {!!data?.trainingEnrichWarnings?.length && (
        <div className={styles.warnBanner} role="status">
          <strong>Training payroll warnings</strong>
          <ul>
            {data.trainingEnrichWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`stat-grid ${styles.statGridWide}`}>

          <StatTile value={String(totals.totalWorkingDays)} label="Working days" />

          <StatTile value={String(totals.totalSales)} label="Sales" />

          <StatTile value={fmt(totals.totalCommission)} label="Commission" />

          <StatTile value={fmt(totals.totalBasic)} label="Basic salary" />

          <StatTile value={totals.totalLoan ? `-${fmt(totals.totalLoan)}` : fmt(0)} label="Loans" />

          <StatTile value={fmt(totals.totalTransport)} label="Transportation" />

          <StatTile value={fmt(totals.totalOtherBonuses)} label="Bonus" />

          <StatTile value={totals.totalDeductions ? `-${fmt(totals.totalDeductions)}` : fmt(0)} label="Deductions" />

          <StatTile value={fmt(totals.totalNet)} label="Net remaining" accent />
          <StatTile value={fmt(totals.totalPaidNet || 0)} label="Paid" />
          <StatTile value={fmt(totals.totalAllNet || totals.totalNet)} label="Total net" />

        </div>

      <CommissionTiersCard />



      <Card>

        {isLoading && <p className="muted">Loading…</p>}

        {isFetching && !isLoading && <p className="muted">Refreshing payroll…</p>}

        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}

        {!isLoading && !error && data?.month === month && (

          <DataGrid

            data={rows}

            columns={columns}

            virtualize={false}

            footer={footer}

            onRowClick={(row) =>
              setPayslipEmp({
                id: String(row.employeeId || row.id),
                name: String(row.name || row.employeeName || row.employeeId),
              })
            }

            emptyMessage="No payroll rows for this month / filters"

          />

        )}

      </Card>



      {payslipEmp && (
        <PayslipDialog
          employeeId={payslipEmp.id}
          employeeName={payslipEmp.name}
          open
          onOpenChange={(o) => !o && setPayslipEmp(null)}
        />
      )}

    </div>

  );

}


