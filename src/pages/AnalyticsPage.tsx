import { useQuery } from "@tanstack/react-query";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import styles from "./AnalyticsPage.module.css";

type TeamRow = { team?: string; total?: number; average?: number; avgPerAgent?: number; avgPerAgentPerDay?: number; agentCount?: number; unit?: string };
type StatusTeam = { team?: string; passed?: number; pending?: number; postdated?: number; denied?: number };

function BarRow({ label, value, max, color = "var(--primary)" }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel}>{label}</div>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${pct}%`, background: color }} /></div>
      <div className={styles.barValue}>{fmt(value)}</div>
    </div>
  );
}

function StatusBar({ team, passed = 0, pending = 0, postdated = 0, denied = 0 }: StatusTeam) {
  const total = passed + pending + postdated + denied;
  if (!total) return null;
  const p = Math.round((passed / total) * 100);
  const pen = Math.round((pending / total) * 100);
  const post = Math.round((postdated / total) * 100);
  const d = Math.round((denied / total) * 100);
  return (
    <div className={styles.statusBar}>
      <div className={styles.statusTitle}>{team} <span className="muted">({total})</span></div>
      <div className={styles.statusTrack}>
        <div style={{ width: `${p}%`, background: "var(--ok, #059669)" }} title={`Passed: ${passed}`} />
        <div style={{ width: `${pen}%`, background: "var(--warn, #d97706)" }} title={`Pending: ${pending}`} />
        <div style={{ width: `${post}%`, background: "var(--primary)" }} title={`Postdated: ${postdated}`} />
        <div style={{ width: `${d}%`, background: "var(--err, #dc2626)" }} title={`Dropped: ${denied}`} />
      </div>
      <div className={styles.statusLegend}>
        <span>Passed {passed}</span>
        <span>Pending {pending}</span>
        <span>Postdated {postdated}</span>
        <span>Dropped {denied}</span>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function AnalyticsPage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", month, companyContext],
    queryFn: () => api<Record<string, unknown>>(path("/reports/analytics", { month })),
  });

  if (isLoading) return <p className="muted">Loading analytics…</p>;

  const companyLabel = data?.company === "hs2" ? "HS-2" : "Hangup";
  const req = (data?.requests as Record<string, unknown>) || {};
  const leave = (req.leave as { byStatus?: Record<string, number>; total?: number }) || {};
  const it = (req.it as { total?: number; ratio?: number }) || {};
  const fin = (data?.financials as Record<string, unknown>) || {};
  const att = (data?.attendance as Record<string, unknown>) || {};
  const train = (data?.training as Record<string, unknown>) || {};
  const sales = (data?.sales as Record<string, unknown>) || {};
  const equip = (data?.equipment as Record<string, number>) || {};
  const audit = (data?.hrAudit as Record<string, number>) || {};

  const leaveMax = Math.max(...Object.values(leave.byStatus || { x: 1 }), 1);
  const expenseMax = Math.max(...Object.values((fin.expensesByCategory as Record<string, number>) || { x: 1 }), 1);
  const paidByMax = Math.max(...Object.values((fin.expensesByPaidBy as Record<string, number>) || { x: 1 }), 1);
  const equipMax = Math.max(...Object.values(equip || { x: 1 }), 1);

  return (
    <div>
      <SectionHeader title="Reporting & Analytics" subtitle={`${monthLabel(month)} · ${companyLabel}`} />

      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <StatTile value={leave.total || 0} label="Leave requests" />
        <StatTile value={it.total || 0} label={`IT requests (${it.ratio || 0}% resolved)`} />
        <StatTile value={`${fmt(att.overall || att.average || 0)}%`} label={`Avg attendance (${String(data?.agentsMonth || month)})`} />
        <StatTile value={fmt(fin.companyCosts as number)} label="Company costs (EGP)" accent />
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Leave requests by status</h3>
          {Object.entries(leave.byStatus || {}).map(([s, c]) => (
            <BarRow key={s} label={s} value={Number(c)} max={leaveMax} />
          ))}
          {!Object.keys(leave.byStatus || {}).length && <p className="muted">No leave data</p>}
        </Card>
        <Card>
          <h3>Financials — company costs</h3>
          <DetailRow label="Company costs (paid)" value={<strong>{fmt(fin.companyCosts as number)} EGP</strong>} />
          <DetailRow label="Paid receipts" value={`${fmt(fin.expenseTotal as number)} EGP (${fmt(fin.paidCount as number)})`} />
          <DetailRow label="Pending receipts" value={`${fmt(fin.pendingTotal as number)} EGP (${fmt(fin.pendingCount as number)})`} />
          <DetailRow label="Monthly bills" value={`${fmt(fin.billsTotal as number)} EGP`} />
          <h4 className={styles.subhead}>Paid by</h4>
          {Object.entries((fin.expensesByPaidBy as Record<string, number>) || {})
            .filter(([, amt]) => Number(amt) > 0)
            .map(([label, amt]) => (
              <BarRow key={label} label={label} value={Number(amt)} max={paidByMax} color={label === "Main Fund" ? "var(--primary)" : "var(--ok, #059669)"} />
            ))}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Expenses by category (paid)</h3>
          {Object.entries((fin.expensesByCategory as Record<string, number>) || {}).map(([cat, amt]) => (
            <BarRow key={cat} label={cat.replace(/_/g, " ")} value={Number(amt)} max={expenseMax} color="var(--warn, #d97706)" />
          ))}
          {!Object.keys(fin.expensesByCategory || {}).length && <p className="muted">No expense data</p>}
        </Card>
        <Card>
          <h3>Bonuses by team</h3>
          {((fin.bonuses as TeamRow[]) || []).map((b) => (
            <BarRow key={b.team} label={String(b.team)} value={Number(b.total)} max={Math.max(...((fin.bonuses as TeamRow[]) || []).map((x) => Number(x.total)), 1)} color="var(--ok, #059669)" />
          ))}
          {!((fin.bonuses as TeamRow[]) || []).length && <p className="muted">No bonus data</p>}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Deductions by team</h3>
          {((fin.deductions as TeamRow[]) || []).map((d) => (
            <BarRow key={d.team} label={String(d.team)} value={Number(d.total)} max={Math.max(...((fin.deductions as TeamRow[]) || []).map((x) => Number(x.total)), 1)} color="var(--err, #dc2626)" />
          ))}
        </Card>
        <Card>
          <h3>Sales status by team ({String(data?.salesMonth || month)})</h3>
          {((sales.statusByTeam as StatusTeam[]) || []).map((s) => (
            <StatusBar key={s.team} {...s} />
          ))}
          {!((sales.statusByTeam as StatusTeam[]) || []).length && <p className="muted">No sales data</p>}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Equipment by type</h3>
          {Object.entries(equip).map(([k, v]) => (
            <BarRow key={k} label={k} value={Number(v)} max={equipMax} color="var(--warn, #d97706)" />
          ))}
        </Card>
        <Card>
          <h3>Closers by unit</h3>
          {((sales.closersByUnit as TeamRow[]) || []).map((s) => (
            <BarRow key={s.unit} label={String(s.unit)} value={Number(s.average)} max={Math.max(...((sales.closersByUnit as TeamRow[]) || []).map((x) => Number(x.average)), 1)} />
          ))}
          {(sales.topCloser as TeamRow)?.unit && (
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Top closer unit: {String((sales.topCloser as TeamRow).unit)} (avg {fmt((sales.topCloser as TeamRow).average)} EGP)
            </p>
          )}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Agent sales by team (avg per agent)</h3>
          {((sales.agentsByTeam as TeamRow[]) || []).map((s) => (
            <BarRow key={s.team} label={String(s.team)} value={Number(s.average)} max={Math.max(...((sales.agentsByTeam as TeamRow[]) || []).map((x) => Number(x.average)), 1)} color="var(--ok, #059669)" />
          ))}
          {(sales.topAgent as TeamRow)?.team && (
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Top agent team: {String((sales.topAgent as TeamRow).team)} (avg {fmt((sales.topAgent as TeamRow).average)} sales/agent)
            </p>
          )}
        </Card>
        <Card>
          <h3>Averages — sales per agent / month</h3>
          {((sales.averagesByTeam as TeamRow[]) || []).map((s) => (
            <BarRow key={s.team} label={`${s.team} (${s.agentCount} agents)`} value={Number(s.avgPerAgent)} max={Math.max(...((sales.averagesByTeam as TeamRow[]) || []).map((x) => Number(x.avgPerAgent)), 1)} color="var(--warn, #d97706)" />
          ))}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Averages — sales per agent / working day</h3>
          {((sales.averagesByTeamPerDay as TeamRow[]) || []).map((s) => (
            <BarRow key={s.team} label={`${s.team} (${s.agentCount} agents)`} value={Number(s.avgPerAgentPerDay)} max={Math.max(...((sales.averagesByTeamPerDay as TeamRow[]) || []).map((x) => Number(x.avgPerAgentPerDay)), 1)} color="var(--warn, #d97706)" />
          ))}
        </Card>
        <Card>
          <h3>Training pipeline</h3>
          <DetailRow label="In training" value={fmt(train.inTraining as number)} />
          <DetailRow label="Graduated this month" value={fmt(train.graduated as number)} />
          <DetailRow label="Dropped" value={fmt(train.dropped as number)} />
          <h4 className={styles.subhead}>By phase</h4>
          {Object.entries((train.phases as Record<string, number>) || {}).map(([phase, count]) => (
            <BarRow key={phase} label={`Phase ${phase}`} value={Number(count)} max={Math.max(...Object.values((train.phases as Record<string, number>) || { x: 1 }), 1)} />
          ))}
        </Card>
      </div>

      <div className={styles.grid2}>
        <Card>
          <h3>Attendance & turnover</h3>
          <DetailRow label="Headcount" value={fmt(att.headcount as number)} />
          <DetailRow label="New employees" value={fmt((att.newEmployees as number) || 0)} />
          <DetailRow label="Departures" value={fmt((att.departures as number) || 0)} />
          <DetailRow label="Turnover rate" value={`${fmt(att.turnoverRate as number)}%`} />
          <h4 className={styles.subhead}>By team</h4>
          {((att.byTeam as TeamRow[]) || []).map((t) => (
            <BarRow key={t.team} label={String(t.team)} value={Number(t.average)} max={100} />
          ))}
        </Card>
        <Card>
          <h3>HR audit — edits this month</h3>
          {Object.keys(audit).length ? (
            <table className={styles.auditTable}>
              <thead><tr><th>User</th><th>Edits</th></tr></thead>
              <tbody>
                {Object.entries(audit).map(([u, c]) => (
                  <tr key={u}><td>{u}</td><td>{fmt(c)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No audit entries this month</p>
          )}
        </Card>
      </div>
    </div>
  );
}
