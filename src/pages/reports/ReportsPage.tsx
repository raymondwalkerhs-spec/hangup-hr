import { useQuery } from "@tanstack/react-query";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { buildApiQuery } from "@/lib/apiQuery";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";

type Report = {
  headcount?: { active?: number; total?: number };
  attendance?: { present?: number; absent?: number; rate?: number };
  payroll?: { totalNet?: number; totalBasic?: number; count?: number };
};

export function ReportsPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", month, companyContext],
    queryFn: () => api<{ report?: Report }>(path("/reports/monthly", { month })),
  });

  const report = data?.report || {};

  return (
    <div>
      <SectionHeader
        title="Reports"
        subtitle={monthLabel(month)}
        actions={
          <Button variant="secondary" onClick={() => window.open(`/api/reports/monthly/pdf${buildApiQuery({ month }, companyContext)}`, "_blank")}>
            Export PDF
          </Button>
        }
      />

      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            <StatTile value={report.headcount?.active ?? "—"} label="Active headcount" accent />
            <StatTile value={report.headcount?.total ?? "—"} label="Total employees" />
            <StatTile value={report.attendance?.present ?? "—"} label="Present days" />
            <StatTile value={report.attendance?.rate != null ? `${report.attendance.rate}%` : "—"} label="Attendance rate" />
            <StatTile value={report.payroll?.count ?? "—"} label="Payroll rows" />
            <StatTile value={report.payroll?.totalNet != null ? fmt(report.payroll.totalNet) : "—"} label="Total net payroll" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
            <Card>
              <h3>Headcount</h3>
              <dl style={{ margin: 0 }}>
                <dt className="muted">Active</dt>
                <dd style={{ fontSize: "1.5rem", margin: "0.25rem 0 1rem" }}>{report.headcount?.active ?? "—"}</dd>
                <dt className="muted">Total</dt>
                <dd style={{ fontSize: "1.5rem", margin: "0.25rem 0" }}>{report.headcount?.total ?? "—"}</dd>
              </dl>
            </Card>
            <Card>
              <h3>Payroll summary</h3>
              <dl style={{ margin: 0 }}>
                <dt className="muted">Total basic</dt>
                <dd style={{ margin: "0.25rem 0 1rem" }}>{report.payroll?.totalBasic != null ? `${fmt(report.payroll.totalBasic)} EGP` : "—"}</dd>
                <dt className="muted">Total net</dt>
                <dd style={{ margin: "0.25rem 0" }}>{report.payroll?.totalNet != null ? `${fmt(report.payroll.totalNet)} EGP` : "—"}</dd>
              </dl>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
