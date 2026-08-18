import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import GridLayout, { WidthProvider } from "react-grid-layout";
import { Megaphone, ClipboardPen } from "lucide-react";
import { api, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useCrossFilterStore } from "@/stores/cross-filter-store";
import { useAuth } from "@/app/AuthProvider";
import { canAccessPage, type StatusUser } from "@/lib/nav-access";
import { SectionHeader } from "@/ui/SectionHeader";
import { WidgetCard } from "@/ui/Card";
import { KpiRing } from "@/widgets/KpiRing";
import { SparkLine } from "@/widgets/SparkLine";
import { LinkedBarChart } from "@/widgets/LinkedBarChart";
import { motion } from "framer-motion";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import styles from "./DashboardPage.module.css";

const ResponsiveGrid = WidthProvider(GridLayout);
const LAYOUT_KEY = "hangup-dashboard-layout-v2";

const STATUS_LABELS: Record<string, string> = {
  passed: "Passed",
  pending: "Pending",
  callback: "Callback",
  denied: "Denied",
  postdated: "Postdated",
};

const SCOPE_LABELS: Record<string, string> = {
  company: "All teams",
  unit: "Your unit",
  team: "Your team",
  closer: "Sales you closed",
  "team+closed": "Team + closed",
  self: "Your sales",
};

const defaultLayout = [
  { i: "headcount", x: 0, y: 0, w: 3, h: 2, minH: 2 },
  { i: "active", x: 3, y: 0, w: 3, h: 2, minH: 2 },
  { i: "payroll", x: 6, y: 0, w: 3, h: 2, minH: 2 },
  { i: "units", x: 9, y: 0, w: 3, h: 2, minH: 2 },
  { i: "sales", x: 0, y: 2, w: 6, h: 3, minH: 3 },
  { i: "spark", x: 6, y: 2, w: 6, h: 3, minH: 3 },
  { i: "attDayOff", x: 0, y: 5, w: 3, h: 2, minH: 2 },
  { i: "attNsnc", x: 3, y: 5, w: 3, h: 2, minH: 2 },
  { i: "attHalf", x: 6, y: 5, w: 3, h: 2, minH: 2 },
  { i: "attWfh", x: 9, y: 5, w: 3, h: 2, minH: 2 },
];

type OpsMonth = {
  scope?: string;
  dailySales?: { date: string; sales: number }[];
  attendance?: {
    dayOff?: number;
    nsnc?: number;
    halfDay?: number;
    wfh?: number;
    attended?: number;
  };
  employeeCount?: number;
};

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as typeof defaultLayout;
  } catch {
    /* ignore */
  }
  return defaultLayout;
}

function isActiveEmployeeStatus(status?: string) {
  return String(status || "").trim().toLowerCase() === "active";
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  const showPayroll = user?.canViewDashboardPayroll === true;
  const showAnnouncements = canAccessPage(user, "announcements");
  const [payrollRevealed, setPayrollRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout>>();
  const payrollPtr = useRef<{ x: number; y: number } | null>(null);
  const showCoaching = canAccessPage(user, "coaching");
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { filters } = useCrossFilterStore();
  const [layout, setLayout] = useState(loadLayout);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data: empData } = useQuery({
    queryKey: ["employees", companyContext],
    queryFn: () => api<{ employees: { status?: string }[]; units: string[] }>(path("/employees")),
  });
  const { data: payData } = useQuery({
    queryKey: ["payroll", month, companyContext],
    queryFn: () => api<{ totals: { totalNet: number } }>(path("/payroll", { month })),
    enabled: showPayroll,
  });
  const { data: salesDash } = useQuery({
    queryKey: ["sales-dashboard", month, filters.team, companyContext],
    queryFn: () => {
      const q = new URLSearchParams({
        period: "month",
        date: `${month}-01`,
        month,
      });
      if (filters.team) q.set("team", filters.team);
      return api<Record<string, unknown>>(path(`/sales/dashboard?${q}`));
    },
  });
  const { data: opsMonth } = useQuery({
    queryKey: ["sales-ops-month", month, companyContext],
    queryFn: () => api<OpsMonth>(path("/sales/ops-month", { month })),
  });

  const onLayoutChange = useCallback((next: typeof defaultLayout) => {
    setLayout(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const employees = empData?.employees || [];
  const active = employees.filter((e) => isActiveEmployeeStatus(e.status)).length;
  const totals = (salesDash?.totals || salesDash?.byStatus || {}) as Record<string, number>;
  const salesByStatus = Object.entries(totals)
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value }));
  const scopeKey = String(opsMonth?.scope || salesDash?.scope || "");
  const salesScopeLabel = filters.team || SCOPE_LABELS[scopeKey] || "Scoped";
  const dailySpark = (opsMonth?.dailySales || []).map((d) => ({
    v: d.sales,
    label: d.date.slice(8),
  }));
  const att = opsMonth?.attendance || {};
  const attMax = Math.max(att.dayOff || 0, att.nsnc || 0, att.halfDay || 0, att.wfh || 0, 1);
  const closerTeams = (user?.closerTeams as { team?: string; name?: string }[] | undefined) || [];
  const closeTeamCount =
    typeof user?.closeTeamCount === "number"
      ? user.closeTeamCount
      : new Set(
          closerTeams
            .map((t) => String(t.team || t.name || "").trim().toLowerCase())
            .filter(Boolean)
        ).size;
  const showCloseTeamsKpi =
    user?.usesCloseTeamsDashboardKpi === true ||
    String(user?.role || "").toLowerCase() === "tl" ||
    closerTeams.length > 0;

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle={monthLabel(month)} />
      {(showAnnouncements || showCoaching) && (
        <div className={styles.shortcuts}>
          {showAnnouncements && (
            <button type="button" className={styles.shortcut} onClick={() => navigate("/announcements")}>
              <span className={styles.shortcutIcon}><Megaphone size={18} /></span>
              <span>
                <strong>Announcements</strong>
                <span className="muted">Company updates for this workspace</span>
              </span>
            </button>
          )}
          {showCoaching && (
            <button type="button" className={styles.shortcut} onClick={() => navigate("/coaching")}>
              <span className={styles.shortcutIcon}><ClipboardPen size={18} /></span>
              <span>
                <strong>Coaching</strong>
                <span className="muted">Agent coaching tickets and notes</span>
              </span>
            </button>
          )}
        </div>
      )}
      <ResponsiveGrid
        className={styles.grid}
        layout={showPayroll ? layout : layout.filter((l) => l.i !== "payroll")}
        cols={12}
        rowHeight={90}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        draggableHandle=".drag-handle"
        onLayoutChange={onLayoutChange}
      >
        <div key="headcount">
          <WidgetCard title="Headcount" className="drag-handle">
            <KpiRing value={employees.length} label="Employees" max={Math.max(employees.length, 1)} />
          </WidgetCard>
        </div>
        <div key="active">
          <WidgetCard title="Active" className="drag-handle">
            <KpiRing value={active} label="Active employees" max={Math.max(employees.length, 1)} />
          </WidgetCard>
        </div>
        {showPayroll && (
        <div key="payroll">
          <WidgetCard title="Net payroll" className="drag-handle">
            <motion.strong
              className={`tabular-nums ${payrollRevealed ? "" : styles.payrollBlur}`}
              style={{ fontSize: "1.75rem", color: "var(--primary)" }}
              aria-hidden={!payrollRevealed}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onMouseDown={(e) => {
                payrollPtr.current = { x: e.clientX, y: e.clientY };
              }}
              onDoubleClick={(e) => {
                const start = payrollPtr.current;
                if (start && (Math.abs(e.clientX - start.x) > 6 || Math.abs(e.clientY - start.y) > 6)) return;
                e.stopPropagation();
                setPayrollRevealed(true);
                clearTimeout(revealTimer.current);
                revealTimer.current = setTimeout(() => setPayrollRevealed(false), 60000);
              }}
            >
              {payData?.totals?.totalNet?.toLocaleString("en-EG") ?? "—"}
            </motion.strong>
            <span className="muted">EGP{payrollRevealed ? "" : " · double-click to reveal"}</span>
          </WidgetCard>
        </div>
        )}
        <div key="units">
          <WidgetCard title={showCloseTeamsKpi ? "Close teams" : "Units"} className="drag-handle">
            <KpiRing
              value={showCloseTeamsKpi ? closeTeamCount : empData?.units?.length || 0}
              label={showCloseTeamsKpi ? "Teams you close" : "Units"}
              max={showCloseTeamsKpi ? Math.max(closeTeamCount, 5) : 20}
            />
          </WidgetCard>
        </div>
        <div key="sales">
          <WidgetCard title="Sales by status" scope={salesScopeLabel} className="drag-handle">
            <LinkedBarChart data={salesByStatus} filterKey="status" />
          </WidgetCard>
        </div>
        <div key="spark">
          <WidgetCard title="Sales this month" scope={salesScopeLabel} className="drag-handle">
            <SparkLine data={dailySpark} />
          </WidgetCard>
        </div>
        <div key="attDayOff">
          <WidgetCard title="Day off" className="drag-handle">
            <KpiRing value={att.dayOff || 0} label="Day-OFF" max={attMax} />
          </WidgetCard>
        </div>
        <div key="attNsnc">
          <WidgetCard title="NSNC" className="drag-handle">
            <KpiRing value={att.nsnc || 0} label="NSNC" max={attMax} />
          </WidgetCard>
        </div>
        <div key="attHalf">
          <WidgetCard title="Half day" className="drag-handle">
            <KpiRing value={att.halfDay || 0} label="Half Day" max={attMax} />
          </WidgetCard>
        </div>
        <div key="attWfh">
          <WidgetCard title="WFH" className="drag-handle">
            <KpiRing value={att.wfh || 0} label="WFH" max={attMax} />
          </WidgetCard>
        </div>
      </ResponsiveGrid>
    </div>
  );
}
