import { useQuery } from "@tanstack/react-query";
import { api, monthLabel, fmt } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAuth } from "@/app/AuthProvider";
import { SectionHeader } from "@/ui/SectionHeader";
import { QueryErrorCard } from "@/ui/QueryErrorCard";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";
import { Card } from "@/ui/Card";

export { OrgPage } from "./org/OrgPage";
export { EquipmentPage } from "./equipment/EquipmentPage";
export { TeamDashboardPage } from "./team-dashboard/TeamDashboardPage";
export { ReportsPage } from "./reports/ReportsPage";
export { InterviewsPage } from "@/features/interviews/InterviewsPage";
export { TrainingPage } from "@/features/training/TrainingPage";
export { RequestsPage } from "./requests/RequestsPage";
export { ItRequestsPage } from "./it-requests/ItRequestsPage";
export { CoachingPage } from "./coaching/CoachingPage";
export { BreaksPage } from "./breaks/BreaksPage";

export { MeetingRequestsPage } from "./meeting-requests/MeetingRequestsPage";

export function PayslipPage() {
  const month = useAppStore((s) => s.month);
  const { user } = useAuth();
  const employeeId = user?.employeeId;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["payslip", month, employeeId],
    queryFn: async () => {
      return api<{ payslip?: Record<string, unknown> }>(`/payroll/${encodeURIComponent(employeeId || "")}?month=${encodeURIComponent(month)}`);
    },
    enabled: Boolean(employeeId),
  });

  const p = data?.payslip;

  return (
    <div>
      <SectionHeader title="Payroll" subtitle={monthLabel(month)} />
      {!employeeId && (
        <EmptyState
          title="No employee record linked"
          hint="Ask HR to link your login to an employee ID so your payslip can appear here."
        />
      )}
      {employeeId && isLoading && <Skeleton />}
      {employeeId && error && (
        <QueryErrorCard
          error={error}
          pageName="your payslip"
          onRetry={() => refetch()}
        />
      )}
      {employeeId && !isLoading && !error && !p && (
        <EmptyState
          title={`HR has not released your payslip for ${monthLabel(month)} yet`}
          hint="When HR checks Show to agent on your payslip, it will appear here."
        />
      )}
      {employeeId && !isLoading && !error && p && (
        <Card>
          <p className="muted" style={{ marginBottom: "1rem" }}>{String(p.name || "")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem" }}>
            <div>
              <h4 style={{ margin: "0 0 0.5rem" }}>Attendance</h4>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                <span className="muted">Working days</span>
                <span>{String(p.totalWorkingDays ?? "—")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                <span className="muted">Basic salary</span>
                <strong>{fmt(p.basicSalary as number)} EGP</strong>
              </div>
              {Number(p.transportAllowance) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Transport</span>
                  <span>+{fmt(p.transportAllowance as number)}</span>
                </div>
              )}
            </div>
            <div>
              <h4 style={{ margin: "0 0 0.5rem" }}>Net pay</h4>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem" }}>
                <span>Balance due</span>
                <strong>{fmt((p.remainingBalance ?? p.netSalary) as number)} EGP</strong>
              </div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            View only — contact HR if you have questions. Export is not available from this screen.
          </p>
        </Card>
      )}
    </div>
  );
}
