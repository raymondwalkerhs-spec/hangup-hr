import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { formatTimeAmPm, calcEndTime24 } from "@/lib/breakTime";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { StatusPill } from "@/ui/StatusPill";
import styles from "./BreaksPage.module.css";

type Break = {
  id?: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  active?: boolean;
  unit?: string;
  role?: string;
};

export function BreaksPage() {
  const { path, companyContext } = useCompanyScope();
  const { data, isLoading, error } = useQuery({
    queryKey: ["breaks", companyContext],
    queryFn: () => api<{ breaks?: Break[]; activeBreak?: Break | null }>(path("/sales-config/breaks")),
  });

  const breaks = (data?.breaks || []).filter((b) => b.active !== false);
  const active = data?.activeBreak;

  return (
    <div>
      <SectionHeader title="Breaks" subtitle="Scheduled break times (Egypt time)" />

      <Card className={styles.section}>
        <h3>Current break</h3>
        {active ? (
          <>
            <p>
              <strong>{active.name}</strong> until {formatTimeAmPm(active.endTime)}
            </p>
            <p className="muted">
              {active.durationMinutes} minutes · {active.unit || "All units"}
            </p>
          </>
        ) : (
          <p className="muted">No active break for your unit/role right now.</p>
        )}
      </Card>

      <Card className={styles.section}>
        <h3>Today&apos;s schedules</h3>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <ul className={styles.list}>
            {breaks.map((b) => (
              <li key={b.id || b.name} className={styles.item}>
                <div>
                  <strong>{b.name}</strong>
                  <span className="muted">
                    {" · "}
                    {formatTimeAmPm(b.startTime)}
                    {" – "}
                    {formatTimeAmPm(b.endTime || calcEndTime24(b.startTime || "00:00", b.durationMinutes || 15))}
                  </span>
                </div>
                <div className={styles.meta}>
                  <StatusPill variant="ok">{b.durationMinutes || 0} min</StatusPill>
                  {b.unit && <span className="muted">{b.unit}</span>}
                  {b.role && <span className="muted">{b.role}</span>}
                </div>
              </li>
            ))}
            {!breaks.length && <li className="muted">No break schedules configured for today.</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
