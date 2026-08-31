import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, monthLabel } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStore } from "@/stores/theme-store";
import { useCrossFilterStore } from "@/stores/cross-filter-store";
import type { StatusUser } from "@/lib/nav-access";
import { Button } from "@/ui/Button";
import styles from "./RpmWeeklySection.module.css";
import { LIVE_REFETCH_MS } from "@/lib/liveRefresh";

type CountMode = "passed" | "passed_pending" | "all";

type RankedEntity = {
  id: string;
  name: string;
  count: number;
  rank: number;
  sharePct?: number;
};

type TeamRow = {
  team: string;
  unit: string;
  count: number;
  targetCount: number | null;
  pct: number | null;
  colorBand: "red" | "amber" | "green" | "teal" | null;
};

type WeekBlock = {
  weekIndex: number;
  monday: string;
  friday: string;
  daysInMonth?: string[];
  total?: number;
  closers?: RankedEntity[];
  agents?: RankedEntity[];
  clients?: RankedEntity[];
  teams?: TeamRow[];
  unassignedCloserCount?: number;
  unassignedAgentCount?: number;
};

type RpmWeeklyPayload = {
  month: string;
  mode: CountMode;
  scope?: string;
  targetsAvailable?: boolean;
  truncated?: boolean;
  weeks?: WeekBlock[];
};

const MODE_KEY = "hangup-rpm-weekly-mode";
const MODES: { id: CountMode; label: string }[] = [
  { id: "passed", label: "Passed" },
  { id: "passed_pending", label: "Passed + Pending" },
  { id: "all", label: "All" },
];

const SCOPE_LABELS: Record<string, string> = {
  company: "All teams",
  unit: "Your unit",
  team: "Your team",
  scoped: "Scoped",
};

function loadMode(): CountMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === "passed" || raw === "passed_pending" || raw === "all") return raw;
  } catch {
    /* ignore */
  }
  return "passed";
}

function cairoToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

/** Monday (ISO) of the calendar week containing `iso` — matches backend rpm-weekly-dashboard. */
function mondayOfIso(iso: string) {
  const dt = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const day = dt.getDay();
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - ((day + 6) % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isCurrentWeek(week: WeekBlock, today: string) {
  return week.monday === mondayOfIso(today) || (today >= week.monday && today <= week.friday);
}

function defaultWeekIndex(weeks: WeekBlock[], today: string, month: string) {
  if (!weeks.length) return 0;
  const weekMonday = mondayOfIso(today);
  const byMonday = weeks.findIndex((w) => w.monday === weekMonday);
  if (byMonday >= 0) return byMonday;
  const inRange = weeks.findIndex((w) => today >= w.monday && today <= w.friday);
  if (inRange >= 0) return inRange;
  if (month === today.slice(0, 7)) {
    const started = weeks.map((w, i) => ({ w, i })).filter(({ w }) => w.monday <= today);
    if (started.length) return started[started.length - 1].i;
  }
  return 0;
}

/** Default tab: current Mon–Fri week (Sat/Sun still map to the week that started this Monday). */
function defaultWeekMonday(weeks: WeekBlock[], today: string, month: string) {
  if (!weeks.length) return null;
  const idx = defaultWeekIndex(weeks, today, month);
  return weeks[idx]?.monday ?? weeks[0].monday;
}

function resolveWeeks(data: RpmWeeklyPayload | undefined, month: string) {
  if (!Array.isArray(data?.weeks) || !data.weeks.length) return [];
  if (data.month && data.month !== month) return [];
  return data.weeks;
}

function shortRange(monday: string, friday: string) {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(monday)} – ${fmt(friday)}`;
}

function bandClass(band: TeamRow["colorBand"]) {
  if (band === "red") return styles.bandRed;
  if (band === "amber") return styles.bandAmber;
  if (band === "green") return styles.bandGreen;
  if (band === "teal") return styles.bandTeal;
  return "";
}

function fillClass(band: TeamRow["colorBand"]) {
  if (band === "red") return styles.fillRed;
  if (band === "amber") return styles.fillAmber;
  if (band === "green") return styles.fillGreen;
  if (band === "teal") return styles.fillTeal;
  return styles.fillAmber;
}

function RankedCards({
  title,
  emptyLabel,
  items,
  unassignedNote,
}: {
  title: string;
  emptyLabel: string;
  items: RankedEntity[];
  unassignedNote?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {!items.length ? (
        <p className={styles.empty}>{emptyLabel}</p>
      ) : (
        <div className={styles.cardRow}>
          {items.map((item) => {
            const expanded = openId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.card} ${expanded ? styles.cardExpanded : ""}`}
                title={item.name}
                aria-expanded={expanded}
                aria-label={`Rank ${item.rank}: ${item.name}, ${item.count} sales`}
                onClick={() => setOpenId(expanded ? null : item.id)}
              >
                <span className={styles.rank}>#{item.rank}</span>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.count}>{item.count}</span>
                {expanded && (
                  <span className={styles.detail}>
                    {item.sharePct ?? 0}% of week · ID {item.id}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {unassignedNote ? <p className={styles.mutedNote}>{unassignedNote}</p> : null}
    </div>
  );
}

function TeamTargets({
  week,
  canEdit,
  targetsAvailable,
  savingKey,
  onSave,
  onClear,
}: {
  week: WeekBlock;
  canEdit: boolean;
  targetsAvailable: boolean;
  savingKey: string | null;
  onSave: (team: TeamRow, value: number) => void;
  onClear: (team: TeamRow) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts({});
    setErrors({});
  }, [week.monday]);

  const teams = week.teams || [];

  return (
    <div>
      <h3 className={styles.sectionTitle}>Team targets</h3>
      {!targetsAvailable && (
        <p className={`${styles.banner} ${styles.bannerWarn}`}>
          Targets unavailable — run migration 20260828_rpm_team_week_targets.
        </p>
      )}
      {!teams.length ? (
        <p className={styles.empty}>No teams in scope for this week.</p>
      ) : (
        <div className={styles.teamList}>
          {teams.map((t) => {
            const key = `${t.unit}::${t.team}`;
            const draft =
              drafts[key] ?? (t.targetCount != null ? String(t.targetCount) : "");
            const busy = savingKey === key;
            const hasTarget = t.targetCount != null && t.targetCount > 0;
            const barWidth = hasTarget ? Math.min(100, t.pct ?? 0) : 0;
            return (
              <div key={key} className={styles.teamRow}>
                <div className={styles.teamTop}>
                  <span className={styles.teamName}>
                    {t.team}
                    {t.unit ? <span className={styles.mutedNote}> · {t.unit}</span> : null}
                  </span>
                  <span className={`${styles.teamMeta} ${bandClass(t.colorBand)}`}>
                    {hasTarget
                      ? `${t.count} / ${t.targetCount} · ${t.pct}%`
                      : `${t.count} · Set target`}
                  </span>
                </div>
                {hasTarget ? (
                  <div className={styles.barTrack} aria-hidden>
                    <div
                      className={`${styles.barFill} ${fillClass(t.colorBand)}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                ) : null}
                {canEdit && targetsAvailable ? (
                  <div className={styles.editRow}>
                    <input
                      className={styles.editInput}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Target for ${t.team}`}
                      value={draft}
                      disabled={busy}
                      onChange={(e) => {
                        setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        const n = Number(draft);
                        if (!Number.isInteger(n) || n < 1) {
                          setErrors((prev) => ({
                            ...prev,
                            [key]: "Enter a whole number ≥ 1",
                          }));
                          return;
                        }
                        onSave(t, n);
                      }}
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                    {hasTarget ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onClear(t)}
                      >
                        Clear
                      </Button>
                    ) : null}
                    {errors[key] ? <p className={styles.fieldError}>{errors[key]}</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RpmWeeklySection() {
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  const canView = user?.canViewRpmWeeklyDashboard === true;
  const canEdit = user?.canEditRpmWeeklyTargets === true;
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const teamFilter = useCrossFilterStore((s) => s.filters.team) || "";
  const qc = useQueryClient();
  const location = useLocation();

  const [mode, setMode] = useState<CountMode>(loadMode);
  /** null = auto-select current calendar week */
  const [manualMonday, setManualMonday] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const query = useQuery({
    queryKey: ["rpm-weekly", month, mode, companyContext, teamFilter],
    enabled: canView,
    placeholderData: keepPreviousData,
    staleTime: LIVE_REFETCH_MS - 500,
    refetchInterval: LIVE_REFETCH_MS,
    refetchIntervalInBackground: false,
    queryFn: () => {
      const q = new URLSearchParams({ month, mode });
      if (teamFilter) q.set("team", teamFilter);
      return api<RpmWeeklyPayload>(path(`/sales/rpm-weekly?${q}`));
    },
  });

  const dataMonth = query.data?.month;
  const weeks = useMemo(
    () => resolveWeeks(query.data, month),
    [query.data, month]
  );
  const weeksReady = weeks.length > 0 && (!dataMonth || dataMonth === month);
  const weeksKey = weeks.map((w) => w.monday).join("|");
  const today = cairoToday();

  const autoMonday = useMemo(
    () => defaultWeekMonday(weeks, today, month),
    [weeksKey, weeks.length, month, today]
  );

  useLayoutEffect(() => {
    setManualMonday(null);
  }, [location.pathname, month, companyContext]);

  const selectedMonday = useMemo(() => {
    if (manualMonday && weeks.some((w) => w.monday === manualMonday)) return manualMonday;
    return autoMonday;
  }, [manualMonday, autoMonday, weeksKey]);

  const activeWeek = weeks.find((w) => w.monday === selectedMonday) ?? null;

  const mutateTarget = useMutation({
    mutationFn: async (body: {
      team: string;
      unit: string;
      weekStart: string;
      targetCount: number | null;
      key: string;
    }) => {
      setSavingKey(body.key);
      setActionError(null);
      return api(path("/sales/rpm-weekly/targets"), {
        method: "PUT",
        body: JSON.stringify({
          team: body.team,
          unit: body.unit,
          weekStart: body.weekStart,
          targetCount: body.targetCount,
        }),
      });
    },
    onSuccess: async () => {
      setSavingKey(null);
      await qc.invalidateQueries({ queryKey: ["rpm-weekly", month] });
    },
    onError: (err: Error) => {
      setSavingKey(null);
      setActionError(err.message || "Failed to save target");
    },
  });

  const scopeLabel = useMemo(() => {
    if (teamFilter) return teamFilter;
    return SCOPE_LABELS[String(query.data?.scope || "")] || "Scoped";
  }, [query.data?.scope, teamFilter]);

  const hasData = Boolean(query.data);
  const showSkeleton = !hasData && (query.isLoading || query.isPending);
  const isBackgroundRefresh = query.isFetching && hasData;

  if (!canView) return null;

  return (
    <section
      className={`${styles.wrap} ${isBackgroundRefresh ? styles.wrapRefreshing : ""}`}
      aria-label="RPM weekly performance"
      aria-busy={isBackgroundRefresh || undefined}
    >
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h2>
            RPM weekly performance
            {isBackgroundRefresh ? (
              <span className={styles.liveDot} aria-hidden="true" title="Updating in background" />
            ) : null}
          </h2>
          <p className={styles.subtitle}>
            {monthLabel(month)} · {scopeLabel}
          </p>
        </div>
        <div
          className={styles.modeGroup}
          role="radiogroup"
          aria-label="Count mode"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={`${styles.modeBtn} ${mode === m.id ? styles.modeBtnActive : ""}`}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {showSkeleton ? (
        <div className={styles.skeletonGrid} aria-busy="true" aria-label="Loading weekly performance">
          <div className={styles.skeletonRow}>
            <div className={styles.skelCard} />
            <div className={styles.skelCard} />
            <div className={styles.skelCard} />
          </div>
          <div className={styles.skelTeam} />
          <div className={styles.skelTeam} />
        </div>
      ) : query.isError ? (
        <div className={styles.errorBox}>
          <span>{(query.error as Error)?.message || "Failed to load weekly performance"}</span>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {query.data?.truncated ? (
            <p className={`${styles.banner} ${styles.bannerWarn}`}>
              Sales list was truncated — rankings may undercount. Narrow the month or contact admin.
            </p>
          ) : null}
          {actionError ? (
            <p className={`${styles.banner} ${styles.bannerWarn}`}>{actionError}</p>
          ) : null}

          <div className={styles.weekPills} role="tablist" aria-label="Weeks">
            {weeks.map((w) => {
              const isActive = w.monday === selectedMonday;
              const isCurrent = isCurrentWeek(w, today);
              return (
                <button
                  key={w.monday}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`${styles.weekPill} ${isActive ? styles.weekPillActive : ""}`}
                  onClick={() => setManualMonday(w.monday)}
                >
                  Week {w.weekIndex} · {shortRange(w.monday, w.friday)}
                  {isCurrent && !isActive ? " · current" : ""}
                </button>
              );
            })}
          </div>

          {!weeksReady || !activeWeek ? (
            <p className={styles.empty}>
              {!hasData && query.isFetching ? "Loading weeks…" : "No weeks in this month."}
            </p>
          ) : (
            <div>
              <RankedCards
                title="Top closers"
                emptyLabel="No closers this week"
                items={activeWeek.closers || []}
                unassignedNote={
                  activeWeek.unassignedCloserCount
                    ? `${activeWeek.unassignedCloserCount} sale(s) with no closer`
                    : undefined
                }
              />
              <RankedCards
                title="Top agents"
                emptyLabel="No agents this week"
                items={activeWeek.agents || []}
                unassignedNote={
                  activeWeek.unassignedAgentCount
                    ? `${activeWeek.unassignedAgentCount} sale(s) with no agent`
                    : undefined
                }
              />
              <RankedCards
                title="Clients"
                emptyLabel="No clients this week"
                items={activeWeek.clients || []}
              />
              <TeamTargets
                week={activeWeek}
                canEdit={canEdit}
                targetsAvailable={query.data?.targetsAvailable !== false}
                savingKey={savingKey}
                onSave={(team, value) =>
                  mutateTarget.mutate({
                    team: team.team,
                    unit: team.unit,
                    weekStart: activeWeek.monday,
                    targetCount: value,
                    key: `${team.unit}::${team.team}`,
                  })
                }
                onClear={(team) =>
                  mutateTarget.mutate({
                    team: team.team,
                    unit: team.unit,
                    weekStart: activeWeek.monday,
                    targetCount: null,
                    key: `${team.unit}::${team.team}`,
                  })
                }
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
