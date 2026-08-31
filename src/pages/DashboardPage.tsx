import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
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
import { LIVE_REFETCH_MS } from "@/lib/liveRefresh";
import { RpmWeeklySection } from "@/features/dashboard/RpmWeeklySection";

const ResponsiveGrid = WidthProvider(GridLayout);
const LAYOUT_KEY = "hangup-dashboard-layout-v6";

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

/** Pre-split dashboard: one status chart + one month sparkline. */
const COMBINED_LAYOUT: Layout[] = [
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
  { i: "checks", x: 0, y: 7, w: 6, h: 3, minH: 3 },
  { i: "qFeedback", x: 6, y: 7, w: 6, h: 3, minH: 3 },
];

/** TL + closer: separate closed vs team status + sparklines. */
const SPLIT_LAYOUT: Layout[] = [
  { i: "headcount", x: 0, y: 0, w: 3, h: 2, minH: 2 },
  { i: "active", x: 3, y: 0, w: 3, h: 2, minH: 2 },
  { i: "payroll", x: 6, y: 0, w: 3, h: 2, minH: 2 },
  { i: "units", x: 9, y: 0, w: 3, h: 2, minH: 2 },
  { i: "salesClosed", x: 0, y: 2, w: 6, h: 3, minH: 3 },
  { i: "sparkClosed", x: 6, y: 2, w: 6, h: 3, minH: 3 },
  { i: "salesTeam", x: 0, y: 5, w: 6, h: 3, minH: 3 },
  { i: "sparkTeam", x: 6, y: 5, w: 6, h: 3, minH: 3 },
  { i: "attDayOff", x: 0, y: 8, w: 3, h: 2, minH: 2 },
  { i: "attNsnc", x: 3, y: 8, w: 3, h: 2, minH: 2 },
  { i: "attHalf", x: 6, y: 8, w: 3, h: 2, minH: 2 },
  { i: "attWfh", x: 9, y: 8, w: 3, h: 2, minH: 2 },
  { i: "checks", x: 0, y: 10, w: 6, h: 3, minH: 3 },
  { i: "qFeedback", x: 6, y: 10, w: 6, h: 3, minH: 3 },
];

type OpsMonth = {
  scope?: string;
  split?: boolean;
  dailySales?: { date: string; sales: number }[];
  closed?: { scope?: string; dailySales?: { date: string; sales: number }[] };
  team?: { scope?: string; dailySales?: { date: string; sales: number }[] };
  attendance?: {
    dayOff?: number;
    nsnc?: number;
    halfDay?: number;
    wfh?: number;
    attended?: number;
  };
  employeeCount?: number;
};

type SalesDashSlice = {
  totals?: Record<string, number>;
  byStatus?: Record<string, number>;
  scope?: string;
};

type SavedLayouts = {
  combined?: Layout[];
  split?: Layout[];
};

function statusBars(totals: Record<string, number> | undefined) {
  return Object.entries(totals || {})
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value }));
}

function loadSavedLayouts(): SavedLayouts {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as SavedLayouts;
    // Migrate legacy single-array layouts (v2–v4)
    for (const legacyKey of [
      "hangup-dashboard-layout-v4",
      "hangup-dashboard-layout-v3",
      "hangup-dashboard-layout-v2",
    ]) {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (!legacyRaw) continue;
      const legacy = JSON.parse(legacyRaw) as Layout[];
      if (!Array.isArray(legacy)) continue;
      const hasSplit = legacy.some((l) => String(l.i).includes("Closed") || String(l.i).includes("Team"));
      return hasSplit ? { split: legacy } : { combined: legacy };
    }
  } catch {
    /* ignore */
  }
  return {};
}

function mergeLayout(
  template: Layout[],
  saved: Layout[] | undefined,
  showPayroll: boolean,
  showChecks: boolean
): Layout[] {
  const savedMap = new Map((saved || []).map((item) => [item.i, item]));
  return template
    .filter((item) => {
      if (!showPayroll && item.i === "payroll") return false;
      if (!showChecks && (item.i === "checks" || item.i === "qFeedback")) return false;
      return true;
    })
    .map((item) => {
      const hit = savedMap.get(item.i);
      return hit ? { ...item, ...hit, i: item.i } : item;
    });
}

function isActiveEmployeeStatus(status?: string) {
  return String(status || "").trim().toLowerCase() === "active";
}

function isCompanyDashboardRole(role: string) {
  return ["admin", "ceo", "rtm", "hr", "quality", "finance", "op"].includes(role);
}

function userHasSplitSalesDashboard(user?: StatusUser) {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  if (isCompanyDashboardRole(role)) return false;
  const leadTeams = (user.leadTeams as { team?: string }[] | undefined) || [];
  const closerTeams = (user.closerTeams as { team?: string }[] | undefined) || [];
  return (role === "tl" || leadTeams.length > 0) && closerTeams.length > 0;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  const userRole = String(user?.role || "").toLowerCase();
  const showPayroll = user?.canViewDashboardPayroll === true;
  const showChecksCards = user?.canViewRpmChecksDashboard === true || user?.canSubmitRpmChecks === true;
  const showAnnouncements = canAccessPage(user, "announcements");
  const [payrollRevealed, setPayrollRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout>>();
  const payrollPtr = useRef<{ x: number; y: number } | null>(null);
  const showCoaching = canAccessPage(user, "coaching");
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { filters } = useCrossFilterStore();
  const [savedLayouts, setSavedLayouts] = useState<SavedLayouts>(loadSavedLayouts);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data: empData } = useQuery({
    queryKey: ["employees", companyContext],
    queryFn: () => api<{ employees: { status?: string }[]; units: string[] }>(path("/employees")),
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
  const { data: payData } = useQuery({
    queryKey: ["payroll", month, companyContext],
    queryFn: () => api<{ totals: { totalNet: number } }>(path("/payroll", { month })),
    enabled: showPayroll,
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
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
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
  const { data: opsMonth } = useQuery({
    queryKey: ["sales-ops-month", month, companyContext],
    queryFn: () => api<OpsMonth>(path("/sales/ops-month", { month })),
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });

  const { data: checksSummary } = useQuery({
    queryKey: ["rpm-checks-dashboard-summary", companyContext],
    queryFn: () =>
      api<{
        totals?: Record<string, number>;
        feedback?: Record<string, number>;
        workingDay?: string;
      }>(path("/rpm-checks/dashboard-summary")),
    enabled: showChecksCards,
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
  });

  const scopeKey = String(opsMonth?.scope || salesDash?.scope || "");
  const splitTlCards = useMemo(() => {
    if (isCompanyDashboardRole(userRole)) return false;
    if (scopeKey === "company" || scopeKey === "unit") return false;
    return Boolean(
      (salesDash as { split?: boolean } | undefined)?.split ||
        opsMonth?.split ||
        scopeKey === "team+closed" ||
        userHasSplitSalesDashboard(user)
    );
  }, [userRole, scopeKey, salesDash, opsMonth?.split, user]);

  const visibleLayout = useMemo(
    () =>
      mergeLayout(
        splitTlCards ? SPLIT_LAYOUT : COMBINED_LAYOUT,
        splitTlCards ? savedLayouts.split : savedLayouts.combined,
        showPayroll,
        showChecksCards
      ),
    [splitTlCards, savedLayouts, showPayroll, showChecksCards]
  );

  const onLayoutChange = useCallback(
    (next: Layout[]) => {
      setSavedLayouts((prev) => {
        const updated = splitTlCards ? { ...prev, split: next } : { ...prev, combined: next };
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated));
        }, 400);
        return updated;
      });
    },
    [splitTlCards]
  );

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const employees = empData?.employees || [];
  const active = employees.filter((e) => isActiveEmployeeStatus(e.status)).length;
  const closedDash = (salesDash as { closed?: SalesDashSlice } | undefined)?.closed;
  const teamDash = (salesDash as { team?: SalesDashSlice } | undefined)?.team;
  const totals = useMemo(
    () => (salesDash?.totals || salesDash?.byStatus || {}) as Record<string, number>,
    [salesDash?.totals, salesDash?.byStatus]
  );
  const salesByStatus = useMemo(() => statusBars(totals), [totals]);
  const closedByStatus = useMemo(
    () => statusBars(closedDash?.totals || closedDash?.byStatus),
    [closedDash]
  );
  const teamByStatus = useMemo(
    () => statusBars(teamDash?.totals || teamDash?.byStatus),
    [teamDash]
  );
  const salesScopeLabel = filters.team || SCOPE_LABELS[scopeKey] || "Scoped";
  const dailySpark = useMemo(
    () =>
      (opsMonth?.dailySales || []).map((d) => ({
        v: d.sales,
        label: d.date.slice(8),
      })),
    [opsMonth?.dailySales]
  );
  const closedSpark = useMemo(
    () =>
      (opsMonth?.closed?.dailySales || []).map((d) => ({
        v: d.sales,
        label: d.date.slice(8),
      })),
    [opsMonth?.closed?.dailySales]
  );
  const teamSpark = useMemo(
    () =>
      (opsMonth?.team?.dailySales || []).map((d) => ({
        v: d.sales,
        label: d.date.slice(8),
      })),
    [opsMonth?.team?.dailySales]
  );
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
    userRole === "tl" ||
    closerTeams.length > 0;

  const renderWidget = (id: string) => {
    switch (id) {
      case "headcount":
        return (
          <WidgetCard title="Headcount" className="drag-handle">
            <KpiRing value={employees.length} label="Employees" max={Math.max(employees.length, 1)} />
          </WidgetCard>
        );
      case "active":
        return (
          <WidgetCard title="Active" className="drag-handle">
            <KpiRing value={active} label="Active employees" max={Math.max(employees.length, 1)} />
          </WidgetCard>
        );
      case "payroll":
        return (
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
        );
      case "units":
        return (
          <WidgetCard title={showCloseTeamsKpi ? "Close teams" : "Units"} className="drag-handle">
            <KpiRing
              value={showCloseTeamsKpi ? closeTeamCount : empData?.units?.length || 0}
              label={showCloseTeamsKpi ? "Teams you close" : "Units"}
              max={showCloseTeamsKpi ? Math.max(closeTeamCount, 5) : 20}
            />
          </WidgetCard>
        );
      case "sales":
        return (
          <WidgetCard title="Sales by status" scope={salesScopeLabel} className="drag-handle">
            <LinkedBarChart data={salesByStatus} filterKey="status" animate={false} />
          </WidgetCard>
        );
      case "spark":
        return (
          <WidgetCard title="Sales this month" scope={salesScopeLabel} className="drag-handle">
            <SparkLine data={dailySpark} animate={false} />
          </WidgetCard>
        );
      case "salesClosed":
        return (
          <WidgetCard title="Sales by status" scope={SCOPE_LABELS.closer} className="drag-handle">
            <LinkedBarChart data={closedByStatus} filterKey="status" animate={false} />
          </WidgetCard>
        );
      case "sparkClosed":
        return (
          <WidgetCard title="Sales this month" scope={SCOPE_LABELS.closer} className="drag-handle">
            <SparkLine data={closedSpark} animate={false} />
          </WidgetCard>
        );
      case "salesTeam":
        return (
          <WidgetCard title="Sales by status" scope={SCOPE_LABELS.team} className="drag-handle">
            <LinkedBarChart data={teamByStatus} filterKey="status" animate={false} />
          </WidgetCard>
        );
      case "sparkTeam":
        return (
          <WidgetCard title="Sales this month" scope={SCOPE_LABELS.team} className="drag-handle">
            <SparkLine data={teamSpark} animate={false} />
          </WidgetCard>
        );
      case "attDayOff":
        return (
          <WidgetCard title="Day off" className="drag-handle">
            <KpiRing value={att.dayOff || 0} label="Day-OFF" max={attMax} />
          </WidgetCard>
        );
      case "attNsnc":
        return (
          <WidgetCard title="NSNC" className="drag-handle">
            <KpiRing value={att.nsnc || 0} label="NSNC" max={attMax} />
          </WidgetCard>
        );
      case "attHalf":
        return (
          <WidgetCard title="Half day" className="drag-handle">
            <KpiRing value={att.halfDay || 0} label="Half Day" max={attMax} />
          </WidgetCard>
        );
      case "attWfh":
        return (
          <WidgetCard title="WFH" className="drag-handle">
            <KpiRing value={att.wfh || 0} label="WFH" max={attMax} />
          </WidgetCard>
        );
      case "checks": {
        const t = checksSummary?.totals || {};
        const bars = [
          { name: "Q", value: t.q || 0 },
          { name: "NQ", value: t.nq || 0 },
          { name: "Age", value: t.age_limit || 0 },
          { name: "Under", value: t.under_age || 0 },
          { name: "Dup", value: t.duplicate || 0 },
        ];
        return (
          <WidgetCard
            title="Checks today"
            scope={checksSummary?.workingDay || "Working day"}
            className="drag-handle"
          >
            <LinkedBarChart data={bars} filterKey="status" animate={false} />
            <button type="button" className="muted" style={{ marginTop: 8 }} onClick={() => navigate("/checks")}>
              Open Checks · Total {t.totalChecks || 0}
            </button>
          </WidgetCard>
        );
      }
      case "qFeedback": {
        const f = checksSummary?.feedback || {};
        const bars = [
          { name: "Open", value: f.open || 0 },
          { name: "CallBack", value: f.callback || 0 },
          { name: "Not Int", value: f.not_int || 0 },
          { name: "Retransfer", value: f.retransfer || 0 },
          { name: "Dropped", value: f.dropped_with_client || 0 },
        ];
        return (
          <WidgetCard title="Q Feedback" scope={checksSummary?.workingDay || "Working day"} className="drag-handle">
            <LinkedBarChart data={bars} filterKey="status" animate={false} />
            <button type="button" className="muted" style={{ marginTop: 8 }} onClick={() => navigate("/q-feedback")}>
              Open Q Feedback
            </button>
          </WidgetCard>
        );
      }
      default:
        return null;
    }
  };

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
        layout={visibleLayout}
        cols={12}
        rowHeight={90}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        draggableHandle=".drag-handle"
        onLayoutChange={onLayoutChange}
      >
        {visibleLayout.map((item) => (
          <div key={item.i}>{renderWidget(item.i)}</div>
        ))}
      </ResponsiveGrid>
      <RpmWeeklySection />
    </div>
  );
}
