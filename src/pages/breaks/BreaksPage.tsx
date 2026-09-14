import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { calcEndTime24, formatTimeAmPm } from "@/lib/breakTime";
import { BreakTimePicker } from "@/features/settings/BreakTimePicker";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/StatusPill";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { egyptTodayDateClient } from "@/lib/egyptDateClient";
import styles from "./BreaksPage.module.css";

type BreakRow = {
  id: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  message?: string;
  active?: boolean;
  units?: string[];
  roles?: string[];
  dialingOnly?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  company?: string;
};

type TakeRow = {
  id: string;
  breakName?: string;
  americanName?: string | null;
  employeeId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  allowedMinutes?: number;
  takenMinutes?: number;
  status?: string;
};

const ROLE_OPTIONS = ["agent", "tl", "op", "quality", "rtm", "hr", "admin", "finance", "ceo"];

function statusVariant(status?: string): "ok" | "warn" | "err" | "muted" {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "ok";
  if (s === "exceeded" || s === "overdue") return "err";
  if (s === "dismissed") return "muted";
  if (s === "in_progress") return "warn";
  return "muted";
}

function fmtClock(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function BreaksPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const { status } = useAppStatus();
  const user = status?.user || {};
  const canManage = ["rtm", "admin"].includes(String(user.role || ""));
  const units =
    companyContext === "hs2" ? ["HS-2"] : ["HS-1", "HS-3", "HS-Back-End", "HS-MGMT"];

  const [day, setDay] = useState(() => egyptTodayDateClient());
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    startTime: "12:00",
    durationMinutes: "15",
    message: "",
    dialingOnly: true,
    units: [] as string[],
    roles: [] as string[],
    effectiveFrom: "",
    effectiveTo: "",
  });
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: breaksData, isLoading: breaksLoading } = useQuery({
    queryKey: ["breaks", companyContext],
    queryFn: () =>
      api<{
        breaks?: BreakRow[];
        activeBreak?: BreakRow | null;
        openTake?: TakeRow | null;
        canManage?: boolean;
        notifierExtraRoles?: string[];
      }>(path("/sales-config/breaks")),
  });

  const { data: takesData, isLoading: takesLoading, error: takesError } = useQuery({
    queryKey: ["break-takes", companyContext, day, search],
    queryFn: () =>
      api<{ takes?: TakeRow[] }>(
        path(`/sales-config/breaks/takes?date=${encodeURIComponent(day)}&q=${encodeURIComponent(search)}`)
      ),
  });

  useEffect(() => {
    if (breaksData?.notifierExtraRoles) setExtraRoles(breaksData.notifierExtraRoles);
  }, [breaksData?.notifierExtraRoles]);

  const breaks = (breaksData?.breaks || []).filter((b) => b.active !== false || canManage);
  const active = breaksData?.activeBreak;
  const takes = takesData?.takes || [];

  const grouped = useMemo(() => {
    const map = new Map<string, TakeRow[]>();
    for (const t of takes) {
      const key = t.breakName || "Break";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()];
  }, [takes]);

  const addBreak = useMutation({
    mutationFn: () => {
      const durationMinutes = Number(form.durationMinutes) || 15;
      const startTime = form.startTime;
      return api(path("/sales-config/breaks"), {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          startTime,
          endTime: calcEndTime24(startTime, durationMinutes),
          durationMinutes,
          message: form.message,
          dialingOnly: form.dialingOnly,
          units: form.units,
          roles: form.roles,
          effectiveFrom: form.effectiveFrom || null,
          effectiveTo: form.effectiveTo || null,
        }),
      });
    },
    onSuccess: () => {
      setFormError(null);
      qc.invalidateQueries({ queryKey: ["breaks"] });
      setForm({
        name: "",
        startTime: "12:00",
        durationMinutes: "15",
        message: "",
        dialingOnly: true,
        units: [],
        roles: [],
        effectiveFrom: "",
        effectiveTo: "",
      });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const delBreak = useMutation({
    mutationFn: (id: string) =>
      api(path(`/sales-config/breaks/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["breaks"] }),
  });

  const saveNotifierRoles = useMutation({
    mutationFn: () =>
      api(path("/sales-config/breaks/notifier-roles"), {
        method: "PUT",
        body: JSON.stringify({ roles: extraRoles }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["breaks"] }),
  });

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div>
      <SectionHeader title="Breaks" subtitle="Egypt time · takes, schedules, and notifier targeting" />

      <Card className={styles.section}>
        <div className={styles.toolbar}>
          <label className={styles.fieldInline}>
            <span className="muted">Day</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className={styles.fieldInline}>
            <span className="muted">Search American name</span>
            <input
              type="search"
              placeholder="Name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {takesLoading && <p className="muted">Loading takes…</p>}
        {takesError && <p className={styles.err}>{(takesError as Error).message}</p>}
        {!takesLoading && !grouped.length && <p className="muted">No break takes for this day in your scope.</p>}
        {grouped.map(([name, rows]) => (
          <div key={name} className={styles.group}>
            <h3>{name}</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>American name</th>
                    <th>ID</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Allowed</th>
                    <th>Taken</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>{t.americanName || "—"}</td>
                      <td>{t.employeeId}</td>
                      <td>{fmtClock(t.startedAt)}</td>
                      <td>{fmtClock(t.endedAt)}</td>
                      <td>{t.allowedMinutes ?? "—"} min</td>
                      <td>{t.takenMinutes ?? "—"} min</td>
                      <td>
                        <StatusPill variant={statusVariant(t.status)}>
                          {String(t.status || "").replace(/_/g, " ") || "—"}
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Card>

      <Card className={styles.section}>
        <h3>Current break</h3>
        {active ? (
          <p>
            <strong>{active.name}</strong> · {active.durationMinutes} min ·{" "}
            {formatTimeAmPm(active.startTime)} – {formatTimeAmPm(active.endTime)}
          </p>
        ) : (
          <p className="muted">No active break window for you right now.</p>
        )}
      </Card>

      <Card className={styles.section}>
        <h3>Schedules</h3>
        {breaksLoading && <p className="muted">Loading…</p>}
        <ul className={styles.list}>
          {breaks.map((b) => (
            <li key={b.id} className={styles.item}>
              <div>
                <strong>{b.name}</strong>
                <span className="muted">
                  {" · "}
                  {formatTimeAmPm(b.startTime)} –{" "}
                  {formatTimeAmPm(b.endTime || calcEndTime24(b.startTime || "00:00", b.durationMinutes || 15))}
                </span>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {b.dialingOnly !== false ? "Dialing" : "Non-dialing OK"}
                  {b.units?.length ? ` · Units: ${b.units.join(", ")}` : ""}
                  {b.roles?.length ? ` · Roles: ${b.roles.join(", ")}` : ""}
                  {b.active === false ? " · Inactive" : ""}
                </div>
              </div>
              <div className={styles.meta}>
                <StatusPill variant="ok">{b.durationMinutes || 0} min</StatusPill>
                {canManage && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (confirm("Delete this break schedule?")) delBreak.mutate(b.id);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
          {!breaks.length && <li className="muted">No schedules configured.</li>}
        </ul>
      </Card>

      {canManage && (
        <Card className={styles.section}>
          <h3>Manage schedules</h3>
          <p className="muted">Create breaks for dialing teams, units, and/or roles. Times are Egypt local.</p>
          <FormGrid wide>
            <FormField label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>
            <BreakTimePicker
              label="Start time"
              value={form.startTime}
              durationMinutes={Number(form.durationMinutes) || 15}
              onChange={(startTime) => setForm({ ...form, startTime })}
            />
            <FormField label="Duration (minutes)">
              <input
                type="number"
                min={1}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </FormField>
            <FormField label="Message">
              <input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </FormField>
            <FormField label="Effective from">
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </FormField>
            <FormField label="Effective to">
              <input
                type="date"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </FormField>
          </FormGrid>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.dialingOnly}
              onChange={(e) => setForm({ ...form, dialingOnly: e.target.checked })}
            />
            Dialing agents only
          </label>
          <div className={styles.chipGroup}>
            <span className="muted">Units</span>
            {units.map((u) => (
              <label key={u} className={styles.chip}>
                <input
                  type="checkbox"
                  checked={form.units.includes(u)}
                  onChange={() => setForm({ ...form, units: toggleIn(form.units, u) })}
                />
                {u}
              </label>
            ))}
          </div>
          <div className={styles.chipGroup}>
            <span className="muted">Roles</span>
            {ROLE_OPTIONS.map((r) => (
              <label key={r} className={styles.chip}>
                <input
                  type="checkbox"
                  checked={form.roles.includes(r)}
                  onChange={() => setForm({ ...form, roles: toggleIn(form.roles, r) })}
                />
                {r}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => addBreak.mutate()}
            disabled={!form.name.trim() || addBreak.isPending}
          >
            {addBreak.isPending ? "Saving…" : "Add break"}
          </Button>
          {formError && <p className={styles.err}>{formError}</p>}

          <hr className={styles.divider} />
          <h4>Notifier extra roles</h4>
          <p className="muted">Default is dialing agents. Add roles that also see the break popup.</p>
          <div className={styles.chipGroup}>
            {ROLE_OPTIONS.map((r) => (
              <label key={r} className={styles.chip}>
                <input
                  type="checkbox"
                  checked={extraRoles.includes(r)}
                  onChange={() => setExtraRoles(toggleIn(extraRoles, r))}
                />
                {r}
              </label>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => saveNotifierRoles.mutate()} disabled={saveNotifierRoles.isPending}>
            Save notifier roles
          </Button>
        </Card>
      )}
    </div>
  );
}
