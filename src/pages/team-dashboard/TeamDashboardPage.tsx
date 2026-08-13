import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import styles from "./TeamDashboardPage.module.css";

type AgentRow = {
  team?: string;
  teamKey?: string;
  agentName?: string;
  approved?: number;
  postdated?: number;
  dropped?: number;
  totalSent?: number;
  dayOff?: boolean;
};

type TeamSummary = {
  team?: string;
  agentsCount?: number;
  activeAgentsCount?: number;
  approved?: number;
  total?: number;
  conversion?: string;
  targetPercentage?: string;
  dayOffs?: number;
};

type DayBlock = {
  date?: string;
  agentRows?: AgentRow[];
  teamSummaries?: TeamSummary[];
  totals?: { approved?: number; totalSent?: number; unassignedSales?: number };
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mondayOf(dateStr: string) {
  const dt = new Date(`${dateStr}T12:00:00`);
  const day = dt.getDay();
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, delta: number) {
  const dt = new Date(`${dateStr}T12:00:00`);
  dt.setDate(dt.getDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function longDateLabel(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function cellVal(n?: number) {
  return n == null || n === 0 ? "" : String(n);
}

function AgentTable({ day }: { day: DayBlock }) {
  const rows = day.agentRows || [];
  const byTeam = new Map<string, AgentRow[]>();
  rows.forEach((r) => {
    const key = r.teamKey || r.team || "—";
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key)!.push(r);
  });

  return (
    <>
      {[...byTeam.entries()].map(([team, teamRows]) => {
        let tApproved = 0, tPost = 0, tDrop = 0, tTotal = 0;
        return (
          <div key={team} className={styles.teamBlock}>
            <h4>{team}</h4>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Approved</th>
                  <th>PostDated</th>
                  <th>Dropped</th>
                  <th>Total Sent</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((r, i) => {
                  tApproved += r.approved || 0;
                  tPost += r.postdated || 0;
                  tDrop += r.dropped || 0;
                  tTotal += r.totalSent || 0;
                  return (
                    <tr key={i} className={r.dayOff ? "muted" : ""}>
                      <td>{r.agentName}</td>
                      <td>{cellVal(r.approved)}</td>
                      <td>{cellVal(r.postdated)}</td>
                      <td>{cellVal(r.dropped)}</td>
                      <td>{r.totalSent ?? 0}</td>
                    </tr>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td><strong>Team total</strong></td>
                  <td>{cellVal(tApproved)}</td>
                  <td>{cellVal(tPost)}</td>
                  <td>{cellVal(tDrop)}</td>
                  <td><strong>{tTotal}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      {day.totals && (
        <p className="muted">
          Grand total — Approved {cellVal(day.totals.approved)} · Total {day.totals.totalSent ?? 0}
          {(day.totals.unassignedSales ?? 0) > 0
            ? ` · ${day.totals.unassignedSales} unassigned sale(s) (no agent on record)`
            : ""}
        </p>
      )}
    </>
  );
}

function TeamSummaryTable({ summaries }: { summaries: TeamSummary[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Team</th>
          <th>Active agents</th>
          <th>Approved</th>
          <th>Total</th>
          <th>Conversion</th>
          <th title="Approved sales ÷ active agents (1 sale per agent = 100%)">Target %</th>
          <th>Day-offs</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((t, i) => (
          <tr key={i}>
            <td><strong>{t.team}</strong></td>
            <td>{t.activeAgentsCount ?? t.agentsCount}</td>
            <td>{cellVal(t.approved)}</td>
            <td>{t.total ?? 0}</td>
            <td>{t.conversion || ""}</td>
            <td>{t.targetPercentage || ""}</td>
            <td>{t.dayOffs ? cellVal(t.dayOffs) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayBlock({ day }: { day: DayBlock }) {
  if (!day?.date) return <p className="muted">No dashboard data for this date.</p>;
  const hasRows = (day.agentRows?.length ?? 0) > 0;
  return (
    <Card className={styles.dayCard}>
      <h3>{longDateLabel(day.date)}</h3>
      {hasRows ? (
        <AgentTable day={day} />
      ) : (
        <p className="muted">
          No team rows for this date. Check the date matches the sale&apos;s <strong>working day</strong> in Sales log,
          and that agents are assigned to a team.
        </p>
      )}
      {(day.teamSummaries?.length ?? 0) > 0 && <TeamSummaryTable summaries={day.teamSummaries!} />}
    </Card>
  );
}

export function TeamDashboardPage() {
  const { path, companyContext } = useCompanyScope();
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [pickDate, setPickDate] = useState(todayIso());
  const [weekDate, setWeekDate] = useState(mondayOf(todayIso()));

  const queryDate = period === "week" ? weekDate : pickDate;
  const { data, isLoading } = useQuery({
    queryKey: ["team-dashboard", period, queryDate, companyContext],
    queryFn: () => {
      const q = new URLSearchParams({ period, date: queryDate });
      return api<DayBlock & { days?: DayBlock[] }>(path(`/sales/team-dashboard?${q}`));
    },
  });

  const headerLabel = period === "week"
    ? `${longDateLabel(weekDate)} – ${longDateLabel(shiftDate(weekDate, 6))}`
    : longDateLabel(pickDate);

  return (
    <div>
      <SectionHeader title="Team dashboards" subtitle={headerLabel} />
      <div className={styles.toolbar}>
        <Button variant="secondary" size="sm" onClick={() => period === "week" ? setWeekDate(shiftDate(weekDate, -7)) : setPickDate(shiftDate(pickDate, -1))}>←</Button>
        <strong>{headerLabel}</strong>
        <Button variant="secondary" size="sm" onClick={() => period === "week" ? setWeekDate(shiftDate(weekDate, 7)) : setPickDate(shiftDate(pickDate, 1))}>→</Button>
        <input
          type="date"
          value={period === "week" ? weekDate : pickDate}
          onChange={(e) => period === "week" ? setWeekDate(mondayOf(e.target.value)) : setPickDate(e.target.value)}
        />
        <select value={period} onChange={(e) => setPeriod(e.target.value as "day" | "week")}>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
        </select>
      </div>

      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : period === "week" ? (
        <div className={styles.stack}>
          {(data?.days || []).map((d) => <DayBlock key={d.date} day={d} />)}
          {!(data?.days?.length) && <p className="muted">No dashboard data for this week.</p>}
        </div>
      ) : (
        <DayBlock day={data || {}} />
      )}
    </div>
  );
}
