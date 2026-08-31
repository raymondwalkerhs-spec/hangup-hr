import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { buildApiQuery } from "@/lib/apiQuery";
import { downloadApiFile } from "@/lib/files";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Select } from "@/ui/Select";
import { SalesRankingsSection } from "./SalesRankingsSection";
import styles from "./ReportsPage.module.css";

type UnitHeadcount = { employees?: number; payrollEligible?: number };

type Report = {
  headcount?: {
    active?: number;
    total?: number;
    out?: number;
    byUnit?: Record<string, UnitHeadcount>;
    byStatus?: Record<string, number>;
  };
  attendance?: {
    present?: number;
    absent?: number;
    rate?: number;
    totalNsnc?: number;
    totalNsncHalf?: number;
    totalLatenessEvents?: number;
  };
  payroll?: {
    totalNet?: number;
    totalBasic?: number;
    totalBonuses?: number;
    totalDeductions?: number;
    count?: number;
    employees?: number;
    twoWeekHolds?: number;
    byUnit?: Record<string, number>;
  };
  markdown?: string;
};

type SavedReport = {
  id: string;
  name: string;
  reportType: string;
  filters?: Record<string, string>;
};

type ColumnSets = Record<string, { id: string; label: string }[]>;

function PayslipRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={styles.payslipRow}>
      <span>{label}</span>
      {strong ? <strong>{value}</strong> : <span>{value}</span>}
    </div>
  );
}

function MonthlyHrReport({
  month,
  companyContext,
  path,
}: {
  month: string;
  companyContext: string;
  path: (p: string, params?: Record<string, string | number | boolean | undefined | null>) => string;
}) {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("employees");
  const [newUnit, setNewUnit] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reports", month, companyContext],
    queryFn: () => api<{ report?: Report; markdown?: string }>(path("/reports/monthly", { month })),
  });

  const savedQ = useQuery({
    queryKey: ["saved-reports", companyContext],
    queryFn: () =>
      api<{ reports?: SavedReport[]; columnSets?: ColumnSets }>(path("/hrms/saved-reports")),
  });

  const createSaved = useMutation({
    mutationFn: () => {
      const filters: Record<string, string> = { month };
      if (newUnit.trim()) filters.unit = newUnit.trim();
      if (newTeam.trim()) filters.team = newTeam.trim();
      const columns = savedQ.data?.columnSets?.[newType] || [];
      return api(path("/hrms/saved-reports"), {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          reportType: newType,
          filters,
          columns,
        }),
      });
    },
    onSuccess: () => {
      setNewOpen(false);
      setNewName("");
      setNewUnit("");
      setNewTeam("");
      qc.invalidateQueries({ queryKey: ["saved-reports"] });
    },
  });

  const deleteSaved = useMutation({
    mutationFn: (id: string) => api(path(`/hrms/saved-reports/${id}`), { method: "DELETE", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-reports"] }),
  });

  const report = data?.report || {};
  const markdown = data?.markdown || "";
  const payrollCount = report.payroll?.employees ?? report.payroll?.count;
  const byUnitHead = Object.entries(report.headcount?.byUnit || {});
  const byUnitPay = Object.entries(report.payroll?.byUnit || {});
  const typeOptions = useMemo(() => {
    const keys = Object.keys(savedQ.data?.columnSets || { employees: [], attendance: [], payroll: [] });
    return keys.map((k) => ({ value: k, label: k }));
  }, [savedQ.data?.columnSets]);

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hr-report-${month}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runTurnover = async () => {
    try {
      setActionMsg(null);
      const r = await api<{ headcount?: { total?: number; active?: number; out?: number } }>(
        path("/hrms/reports/turnover")
      );
      const h = r.headcount || {};
      setActionMsg(`Turnover — Total: ${h.total ?? "—"} · Active: ${h.active ?? "—"} · Out: ${h.out ?? "—"}`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Turnover failed");
    }
  };

  const runAttendanceRankings = async () => {
    try {
      setActionMsg(null);
      const r = await api<{
        rankings?: { employeeId: string; name: string; unit: string; nsnc: number; lateness: number; halfDays: number }[];
      }>(path("/hrms/reports/attendance-rankings", { month }));
      const header = "employeeId,name,unit,nsnc,lateness,halfDays\n";
      const rows = (r.rankings || [])
        .map((x) => [x.employeeId, x.name, x.unit, x.nsnc, x.lateness, x.halfDays].join(","))
        .join("\n");
      const blob = new Blob([header + rows], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-rankings-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setActionMsg(`Downloaded attendance rankings (${r.rankings?.length || 0} rows)`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Attendance rankings failed");
    }
  };

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className={styles.extraActions}>
        <Button size="sm" variant="secondary" onClick={downloadMarkdown} disabled={!markdown}>
          Download Markdown
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadApiFile(
              `/reports/monthly/pdf${buildApiQuery({ month }, companyContext)}`,
              `hr-report-${month}.pdf`
            )
          }
        >
          Export PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={runTurnover}>
          Turnover report
        </Button>
        <Button size="sm" variant="secondary" onClick={runAttendanceRankings}>
          Attendance rankings CSV
        </Button>
      </div>
      {actionMsg ? <p className={styles.actionMsg}>{actionMsg}</p> : null}

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        <StatTile value={report.headcount?.total ?? "—"} label="Total employees" />
        <StatTile value={report.headcount?.active ?? "—"} label="Active" accent />
        <StatTile value={report.headcount?.out ?? "—"} label="Out / inactive" />
        <StatTile value={report.attendance?.totalNsnc ?? "—"} label="NSNC (full)" />
        <StatTile value={report.attendance?.totalNsncHalf ?? "—"} label="NSNC Half Day" />
        <StatTile value={report.attendance?.totalLatenessEvents ?? "—"} label="Lateness events" />
      </div>

      <div className={styles.twoCol}>
        <Card>
          <h3>Payroll summary</h3>
          <PayslipRow label="Employees on payroll" value={String(payrollCount ?? "—")} />
          <PayslipRow
            label="Total basic"
            value={report.payroll?.totalBasic != null ? `${fmt(report.payroll.totalBasic)} EGP` : "—"}
          />
          <PayslipRow
            label="Total bonuses"
            value={report.payroll?.totalBonuses != null ? `${fmt(report.payroll.totalBonuses)} EGP` : "—"}
          />
          <PayslipRow
            label="Total deductions"
            value={report.payroll?.totalDeductions != null ? `${fmt(report.payroll.totalDeductions)} EGP` : "—"}
          />
          <PayslipRow
            label="Net payroll"
            value={report.payroll?.totalNet != null ? `${fmt(report.payroll.totalNet)} EGP` : "—"}
            strong
          />
          <PayslipRow label="2-week holds" value={String(report.payroll?.twoWeekHolds ?? "—")} />
        </Card>
        <Card>
          <h3>Net pay by unit</h3>
          {byUnitPay.length ? (
            byUnitPay.map(([u, n]) => (
              <PayslipRow key={u} label={u} value={`${fmt(n)} EGP`} />
            ))
          ) : (
            <p className="muted">No unit payroll data</p>
          )}
        </Card>
      </div>

      <Card>
        <h3>Headcount by unit</h3>
        {byUnitHead.length ? (
          byUnitHead.map(([u, d]) => (
            <PayslipRow
              key={u}
              label={u}
              value={`${d.employees ?? 0} (${d.payrollEligible ?? 0} payroll)`}
            />
          ))
        ) : (
          <p className="muted">No headcount by unit</p>
        )}
      </Card>

      <Card>
        <div className={styles.savedHead}>
          <h3>Custom reports</h3>
          <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>
            + New
          </Button>
        </div>
        {savedQ.isLoading ? (
          <p className="muted">Loading…</p>
        ) : savedQ.isError ? (
          <p className="muted">{(savedQ.error as Error)?.message || "Could not load saved reports"}</p>
        ) : (savedQ.data?.reports || []).length === 0 ? (
          <p className="muted">No saved reports yet.</p>
        ) : (
          <div className="table-wrap">
            <table className={styles.savedTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(savedQ.data?.reports || []).map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.reportType}</td>
                    <td className={styles.savedActions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          downloadApiFile(
                            `/hrms/saved-reports/${r.id}/run${buildApiQuery({ month }, companyContext)}`,
                            `report-${month}.csv`
                          )
                        }
                      >
                        Export CSV
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (confirm("Delete this saved report?")) deleteSaved.mutate(r.id);
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="New saved report">
        <form
          className={styles.newForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createSaved.mutate();
          }}
        >
          <label className={styles.field}>
            <span>Name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </label>
          <label className={styles.field}>
            <span>Type</span>
            <Select value={newType} onChange={setNewType} options={typeOptions} aria-label="Report type" />
          </label>
          <label className={styles.field}>
            <span>Filter unit</span>
            <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="optional" />
          </label>
          <label className={styles.field}>
            <span>Filter team</span>
            <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="optional" />
          </label>
          {createSaved.isError ? (
            <p className={styles.actionMsg}>{(createSaved.error as Error)?.message || "Save failed"}</p>
          ) : null}
          <div className={styles.formActions}>
            <Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSaved.isPending || !newName.trim()}>
              {createSaved.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ReportsPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { user } = useAppStatus();
  const canSalesRankings = user?.canViewSalesRankings === true;
  const canMonthlyHr = user?.canViewReports === true;
  const [tab, setTab] = useState<"monthly" | "sales">(() =>
    canMonthlyHr ? "monthly" : canSalesRankings ? "sales" : "monthly"
  );

  const showTabs = canSalesRankings && canMonthlyHr;

  return (
    <div>
      <SectionHeader
        title="Reports"
        subtitle={tab === "monthly" ? monthLabel(month) : "Sales rankings"}
        actions={
          tab === "monthly" && canMonthlyHr ? (
            <Button
              variant="secondary"
              onClick={() =>
                downloadApiFile(
                  `/reports/monthly/pdf${buildApiQuery({ month }, companyContext)}`,
                  `hr-report-${month}.pdf`
                )
              }
            >
              Export PDF
            </Button>
          ) : null
        }
      />

      {showTabs ? (
        <div className={styles.tabs} role="tablist" aria-label="Report type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "monthly"}
            className={`${styles.tab} ${tab === "monthly" ? styles.tabActive : ""}`}
            onClick={() => setTab("monthly")}
          >
            HR Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sales"}
            className={`${styles.tab} ${tab === "sales" ? styles.tabActive : ""}`}
            onClick={() => setTab("sales")}
          >
            Sales Rankings
          </button>
        </div>
      ) : null}

      {tab === "sales" && canSalesRankings ? (
        <SalesRankingsSection />
      ) : tab === "monthly" && canMonthlyHr ? (
        <MonthlyHrReport month={month} companyContext={companyContext} path={path} />
      ) : (
        <p className="muted">You do not have permission to view reports.</p>
      )}
    </div>
  );
}
