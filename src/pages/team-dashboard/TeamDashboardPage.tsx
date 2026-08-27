import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Button } from "@/ui/Button";
import { QueryErrorCard } from "@/ui/QueryErrorCard";
import { EmptyState } from "@/ui/EmptyState";
import { cairoWorkingDayToday } from "@/lib/salesCells";
import styles from "./TeamDashboardPage.module.css";

type AgentRow = {
  agentId?: string;
  team?: string;
  teamKey?: string;
  agentName?: string;
  approved?: number;
  pending?: number;
  dropped?: number;
  retransfer?: number;
  totalSent?: number;
  dayOff?: boolean;
  checksQ?: number;
  checksNq?: number;
  checksAgeLimit?: number;
  checksUnderAge?: number;
  checksDuplicate?: number;
  checksTotal?: number;
  note?: string;
};

type TeamSummary = {
  team?: string;
  agentsCount?: number;
  activeAgentsCount?: number;
  approved?: number;
  pending?: number;
  passedPending?: number;
  total?: number;
  checksQ?: number;
  conversion?: string;
  targetPercentage?: string;
  dayOffs?: number;
};

type DayBlock = {
  date?: string;
  from?: string;
  to?: string;
  period?: Period;
  periodTotals?: boolean;
  targetDivisor?: number;
  agentRows?: AgentRow[];
  teamSummaries?: TeamSummary[];
  totals?: {
    approved?: number;
    pending?: number;
    dropped?: number;
    retransfer?: number;
    totalSent?: number;
    checksQ?: number;
    unassignedSales?: number;
  };
};

type Period = "day" | "week" | "month";

function mondayOf(dateStr: string) {
  const dt = new Date(`${dateStr}T12:00:00`);
  const day = dt.getDay();
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function monthStart(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`;
}

function shiftDate(dateStr: string, delta: number) {
  const dt = new Date(`${dateStr}T12:00:00`);
  dt.setDate(dt.getDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function shiftMonth(dateStr: string, delta: number) {
  const dt = new Date(`${dateStr}T12:00:00`);
  dt.setMonth(dt.getMonth() + delta);
  return monthStart(dt.toISOString().slice(0, 10));
}

function longDateLabel(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function monthLabel(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function cellVal(n?: number) {
  return n == null || n === 0 ? "" : String(n);
}

function convTone(conversion?: string) {
  const n = Number(String(conversion || "").replace("%", ""));
  if (!Number.isFinite(n)) return "";
  if (n >= 50) return styles.convGood;
  if (n >= 25) return styles.convMid;
  return styles.convLow;
}

function NoteCell({
  agentId,
  initial,
  onSave,
  busy,
}: {
  agentId: string;
  initial: string;
  onSave: (agentId: string, note: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className={styles.noteInput}
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) onSave(agentId, value);
      }}
      aria-label="Agent note"
    />
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "sent" | "q" | "nq" | "age" | "under" | "dup" | "checks" | "conv";
}) {
  const toneClass =
    tone === "sent"
      ? styles.kpiSent
      : tone === "q"
        ? styles.kpiQ
        : tone === "nq"
          ? styles.kpiNq
          : tone === "age"
            ? styles.kpiAge
            : tone === "under"
              ? styles.kpiUnder
              : tone === "dup"
                ? styles.kpiDup
                : tone === "checks"
                  ? styles.kpiChecks
                  : tone === "conv"
                    ? styles.kpiConv
                    : "";
  return (
    <div className={`${styles.kpi} ${toneClass}`}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
    </div>
  );
}

function AgentTable({
  day,
  onSaveNote,
  savingNoteId,
  showNotes,
}: {
  day: DayBlock;
  onSaveNote: (agentId: string, note: string) => void;
  savingNoteId: string | null;
  showNotes: boolean;
}) {
  const rows = day.agentRows || [];
  const byTeam = new Map<string, AgentRow[]>();
  rows.forEach((r) => {
    const key = r.teamKey || r.team || "—";
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key)!.push(r);
  });
  const summaries = new Map((day.teamSummaries || []).map((t) => [t.team || "", t]));

  return (
    <>
      {[...byTeam.entries()].map(([team, teamRows]) => {
        let tPassed = 0,
          tPending = 0,
          tDrop = 0,
          tRetransfer = 0,
          tTotal = 0,
          tQ = 0,
          tNq = 0,
          tAge = 0,
          tUnder = 0,
          tDup = 0,
          tChecks = 0;
        const summary = summaries.get(team);
        const active = summary?.activeAgentsCount ?? summary?.agentsCount ?? teamRows.filter((r) => !r.dayOff).length;
        const divisor = Math.max(1, Number(day.targetDivisor) || 1);
        const target120 = (Number(active) * 1.2).toFixed(1).replace(/\.0$/, "");
        const target150 = (Number(active) * 1.5).toFixed(1).replace(/\.0$/, "");
        const teamSent = teamRows.reduce((s, r) => s + (r.totalSent || 0), 0);
        const achievedDaily = teamSent / divisor;

        return (
          <div key={team} className={styles.teamBlock}>
            <div className={styles.teamHead}>
              <h4>Team {team}</h4>
              <div className={styles.teamMeta}>
                <span className={styles.metaChip}>Active {active}</span>
                <span className={styles.metaChip} title="Daily target rate (1 sale/agent/day)">
                  Target 120% · {target120}
                </span>
                <span className={styles.metaChip} title="Daily target rate (1 sale/agent/day)">
                  Target 150% · {target150}
                </span>
                {summary?.conversion && (
                  <span className={styles.metaChip}>Conv {summary.conversion}</span>
                )}
                <span
                  className={styles.metaChip}
                  title={
                    divisor > 1
                      ? `Sent ${teamSent} ÷ ${divisor} = daily rate; Target % already daily-normalized`
                      : "Achieved vs 1 sale/agent/day"
                  }
                >
                  Achieved {summary?.targetPercentage || `${formatDailyRate(achievedDaily)}`}
                </span>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    {showNotes && <th>Status</th>}
                    <th className={styles.thPassed}>Passed</th>
                    <th className={styles.thPending}>Pending</th>
                    <th className={styles.thDropped}>Dropped</th>
                    <th className={styles.thRetransfer}>Retransfer</th>
                    <th className={styles.thSent}>Sent Sales</th>
                    <th className={styles.thQ}>Q</th>
                    <th className={styles.thNq}>NQ</th>
                    <th className={styles.thAge}>Age</th>
                    <th className={styles.thUnder}>Under</th>
                    <th className={styles.thDup}>Dup</th>
                    <th className={styles.thChecks}>Total Checks</th>
                    {showNotes && <th>Notes</th>}
                  </tr>
                </thead>
                <tbody>
                  {teamRows.map((r, i) => {
                    tPassed += r.approved || 0;
                    tPending += r.pending || 0;
                    tDrop += r.dropped || 0;
                    tRetransfer += r.retransfer || 0;
                    tTotal += r.totalSent || 0;
                    tQ += r.checksQ || 0;
                    tNq += r.checksNq || 0;
                    tAge += r.checksAgeLimit || 0;
                    tUnder += r.checksUnderAge || 0;
                    tDup += r.checksDuplicate || 0;
                    tChecks += r.checksTotal || 0;
                    return (
                      <tr
                        key={`${r.agentId || r.agentName}-${i}`}
                        className={r.dayOff ? styles.dayOff : undefined}
                      >
                        <td>{r.agentName}</td>
                        {showNotes && (
                          <td>
                            {r.dayOff ? (
                              <span className={styles.dayOffBadge}>Day-OFF</span>
                            ) : (
                              <span className={styles.statusActive}>Active</span>
                            )}
                          </td>
                        )}
                        <td className={styles.cellPassed}>{cellVal(r.approved)}</td>
                        <td className={styles.cellPending}>{cellVal(r.pending)}</td>
                        <td className={styles.cellDropped}>{cellVal(r.dropped)}</td>
                        <td className={styles.cellRetransfer}>{cellVal(r.retransfer)}</td>
                        <td className={styles.cellSent}>{r.totalSent ?? 0}</td>
                        <td className={styles.cellQ}>{cellVal(r.checksQ)}</td>
                        <td className={styles.cellNq}>{cellVal(r.checksNq)}</td>
                        <td className={styles.cellAge}>{cellVal(r.checksAgeLimit)}</td>
                        <td className={styles.cellUnder}>{cellVal(r.checksUnderAge)}</td>
                        <td className={styles.cellDup}>{cellVal(r.checksDuplicate)}</td>
                        <td className={styles.cellChecks}>{cellVal(r.checksTotal)}</td>
                        {showNotes && (
                          <td>
                            {r.agentId ? (
                              <NoteCell
                                agentId={r.agentId}
                                initial={r.note || ""}
                                busy={savingNoteId === r.agentId}
                                onSave={onSaveNote}
                              />
                            ) : (
                              ""
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  <tr className={styles.totalRow}>
                    <td>
                      <strong>TOTAL</strong>
                    </td>
                    {showNotes && <td />}
                    <td>{cellVal(tPassed)}</td>
                    <td>{cellVal(tPending)}</td>
                    <td>{cellVal(tDrop)}</td>
                    <td>{cellVal(tRetransfer)}</td>
                    <td>{tTotal}</td>
                    <td>{cellVal(tQ)}</td>
                    <td>{cellVal(tNq)}</td>
                    <td>{cellVal(tAge)}</td>
                    <td>{cellVal(tUnder)}</td>
                    <td>{cellVal(tDup)}</td>
                    <td>{tChecks || ""}</td>
                    {showNotes && <td />}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

function formatDailyRate(n: number) {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function TeamSummaryTable({
  summaries,
  targetDivisor = 1,
}: {
  summaries: TeamSummary[];
  targetDivisor?: number;
}) {
  const divisor = Math.max(1, targetDivisor || 1);
  const targetHint =
    divisor === 1
      ? "Sent Sales ÷ active agents (1 sale/agent/day)"
      : divisor === 5
        ? "Daily-rate Target % · week totals ÷ 5 working days"
        : `Daily-rate Target % · month totals ÷ ${divisor} (5 × working weeks)`;
  return (
    <div className={styles.summarySection}>
      <div className={styles.summaryHead}>Unit summary · Conversion = Sent Sales ÷ Q · {targetHint}</div>
      <div className={styles.tableWrap}>
        <table className={styles.summaryTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Active agents</th>
              <th>Sent Sales</th>
              <th title="Daily-equivalent sent (period ÷ working-day units)">Sent / day</th>
              <th>Q</th>
              <th title="Sent Sales ÷ Q checks">Conversion</th>
              <th title={targetHint}>Target %</th>
              <th>Day-offs</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((t, i) => (
              <tr key={i}>
                <td>
                  <strong>{t.team}</strong>
                </td>
                <td>{t.activeAgentsCount ?? t.agentsCount}</td>
                <td className={styles.cellSent}>{t.total ?? 0}</td>
                <td className={styles.cellSent}>{formatDailyRate((t.total ?? 0) / divisor)}</td>
                <td className={styles.cellQ}>{cellVal(t.checksQ)}</td>
                <td className={convTone(t.conversion)}>{t.conversion || ""}</td>
                <td>{t.targetPercentage || ""}</td>
                <td>{t.dayOffs ? cellVal(t.dayOffs) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardBlock({
  day,
  title,
  onSaveNote,
  savingNoteId,
  showNotes,
}: {
  day: DayBlock;
  title: string;
  onSaveNote: (agentId: string, note: string) => void;
  savingNoteId: string | null;
  showNotes: boolean;
}) {
  const hasRows = (day.agentRows?.length ?? 0) > 0;
  const rows = day.agentRows || [];
  const q = rows.reduce((s, r) => s + (r.checksQ || 0), 0);
  const nq = rows.reduce((s, r) => s + (r.checksNq || 0), 0);
  const age = rows.reduce((s, r) => s + (r.checksAgeLimit || 0), 0);
  const under = rows.reduce((s, r) => s + (r.checksUnderAge || 0), 0);
  const dup = rows.reduce((s, r) => s + (r.checksDuplicate || 0), 0);
  const totalChecks = q + nq + age + under + dup;
  const sent = day.totals?.totalSent ?? rows.reduce((s, r) => s + (r.totalSent || 0), 0);
  const divisor = Math.max(1, Number(day.targetDivisor) || 1);
  const achievedDaily = sent / divisor;
  const conversion =
    q > 0 ? `${((sent / q) * 100).toFixed(2)}%` : sent > 0 ? "—" : "no sales yet";
  const activeN = (day.teamSummaries || []).reduce(
    (s, t) => s + (t.activeAgentsCount ?? t.agentsCount ?? 0),
    0
  );
  // Daily target rate = 1 sale / agent / day (chips stay daily even on week/month)
  const target120 = (activeN * 1.2).toFixed(1).replace(/\.0$/, "");
  const target150 = (activeN * 1.5).toFixed(1).replace(/\.0$/, "");

  return (
    <div className={styles.dayCard}>
      <div className={styles.dayCardHead}>
        <h3>{title}</h3>
        <div className={styles.teamMeta}>
          <span className={styles.metaChip}>Active agents {activeN}</span>
          <span className={styles.metaChip}>Target 120% · {target120}</span>
          <span className={styles.metaChip}>Target 150% · {target150}</span>
          <span
            className={styles.metaChip}
            title={
              divisor > 1
                ? `Period sent ${sent} ÷ ${divisor} working-day units`
                : "Sent sales today"
            }
          >
            Achieved {formatDailyRate(achievedDaily)}
            {divisor > 1 ? "/day" : ""}
          </span>
        </div>
      </div>
      <div className={styles.dayCardBody}>
        <div className={styles.stats}>
          <Kpi label="Sent Sales" value={sent} tone="sent" />
          <Kpi label="Q" value={q} tone="q" />
          <Kpi label="NQ" value={nq} tone="nq" />
          <Kpi label="Age limit" value={age} tone="age" />
          <Kpi label="Under Age" value={under} tone="under" />
          <Kpi label="Duplicate" value={dup} tone="dup" />
          <Kpi label="Total Checks" value={totalChecks} tone="checks" />
          <Kpi label="Conversion" value={conversion} tone="conv" />
        </div>

        {hasRows ? (
          <AgentTable day={day} onSaveNote={onSaveNote} savingNoteId={savingNoteId} showNotes={showNotes} />
        ) : (
          <EmptyState
            title="No team rows for this period"
            hint="Check the date matches sale/check working days, and that agents are assigned to a team."
          />
        )}
        {(day.teamSummaries?.length ?? 0) > 0 && (
          <TeamSummaryTable summaries={day.teamSummaries!} targetDivisor={divisor} />
        )}
      </div>
    </div>
  );
}

export function TeamDashboardPage() {
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("day");
  const [pickDate, setPickDate] = useState(() => cairoWorkingDayToday());
  const [weekDate, setWeekDate] = useState(() => mondayOf(cairoWorkingDayToday()));
  const [monthDate, setMonthDate] = useState(() => monthStart(cairoWorkingDayToday()));
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const queryDate = period === "week" ? weekDate : period === "month" ? monthDate : pickDate;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["team-dashboard", period, queryDate, companyContext],
    queryFn: () => {
      const q = new URLSearchParams({ period, date: queryDate });
      return api<DayBlock>(path(`/sales/team-dashboard?${q}`));
    },
  });

  const noteMutation = useMutation({
    mutationFn: ({ agentId, note }: { agentId: string; note: string }) =>
      api(path("/sales/team-dashboard/notes"), {
        method: "PATCH",
        body: JSON.stringify({ agentId, workingDay: pickDate, note }),
      }),
    onMutate: ({ agentId }) => setSavingNoteId(agentId),
    onSettled: () => {
      setSavingNoteId(null);
      qc.invalidateQueries({ queryKey: ["team-dashboard"] });
    },
  });

  const headerLabel =
    period === "week"
      ? `${longDateLabel(weekDate)} – ${longDateLabel(shiftDate(weekDate, 6))}`
      : period === "month"
        ? monthLabel(monthDate)
        : longDateLabel(pickDate);

  function goPrev() {
    if (period === "week") setWeekDate(shiftDate(weekDate, -7));
    else if (period === "month") setMonthDate(shiftMonth(monthDate, -1));
    else setPickDate(shiftDate(pickDate, -1));
  }

  function goNext() {
    if (period === "week") setWeekDate(shiftDate(weekDate, 7));
    else if (period === "month") setMonthDate(shiftMonth(monthDate, 1));
    else setPickDate(shiftDate(pickDate, 1));
  }

  return (
    <div className={styles.page}>
      <SectionHeader title="Team dashboards" subtitle={`${headerLabel} · RPM sales + checks`} />
      <div className={styles.toolbar}>
        <Button variant="secondary" size="sm" onClick={goPrev}>
          ←
        </Button>
        <strong>{headerLabel}</strong>
        <Button variant="secondary" size="sm" onClick={goNext}>
          →
        </Button>
        {period === "month" ? (
          <input
            className={styles.dateField}
            type="month"
            value={monthDate.slice(0, 7)}
            onChange={(e) => setMonthDate(`${e.target.value}-01`)}
          />
        ) : (
          <input
            className={styles.dateField}
            type="date"
            value={period === "week" ? weekDate : pickDate}
            onChange={(e) =>
              period === "week" ? setWeekDate(mondayOf(e.target.value)) : setPickDate(e.target.value)
            }
          />
        )}
        <div className={styles.periodTabs} role="tablist" aria-label="Dashboard period">
          {(
            [
              ["day", "Daily"],
              ["week", "Weekly"],
              ["month", "Monthly"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={period === value}
              className={`${styles.periodTab} ${period === value ? styles.periodTabActive : ""}`}
              onClick={() => {
                setPeriod(value);
                if (value === "week") setWeekDate(mondayOf(pickDate));
                if (value === "month") setMonthDate(monthStart(pickDate));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : error ? (
        <QueryErrorCard error={error as Error} onRetry={() => refetch()} />
      ) : (
        <DashboardBlock
          day={data || {}}
          title={
            period === "day"
              ? longDateLabel(pickDate)
              : period === "week"
                ? `Week totals · ${headerLabel}`
                : `Month totals · ${headerLabel}`
          }
          savingNoteId={savingNoteId}
          showNotes={period === "day"}
          onSaveNote={(agentId, note) => noteMutation.mutate({ agentId, note })}
        />
      )}
    </div>
  );
}
