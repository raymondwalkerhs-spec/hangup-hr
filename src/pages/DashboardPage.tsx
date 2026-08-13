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
const LAYOUT_KEY = "hangup-dashboard-layout";

const defaultLayout = [
  { i: "headcount", x: 0, y: 0, w: 3, h: 2, minH: 2 },
  { i: "active", x: 3, y: 0, w: 3, h: 2, minH: 2 },
  { i: "payroll", x: 6, y: 0, w: 3, h: 2, minH: 2 },
  { i: "units", x: 9, y: 0, w: 3, h: 2, minH: 2 },
  { i: "sales", x: 0, y: 2, w: 6, h: 3, minH: 3 },
  { i: "spark", x: 6, y: 2, w: 6, h: 3, minH: 3 },
];

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as typeof defaultLayout;
  } catch {
    /* ignore */
  }
  return defaultLayout;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  const showAnnouncements = canAccessPage(user, "announcements");
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
  });
  const { data: salesDash } = useQuery({
    queryKey: ["sales-dashboard", month, filters.team, companyContext],
    queryFn: () => {
      const q = new URLSearchParams({ month });
      if (filters.team) q.set("team", filters.team);
      return api<Record<string, unknown>>(path(`/sales/dashboard?${q}`));
    },
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
  const active = employees.filter((e) => e.status === "Active").length;
  const salesByStatus = Object.entries((salesDash?.byStatus as Record<string, number>) || {}).map(
    ([name, value]) => ({ name, value })
  );

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
        layout={layout}
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
            <KpiRing value={active} label="Active agents" max={Math.max(employees.length, 1)} />
          </WidgetCard>
        </div>
        <div key="payroll">
          <WidgetCard title="Net payroll" className="drag-handle">
            <motion.strong
              className="tabular-nums"
              style={{ fontSize: "1.75rem", color: "var(--primary)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {payData?.totals?.totalNet?.toLocaleString("en-EG") ?? "—"}
            </motion.strong>
            <span className="muted">EGP</span>
          </WidgetCard>
        </div>
        <div key="units">
          <WidgetCard title="Units" className="drag-handle">
            <KpiRing value={empData?.units?.length || 0} label="Units" max={20} />
          </WidgetCard>
        </div>
        <div key="sales">
          <WidgetCard title="Sales by status" scope={filters.team || "All teams"} className="drag-handle">
            <LinkedBarChart data={salesByStatus} filterKey="team" />
          </WidgetCard>
        </div>
        <div key="spark">
          <WidgetCard title="Payroll trend" className="drag-handle">
            <SparkLine
              data={[1, 2, 3, 4, 5].map((v) => ({ v: (payData?.totals?.totalNet || 0) * (0.9 + v * 0.02) }))}
            />
          </WidgetCard>
        </div>
      </ResponsiveGrid>
    </div>
  );
}
