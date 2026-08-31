import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { cairoWorkingDayToday } from "@/lib/salesCells";
import { PeriodPicker, type DateRange } from "@/ui/PeriodPicker";
import { Card } from "@/ui/Card";
import { EmptyState } from "@/ui/EmptyState";
import { QueryErrorCard } from "@/ui/QueryErrorCard";
import { Skeleton } from "@/ui/Skeleton";
import styles from "./SalesRankingsSection.module.css";

const PERIOD_STORAGE_KEY = "hangup-reports-sales-period-v1";
const SALES_MODE_KEY = "hangup-reports-sales-mode-v1";
const CHECKS_FILTER_KEY = "hangup-reports-checks-filter-v1";

type Breakdown = {
  passed?: number;
  pending?: number;
  denied?: number;
  retransfer?: number;
  callback?: number;
  total?: number;
  q?: number;
  nq?: number;
  age_limit?: number;
  under_age?: number;
  duplicate?: number;
};

type RankRow = {
  rank: number;
  employeeId: string;
  name: string;
  team?: string;
  count: number;
  totalSales?: number;
  ratePct?: number | null;
  rateLabel?: string | null;
  breakdown?: Breakdown;
  attendanceAnomalies?: { date: string; status: string }[];
  attendanceAnomaliesMore?: number;
};

type Report = {
  period?: { from?: string; to?: string; checksFilter?: string; salesMode?: string };
  agents?: RankRow[];
  closers?: RankRow[];
  checkAgents?: RankRow[];
};

type SalesMode = "all" | "passed" | "passed_pending" | "denied";
type ChecksFilter = "all" | "q" | "nq" | "duplicate";

const SALES_MODES: { id: SalesMode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "passed", label: "Passed" },
  { id: "passed_pending", label: "Passed + Pending" },
  { id: "denied", label: "Denied" },
];

const CHECK_FILTERS: { id: ChecksFilter; label: string }[] = [
  { id: "all", label: "All checks" },
  { id: "q", label: "Q" },
  { id: "nq", label: "NQ" },
  { id: "duplicate", label: "Duplicate" },
];

function loadStoredPeriod(): DateRange | null {
  try {
    const raw = sessionStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as DateRange;
    if (p?.from && p?.to) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function loadSalesMode(): SalesMode {
  try {
    const raw = sessionStorage.getItem(SALES_MODE_KEY);
    if (raw === "passed" || raw === "passed_pending" || raw === "denied" || raw === "all") return raw;
  } catch {
    /* ignore */
  }
  return "all";
}

function loadChecksFilter(): ChecksFilter {
  try {
    const raw = sessionStorage.getItem(CHECKS_FILTER_KEY);
    if (raw === "q" || raw === "nq" || raw === "duplicate" || raw === "all") return raw;
  } catch {
    /* ignore */
  }
  return "all";
}

function formatRate(pct: number | null | undefined) {
  if (pct == null || Number.isNaN(pct)) return "—";
  return `${pct}%`;
}

function TooltipBody({ row, kind }: { row: RankRow; kind: "sales" | "checks" }) {
  const b = row.breakdown || {};
  return (
    <div className={styles.tooltipInner}>
      {kind === "sales" ? (
        <>
          <div><strong>Passed:</strong> {b.passed ?? 0}</div>
          <div><strong>Pending:</strong> {b.pending ?? 0}</div>
          <div><strong>Denied:</strong> {b.denied ?? 0}</div>
          {(b.retransfer ?? 0) > 0 ? <div><strong>Retransfer:</strong> {b.retransfer}</div> : null}
          {(b.callback ?? 0) > 0 ? <div><strong>Callback:</strong> {b.callback}</div> : null}
          <div><strong>All sales:</strong> {row.totalSales ?? b.total ?? 0}</div>
          {row.ratePct != null && row.rateLabel ? (
            <div><strong>{row.rateLabel}:</strong> {formatRate(row.ratePct)}</div>
          ) : null}
        </>
      ) : (
        <>
          <div><strong>Q:</strong> {b.q ?? 0}</div>
          <div><strong>NQ:</strong> {b.nq ?? 0}</div>
          <div><strong>Age limit:</strong> {b.age_limit ?? 0}</div>
          <div><strong>Under Age:</strong> {b.under_age ?? 0}</div>
          <div><strong>Duplicate:</strong> {b.duplicate ?? 0}</div>
        </>
      )}
      {(row.attendanceAnomalies?.length ?? 0) > 0 ? (
        <div className={styles.anomalies}>
          <strong>Attendance</strong>
          <ul>
            {row.attendanceAnomalies!.map((a) => (
              <li key={`${a.date}-${a.status}`}>{a.date}: {a.status}</li>
            ))}
          </ul>
          {(row.attendanceAnomaliesMore ?? 0) > 0 ? (
            <div className="muted">+{row.attendanceAnomaliesMore} more days</div>
          ) : null}
        </div>
      ) : (
        <div className="muted" style={{ marginTop: "0.35rem" }}>No attendance anomalies in period</div>
      )}
    </div>
  );
}

function HoverTip({ children, content }: { children: ReactNode; content: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, placeBelow: false });

  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tipH = tipRef.current?.offsetHeight || 160;
    const tipW = tipRef.current?.offsetWidth || 200;
    const spaceAbove = r.top;
    const placeBelow = spaceAbove < tipH + 12;
    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    const top = placeBelow ? r.bottom + 8 : r.top - 8;
    setPos({ top, left, placeBelow });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, content]);

  return (
    <span
      ref={anchorRef}
      className={styles.tipWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            className={`${styles.tooltipPortal} ${pos.placeBelow ? styles.tooltipBelow : styles.tooltipAbove}`}
            style={{ top: pos.top, left: pos.left }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
}

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {options.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`${styles.chip} ${value === f.id ? styles.chipActive : ""}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function RankTable({
  title,
  rows,
  kind,
  emptyLabel,
  showRate,
  rateHeader,
  hideTeam,
  showCheckStatusCols,
}: {
  title: string;
  rows: RankRow[];
  kind: "sales" | "checks";
  emptyLabel: string;
  showRate?: boolean;
  rateHeader?: string;
  hideTeam?: boolean;
  showCheckStatusCols?: boolean;
}) {
  if (!rows.length) {
    return (
      <Card>
        <h3>{title}</h3>
        <EmptyState title={emptyLabel} />
      </Card>
    );
  }
  return (
    <Card>
      <h3>{title}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              {!hideTeam ? <th>Team</th> : null}
              <th>Total</th>
              {showCheckStatusCols ? (
                <>
                  <th>Q</th>
                  <th>NQ</th>
                  <th>Age</th>
                  <th>Under</th>
                  <th>Dup</th>
                </>
              ) : null}
              {showRate ? <th>{rateHeader || "Rate"}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeId} className={styles.hoverRow}>
                <td>{row.rank}</td>
                <td>
                  <span className={styles.nameCell}>
                    {row.name || row.employeeId}
                    <HoverTip content={<TooltipBody row={row} kind={kind} />}>
                      <span
                        className={styles.tipIcon}
                        tabIndex={0}
                        aria-label={`Details for ${row.name || row.employeeId}`}
                      >
                        ⓘ
                      </span>
                    </HoverTip>
                  </span>
                </td>
                {!hideTeam ? <td>{row.team || "—"}</td> : null}
                <td><strong>{row.count}</strong></td>
                {showCheckStatusCols ? (
                  <>
                    <td className={styles.countCell}>{row.breakdown?.q ?? 0}</td>
                    <td className={styles.countCell}>{row.breakdown?.nq ?? 0}</td>
                    <td className={styles.countCell}>{row.breakdown?.age_limit ?? 0}</td>
                    <td className={styles.countCell}>{row.breakdown?.under_age ?? 0}</td>
                    <td className={styles.countCell}>{row.breakdown?.duplicate ?? 0}</td>
                  </>
                ) : null}
                {showRate ? <td className={styles.rateCell}>{formatRate(row.ratePct)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function SalesRankingsSection() {
  const { path } = useCompanyScope();
  const today = cairoWorkingDayToday();
  const [period, setPeriod] = useState<DateRange>(() => loadStoredPeriod() || { from: today, to: today });
  const [salesMode, setSalesMode] = useState<SalesMode>(loadSalesMode);
  const [checksFilter, setChecksFilter] = useState<ChecksFilter>(loadChecksFilter);

  useEffect(() => {
    sessionStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify(period));
  }, [period]);

  useEffect(() => {
    sessionStorage.setItem(SALES_MODE_KEY, salesMode);
  }, [salesMode]);

  useEffect(() => {
    sessionStorage.setItem(CHECKS_FILTER_KEY, checksFilter);
  }, [checksFilter]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["reports-sales-rankings", period.from, period.to, salesMode, checksFilter, path("")],
    queryFn: () =>
      api<{ report?: Report }>(
        path("/reports/sales-rankings", {
          from: period.from,
          to: period.to,
          dateBasis: "submission",
          salesMode,
          checksFilter,
        })
      ),
    enabled: Boolean(period.from && period.to),
  });

  const report = data?.report;
  const showRate = salesMode === "passed" || salesMode === "denied";
  const rateHeader = salesMode === "passed" ? "Passed %" : salesMode === "denied" ? "Denied %" : "Rate";

  if (error) {
    return <QueryErrorCard error={error as Error} onRetry={() => refetch()} />;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <section className={styles.section} aria-label="RPM sales rankings">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>RPM Sales</h2>
            <p className={styles.sectionSub}>Top agents (sent) and closers (closed)</p>
          </div>
          <FilterChips
            label="Sales status filter"
            options={SALES_MODES}
            value={salesMode}
            onChange={setSalesMode}
          />
        </div>
        {isLoading ? (
          <Skeleton lines={6} />
        ) : (
          <div className={styles.salesGrid}>
            <RankTable
              title="Top agents — RPM sent"
              rows={report?.agents || []}
              kind="sales"
              emptyLabel="No matching RPM sales for agents"
              showRate={showRate}
              rateHeader={rateHeader}
            />
            <RankTable
              title="Top closers — RPM closed"
              rows={report?.closers || []}
              kind="sales"
              emptyLabel="No matching RPM sales for closers"
              showRate={showRate}
              rateHeader={rateHeader}
              hideTeam
            />
          </div>
        )}
      </section>

      <section className={styles.section} aria-label="Checks rankings">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Checks</h2>
            <p className={styles.sectionSub}>Top agents by check volume</p>
          </div>
          <FilterChips
            label="Checks filter"
            options={CHECK_FILTERS}
            value={checksFilter}
            onChange={setChecksFilter}
          />
        </div>
        {isLoading ? (
          <Skeleton lines={4} />
        ) : (
          <RankTable
            title={`Top agents — checks (${checksFilter === "all" ? "all types" : checksFilter.toUpperCase()})`}
            rows={report?.checkAgents || []}
            kind="checks"
            emptyLabel="No checks in this period"
            showCheckStatusCols={checksFilter === "all"}
          />
        )}
      </section>
    </div>
  );
}
